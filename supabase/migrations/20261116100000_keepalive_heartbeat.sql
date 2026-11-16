-- Keep-alive heartbeat: a real DB write (not just a read) so the Supabase free tier
-- counts the project as active. Called daily by the local Task Scheduler script.
create table if not exists public.keepalive_heartbeat (
  id int primary key check (id = 1),
  last_ping timestamptz not null default now(),
  ping_count bigint not null default 0
);
alter table public.keepalive_heartbeat enable row level security;
revoke all on public.keepalive_heartbeat from anon, authenticated;
insert into public.keepalive_heartbeat (id) values (1) on conflict (id) do nothing;

create or replace function public.keepalive_touch()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  update public.keepalive_heartbeat
     set last_ping = now(), ping_count = ping_count + 1
   where id = 1
  returning last_ping
$$;
revoke all on function public.keepalive_touch() from public;
grant execute on function public.keepalive_touch() to anon;
