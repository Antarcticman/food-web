begin;

-- Friend-beta menu correction tools. All mutations stay behind trusted RPCs so
-- collaborators can fix mistakes without receiving broad table permissions.
create or replace function public.reset_visit_after_menu_change(target_visit uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ratings r
  using public.dishes d
  where r.dish_id = d.id
    and d.visit_id = target_visit
    and d.is_overall
    and d.deleted_at is null;

  update public.dish_consumers dc
  set status = 'unopened'::public.consumer_status,
      resume_status = null,
      opened_at = null,
      updated_at = now()
  from public.dishes d
  where dc.dish_id = d.id
    and d.visit_id = target_visit
    and d.is_overall
    and d.deleted_at is null;

  update public.visit_participants
  set ready_at = null,
      completed_at = null
  where visit_id = target_visit and excluded_at is null;
end;
$$;

revoke all on function public.reset_visit_after_menu_change(uuid) from public, anon, authenticated;

create or replace function public.update_visit_dish_details(
  target_dish uuid,
  requested_name text,
  requested_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
  cleaned_name text;
  cleaned_description text;
  name_changed boolean;
begin
  select d.id, d.visit_id, d.name, d.description, d.confirmation,
         d.restaurant_dish_id, d.is_overall, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is null and v.deleted_at is null;

  if not found then raise exception 'Dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating cannot be renamed'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' then raise exception 'Reopen the visit before editing'; end if;
  if exists (select 1 from public.ratings where dish_id = target_dish) and not public.is_global_admin() then
    raise exception 'This dish already has ratings; ask Admin to correct it';
  end if;

  cleaned_name := trim(coalesce(requested_name, ''));
  cleaned_description := nullif(trim(coalesce(requested_description, '')), '');
  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 180 then
    raise exception 'Dish name must be 1 to 180 characters';
  end if;
  if char_length(coalesce(cleaned_description, '')) > 400 then
    raise exception 'Description is too long';
  end if;

  name_changed := cleaned_name is distinct from target_record.name;
  update public.dishes
  set name = cleaned_name,
      description = cleaned_description,
      confirmation = case when name_changed then 'draft'::public.dish_confirmation else confirmation end,
      confirmed_by = case when name_changed then null else confirmed_by end,
      confirmed_at = case when name_changed then null else confirmed_at end,
      restaurant_dish_id = case when name_changed then null else restaurant_dish_id end,
      catalog_version_label = case when name_changed then null else catalog_version_label end
  where id = target_dish;

  insert into public.dish_revisions (dish_id, actor_id, action, before_value, after_value)
  values (
    target_dish,
    auth.uid(),
    'details_updated',
    jsonb_build_object('name', target_record.name, 'description', target_record.description),
    jsonb_build_object('name', cleaned_name, 'description', cleaned_description)
  );

  update public.visit_participants
  set ready_at = null,
      completed_at = null
  where visit_id = target_record.visit_id and excluded_at is null;
end;
$$;

grant execute on function public.update_visit_dish_details(uuid, text, text) to authenticated;

create or replace function public.set_visit_dish_consumers(
  target_dish uuid,
  requested_users uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
  cleaned_users uuid[];
begin
  select d.id, d.visit_id, d.is_overall, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is null and v.deleted_at is null;

  if not found then raise exception 'Dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating is assigned to everyone'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' then raise exception 'Reopen the visit before editing'; end if;

  select coalesce(array_agg(distinct requested.user_id), '{}'::uuid[])
  into cleaned_users
  from unnest(coalesce(requested_users, '{}'::uuid[])) as requested(user_id);

  if cardinality(cleaned_users) = 0 then raise exception 'Choose at least one diner'; end if;
  if exists (
    select 1
    from unnest(cleaned_users) as requested(user_id)
    left join public.visit_participants vp
      on vp.visit_id = target_record.visit_id
      and vp.user_id = requested.user_id
      and vp.excluded_at is null
    where vp.user_id is null
  ) then
    raise exception 'A selected diner is not in this table';
  end if;

  -- A normal save should not invalidate the overall score when the assignment
  -- did not actually change.
  if not exists (
      select 1 from public.dish_consumers dc
      where dc.dish_id = target_dish and not (dc.user_id = any(cleaned_users))
    )
    and not exists (
      select 1 from unnest(cleaned_users) as requested(user_id)
      where not exists (
        select 1 from public.dish_consumers dc
        where dc.dish_id = target_dish and dc.user_id = requested.user_id
      )
    )
  then
    return;
  end if;

  if exists (
    select 1
    from public.dish_consumers dc
    join public.ratings r on r.dish_id = dc.dish_id and r.user_id = dc.user_id
    where dc.dish_id = target_dish
      and not (dc.user_id = any(cleaned_users))
  ) then
    raise exception 'A diner who already rated this dish cannot be removed';
  end if;

  insert into public.dish_consumers (dish_id, user_id, status)
  select target_dish, requested.user_id, 'unopened'::public.consumer_status
  from unnest(cleaned_users) as requested(user_id)
  on conflict (dish_id, user_id) do nothing;

  delete from public.dish_consumers dc
  where dc.dish_id = target_dish
    and not (dc.user_id = any(cleaned_users))
    and not exists (
      select 1 from public.ratings r
      where r.dish_id = dc.dish_id and r.user_id = dc.user_id
    );

  insert into public.dish_revisions (dish_id, actor_id, action, after_value)
  values (
    target_dish,
    auth.uid(),
    'consumers_updated',
    jsonb_build_object('userIds', to_jsonb(cleaned_users))
  );

  perform public.reset_visit_after_menu_change(target_record.visit_id);
end;
$$;

grant execute on function public.set_visit_dish_consumers(uuid, uuid[]) to authenticated;

create or replace function public.delete_visit_dish(target_dish uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
begin
  select d.id, d.visit_id, d.name, d.is_overall, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is null and v.deleted_at is null;

  if not found then raise exception 'Dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating cannot be deleted'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' then raise exception 'Reopen the visit before editing'; end if;
  if exists (select 1 from public.ratings where dish_id = target_dish) and not public.is_global_admin() then
    raise exception 'This dish already has ratings; ask Admin to delete it';
  end if;

  update public.dishes set deleted_at = now() where id = target_dish;
  insert into public.dish_revisions (dish_id, actor_id, action, before_value)
  values (target_dish, auth.uid(), 'deleted', jsonb_build_object('name', target_record.name));
  perform public.reset_visit_after_menu_change(target_record.visit_id);
end;
$$;

grant execute on function public.delete_visit_dish(uuid) to authenticated;

create or replace function public.restore_visit_dish(target_dish uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
  next_order numeric(8, 3);
begin
  select d.id, d.visit_id, d.name, d.is_overall, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is not null and v.deleted_at is null;

  if not found then raise exception 'Deleted dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating cannot be restored this way'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' then raise exception 'Reopen the visit before editing'; end if;

  perform pg_advisory_xact_lock(hashtext(target_record.visit_id::text));
  select coalesce(max(course_order), 0) + 1 into next_order
  from public.dishes
  where visit_id = target_record.visit_id and not is_overall and deleted_at is null;

  update public.dishes
  set deleted_at = null,
      course_order = next_order
  where id = target_dish;

  insert into public.dish_revisions (dish_id, actor_id, action, after_value)
  values (target_dish, auth.uid(), 'restored', jsonb_build_object('name', target_record.name));
  perform public.reset_visit_after_menu_change(target_record.visit_id);
end;
$$;

grant execute on function public.restore_visit_dish(uuid) to authenticated;

commit;
