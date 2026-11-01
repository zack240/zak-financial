-- Scenario boleh pilih "naikkan item sedia ada" (cth Takaful RM173 -> RM335) bukan sentiasa cipta item baharu.
-- Null = cipta item Komitmen baharu (kelakuan asal, untuk komitmen yang betul-betul baharu).
alter table public.what_if_scenarios add column if not exists target_item_id uuid references public.items(id) on delete set null;
