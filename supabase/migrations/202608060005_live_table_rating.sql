begin;

-- Realtime-safe progress contains no private score and intentionally collapses
-- unopened/opened into the same public state.
create table public.dish_public_progress (
  dish_id uuid not null references public.dishes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  public_status text not null check (public_status in ('unopened', 'rated', 'not_eaten')),
  updated_at timestamptz not null default now(),
  primary key (dish_id, user_id)
);

create or replace function public.sync_public_dish_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.dish_public_progress
    where dish_id = old.dish_id and user_id = old.user_id;
    return old;
  end if;

  insert into public.dish_public_progress (dish_id, user_id, public_status, updated_at)
  values (
    new.dish_id,
    new.user_id,
    case
      when new.status = 'rated' then 'rated'
      when new.status = 'not_eaten' then 'not_eaten'
      else 'unopened'
    end,
    now()
  )
  on conflict (dish_id, user_id) do update
  set public_status = excluded.public_status,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

create trigger dish_consumers_sync_public_progress
after insert or update or delete on public.dish_consumers
for each row execute function public.sync_public_dish_progress();

insert into public.dish_public_progress (dish_id, user_id, public_status, updated_at)
select
  dc.dish_id,
  dc.user_id,
  case
    when dc.status = 'rated' then 'rated'
    when dc.status = 'not_eaten' then 'not_eaten'
    else 'unopened'
  end,
  dc.updated_at
from public.dish_consumers dc
on conflict (dish_id, user_id) do update
set public_status = excluded.public_status,
    updated_at = excluded.updated_at;

alter table public.dish_public_progress enable row level security;
create policy dish_public_progress_read_participants
on public.dish_public_progress for select to authenticated
using (public.is_visit_participant(public.rating_visit_id(dish_id)));
grant select on public.dish_public_progress to authenticated;
grant all privileges on public.dish_public_progress to service_role;
alter publication supabase_realtime add table public.dish_public_progress;

-- A participant joining an existing room receives every current dish. The
-- original function name is retained so the existing trigger keeps working.
create or replace function public.bootstrap_participant_overall()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.dish_consumers (dish_id, user_id, status)
  select id, new.user_id, 'unopened'::public.consumer_status
  from public.dishes
  where visit_id = new.visit_id and deleted_at is null
  on conflict (dish_id, user_id) do nothing;
  return new;
end;
$$;

-- Repair rooms created before this migration.
insert into public.dish_consumers (dish_id, user_id, status)
select d.id, vp.user_id, 'unopened'::public.consumer_status
from public.dishes d
join public.visit_participants vp on vp.visit_id = d.visit_id and vp.excluded_at is null
join public.visits v on v.id = d.visit_id and v.status = 'active' and v.deleted_at is null
where d.deleted_at is null
on conflict (dish_id, user_id) do nothing;

create or replace function public.create_visit_dish(
  target_visit uuid,
  dish_name text,
  dish_kind text,
  dish_category text,
  dish_visual_recipe jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_dish uuid;
  next_order numeric(8, 3);
begin
  if not public.is_visit_participant(target_visit) then raise exception 'Not a participant'; end if;
  if exists (select 1 from public.visits where id = target_visit and status <> 'active') then
    raise exception 'Visit is not active';
  end if;
  if char_length(trim(dish_name)) < 1 or char_length(trim(dish_name)) > 180 then
    raise exception 'Invalid dish name';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_visit::text));
  select coalesce(max(course_order), 0) + 1 into next_order
  from public.dishes
  where visit_id = target_visit and not is_overall and deleted_at is null;

  insert into public.dishes (
    visit_id, name, kind, category, visual_recipe, course_order,
    is_overall, confirmation, created_by
  ) values (
    target_visit, trim(dish_name), dish_kind, dish_category, dish_visual_recipe,
    next_order, false, 'draft', auth.uid()
  ) returning id into created_dish;

  insert into public.dish_consumers (dish_id, user_id, status)
  select created_dish, user_id, 'unopened'::public.consumer_status
  from public.visit_participants
  where visit_id = target_visit and excluded_at is null
  on conflict (dish_id, user_id) do nothing;

  return created_dish;
end;
$$;

grant execute on function public.create_visit_dish(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.reorder_visit_dishes(target_visit uuid, ordered_dish_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  if not public.is_visit_participant(target_visit) then raise exception 'Not a participant'; end if;
  if exists (select 1 from public.visits where id = target_visit and status <> 'active') then
    raise exception 'Visit is not active';
  end if;

  select count(*) into expected_count
  from public.dishes
  where visit_id = target_visit and not is_overall and deleted_at is null;

  if cardinality(ordered_dish_ids) <> expected_count
    or exists (
      select 1 from unnest(ordered_dish_ids) as requested(id)
      left join public.dishes d on d.id = requested.id
      where d.id is null or d.visit_id <> target_visit or d.is_overall or d.deleted_at is not null
    )
    or (select count(distinct requested.id) from unnest(ordered_dish_ids) as requested(id)) <> expected_count
  then
    raise exception 'Dish order is incomplete';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_visit::text));
  update public.dishes d
  set course_order = -1000 - item.ordinality
  from unnest(ordered_dish_ids) with ordinality as item(id, ordinality)
  where d.id = item.id;

  update public.dishes d
  set course_order = item.ordinality
  from unnest(ordered_dish_ids) with ordinality as item(id, ordinality)
  where d.id = item.id;
  return true;
end;
$$;

grant execute on function public.reorder_visit_dishes(uuid, uuid[]) to authenticated;

commit;
