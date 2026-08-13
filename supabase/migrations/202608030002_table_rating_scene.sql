begin;

-- V3 dish participation lifecycle. A new enum avoids leaving the legacy
-- `skipped` value available to new clients.
drop trigger if exists ratings_validate on public.ratings;
drop trigger if exists ratings_sync_progress on public.ratings;
drop trigger if exists consumers_reopen_participant on public.dish_consumers;

create type public.consumer_status_v3 as enum ('unopened', 'opened', 'rated', 'not_eaten');

alter table public.dish_consumers alter column status drop default;
alter table public.dish_consumers
  alter column status type public.consumer_status_v3
  using (
    case status::text
      when 'completed' then 'rated'
      when 'not_eaten' then 'not_eaten'
      when 'skipped' then 'opened'
      else 'unopened'
    end
  )::public.consumer_status_v3;

drop type public.consumer_status;
alter type public.consumer_status_v3 rename to consumer_status;

alter table public.dish_consumers
  alter column status set default 'unopened'::public.consumer_status,
  add column opened_at timestamptz,
  add column resume_status public.consumer_status;

alter table public.dishes
  add column category text not null default 'other'
    check (category in ('vegetable', 'rice', 'noodle', 'bread_pizza', 'dumpling', 'meat', 'seafood', 'soup', 'drink', 'dessert', 'other')),
  add column visual_recipe jsonb not null default '{"category":"other","vessel":"plate","base":"other-base","palette":"coral","seed":0}'::jsonb;

update public.dishes
set category = case
  when kind = 'seafood' then 'seafood'
  when kind = 'meat' then 'meat'
  when kind = 'dessert' then 'dessert'
  else 'other'
end,
visual_recipe = jsonb_build_object(
  'category', case
    when kind = 'seafood' then 'seafood'
    when kind = 'meat' then 'meat'
    when kind = 'dessert' then 'dessert'
    else 'other'
  end,
  'vessel', 'plate',
  'base', concat(kind, '-base'),
  'palette', 'coral',
  'seed', abs(hashtext(name))
);

alter table public.visit_participants add column ready_at timestamptz;
alter table public.ratings rename column submitted_at to rated_at;

create or replace function public.is_active_dish_consumer(target_dish uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dish_consumers dc
    join public.dishes d on d.id = dc.dish_id
    where dc.dish_id = target_dish
      and dc.user_id = auth.uid()
      and (
        dc.status in ('opened', 'rated')
        or (d.is_overall and dc.status = 'unopened')
      )
  );
$$;

create or replace function public.protect_dish_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_status public.visit_status;
begin
  select status into target_status from public.visits where id = old.visit_id;
  if target_status <> 'active' then
    raise exception 'Revealed visits must be reopened before editing';
  end if;
  if exists (select 1 from public.ratings where dish_id = old.id)
    and not public.is_global_admin()
    and (
      new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.kind is distinct from old.kind
      or new.category is distinct from old.category
      or new.visual_recipe is distinct from old.visual_recipe
      or new.course_order is distinct from old.course_order
      or new.is_overall is distinct from old.is_overall
      or new.confirmation is distinct from old.confirmation
      or new.deleted_at is distinct from old.deleted_at
    )
  then
    raise exception 'Dish structure is locked after the first rating';
  end if;
  return new;
end;
$$;

create or replace function public.bootstrap_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  overall_id uuid;
begin
  insert into public.visit_participants (visit_id, user_id)
  values (new.id, new.created_by);

  insert into public.dishes (
    visit_id, name, description, kind, category, visual_recipe,
    course_order, is_overall, confirmation, created_by, confirmed_by, confirmed_at
  ) values (
    new.id,
    '整體用餐',
    '餐點 · 服務 · 氣氛 · 是否想再訪',
    'overall',
    'other',
    '{"category":"other","vessel":"plate","base":"overall-base","palette":"gold","seed":0}'::jsonb,
    999,
    true,
    'confirmed',
    new.created_by,
    new.created_by,
    now()
  ) returning id into overall_id;

  insert into public.dish_consumers (dish_id, user_id, status)
  values (overall_id, new.created_by, 'unopened');
  return new;
end;
$$;

