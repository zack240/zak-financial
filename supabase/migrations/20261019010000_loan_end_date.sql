-- Tarikh tamat bayar pinjaman (untuk kira bilangan ansuran ikut jadual)
alter table public.loans add column if not exists end_date date;
