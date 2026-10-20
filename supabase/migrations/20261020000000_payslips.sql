-- Slip gaji bulanan (satu baris = satu bulan). Gaji bersih di sini jadi sumber pendapatan sebenar periods.income.
create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  position text,
  basic numeric(12,2) not null default 0,
  allowance numeric(12,2) not null default 0,   -- covering allowance dll
  overtime numeric(12,2) not null default 0,    -- OT biasa
  holiday numeric(12,2) not null default 0,     -- kerja cuti umum (PH)
  commission numeric(12,2) not null default 0,
  gross numeric(12,2) not null,                 -- TOTAL EARNING
  epf numeric(12,2) not null default 0,         -- potongan pekerja
  socso numeric(12,2) not null default 0,
  eis numeric(12,2) not null default 0,
  skbbk numeric(12,2) not null default 0,       -- PERKESO LINDUNG 24 Jam (mula Jun 2026)
  pcb numeric(12,2) not null default 0,
  staff_house numeric(12,2) not null default 0,
  other_deduction numeric(12,2) not null default 0,
  net numeric(12,2) not null,                   -- NETT INCOME
  epf_employer numeric(12,2) not null default 0,
  socso_employer numeric(12,2) not null default 0,
  eis_employer numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payslips_touch before update on public.payslips for each row execute function public.touch_updated_at();
create trigger payslips_audit after insert or update or delete on public.payslips for each row execute function public.audit_trigger();
alter table public.payslips enable row level security;
alter table public.payslips force row level security;
revoke all on public.payslips from anon, authenticated;
grant select, insert, update, delete on public.payslips to authenticated;
create policy owner_only on public.payslips for all to authenticated using (public.is_owner()) with check (public.is_owner());
