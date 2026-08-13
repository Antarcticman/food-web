begin;

-- Course role and ingredients are separate axes. The existing category stays as
-- a compact visual key so artwork can evolve without rewriting rating history.
alter table public.dishes
  add column course_role text not null default 'other'
    check (course_role in ('appetizer', 'main', 'staple', 'side', 'soup', 'dessert', 'drink', 'snack', 'other')),
  add column ingredient_families text[] not null default '{}'::text[]
    check (
      cardinality(ingredient_families) <= 3
      and ingredient_families <@ array[
        'meat', 'seafood', 'vegetable', 'egg_dairy', 'grain_noodle',
        'fruit', 'legume', 'mushroom', 'mixed', 'other'
      ]::text[]
    );

alter table public.restaurant_dishes
  add column course_role text not null default 'other'
    check (course_role in ('appetizer', 'main', 'staple', 'side', 'soup', 'dessert', 'drink', 'snack', 'other')),
  add column ingredient_families text[] not null default '{}'::text[]
    check (
      cardinality(ingredient_families) <= 3
      and ingredient_families <@ array[
        'meat', 'seafood', 'vegetable', 'egg_dairy', 'grain_noodle',
        'fruit', 'legume', 'mushroom', 'mixed', 'other'
      ]::text[]
    );

-- Historical dishes may belong to already revealed visits. The normal trigger
-- correctly blocks application edits to those rows, so pause only that trigger
-- for this one-time schema backfill and restore it immediately afterwards.
alter table public.dishes disable trigger dishes_protect_structure;

update public.dishes
set course_role = case
      when is_overall then 'other'
      when category = 'drink' then 'drink'
      when category = 'dessert' then 'dessert'
      when category = 'soup' then 'soup'
      when category in ('rice', 'noodle', 'bread_pizza', 'dumpling') then 'staple'
      else 'main'
    end,
    ingredient_families = case category
      when 'meat' then array['meat']::text[]
      when 'seafood' then array['seafood']::text[]
      when 'vegetable' then array['vegetable']::text[]
      when 'rice' then array['grain_noodle']::text[]
      when 'noodle' then array['grain_noodle']::text[]
      when 'bread_pizza' then array['grain_noodle']::text[]
      when 'dumpling' then array['grain_noodle']::text[]
      else '{}'::text[]
    end;

alter table public.dishes enable trigger dishes_protect_structure;

update public.restaurant_dishes
set course_role = case
      when category = 'drink' then 'drink'
      when category = 'dessert' then 'dessert'
      when category = 'soup' then 'soup'
      when category in ('rice', 'noodle', 'bread_pizza', 'dumpling') then 'staple'
      else 'main'
    end,
    ingredient_families = case category
      when 'meat' then array['meat']::text[]
      when 'seafood' then array['seafood']::text[]
      when 'vegetable' then array['vegetable']::text[]
      when 'rice' then array['grain_noodle']::text[]
      when 'noodle' then array['grain_noodle']::text[]
      when 'bread_pizza' then array['grain_noodle']::text[]
      when 'dumpling' then array['grain_noodle']::text[]
      else '{}'::text[]
    end;

drop function if exists public.create_visit_dish(uuid, text, text, text, jsonb);

create function public.create_visit_dish(
  target_visit uuid,
  dish_name text,
  dish_description text,
  dish_kind text,
  dish_category text,
  dish_visual_recipe jsonb,
  dish_course_role text,
  dish_ingredient_families text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_dish uuid;
  next_order numeric(8, 3);
  cleaned_ingredients text[];
begin
  if not public.is_visit_participant(target_visit) then raise exception 'Not a participant'; end if;
  if exists (select 1 from public.visits where id = target_visit and status <> 'active') then
    raise exception 'Visit is not active';
  end if;
  if char_length(trim(dish_name)) < 1 or char_length(trim(dish_name)) > 180 then
    raise exception 'Invalid dish name';
  end if;
  if char_length(coalesce(dish_description, '')) > 400 then raise exception 'Description is too long'; end if;
  if dish_course_role not in ('appetizer', 'main', 'staple', 'side', 'soup', 'dessert', 'drink', 'snack', 'other') then
    raise exception 'Invalid course role';
  end if;

  cleaned_ingredients := coalesce(dish_ingredient_families, '{}'::text[]);
  if cardinality(cleaned_ingredients) > 3 or not cleaned_ingredients <@ array[
    'meat', 'seafood', 'vegetable', 'egg_dairy', 'grain_noodle',
    'fruit', 'legume', 'mushroom', 'mixed', 'other'
  ]::text[] then
    raise exception 'Invalid ingredient families';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_visit::text));
  select coalesce(max(course_order), 0) + 1 into next_order
  from public.dishes
  where visit_id = target_visit and not is_overall and deleted_at is null;

  insert into public.dishes (
    visit_id, name, description, kind, category, visual_recipe, course_role,
    ingredient_families, course_order, is_overall, confirmation, created_by
  ) values (
    target_visit, trim(dish_name), nullif(trim(coalesce(dish_description, '')), ''),
    dish_kind, dish_category, dish_visual_recipe, dish_course_role,
    cleaned_ingredients, next_order, false, 'draft', auth.uid()
  ) returning id into created_dish;

  insert into public.dish_consumers (dish_id, user_id, status)
  select created_dish, user_id, 'unopened'::public.consumer_status
  from public.visit_participants
  where visit_id = target_visit and excluded_at is null
  on conflict (dish_id, user_id) do nothing;

  -- Adding a dish changes the visit scope. Overall scores and ready state are
  -- deliberately reset so the result cannot silently omit the new dish.
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

grant execute on function public.create_visit_dish(uuid, text, text, text, text, jsonb, text, text[]) to authenticated;

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
  select d.id, d.visit_id, d.name, d.category, d.visual_recipe, d.course_role,
         d.ingredient_families, d.created_by, d.is_overall, v.restaurant_id, v.status
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
          category, visual_recipe, course_role, ingredient_families, created_by
        ) values (
          target_record.restaurant_id, target_record.name, normalized, cleaned_version,
          target_record.category, target_record.visual_recipe, target_record.course_role,
          target_record.ingredient_families, auth.uid()
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

  update public.restaurant_dishes
  set course_role = case when course_role = 'other' then target_record.course_role else course_role end,
      ingredient_families = case
        when cardinality(ingredient_families) = 0 then target_record.ingredient_families
        else ingredient_families
      end
  where id = linked_id;

  update public.dishes
  set restaurant_dish_id = linked_id,
      catalog_version_label = cleaned_version
  where id = target_dish;

  return linked_id;
end;
$$;

commit;
