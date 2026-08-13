begin;

-- Restaurants are shared identities, while visits remain separate dining events.
-- Keep the canonical identity stable and store the names friends actually typed
-- as searchable aliases.
create or replace function public.normalize_restaurant_name(raw_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(trim(coalesce(raw_name, ''))), '[[:space:][:punct:]]+', '', 'g');
$$;

create table public.restaurant_brands (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (char_length(trim(canonical_name)) between 1 and 160),
  normalized_name text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.restaurants
  add column brand_id uuid references public.restaurant_brands(id),
  add column normalized_name text,
  add column map_url text check (map_url is null or char_length(map_url) <= 1200),
  add column location_accuracy_m double precision check (location_accuracy_m is null or location_accuracy_m >= 0),
  add column merged_into_id uuid references public.restaurants(id);

update public.restaurants
set normalized_name = public.normalize_restaurant_name(name)
where normalized_name is null;

alter table public.restaurants alter column normalized_name set not null;
create index restaurants_normalized_name_idx
on public.restaurants (normalized_name)
where deleted_at is null;
create index restaurants_brand_idx
on public.restaurants (brand_id)
where brand_id is not null and deleted_at is null;
create index restaurants_location_idx
on public.restaurants (latitude, longitude)
where latitude is not null and longitude is not null and deleted_at is null;

create or replace function public.sync_restaurant_normalized_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.normalized_name := public.normalize_restaurant_name(new.name);
  if new.normalized_name = '' then raise exception 'Restaurant name cannot be empty'; end if;
  return new;
end;
$$;

create trigger restaurants_sync_normalized_name
before insert or update of name on public.restaurants
for each row execute function public.sync_restaurant_normalized_name();

create trigger restaurant_brands_touch_updated_at
before update on public.restaurant_brands
for each row execute function public.touch_updated_at();

create table public.restaurant_aliases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  alias text not null check (char_length(trim(alias)) between 1 and 160),
  normalized_alias text not null,
  source text not null default 'user' check (source in ('user', 'merge', 'admin')),
  merge_revision_id bigint,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index restaurant_aliases_identity_idx
on public.restaurant_aliases (restaurant_id, normalized_alias);
create index restaurant_aliases_search_idx
on public.restaurant_aliases (normalized_alias);

create or replace function public.sync_restaurant_alias_normalized_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.alias := trim(new.alias);
  new.normalized_alias := public.normalize_restaurant_name(new.alias);
  if new.normalized_alias = '' then raise exception 'Restaurant alias cannot be empty'; end if;
  return new;
end;
$$;

create trigger restaurant_aliases_sync_normalized_name
before insert or update of alias on public.restaurant_aliases
for each row execute function public.sync_restaurant_alias_normalized_name();

create table public.restaurant_revisions (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('create', 'location_added', 'canonical_updated', 'merge', 'merge_undo')),
  reason text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create table public.restaurant_merge_revisions (
  id bigint generated always as identity primary key,
  source_restaurant_id uuid not null references public.restaurants(id),
  target_restaurant_id uuid not null references public.restaurants(id),
  actor_id uuid not null references public.profiles(id),
  moved_visit_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id),
  check (source_restaurant_id <> target_restaurant_id)
);

alter table public.restaurant_aliases
  add constraint restaurant_aliases_merge_revision_fkey
  foreign key (merge_revision_id) references public.restaurant_merge_revisions(id) on delete cascade;

-- A member may create restaurants, but canonical identity edits are Admin-only.
-- Filling a missing coordinate is performed through the trusted RPC below.
drop policy if exists restaurants_update_friends on public.restaurants;
create policy restaurants_update_admin
on public.restaurants for update to authenticated
using (public.is_global_admin())
with check (public.is_global_admin());

alter table public.restaurant_brands enable row level security;
alter table public.restaurant_aliases enable row level security;
alter table public.restaurant_revisions enable row level security;
alter table public.restaurant_merge_revisions enable row level security;

