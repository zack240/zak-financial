-- Matlamat hidup ikut fasa umur. Terkumpul dikira dari baki awal + caruman sebenar
-- (entries 'done' item berkaitan, atau KWSP dari slip gaji) selepas tarikh baki awal.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase smallint not null check (phase between 1 and 4),         -- 1: 27-30, 2: 30an, 3: 40an, 4: 50an
  kind text not null default 'simpanan' check (kind in ('simpanan', 'hutang', 'kwsp', 'pencapaian')),
  target_amount numeric(12,2),
  target_date date,
  item_id uuid references public.items(id) on delete set null,   -- simpanan: item caruman bulanan
  loan_id uuid references public.loans(id) on delete set null,   -- hutang: pinjaman yg nak dilangsaikan
  opening_balance numeric(12,2) not null default 0,              -- baki sedia ada (cth baki i-Akaun KWSP)
  balance_as_of date,                                            -- caruman selepas tarikh ini ditambah
  priority smallint not null default 0,
  done_on date,                                                  -- null = belum capai
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger goals_touch before update on public.goals for each row execute function public.touch_updated_at();
create trigger goals_audit after insert or update or delete on public.goals for each row execute function public.audit_trigger();
alter table public.goals enable row level security;
alter table public.goals force row level security;
revoke all on public.goals from anon, authenticated;
grant select, insert, update, delete on public.goals to authenticated;
create policy owner_only on public.goals for all to authenticated using (public.is_owner()) with check (public.is_owner());
