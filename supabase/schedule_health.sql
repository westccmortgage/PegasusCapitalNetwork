-- Weekly automated health sweep (pg_cron). Run once. Mondays 13:00 UTC.
create extension if not exists pg_cron;
select cron.schedule('pegasus-weekly-health', '0 13 * * 1', $$ select public.pegasus_health_sweep(); $$);
-- Remove: select cron.unschedule('pegasus-weekly-health');
