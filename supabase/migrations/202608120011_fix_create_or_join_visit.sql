begin;

-- The function's table-return columns are PL/pgSQL variables too. The previous
-- implementation reused `visit_id` and `restaurant_id` as unqualified table
-- columns, so the alias and active-table branches could fail as ambiguous.
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
  v_restaurant_id uuid;
  v_visit_id uuid;
  v_joined_existing boolean;
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
    select coalesce(source_restaurant.merged_into_id, source_restaurant.id)
    into v_restaurant_id
    from public.restaurants as source_restaurant
    where source_restaurant.id = p_restaurant_id;

    if v_restaurant_id is null then raise exception 'Restaurant not found'; end if;

    select resolved_restaurant.latitude,
           resolved_restaurant.longitude,
           resolved_restaurant.normalized_name
    into existing_latitude, existing_longitude, canonical_normalized
    from public.restaurants as resolved_restaurant
    where resolved_restaurant.id = v_restaurant_id
      and resolved_restaurant.deleted_at is null;

    if not found then raise exception 'Restaurant not found'; end if;

    if p_save_location
      and existing_latitude is null and existing_longitude is null
      and p_latitude is not null and p_longitude is not null
    then
      update public.restaurants as restaurant
      set latitude = p_latitude,
          longitude = p_longitude,
          location_accuracy_m = p_location_accuracy_m
      where restaurant.id = v_restaurant_id;

      insert into public.restaurant_revisions (
        restaurant_id, actor_id, action, before_value, after_value
      ) values (
        v_restaurant_id, auth.uid(), 'location_added',
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
    ) returning restaurants.id, restaurants.normalized_name
      into v_restaurant_id, canonical_normalized;

    insert into public.restaurant_revisions (
      restaurant_id, actor_id, action, after_value
    ) values (
      v_restaurant_id, auth.uid(), 'create',
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
      v_restaurant_id,
      trim(p_requested_alias),
      public.normalize_restaurant_name(p_requested_alias),
      'user',
      auth.uid()
    ) on conflict do nothing;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_restaurant_id::text));

  select active_visit.id
  into v_visit_id
  from public.visits as active_visit
  where active_visit.restaurant_id = v_restaurant_id
    and active_visit.status = 'active'
    and active_visit.expires_at > now()
    and active_visit.deleted_at is null
  order by active_visit.created_at desc
  limit 1
  for update;

  if v_visit_id is not null then
    v_joined_existing := true;
    insert into public.visit_participants (visit_id, user_id, excluded_at)
    values (v_visit_id, auth.uid(), null)
    on conflict on constraint visit_participants_pkey
    do update set excluded_at = null;
  else
    v_joined_existing := false;
    insert into public.visits (restaurant_id, created_by, expires_at)
    values (v_restaurant_id, auth.uid(), now() + interval '12 hours')
    returning visits.id into v_visit_id;
  end if;

  visit_id := v_visit_id;
  restaurant_id := v_restaurant_id;
  joined_existing := v_joined_existing;
  return next;
end;
$$;

grant execute on function public.create_or_join_visit(
  uuid, text, text, text, double precision, double precision,
  double precision, text, boolean, text
) to authenticated;

commit;
