insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-images',
  'listing-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.require_listing_rejection_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'rejected' and nullif(btrim(new.rejection_reason), '') is null then
    raise exception 'A rejection reason is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_listing_rejection_reason on public.listings;
create trigger require_listing_rejection_reason
  before insert or update on public.listings
  for each row execute function public.require_listing_rejection_reason();

drop policy if exists "Listing owners upload their own images" on storage.objects;
create policy "Listing owners upload their own images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Listing owners and admins delete listing images" on storage.objects;
create policy "Listing owners and admins delete listing images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_myhome_admin())
    )
  );

alter table public.listings replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listings'
  ) then
    alter publication supabase_realtime add table public.listings;
  end if;
end;
$$;
