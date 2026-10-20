-- Nombor akaun bank / e-wallet (dipapar bertopeng dalam app, salin penuh dengan butang)
alter table public.accounts add column if not exists account_no text check (account_no is null or length(account_no) <= 40);
