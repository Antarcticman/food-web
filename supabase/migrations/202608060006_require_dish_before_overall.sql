-- An empty visit previously looked "complete" because it had zero unfinished
-- dishes. Require at least one real dish before TOTAL can be rated, marked
-- ready, or revealed. The UI mirrors these rules, but the database remains the
-- final guard for older clients and concurrent tabs.

create or replace function public.require_dish_before_overall_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_visit uuid;
  target_is_overall boolean;
begin
  select visit_id, is_overall
  into target_visit, target_is_overall
  from public.dishes
  where id = new.dish_id and deleted_at is null;

  if target_is_overall and not exists (
    select 1
    from public.dishes
    where visit_id = target_visit
      and not is_overall
      and deleted_at is null
  ) then
    raise exception 'Add at least one dish before rating the overall visit';
  end if;

  return new;
end;
$$;

drop trigger if exists ratings_require_real_dish on public.ratings;
create trigger ratings_require_real_dish
before insert or update on public.ratings
for each row execute function public.require_dish_before_overall_rating();

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

  if ready and not exists (
    select 1
    from public.dishes
    where visit_id = target_visit
      and not is_overall
      and deleted_at is null
  ) then
    raise exception 'Add at least one dish before finishing the visit';
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

create or replace function public.prevent_empty_visit_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active'
    and new.status = 'revealed'
    and not exists (
      select 1
      from public.dishes
      where visit_id = new.id
        and not is_overall
        and deleted_at is null
    )
  then
    raise exception 'Add at least one dish before revealing the visit';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_prevent_empty_reveal on public.visits;
create trigger visits_prevent_empty_reveal
before update of status on public.visits
for each row execute function public.prevent_empty_visit_reveal();

grant execute on function public.set_visit_ready(uuid, boolean) to authenticated;
