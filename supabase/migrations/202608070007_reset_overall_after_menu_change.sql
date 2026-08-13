begin;

-- Adding a real dish changes the scope of the visit. Any previously saved
-- TOTAL score is now stale, so every participant must rate the overall visit
-- again after finishing the new dish.
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

  return created_dish;
end;
$$;

grant execute on function public.create_visit_dish(uuid, text, text, text, jsonb) to authenticated;

commit;
