begin;

alter table public.allowlist
  add column if not exists is_admin boolean not null default false;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowlisted_admin boolean;
begin
  if tg_op = 'INSERT' then
    if new.id <> auth.uid()
      or lower(new.email) <> lower(coalesce(auth.jwt() ->> 'email', ''))
    then
      raise exception 'Invalid profile bootstrap';
    end if;

    select entry.is_admin
      into allowlisted_admin
      from public.allowlist as entry
     where entry.email = lower(new.email)
       and entry.active;

    if not found then
      raise exception 'Not allowlisted';
    end if;

    new.email := lower(new.email);
    new.is_admin := coalesce(allowlisted_admin, false);
  elsif new.email is distinct from old.email then
    raise exception 'Profile email cannot be changed here';
  elsif new.is_admin is distinct from old.is_admin
    and not public.is_global_admin()
  then
    raise exception 'Only Admin can change Admin privileges';
  end if;

  return new;
end;
$$;

comment on column public.allowlist.is_admin is
  'Determines the immutable initial Admin privilege when an allowlisted user creates a profile.';

commit;
