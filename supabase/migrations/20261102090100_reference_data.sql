-- 0002 — categories and units of measure

create table public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (btrim(name) <> ''),
  constraint categories_normalized_name_key unique (normalized_name)
);

create trigger categories_set_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

create table public.units_of_measure (
  id smallint generated always as identity primary key,
  code text not null,
  label text not null,
  decimal_scale smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_key unique (code),
  constraint units_code_canonical check (code = upper(btrim(code)) and code <> ''),
  constraint units_label_not_blank check (btrim(label) <> ''),
  constraint units_decimal_scale_range check (decimal_scale between 0 and 3)
);

create trigger units_set_updated_at
before update on public.units_of_measure
for each row execute function private.set_updated_at();

insert into public.units_of_measure (code, label, decimal_scale)
values
  ('PCS', 'Pcs', 0),
  ('LUSIN', 'Lusin', 0),
  ('METER', 'Meter', 3),
  ('ROLL', 'Roll', 0),
  ('SET', 'Set', 0),
  ('PAX', 'Pax', 0),
  ('PACK', 'Pack', 0),
  ('KARUNG', 'Karung', 0)
on conflict (code) do nothing;
