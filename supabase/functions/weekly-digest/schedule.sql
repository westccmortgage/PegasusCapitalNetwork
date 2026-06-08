-- Weekly digest schedule (pg_cron + pg_net). Edit URL + anon key, then run once.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Mondays 14:00 UTC
select cron.schedule('pegasus-weekly-digest', '0 14 * * 1', $$
  select net.http_post(
    url     := 'https://REPLACE-PROJECT-REF.functions.supabase.co/weekly-digest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer REPLACE-ANON-KEY"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- To remove: select cron.unschedule('pegasus-weekly-digest');
