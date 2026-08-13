begin;

-- A compact, trusted edit path used by the table-details sheet. Members may
-- correct classification until rating begins; Admin can repair mistakes later.
create or replace function public.update_visit_dish_classification(
  target_dish uuid,
  dish_course_role text,
  dish_ingredient_families text[],
  dish_category text,
  dish_visual_recipe jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record record;
  cleaned_ingredients text[];
begin
  select d.id, d.visit_id, d.name, d.description, d.course_role,
         d.ingredient_families, d.category, d.visual_recipe,
         d.restaurant_dish_id, d.is_overall, v.status
  into target_record
  from public.dishes d
  join public.visits v on v.id = d.visit_id
  where d.id = target_dish and d.deleted_at is null and v.deleted_at is null;

  if not found then raise exception 'Dish not found'; end if;
  if target_record.is_overall then raise exception 'Overall rating has no dish classification'; end if;
  if not public.is_visit_participant(target_record.visit_id) and not public.is_global_admin() then
    raise exception 'Not a participant';
  end if;
  if target_record.status <> 'active' and not public.is_global_admin() then
    raise exception 'Reopen the visit before editing';
  end if;
  if exists (select 1 from public.ratings where dish_id = target_dish) and not public.is_global_admin() then
    raise exception '已有朋友評分，分類需由 Admin 修正';
  end if;
  if dish_course_role not in ('appetizer', 'main', 'staple', 'side', 'soup', 'dessert', 'drink', 'snack', 'other') then
    raise exception 'Invalid course role';
  end if;
  if dish_category not in ('vegetable', 'rice', 'noodle', 'bread_pizza', 'dumpling', 'meat', 'seafood', 'soup', 'drink', 'dessert', 'other') then
    raise exception 'Invalid visual category';
  end if;
  if jsonb_typeof(dish_visual_recipe) <> 'object' then raise exception 'Invalid visual recipe'; end if;

  cleaned_ingredients := coalesce(dish_ingredient_families, '{}'::text[]);
  if cardinality(cleaned_ingredients) > 3 or not cleaned_ingredients <@ array[
    'meat', 'seafood', 'vegetable', 'egg_dairy', 'grain_noodle',
    'fruit', 'legume', 'mushroom', 'mixed', 'other'
  ]::text[] then
    raise exception 'Invalid ingredient families';
  end if;

  update public.dishes
  set course_role = dish_course_role,
      ingredient_families = cleaned_ingredients,
      category = dish_category,
      visual_recipe = dish_visual_recipe
  where id = target_dish;

  if target_record.restaurant_dish_id is not null then
    update public.restaurant_dishes
    set course_role = dish_course_role,
        ingredient_families = cleaned_ingredients,
        category = dish_category,
        visual_recipe = dish_visual_recipe
    where id = target_record.restaurant_dish_id;
  end if;

  insert into public.dish_revisions (dish_id, actor_id, action, before_value, after_value)
  values (
    target_dish,
    auth.uid(),
    'classification_updated',
    jsonb_build_object(
      'course_role', target_record.course_role,
      'ingredient_families', target_record.ingredient_families,
      'category', target_record.category,
      'visual_recipe', target_record.visual_recipe
    ),
    jsonb_build_object(
      'course_role', dish_course_role,
      'ingredient_families', cleaned_ingredients,
      'category', dish_category,
      'visual_recipe', dish_visual_recipe
    )
  );

  update public.visit_participants
  set ready_at = null,
      completed_at = null
  where visit_id = target_record.visit_id and excluded_at is null;
end;
$$;

grant execute on function public.update_visit_dish_classification(uuid, text, text[], text, jsonb) to authenticated;

-- Include the new fields in the same structural lock as name, order and visual.
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
      or new.course_role is distinct from old.course_role
      or new.ingredient_families is distinct from old.ingredient_families
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

commit;
