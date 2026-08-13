begin;

create extension if not exists pgcrypto;

create type public.visit_status as enum ('active', 'revealed', 'closed');
create type public.dish_confirmation as enum ('draft', 'confirmed');
create type public.consumer_status as enum ('pending', 'completed', 'not_eaten', 'skipped');

create table public.allowlist (
  email text primary key check (email = lower(email)),
  active boolean not null default true,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_recipe jsonb not null default '{}'::jsonb,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  branch_name text,
  address text,
  latitude double precision,
  longitude double precision,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  room_code text not null unique check (room_code ~ '^[0-9]{6}$'),
  status public.visit_status not null default 'active',
  reveal_individual_scores boolean not null default true,
  current_result_version integer not null default 0 check (current_result_version >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revealed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  deleted_at timestamptz
);

create or replace function public.generate_room_code()
returns text language sql volatile as $$
  select lpad((floor(random() * 1000000))::integer::text, 6, '0');
$$;

alter table public.visits alter column room_code set default public.generate_room_code();

create table public.visit_participants (
  visit_id uuid not null references public.visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  excluded_at timestamptz,
  primary key (visit_id, user_id)
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  description text,
  kind text not null default 'other',
  course_order numeric(8, 3) not null,
  is_overall boolean not null default false,
  confirmation public.dish_confirmation not null default 'draft',
  price numeric(12, 2) check (price is null or price >= 0),
  created_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index dishes_one_overall_per_visit on public.dishes(visit_id) where is_overall and deleted_at is null;
create unique index dishes_course_order_per_visit on public.dishes(visit_id, course_order) where deleted_at is null;
create index dishes_visit_order_idx on public.dishes(visit_id, course_order) where deleted_at is null;

create table public.dish_consumers (
  dish_id uuid not null references public.dishes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  status public.consumer_status not null default 'pending',
  updated_at timestamptz not null default now(),
  primary key (dish_id, user_id)
);

create table public.ratings (
  dish_id uuid not null references public.dishes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  score smallint not null check (score between 0 and 100),
  reasons text[] not null default '{}',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dish_id, user_id),
  check (cardinality(reasons) <= 3)
);
create index ratings_dish_idx on public.ratings(dish_id);

create table public.dish_revisions (
  id bigint generated always as identity primary key,
  dish_id uuid not null references public.dishes(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create table public.result_versions (
  visit_id uuid not null references public.visits(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  reveal_individual_scores boolean not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (visit_id, version)
);

create table public.visit_revisions (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.visits(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('reopen', 'close', 'restore')),
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger restaurants_touch_updated_at before update on public.restaurants for each row execute function public.touch_updated_at();
create trigger dishes_touch_updated_at before update on public.dishes for each row execute function public.touch_updated_at();
create trigger dish_consumers_touch_updated_at before update on public.dish_consumers for each row execute function public.touch_updated_at();
create trigger ratings_touch_updated_at before update on public.ratings for each row execute function public.touch_updated_at();

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.id <> auth.uid() or lower(new.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) or new.is_admin then
      raise exception 'Invalid profile bootstrap';
    end if;
  elsif new.email is distinct from old.email then
    raise exception 'Profile email cannot be changed here';
  elsif new.is_admin is distinct from old.is_admin and not public.is_global_admin() then
    raise exception 'Only Admin can change Admin privileges';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_privileges before insert or update on public.profiles for each row execute function public.protect_profile_privileges();

create or replace function public.is_allowlisted()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  );
$$;

create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin and deleted_at is null
  );
$$;

create or replace function public.is_visit_participant(target_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.visit_participants
    where visit_id = target_visit and user_id = auth.uid() and excluded_at is null
  );
$$;

create or replace function public.visit_is_revealed(target_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.visits
    where id = target_visit and status in ('revealed', 'closed')
  );
$$;

create or replace function public.visit_allows_individual_scores(target_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.visits
    where id = target_visit
      and status in ('revealed', 'closed')
      and reveal_individual_scores
  );
$$;

create or replace function public.rating_visit_id(target_dish uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select visit_id from public.dishes where id = target_dish;
$$;

create or replace function public.is_active_dish_consumer(target_dish uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dish_consumers
    where dish_id = target_dish
      and user_id = auth.uid()
      and status in ('pending', 'completed')
  );
$$;

grant execute on function public.is_allowlisted() to authenticated;
grant execute on function public.is_global_admin() to authenticated;
grant execute on function public.is_visit_participant(uuid) to authenticated;
grant execute on function public.visit_is_revealed(uuid) to authenticated;
grant execute on function public.visit_allows_individual_scores(uuid) to authenticated;
grant execute on function public.rating_visit_id(uuid) to authenticated;
grant execute on function public.is_active_dish_consumer(uuid) to authenticated;

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

create trigger dishes_protect_structure before update on public.dishes for each row execute function public.protect_dish_structure();

create or replace function public.bootstrap_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  overall_id uuid;
begin
  insert into public.visit_participants (visit_id, user_id)
  values (new.id, new.created_by);

  insert into public.dishes (
    visit_id, name, description, kind, course_order, is_overall,
    confirmation, created_by, confirmed_by, confirmed_at
  ) values (
    new.id, '整體用餐', '餐點 · 服務 · 氣氛 · 是否想再訪', 'overall', 999,
    true, 'confirmed', new.created_by, new.created_by, now()
  ) returning id into overall_id;

  insert into public.dish_consumers (dish_id, user_id, status)
  values (overall_id, new.created_by, 'pending');
  return new;
end;
$$;

create trigger visits_bootstrap after insert on public.visits for each row execute function public.bootstrap_visit();

create or replace function public.bootstrap_participant_overall()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.dish_consumers (dish_id, user_id, status)
  select id, new.user_id, 'pending'::public.consumer_status
  from public.dishes
  where visit_id = new.visit_id and is_overall and deleted_at is null
  on conflict (dish_id, user_id) do nothing;
  return new;
end;
$$;

create trigger participants_bootstrap_overall after insert on public.visit_participants for each row execute function public.bootstrap_participant_overall();

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
    where dish_id = new.dish_id and user_id = new.user_id and status in ('pending', 'completed')
  ) then
    raise exception 'Only assigned consumers can rate this dish';
  end if;

  if target_is_overall and exists (
    select 1
    from public.dish_consumers dc
    join public.dishes d on d.id = dc.dish_id
    where d.visit_id = target_visit
      and not d.is_overall
      and d.deleted_at is null
      and dc.user_id = new.user_id
      and dc.status = 'pending'
  ) then
    raise exception 'Finish or skip every assigned dish before the overall rating';
  end if;
  return new;
end;
$$;

create trigger ratings_validate before insert or update on public.ratings for each row execute function public.validate_rating_submission();

create or replace function public.sync_rating_progress()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
  target_is_overall boolean;
begin
  update public.dish_consumers
  set status = 'completed'
  where dish_id = new.dish_id and user_id = new.user_id;

  select visit_id, is_overall into target_visit, target_is_overall from public.dishes where id = new.dish_id;
  if target_is_overall then
    update public.visit_participants
    set completed_at = coalesce(completed_at, now())
    where visit_id = target_visit and user_id = new.user_id and excluded_at is null;
  end if;
  return new;
end;
$$;

create trigger ratings_sync_progress after insert or update on public.ratings for each row execute function public.sync_rating_progress();

create or replace function public.reopen_participant_for_new_dish()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
  target_is_overall boolean;
begin
  select visit_id, is_overall into target_visit, target_is_overall from public.dishes where id = new.dish_id;
  if not target_is_overall and new.status = 'pending' then
    update public.visit_participants
    set completed_at = null
    where visit_id = target_visit and user_id = new.user_id and excluded_at is null;
  end if;
  return new;
end;
$$;

create trigger consumers_reopen_participant after insert or update on public.dish_consumers for each row execute function public.reopen_participant_for_new_dish();

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
    where visit_id = target_visit and excluded_at is null and completed_at is null
  ) then
    raise exception 'Everyone must complete or be excluded before reveal';
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

create or replace function public.reopen_visit(target_visit uuid, reopen_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.visits%rowtype;
begin
  if not public.is_global_admin() then raise exception 'Admin required'; end if;
  if char_length(trim(coalesce(reopen_reason, ''))) < 3 then
    raise exception 'A reopen reason is required';
  end if;

  select * into target
  from public.visits
  where id = target_visit and deleted_at is null
  for update;
  if not found then raise exception 'Visit not found'; end if;
  if target.status = 'active' then raise exception 'Visit is already active'; end if;

  update public.visits
  set status = 'active', revealed_at = null
  where id = target_visit;

  insert into public.visit_revisions (
    visit_id, actor_id, action, reason, before_value, after_value
  ) values (
    target_visit,
    auth.uid(),
    'reopen',
    trim(reopen_reason),
    jsonb_build_object(
      'status', target.status,
      'revealedAt', target.revealed_at,
      'resultVersion', target.current_result_version
    ),
    jsonb_build_object(
      'status', 'active',
      'revealedAt', null,
      'resultVersion', target.current_result_version
    )
  );
end;
$$;

grant execute on function public.reveal_visit(uuid) to authenticated;
grant execute on function public.reopen_visit(uuid, text) to authenticated;

alter table public.allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.visits enable row level security;
alter table public.visit_participants enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_consumers enable row level security;
alter table public.ratings enable row level security;
alter table public.dish_revisions enable row level security;
alter table public.result_versions enable row level security;
alter table public.visit_revisions enable row level security;

create policy allowlist_admin_all on public.allowlist for all to authenticated using (public.is_global_admin()) with check (public.is_global_admin());

create policy profiles_read_friends on public.profiles for select to authenticated using (public.is_allowlisted() and deleted_at is null);
create policy profiles_insert_self on public.profiles for insert to authenticated with check (public.is_allowlisted() and id = auth.uid());
create policy profiles_update_self_or_admin on public.profiles for update to authenticated using (id = auth.uid() or public.is_global_admin()) with check (id = auth.uid() or public.is_global_admin());

create policy restaurants_read_friends on public.restaurants for select to authenticated using (public.is_allowlisted() and deleted_at is null);
create policy restaurants_insert_friends on public.restaurants for insert to authenticated with check (public.is_allowlisted() and created_by = auth.uid());
create policy restaurants_update_friends on public.restaurants for update to authenticated using (public.is_allowlisted()) with check (public.is_allowlisted());

create policy visits_read_friends on public.visits for select to authenticated using (public.is_allowlisted() and deleted_at is null);
create policy visits_insert_friends on public.visits for insert to authenticated with check (public.is_allowlisted() and created_by = auth.uid());
-- Visit reveal/reopen state is changed only by a trusted server function or Admin.
create policy visits_update_admin on public.visits for update to authenticated using (public.is_global_admin()) with check (public.is_global_admin());

create policy participants_read_friends on public.visit_participants for select to authenticated using (public.is_allowlisted());
create policy participants_join_self on public.visit_participants for insert to authenticated with check (public.is_allowlisted() and user_id = auth.uid());
create policy participants_update_self_or_admin on public.visit_participants for update to authenticated using (user_id = auth.uid() or public.is_global_admin()) with check (user_id = auth.uid() or public.is_global_admin());

create policy dishes_read_friends on public.dishes for select to authenticated using (public.is_allowlisted() and deleted_at is null);
create policy dishes_insert_participants on public.dishes for insert to authenticated with check (public.is_visit_participant(visit_id) and created_by = auth.uid());
create policy dishes_update_participants on public.dishes for update to authenticated using (public.is_visit_participant(visit_id) or public.is_global_admin()) with check (public.is_visit_participant(visit_id) or public.is_global_admin());

create policy consumers_read_visit on public.dish_consumers for select to authenticated using (public.is_visit_participant(public.rating_visit_id(dish_id)));
create policy consumers_insert_self on public.dish_consumers for insert to authenticated with check (user_id = auth.uid() and public.is_visit_participant(public.rating_visit_id(dish_id)));
create policy consumers_update_self_or_admin on public.dish_consumers for update to authenticated using (user_id = auth.uid() or public.is_global_admin()) with check (user_id = auth.uid() or public.is_global_admin());

-- Critical privacy boundary: even Admin cannot read another person's score before reveal.
create policy ratings_read_owner_or_revealed on public.ratings for select to authenticated using (
  user_id = auth.uid()
  or public.visit_allows_individual_scores(public.rating_visit_id(dish_id))
);
create policy ratings_insert_owner on public.ratings for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_visit_participant(public.rating_visit_id(dish_id))
  and public.is_active_dish_consumer(dish_id)
  and not public.visit_is_revealed(public.rating_visit_id(dish_id))
);
create policy ratings_update_owner_before_reveal on public.ratings for update to authenticated using (
  user_id = auth.uid()
  and public.is_active_dish_consumer(dish_id)
  and not public.visit_is_revealed(public.rating_visit_id(dish_id))
) with check (
  user_id = auth.uid()
  and public.is_active_dish_consumer(dish_id)
  and not public.visit_is_revealed(public.rating_visit_id(dish_id))
);

create policy revisions_read_participants on public.dish_revisions for select to authenticated using (public.is_visit_participant(public.rating_visit_id(dish_id)) or public.is_global_admin());
create policy revisions_insert_participants on public.dish_revisions for insert to authenticated with check (actor_id = auth.uid() and public.is_visit_participant(public.rating_visit_id(dish_id)));
create policy results_read_friends on public.result_versions for select to authenticated using (public.is_allowlisted());
create policy results_admin_insert on public.result_versions for insert to authenticated with check (public.is_global_admin());
create policy visit_revisions_read_participants on public.visit_revisions for select to authenticated using (
  public.is_visit_participant(visit_id) or public.is_global_admin()
);

alter publication supabase_realtime add table public.visits;
alter publication supabase_realtime add table public.visit_participants;
alter publication supabase_realtime add table public.dishes;
alter publication supabase_realtime add table public.dish_consumers;

-- This project opts out of automatically exposing new public tables.
-- Grant only the operations used by signed-in friends; RLS still decides rows.
grant usage on schema public to authenticated, service_role;
grant all privileges on table
  public.allowlist,
  public.profiles,
  public.restaurants,
  public.visits,
  public.visit_participants,
  public.dishes,
  public.dish_consumers,
  public.ratings,
  public.dish_revisions,
  public.result_versions,
  public.visit_revisions
to service_role;
grant select, insert, update, delete on public.allowlist to authenticated;
grant select, insert, update on
  public.profiles,
  public.restaurants,
  public.visits,
  public.visit_participants,
  public.dishes,
  public.dish_consumers,
  public.ratings
to authenticated;
grant select, insert on public.dish_revisions, public.result_versions to authenticated;
grant select on public.visit_revisions to authenticated;

commit;
