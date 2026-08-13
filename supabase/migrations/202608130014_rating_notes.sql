begin;

alter table public.ratings add column if not exists note text;
alter table public.ratings drop constraint if exists ratings_note_length;
alter table public.ratings add constraint ratings_note_length
  check (note is null or char_length(note) <= 300);

alter table public.restaurants add column if not exists google_maps_ftid text;
create index if not exists restaurants_google_maps_ftid_idx
  on public.restaurants (google_maps_ftid)
  where google_maps_ftid is not null and deleted_at is null;

-- Future immutable snapshots include each author's optional comment.
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
  if not public.is_visit_participant(target_visit) and not public.is_global_admin() then raise exception 'Not a participant'; end if;
  if target.status <> 'active' then return target.current_result_version; end if;
  if exists (select 1 from public.visit_participants where visit_id = target_visit and excluded_at is null and ready_at is null)
  then raise exception 'Everyone must be ready before reveal'; end if;

  next_version := target.current_result_version + 1;
  select jsonb_build_object(
    'schemaVersion', 3,
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
    select d.course_order, jsonb_strip_nulls(jsonb_build_object(
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
        coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'userId', r.user_id,
          'name', p.display_name,
          'score', r.score,
          'reasons', r.reasons,
          'note', nullif(r.note, '')
        )) order by p.display_name) filter (where r.user_id is not null), '[]'::jsonb)
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
  update public.visits set status = 'revealed', revealed_at = now(), current_result_version = next_version where id = target_visit;
  return next_version;
end;
$$;

-- A pasted Maps link can safely fill blanks on a previously saved restaurant.
-- Existing values are never overwritten by ordinary users.
create or replace function public.enrich_restaurant_from_map(
  target_restaurant uuid,
  requested_address text default null,
  requested_map_url text default null,
  requested_google_maps_ftid text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_restaurant uuid;
  cleaned_address text := nullif(trim(coalesce(requested_address, '')), '');
  cleaned_map_url text := nullif(trim(coalesce(requested_map_url, '')), '');
  cleaned_google_maps_ftid text := nullif(trim(coalesce(requested_google_maps_ftid, '')), '');
begin
  if not public.is_allowlisted() then raise exception 'Not allowlisted'; end if;
  if cleaned_address is not null and char_length(cleaned_address) > 300 then raise exception 'Address is too long'; end if;
  if cleaned_map_url is not null and char_length(cleaned_map_url) > 1200 then raise exception 'Map URL is too long'; end if;
  if cleaned_google_maps_ftid is not null and char_length(cleaned_google_maps_ftid) > 200 then raise exception 'Google Maps id is too long'; end if;

  select coalesce(merged_into_id, id) into resolved_restaurant
  from public.restaurants where id = target_restaurant;
  if resolved_restaurant is null then raise exception 'Restaurant not found'; end if;

  update public.restaurants
  set address = coalesce(address, cleaned_address),
      map_url = coalesce(map_url, cleaned_map_url),
      google_maps_ftid = coalesce(google_maps_ftid, cleaned_google_maps_ftid)
  where id = resolved_restaurant and deleted_at is null;
end;
$$;

grant execute on function public.enrich_restaurant_from_map(uuid, text, text, text) to authenticated;

commit;
