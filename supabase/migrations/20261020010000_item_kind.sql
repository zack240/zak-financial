-- Jenis item dalam bucket invest: dana kecemasan / pelaburan jangka panjang / matlamat belanja (sinking fund)
alter table public.items add column if not exists kind text check (kind in ('kecemasan', 'pelaburan', 'matlamat'));
