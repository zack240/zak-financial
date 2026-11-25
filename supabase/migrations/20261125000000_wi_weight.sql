-- What If / Invest: pembahagian ikut pemberat 0-5. amaun = pemberat / jumlah pemberat item tak dikunci x (Invest - item dikunci).
-- wi_weight: 0 = tak diagih (RM0), 5 = keutamaan tertinggi. Default 5.
-- wi_locked: amaun tetap (cth Dana kecemasan) — tak ikut pemberat, tak dipotong dalam simulasi What If.
alter table public.items add column if not exists wi_weight smallint not null default 5 check (wi_weight between 0 and 5);
alter table public.items add column if not exists wi_locked boolean not null default false;
