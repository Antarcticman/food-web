begin;

-- Stable restaurant-level dishes let separate visits contribute to one
-- long-term leaderboard without overwriting the original visit menu.
create table public.restaurant_dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 180),
  normalized_name text not null check (char_length(normalized_name) between 1 and 180),
  version_label text check (version_label is null or char_length(trim(version_label)) between 1 and 80),
  category text not null default 'other'
    check (category in ('vegetable', 'rice', 'noodle', 'bread_pizza', 'dumpling', 'meat', 'seafood', 'soup', 'drink', 'dessert', 'other')),
  visual_recipe jsonb not null default '{"category":"other","vessel":"plate","base":"other-base","palette":"coral","seed":0}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index restaurant_dishes_identity_idx
on public.restaurant_dishes (restaurant_id, normalized_name, coalesce(version_label, ''))
where deleted_at is null;

create index restaurant_dishes_restaurant_idx
on public.restaurant_dishes (restaurant_id, display_name)
where deleted_at is null;

create trigger restaurant_dishes_touch_updated_at
before update on public.restaurant_dishes
for each row execute function public.touch_updated_at();

create or replace function public.normalize_dish_name(raw_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(trim(coalesce(raw_name, ''))), '[[:space:][:punct:]]+', '', 'g');
$$;

alter table public.dishes
  add column restaurant_dish_id uuid references public.restaurant_dishes(id),
  add column catalog_version_label text
    check (catalog_version_label is null or char_length(trim(catalog_version_label)) between 1 and 80);

create index dishes_restaurant_dish_idx
on public.dishes (restaurant_dish_id)
where restaurant_dish_id is not null and deleted_at is null;

-- Preserve existing visit history when this migration is applied to a database
-- that already contains rated visits.
insert into public.restaurant_dishes (
  restaurant_id, display_name, normalized_name, version_label,
  category, visual_recipe, created_by, created_at, updated_at
)
select distinct on (
  v.restaurant_id,
  public.normalize_dish_name(d.name),
  coalesce(d.catalog_version_label, '')
)
  v.restaurant_id,
  d.name,
  public.normalize_dish_name(d.name),
  d.catalog_version_label,
  d.category,
  d.visual_recipe,
  d.created_by,
  d.created_at,
  d.updated_at
from public.dishes d
join public.visits v on v.id = d.visit_id
where not d.is_overall
  and d.deleted_at is null
  and v.deleted_at is null
  and public.normalize_dish_name(d.name) <> ''
order by
  v.restaurant_id,
  public.normalize_dish_name(d.name),
  coalesce(d.catalog_version_label, ''),
  d.created_at
on conflict do nothing;

update public.dishes d
set restaurant_dish_id = rd.id
from public.visits v, public.restaurant_dishes rd
where v.id = d.visit_id
  and rd.restaurant_id = v.restaurant_id
  and rd.normalized_name = public.normalize_dish_name(d.name)
  and coalesce(rd.version_label, '') = coalesce(d.catalog_version_label, '')
  and rd.deleted_at is null
  and not d.is_overall
  and d.deleted_at is null;