create policy restaurant_brands_read_friends
on public.restaurant_brands for select to authenticated
using (public.is_allowlisted() and deleted_at is null);
create policy restaurant_brands_admin_all
on public.restaurant_brands for all to authenticated
using (public.is_global_admin()) with check (public.is_global_admin());

create policy restaurant_aliases_read_friends
on public.restaurant_aliases for select to authenticated
using (public.is_allowlisted());
create policy restaurant_aliases_insert_friends
on public.restaurant_aliases for insert to authenticated
with check (public.is_allowlisted() and created_by = auth.uid() and source = 'user');
create policy restaurant_aliases_admin_update
on public.restaurant_aliases for update to authenticated
using (public.is_global_admin()) with check (public.is_global_admin());

create policy restaurant_revisions_read_friends
on public.restaurant_revisions for select to authenticated
using (public.is_allowlisted());
create policy restaurant_merge_revisions_admin_read
on public.restaurant_merge_revisions for select to authenticated
using (public.is_global_admin());

-- The beta has one active room per restaurant. The advisory lock makes the
-- rule reliable even when two friends tap the CTA at nearly the same moment.
create or replace function public.prevent_parallel_active_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and new.expires_at > now() and new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtext(new.restaurant_id::text));
    if exists (
      select 1 from public.visits v
      where v.restaurant_id = new.restaurant_id
        and v.id <> new.id
        and v.status = 'active'
        and v.expires_at > now()
        and v.deleted_at is null
    ) then
      raise exception 'ACTIVE_VISIT_EXISTS';
    end if;
  end if;
  return new;
end;
$$;

create trigger visits_prevent_parallel_active
before insert or update of status, restaurant_id, expires_at, deleted_at on public.visits
for each row execute function public.prevent_parallel_active_visit();

alter table public.visits
  alter column expires_at set default (now() + interval '12 hours');

create or replace function public.create_or_join_visit(
  p_restaurant_id uuid,
  p_restaurant_name text,
  p_branch_name text default null,
  p_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_accuracy_m double precision default null,
  p_map_url text default null,
  p_save_location boolean default false,
  p_requested_alias text default null
)
returns table (
  visit_id uuid,
  restaurant_id uuid,
  joined_existing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_latitude double precision;
  existing_longitude double precision;
  canonical_normalized text;
  cleaned_name text;
  cleaned_branch text;
  cleaned_address text;
  cleaned_map_url text;
begin
  if not public.is_allowlisted() then raise exception 'Not allowlisted'; end if;

  cleaned_name := trim(coalesce(p_restaurant_name, ''));
  cleaned_branch := nullif(trim(coalesce(p_branch_name, '')), '');
  cleaned_address := nullif(trim(coalesce(p_address, '')), '');
  cleaned_map_url := nullif(trim(coalesce(p_map_url, '')), '');

  if p_restaurant_id is not null then
    select coalesce(r.merged_into_id, r.id), r.latitude, r.longitude, r.normalized_name
    into restaurant_id, existing_latitude, existing_longitude, canonical_normalized
    from public.restaurants r
    where r.id = p_restaurant_id;
    if restaurant_id is null then raise exception 'Restaurant not found'; end if;

    if p_save_location
      and existing_latitude is null and existing_longitude is null
      and p_latitude is not null and p_longitude is not null
    then
      update public.restaurants r
      set latitude = p_latitude,
          longitude = p_longitude,
          location_accuracy_m = p_location_accuracy_m
      where r.id = restaurant_id;

      insert into public.restaurant_revisions (
        restaurant_id, actor_id, action, before_value, after_value
      ) values (
        restaurant_id, auth.uid(), 'location_added',
        jsonb_build_object('latitude', existing_latitude, 'longitude', existing_longitude),
        jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude, 'accuracyM', p_location_accuracy_m)
      );
    end if;
  else
    if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 160 then
      raise exception 'Invalid restaurant name';
    end if;
    if cleaned_branch is not null and char_length(cleaned_branch) > 160 then
      raise exception 'Invalid branch name';
    end if;

    insert into public.restaurants (
      name, branch_name, address, latitude, longitude, location_accuracy_m,
      map_url, created_by
    ) values (
      cleaned_name, cleaned_branch, cleaned_address,
      case when p_save_location then p_latitude else null end,
      case when p_save_location then p_longitude else null end,
      case when p_save_location then p_location_accuracy_m else null end,
      cleaned_map_url, auth.uid()
    ) returning id, normalized_name into restaurant_id, canonical_normalized;

    insert into public.restaurant_revisions (
      restaurant_id, actor_id, action, after_value
    ) values (
      restaurant_id, auth.uid(), 'create',
      jsonb_build_object('name', cleaned_name, 'branchName', cleaned_branch, 'address', cleaned_address)
    );
  end if;

  if p_requested_alias is not null
    and public.normalize_restaurant_name(p_requested_alias) <> ''
    and public.normalize_restaurant_name(p_requested_alias) <> canonical_normalized
  then
    insert into public.restaurant_aliases (
      restaurant_id, alias, normalized_alias, source, created_by
    ) values (
      restaurant_id, trim(p_requested_alias), public.normalize_restaurant_name(p_requested_alias), 'user', auth.uid()
    ) on conflict (restaurant_id, normalized_alias) do nothing;
  end if;

  perform pg_advisory_xact_lock(hashtext(restaurant_id::text));
  select v.id into visit_id
  from public.visits v
  where v.restaurant_id = restaurant_id
    and v.status = 'active'
    and v.expires_at > now()
    and v.deleted_at is null
  order by v.created_at desc
  limit 1
  for update;

  if visit_id is not null then
    joined_existing := true;
    insert into public.visit_participants (visit_id, user_id, excluded_at)
    values (visit_id, auth.uid(), null)
    on conflict (visit_id, user_id) do update set excluded_at = null;
  else
    joined_existing := false;
    insert into public.visits (restaurant_id, created_by, expires_at)
    values (restaurant_id, auth.uid(), now() + interval '12 hours')
    returning id into visit_id;
  end if;

  return next;
