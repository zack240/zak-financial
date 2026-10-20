-- Tarikh tamat item bertempoh (cth kontrak telefon, ansuran) untuk kiraan bulan tinggal + peringatan
alter table public.items add column if not exists end_date date;