-- Exact normalized names link automatically through this RPC. Near matches are
-- intentionally not guessed: the client must show a confirmation choice and
-- pass the selected restaurant dish id.
create or replace function public.link_restaurant_dish(
  target_dish uuid,
  requested_restaurant_dish uuid default null,
  requested_version_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
  linked_id uuid;
  normalized text;
  cleaned_version text;
begin
  select d.id, d.visit_id, d.name, d.category, d.visual_recipe, d.created_by,
         d.is_overall, v.restaurant_id, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is null and v.deleted_at is null;

  if not found then raise exception 'Dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating cannot be linked as a restaurant dish'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' and not public.is_global_admin() then
    raise exception 'Reopen the visit before changing its restaurant dish link';
  end if;

  cleaned_version := nullif(trim(requested_version_label), '');
  normalized := public.normalize_dish_name(target_record.name);
  if normalized = '' then raise exception 'Dish name cannot be normalized'; end if;

  if requested_restaurant_dish is not null then
    select id, version_label into linked_id, cleaned_version
    from public.restaurant_dishes
    where id = requested_restaurant_dish
      and restaurant_id = target_record.restaurant_id
      and deleted_at is null;
    if linked_id is null then raise exception 'Restaurant dish does not belong to this restaurant'; end if;
  else
    select id into linked_id
    from public.restaurant_dishes
    where restaurant_id = target_record.restaurant_id
      and normalized_name = normalized
      and coalesce(version_label, '') = coalesce(cleaned_version, '')
      and deleted_at is null;

    if linked_id is null then
      begin
        insert into public.restaurant_dishes (
          restaurant_id, display_name, normalized_name, version_label,
          category, visual_recipe, created_by
        ) values (
          target_record.restaurant_id, target_record.name, normalized, cleaned_version,
          target_record.category, target_record.visual_recipe, auth.uid()
        ) returning id into linked_id;
      exception when unique_violation then
        select id into linked_id
        from public.restaurant_dishes
        where restaurant_id = target_record.restaurant_id
          and normalized_name = normalized
          and coalesce(version_label, '') = coalesce(cleaned_version, '')
          and deleted_at is null;
      end;
    end if;
  end if;

  update public.dishes
  set restaurant_dish_id = linked_id,
      catalog_version_label = cleaned_version
  where id = target_dish;

  return linked_id;
end;
$$;

grant execute on function public.link_restaurant_dish(uuid, uuid, text) to authenticated;

-- A viewed marker is per immutable result version, so reopening a visit and
-- creating a new version correctly enables the reveal again.
create table public.result_views (
  visit_id uuid not null,
  version integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (visit_id, version, user_id),
  foreign key (visit_id, version)
    references public.result_versions(visit_id, version) on delete cascade
);

create index result_views_user_idx on public.result_views(user_id, viewed_at desc);

create or replace function public.mark_result_viewed(target_visit uuid, target_version integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  marked_at timestamptz;
begin
  if not public.is_visit_participant(target_visit) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if not exists (
    select 1 from public.result_versions
    where visit_id = target_visit and version = target_version
  ) then
    raise exception 'Result version not found';
  end if;

  insert into public.result_views (visit_id, version, user_id)
  values (target_visit, target_version, auth.uid())
  on conflict (visit_id, version, user_id)
  do update set viewed_at = excluded.viewed_at
  returning viewed_at into marked_at;

  return marked_at;
end;
$$;

grant execute on function public.mark_result_viewed(uuid, integer) to authenticated;

-- Aggregate in a security-definer function: friends can read safe restaurant
-- totals even when a visit chose not to reveal individual raw scores.
create or replace function public.get_restaurant_dish_leaderboard(target_restaurant uuid)
returns table (
  restaurant_dish_id uuid,
  display_name text,
  category text,
  visual_recipe jsonb,
  average numeric,
  people_count bigint,
  rating_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_allowlisted() then raise exception 'Not allowlisted'; end if;
  if not exists (
    select 1 from public.restaurants
    where id = target_restaurant and deleted_at is null
  ) then raise exception 'Restaurant not found'; end if;

  return query
  with per_person as (
    select
      d.restaurant_dish_id,
      r.user_id,
      avg(r.score)::numeric as person_average,
      count(*)::bigint as person_rating_count
    from public.ratings r
    join public.dishes d on d.id = r.dish_id
    join public.visits v on v.id = d.visit_id
    join public.restaurant_dishes rd on rd.id = d.restaurant_dish_id
    where v.restaurant_id = target_restaurant
      and v.status in ('revealed', 'closed')
      and v.deleted_at is null
      and d.deleted_at is null
      and not d.is_overall
      and rd.deleted_at is null
    group by d.restaurant_dish_id, r.user_id
  )
  select
    rd.id,
    rd.display_name,
    rd.category,
    rd.visual_recipe,
    round(avg(pp.person_average), 1) as average,
    count(*)::bigint as people_count,
    sum(pp.person_rating_count)::bigint as rating_count
  from per_person pp
  join public.restaurant_dishes rd on rd.id = pp.restaurant_dish_id
  group by rd.id
  order by 5 desc, 6 desc, rd.display_name;
end;
$$;

grant execute on function public.get_restaurant_dish_leaderboard(uuid) to authenticated;

-- Include the canonical dish id and versioned ranking rules in future immutable
-- snapshots. Existing result versions remain untouched and readable.
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
    'schemaVersion', 2,
    'visitId', target_visit,
    'version', next_version,
    'revealedAt', now(),
    'revealIndividualScores', target.reveal_individual_scores,
    'rankingRules', jsonb_build_object(
      'minimumDishCount', 3,
      'minimumPodiumScore', 60,
      'tieRule', 'average_and_rating_count',
      'personWeighting', 'equal_after_person_visit_average'
    ),
    'dishes', coalesce(jsonb_agg(dish_result order by course_order), '[]'::jsonb)
  ) into result_snapshot
  from (
    select
      d.course_order,
      jsonb_strip_nulls(jsonb_build_object(
        'dishId', d.id,
        'restaurantDishId', d.restaurant_dish_id,
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

-- Protect the newly added canonical link after rating starts, matching the rest
-- of the dish structure fields.
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
      or new.restaurant_dish_id is distinct from old.restaurant_dish_id
      or new.catalog_version_label is distinct from old.catalog_version_label
      or new.deleted_at is distinct from old.deleted_at
    )
  then
    raise exception 'Dish structure is locked after the first rating';
  end if;
  return new;
end;
$$;

alter table public.restaurant_dishes enable row level security;
alter table public.result_views enable row level security;

create policy restaurant_dishes_read_friends
on public.restaurant_dishes for select to authenticated
using (public.is_allowlisted() and deleted_at is null);

create policy restaurant_dishes_insert_friends
on public.restaurant_dishes for insert to authenticated
with check (public.is_allowlisted() and created_by = auth.uid());

create policy restaurant_dishes_update_friends
on public.restaurant_dishes for update to authenticated
using (public.is_allowlisted())
with check (public.is_allowlisted());

create policy result_views_read_self
on public.result_views for select to authenticated
using (user_id = auth.uid() or public.is_global_admin());

create policy result_views_insert_self
on public.result_views for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_visit_participant(visit_id)
);

create policy result_views_update_self
on public.result_views for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant all privileges on table public.restaurant_dishes, public.result_views to service_role;
grant select, insert, update on public.restaurant_dishes, public.result_views to authenticated;

commit;