end;
$$;

grant execute on function public.create_or_join_visit(
  uuid, text, text, text, double precision, double precision,
  double precision, text, boolean, text
) to authenticated;

create or replace function public.close_stale_visit(p_visit_id uuid, p_reason text default 'Admin closed a stale table')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.visits%rowtype;
begin
  if not public.is_global_admin() then raise exception 'Admin required'; end if;
  select * into target from public.visits where id = p_visit_id and deleted_at is null for update;
  if not found then raise exception 'Visit not found'; end if;
  if target.status <> 'active' then return; end if;
  if target.created_at > now() - interval '6 hours' then raise exception 'Visit is not stale yet'; end if;

  update public.visits set status = 'closed' where id = p_visit_id;
  insert into public.visit_revisions (
    visit_id, actor_id, action, reason, before_value, after_value
  ) values (
    p_visit_id, auth.uid(), 'close', coalesce(nullif(trim(p_reason), ''), 'Admin closed a stale table'),
    jsonb_build_object('status', target.status), jsonb_build_object('status', 'closed')
  );
end;
$$;

grant execute on function public.close_stale_visit(uuid, text) to authenticated;

-- Admin-only, reversible duplicate merge. Visits move to the canonical target;
-- source dish identities remain immutable, so historical result snapshots and
-- rating links stay valid. Undo moves only the recorded visit ids back.
create or replace function public.merge_restaurants(
  p_source_restaurant uuid,
  p_target_restaurant uuid,
  p_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  source_record public.restaurants%rowtype;
  target_record public.restaurants%rowtype;
  moved_visits uuid[];
  revision_id bigint;
begin
  if not public.is_global_admin() then raise exception 'Admin required'; end if;
  if p_source_restaurant = p_target_restaurant then raise exception 'Choose two restaurants'; end if;

  perform pg_advisory_xact_lock(hashtext(least(p_source_restaurant::text, p_target_restaurant::text)));
  select * into source_record from public.restaurants where id = p_source_restaurant for update;
  select * into target_record from public.restaurants where id = p_target_restaurant and deleted_at is null for update;
  if source_record.id is null or target_record.id is null then raise exception 'Restaurant not found'; end if;
  if source_record.merged_into_id is not null then raise exception 'Source restaurant is already merged'; end if;
  if exists (
    select 1 from public.visits
    where restaurant_id = p_source_restaurant and status = 'active'
      and expires_at > now() and deleted_at is null
  ) then raise exception 'Close the source active table before merging'; end if;

  select coalesce(array_agg(v.id), '{}'::uuid[]) into moved_visits
  from public.visits v where v.restaurant_id = p_source_restaurant;

  insert into public.restaurant_merge_revisions (
    source_restaurant_id, target_restaurant_id, actor_id, moved_visit_ids
  ) values (
    p_source_restaurant, p_target_restaurant, auth.uid(), moved_visits
  ) returning id into revision_id;

  insert into public.restaurant_aliases (
    restaurant_id, alias, normalized_alias, source, merge_revision_id, created_by
  ) values (
    p_target_restaurant, source_record.name, source_record.normalized_name,
    'merge', revision_id, auth.uid()
  ) on conflict (restaurant_id, normalized_alias) do nothing;

  insert into public.restaurant_aliases (
    restaurant_id, alias, normalized_alias, source, merge_revision_id, created_by
  )
  select p_target_restaurant, a.alias, a.normalized_alias, 'merge', revision_id, auth.uid()
  from public.restaurant_aliases a
  where a.restaurant_id = p_source_restaurant
  on conflict (restaurant_id, normalized_alias) do nothing;

  update public.visits set restaurant_id = p_target_restaurant
  where id = any(moved_visits);
  update public.restaurants
  set merged_into_id = p_target_restaurant, deleted_at = now()
  where id = p_source_restaurant;

  insert into public.restaurant_revisions (
    restaurant_id, actor_id, action, reason, before_value, after_value
  ) values (
    p_source_restaurant, auth.uid(), 'merge', nullif(trim(coalesce(p_reason, '')), ''),
    jsonb_build_object('name', source_record.name, 'visitIds', moved_visits),
    jsonb_build_object('mergedIntoId', p_target_restaurant, 'revisionId', revision_id)
  );
  return revision_id;
end;
$$;

create or replace function public.undo_restaurant_merge(p_revision_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  merge_record public.restaurant_merge_revisions%rowtype;
begin
  if not public.is_global_admin() then raise exception 'Admin required'; end if;
  select * into merge_record
  from public.restaurant_merge_revisions
  where id = p_revision_id for update;
  if not found then raise exception 'Merge revision not found'; end if;
  if merge_record.undone_at is not null then return; end if;

  update public.visits
  set restaurant_id = merge_record.source_restaurant_id
  where id = any(merge_record.moved_visit_ids)
    and restaurant_id = merge_record.target_restaurant_id;
  delete from public.restaurant_aliases
  where merge_revision_id = p_revision_id and source = 'merge';
  update public.restaurants
  set merged_into_id = null, deleted_at = null
  where id = merge_record.source_restaurant_id;
  update public.restaurant_merge_revisions
  set undone_at = now(), undone_by = auth.uid()
  where id = p_revision_id;

  insert into public.restaurant_revisions (
    restaurant_id, actor_id, action, after_value
  ) values (
    merge_record.source_restaurant_id, auth.uid(), 'merge_undo',
    jsonb_build_object('revisionId', p_revision_id)
  );
end;
$$;

grant execute on function public.merge_restaurants(uuid, uuid, text) to authenticated;
grant execute on function public.undo_restaurant_merge(bigint) to authenticated;

grant select, insert, update on public.restaurant_brands to authenticated;
grant select, insert, update, delete on public.restaurant_aliases to authenticated;
grant select on public.restaurant_revisions, public.restaurant_merge_revisions to authenticated;
grant all privileges on table
  public.restaurant_brands,
  public.restaurant_aliases,
  public.restaurant_revisions,
  public.restaurant_merge_revisions
to service_role;

commit;
