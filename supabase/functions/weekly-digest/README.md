# Weekly digest — setup

This Edge Function emails each member a weekly brief. It does nothing until you
add an email provider key and schedule it, so it's safe to deploy now and switch
on later.

## 1. Get an email provider
Create a free account at resend.com, verify your sending domain
(pegasuscapitalnetwork.com), and copy an API key.

## 2. Deploy + set secrets (Supabase CLI)
    supabase functions deploy weekly-digest --no-verify-jwt
    supabase secrets set RESEND_API_KEY=re_xxx
    supabase secrets set DIGEST_FROM="Pegasus <noreply@pegasuscapitalnetwork.com>"
    supabase secrets set SITE_URL="https://pegasuscapitalnetwork.com"
(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

## 3. Test to yourself first (no broadcast)
    curl -X POST "https://<project-ref>.functions.supabase.co/weekly-digest" \
      -H "Content-Type: application/json" \
      -d '{"test":true,"email":"you@example.com","name":"You"}'

## 4. Schedule it weekly
Run schedule.sql in the SQL editor (uses pg_cron + pg_net). Edit the URL and the
anon key in that file first. Default: Mondays 14:00 UTC.

## Notes
- The broadcast path skips members whose digest would be empty, so quiet weeks
  don't send hollow emails.
- Sender reputation: verify your domain (SPF/DKIM) in Resend before broadcasting.