create or replace function public.bootstrap_participant_overall()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.dish_consumers (dish_id, user_id, status)
  select id, new.user_id, 'unopened'::public.consumer_status
  from public.dishes
  where visit_id = new.visit_id and is_overall and deleted_at is null
  on conflict (dish_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.validate_rating_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
  target_is_overall boolean;
begin
  select visit_id, is_overall into target_visit, target_is_overall
  from public.dishes where id = new.dish_id and deleted_at is null;

  if not exists (
    select 1 from public.dish_consumers
    where dish_id = new.dish_id
      and user_id = new.user_id
      and (
        status in ('opened', 'rated')
        or (target_is_overall and status = 'unopened')
      )
  ) then
    raise exception 'Open an assigned dish before rating it';
  end if;

  if target_is_overall and exists (
    select 1
    from public.dish_consumers dc
    join public.dishes d on d.id = dc.dish_id
    where d.visit_id = target_visit
      and not d.is_overall
      and d.deleted_at is null
      and dc.user_id = new.user_id
      and dc.status not in ('rated', 'not_eaten')
  ) then
    raise exception 'Finish or mark every assigned dish not eaten before the overall rating';
  end if;
  return new;
end;
$$;

create or replace function public.sync_rating_progress()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
begin
  update public.dish_consumers
  set status = 'rated', opened_at = coalesce(opened_at, now())
  where dish_id = new.dish_id and user_id = new.user_id;

  select visit_id into target_visit from public.dishes where id = new.dish_id;
  update public.visit_participants
  set ready_at = null, completed_at = null
  where visit_id = target_visit and user_id = new.user_id and excluded_at is null;
  return new;
end;
$$;

create or replace function public.reopen_participant_for_new_dish()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
  target_is_overall boolean;
begin
  select visit_id, is_overall into target_visit, target_is_overall from public.dishes where id = new.dish_id;
  if not target_is_overall and new.status not in ('rated', 'not_eaten') then
    update public.visit_participants
    set ready_at = null, completed_at = null
    where visit_id = target_visit and user_id = new.user_id and excluded_at is null;
  end if;
  return new;
end;
$$;

create trigger ratings_validate before insert or update on public.ratings
for each row execute function public.validate_rating_submission();
create trigger ratings_sync_progress after insert or update on public.ratings
for each row execute function public.sync_rating_progress();
create trigger consumers_reopen_participant after insert or update on public.dish_consumers
for each row execute function public.reopen_participant_for_new_dish();

create or replace function public.set_visit_ready(target_visit uuid, ready boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  everyone_ready boolean;
begin
  if not public.is_visit_participant(target_visit) then
    raise exception 'Not a participant';
  end if;
  if public.visit_is_revealed(target_visit) then
    raise exception 'Visit already revealed';
  end if;

  if ready and exists (
    select 1
    from public.dish_consumers dc
    join public.dishes d on d.id = dc.dish_id
    where d.visit_id = target_visit
      and d.deleted_at is null
      and dc.user_id = auth.uid()
      and dc.status not in ('rated', 'not_eaten')
  ) then
    raise exception 'Finish every assigned dish and TOTAL before becoming ready';
  end if;

  update public.visit_participants
  set ready_at = case when ready then now() else null end,
      completed_at = case when ready then now() else null end
  where visit_id = target_visit and user_id = auth.uid() and excluded_at is null;

  select not exists (
    select 1 from public.visit_participants
    where visit_id = target_visit and excluded_at is null and ready_at is null
  ) into everyone_ready;
  return everyone_ready;
end;
$$;

create or replace function public.reveal_visit(target_visit uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.visits%rowtype;
  next_version integer;
  result_snapshot jsonb;
begin
  select * into target from public.visits where id = target_visit and deleted_at is null for update;
  if not found then raise exception 'Visit not found'; end if;
  if not public.is_visit_participant(target_visit) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target.status <> 'active' then return target.current_result_version; end if;
  if exists (
    select 1 from public.visit_participants
    where visit_id = target_visit and excluded_at is null and ready_at is null
  ) then
    raise exception 'Everyone must be ready before reveal';
  end if;

  next_version := target.current_result_version + 1;
  select jsonb_build_object(
    'visitId', target_visit,
    'version', next_version,
    'revealedAt', now(),
    'revealIndividualScores', target.reveal_individual_scores,
    'dishes', coalesce(jsonb_agg(dish_result order by course_order), '[]'::jsonb)
  ) into result_snapshot
  from (
    select
      d.course_order,
      jsonb_strip_nulls(jsonb_build_object(
        'dishId', d.id,
        'name', d.name,
        'kind', d.kind,
        'category', d.category,
        'visualRecipe', d.visual_recipe,
        'isOverall', d.is_overall,
        'average', round(avg(r.score)::numeric, 1),
        'ratingCount', count(r.score),
        'individualScores', case when target.reveal_individual_scores then
          coalesce(jsonb_agg(
            jsonb_build_object('userId', r.user_id, 'name', p.display_name, 'score', r.score, 'reasons', r.reasons)
            order by p.display_name
          ) filter (where r.user_id is not null), '[]'::jsonb)
        else null end
      )) as dish_result
    from public.dishes d
    left join public.ratings r on r.dish_id = d.id
    left join public.profiles p on p.id = r.user_id
    where d.visit_id = target_visit and d.deleted_at is null
    group by d.id
  ) results;

  insert into public.result_versions (visit_id, version, snapshot, reveal_individual_scores, created_by)
  values (target_visit, next_version, result_snapshot, target.reveal_individual_scores, auth.uid());
  update public.visits
  set status = 'revealed', revealed_at = now(), current_result_version = next_version
  where id = target_visit;
  return next_version;
end;
$$;

grant execute on function public.set_visit_ready(uuid, boolean) to authenticated;

-- Reading the base consumer table is now self-only. Other participants use a
-- sanitized progress view so `opened` remains private until the first rating.
drop policy if exists consumers_read_visit on public.dish_consumers;
create policy consumers_read_self on public.dish_consumers for select to authenticated using (
  user_id = auth.uid() or public.is_global_admin()
);

create or replace view public.dish_consumer_progress
with (security_barrier = true)
as
select
  dc.dish_id,
  dc.user_id,
  case
    when dc.status = 'rated' then 'rated'
    when dc.status = 'not_eaten' then 'not_eaten'
    else 'unopened'
  end as public_status,
  dc.updated_at
from public.dish_consumers dc
where public.is_visit_participant(public.rating_visit_id(dc.dish_id));

grant select on public.dish_consumer_progress to authenticated, service_role;

commit;
