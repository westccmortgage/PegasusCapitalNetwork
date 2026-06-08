-- Weekly automated request escalation sweep (pg_cron). Run once. Mondays 13:30 UTC.
-- Uses the cron-safe wrapper (no admin gate; restricted to backend roles).
create extension if not exists pg_cron;
select cron.schedule('pegasus-weekly-request-sweep', '30 13 * * 1', $$ select public.cron_escalate_stale_requests(24); $$);
-- Remove: select cron.unschedule('pegasus-weekly-request-sweep');
