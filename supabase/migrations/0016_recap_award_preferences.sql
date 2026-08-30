-- Let each person opt out of named weekly recap awards.

alter table public.profiles
  add column if not exists recap_awards_enabled boolean not null default true;

comment on column public.profiles.recap_awards_enabled is
  'When false, the member is excluded from named weekly recap awards and exports.';
