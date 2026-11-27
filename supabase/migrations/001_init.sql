create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'admin')),
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id text primary key,
  title text not null,
  location text not null,
  coordinates jsonb not null default '{}'::jsonb,
  price numeric not null check (price >= 0),
  bedrooms integer not null check (bedrooms >= 0),
  bathrooms numeric not null check (bathrooms >= 0),
  sqm numeric not null check (sqm > 0),
  images text[] not null default '{}',
  description text not null default '',
  description_translations jsonb not null default '{}'::jsonb,
  keywords text not null default '',
  tags text[] not null default '{}',
  vibe text not null default '',
  safety text not null default '',
  walkability text not null default '',
  transit text not null default '',
  base_score integer not null default 85,
  views integer not null default 0,
  saved boolean not null default false,
  custom boolean not null default true,
  seed_listing boolean not null default false,
  locale_content jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  owner_id uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.favorites (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  listing_id text not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, listing_id)
);

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  criteria text not null,
  email text not null,
  alerts_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, name)
  values (
    new.id,
    'client',
    coalesce(new.raw_user_meta_data ->> 'name', '')
  );
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.is_myhome_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_myhome_admin() from public;
grant execute on function public.is_myhome_admin() to authenticated;

create or replace function public.prevent_client_listing_moderation_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_myhome_admin()
    and (
      new.status is distinct from old.status
      or new.owner_id is distinct from old.owner_id
      or new.rejection_reason is distinct from old.rejection_reason
    ) then
    raise exception 'Only administrators can change listing status, owner, or rejection reason.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_listing_moderation_fields on public.listings;
create trigger protect_listing_moderation_fields
  before update on public.listings
  for each row execute function public.prevent_client_listing_moderation_changes();

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.favorites enable row level security;
alter table public.saved_searches enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_myhome_admin()));

drop policy if exists "Users update their own profile name" on public.profiles;
create policy "Users update their own profile name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;

drop policy if exists "Anyone reads approved listings" on public.listings;
create policy "Anyone reads approved listings"
  on public.listings for select to anon, authenticated
  using (status = 'approved');

drop policy if exists "Clients read their own listings" on public.listings;
create policy "Clients read their own listings"
  on public.listings for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Admins read every listing" on public.listings;
create policy "Admins read every listing"
  on public.listings for select to authenticated
  using ((select public.is_myhome_admin()));

drop policy if exists "Clients submit pending listings" on public.listings;
create policy "Clients submit pending listings"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'pending'
    and rejection_reason is null
  );

drop policy if exists "Clients edit their pending listings" on public.listings;
drop policy if exists "Clients edit their own listings" on public.listings;
create policy "Clients edit their own listings"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Clients delete their pending listings" on public.listings;
create policy "Clients delete their pending listings"
  on public.listings for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'pending');

drop policy if exists "Admins manage every listing" on public.listings;
create policy "Admins manage every listing"
  on public.listings for all to authenticated
  using ((select public.is_myhome_admin()))
  with check ((select public.is_myhome_admin()));

grant select, insert, delete on public.favorites to authenticated;

drop policy if exists "Owners read their favorites" on public.favorites;
create policy "Owners read their favorites"
  on public.favorites for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owners add their favorites" on public.favorites;
create policy "Owners add their favorites"
  on public.favorites for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.listings
      where id = listing_id and status = 'approved'
    )
  );

drop policy if exists "Owners remove their favorites" on public.favorites;
create policy "Owners remove their favorites"
  on public.favorites for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.saved_searches to authenticated;

drop policy if exists "Owners manage their saved searches" on public.saved_searches;
create policy "Owners manage their saved searches"
  on public.saved_searches for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
