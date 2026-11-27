alter table public.profiles
  add column if not exists privacy_consent_at timestamptz,
  add column if not exists privacy_policy_version text;

alter table public.listings
  add column if not exists privacy_consent_at timestamptz,
  add column if not exists privacy_policy_version text;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ->> 'privacy_consent' is distinct from 'true'
    or nullif(new.raw_user_meta_data ->> 'privacy_consent_at', '') is null
    or nullif(new.raw_user_meta_data ->> 'privacy_policy_version', '') is null then
    raise exception 'Privacy policy consent is required to create an account.';
  end if;

  insert into public.profiles (
    id, role, name, privacy_consent_at, privacy_policy_version
  )
  values (
    new.id,
    'client',
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    (new.raw_user_meta_data ->> 'privacy_consent_at')::timestamptz,
    new.raw_user_meta_data ->> 'privacy_policy_version'
  );
  return new;
end;
$$;

create or replace function public.require_listing_privacy_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.privacy_consent_at is not null
        and new.privacy_consent_at is distinct from old.privacy_consent_at)
      or (old.privacy_policy_version is not null
        and new.privacy_policy_version is distinct from old.privacy_policy_version) then
      raise exception 'Listing privacy consent records cannot be changed.';
    end if;
    if new.owner_id is not null and (
      new.privacy_consent_at is null
      or nullif(btrim(new.privacy_policy_version), '') is null
    ) then
      raise exception 'Privacy policy consent is required to submit a listing.';
    end if;
    return new;
  end if;

  if new.owner_id is not null and (
    new.privacy_consent_at is null
    or nullif(btrim(new.privacy_policy_version), '') is null
  ) then
    raise exception 'Privacy policy consent is required to submit a listing.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_listing_privacy_consent on public.listings;
create trigger require_listing_privacy_consent
  before insert or update on public.listings
  for each row execute function public.require_listing_privacy_consent();

create table if not exists public.edge_rate_limits (
  subject text not null,
  action text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  primary key (subject, action)
);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.edge_rate_limits to service_role;

create or replace function public.consume_edge_rate_limit(
  p_subject text,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_subject is null or length(p_subject) > 160
    or p_action is null or length(p_action) > 64
    or p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments.';
  end if;

  insert into public.edge_rate_limits as current_limit (
    subject, action, window_started_at, request_count
  )
  values (p_subject, p_action, now(), 1)
  on conflict (subject, action) do update
    set window_started_at = case
          when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now()
          else current_limit.window_started_at
        end,
        request_count = case
          when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1
          else current_limit.request_count + 1
        end
  returning request_count into v_count;

  delete from public.edge_rate_limits
  where window_started_at < now() - interval '2 days';

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer) to service_role;

create table if not exists public.listing_email_notifications (
  listing_id text not null references public.listings (id) on delete cascade,
  event text not null check (event in ('submitted', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (listing_id, event)
);

alter table public.listing_email_notifications enable row level security;
revoke all on public.listing_email_notifications from public, anon, authenticated;
grant select, insert, delete on public.listing_email_notifications to service_role;
