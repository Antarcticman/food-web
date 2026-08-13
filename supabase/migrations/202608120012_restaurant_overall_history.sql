begin;

-- Restaurant history uses the same fairness rule as the dish leaderboard:
-- average each person's repeated visits first, then weight every person equally.
create or replace function public.get_restaurant_history_summary(target_restaurant uuid)
returns table (
  average numeric,
  people_count bigint,
  visit_count bigint,
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
  with valid_overall_ratings as (
    select r.user_id, r.score, v.id as visit_id
    from public.ratings r
    join public.dishes d on d.id = r.dish_id
    join public.visits v on v.id = d.visit_id
    where v.restaurant_id = target_restaurant
      and v.status in ('revealed', 'closed')
      and v.deleted_at is null
      and d.deleted_at is null
      and d.is_overall
  ),
  per_person as (
    select
      user_id,
      avg(score)::numeric as person_average,
      count(*)::bigint as person_rating_count
    from valid_overall_ratings
    group by user_id
  )
  select
    round(avg(pp.person_average), 1) as average,
    count(pp.user_id)::bigint as people_count,
    (select count(distinct vor.visit_id)::bigint from valid_overall_ratings vor) as visit_count,
    coalesce(sum(pp.person_rating_count), 0)::bigint as rating_count
  from per_person pp;
end;
$$;

grant execute on function public.get_restaurant_history_summary(uuid) to authenticated;

commit;
