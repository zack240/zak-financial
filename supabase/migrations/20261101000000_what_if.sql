-- Tab "What If": simulasi komitmen baharu, diselesaikan dengan pembahagian semula Invest sahaja.
-- wi_priority: urutan item invest dipotong bila ada komitmen baharu (nombor kecil = potong dulu).
--              null = item ini TIDAK disentuh langsung (default selamat sehingga ditetapkan).
-- wi_floor:    had minimum (RM) item ini tak boleh turun bawah — untuk jamin "menabung" tak pernah RM0.
alter table public.items add column if not exists wi_priority smallint;
alter table public.items add column if not exists wi_floor numeric(12,2) not null default 0 check (wi_floor >= 0);

create table public.what_if_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(12,2) not null check (amount >= 0),  -- tambahan komitmen bulanan (cth naik taraf takaful, ansuran kereta)
  notes text,
  status text not null default 'draft' check (status in ('draft', 'applied')),
  snapshot jsonb,            -- pecahan sebelum/lepas masa di-"Apply" (kekal sebagai sejarah, tak berubah lepas itu)
  item_id uuid references public.items(id) on delete set null,  -- item komitmen baharu yang dicipta bila di-Apply
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger what_if_scenarios_touch before update on public.what_if_scenarios for each row execute function public.touch_updated_at();
create trigger what_if_scenarios_audit after insert or update or delete on public.what_if_scenarios for each row execute function public.audit_trigger();
alter table public.what_if_scenarios enable row level security;
alter table public.what_if_scenarios force row level security;
revoke all on public.what_if_scenarios from anon, authenticated;
grant select, insert, update, delete on public.what_if_scenarios to authenticated;
create policy owner_only on public.what_if_scenarios for all to authenticated using (public.is_owner()) with check (public.is_owner());
