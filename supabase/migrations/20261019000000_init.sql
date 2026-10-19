-- Zak Financial — skema v1
-- Prinsip keselamatan:
--   * anon TIADA akses langsung ke mana-mana jadual (kecuali RPC ping() untuk keep-alive).
--   * Semua jadual: RLS "owner only" — auth.uid() mesti dalam app_owner DAN sesi mesti aal2 (MFA/TOTP).
--   * Setiap insert/update/delete direkod dalam audit_log (tak boleh diubah dari app).
--   * Data peribadi TIDAK disimpan dalam repo ini — hanya skema.

create extension if not exists pgcrypto;

-- ---------- pemilik ----------
create table public.app_owner (
  uid uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.app_owner enable row level security;
revoke all on public.app_owner from anon, authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_owner o where o.uid = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- tetapan ----------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- akaun bank / e-wallet ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- MAYB, BIMB, TNG, CIMB
  name text not null,                 -- Maybank, Bank Islam ...
  role text,                          -- Daily, Masuk Gaji, 2nd wallet, Auto debit
  color text not null default '#999999',
  balance_cap numeric(12,2),          -- cth CIMB: simpan max 3000, lebihan tukar emas
  cap_note text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- item bajet bulanan ----------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  bucket text not null check (bucket in ('komitmen','invest','reward')),
  account_id uuid references public.accounts(id) on delete set null,
  paid_by text not null default 'self' check (paid_by in ('self','company')),
  ref_no text,                        -- no akaun / polisi (cth Takaful)
  notes text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- bulan (kitaran gaji) ----------
create table public.periods (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),  -- 2026-10-01 = Okt 2026
  payday date,
  income numeric(12,2) not null default 0,
  leftover numeric(12,2),             -- "ALL BALANCE" / SAVING bulan tu
  notes text,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- rekod item per bulan ----------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','done','skip','missed','company','other')),
  amount numeric(12,2),               -- null = ikut amaun item
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, item_id)
);
create index entries_item_idx on public.entries(item_id);

-- ---------- pindahan gabung (cth TNG RM300 untuk Spotify+iCloud+Shopee) ----------
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  label text not null,
  amount numeric(12,2) not null,
  done boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transfers_period_idx on public.transfers(period_id);

-- ---------- pinjaman (PTPTN, JPA) ----------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text,
  ref_no text,
  original_amount numeric(12,2),
  monthly numeric(12,2),
  start_date date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  paid_on date not null,
  amount numeric(12,2) not null check (amount >= 0),
  balance_after numeric(12,2),        -- baki selepas bayar (ikut penyata)
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loan_payments_loan_idx on public.loan_payments(loan_id, paid_on);

-- ---------- audit log ----------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  tbl text not null,
  op text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (tbl, op, row_id, old_data, new_data)
  values (
    tg_table_name, tg_op,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'key'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- ---------- triggers, RLS, grants untuk semua jadual data ----------
do $$
declare t text;
begin
  foreach t in array array['settings','accounts','items','periods','entries','transfers','loans','loan_payments'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy owner_only on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy owner_read on public.audit_log for select to authenticated using (public.is_owner());
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- ---------- keep-alive (free tier auto-pause) — tiada data didedahkan ----------
create or replace function public.ping()
returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon;

-- Halang jadual baharu masa depan dapat grant automatik ke anon
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
