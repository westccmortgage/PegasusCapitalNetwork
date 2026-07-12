-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — research fields (migration 077)
-- ADDITIVE + IDEMPOTENT. Requires 072. Adds the columns the externally-sourced
-- research workbooks carry (e.g. "ChatGPT California Partner Research") so the
-- Universal Import Mapper can map them into typed columns instead of only
-- retaining them in provenance. All optional; native imports are unaffected.
-- ============================================================================

alter table public.pn_agents
  add column if not exists license_status       text,
  add column if not exists county                text,
  add column if not exists service_areas         text,
  add column if not exists activity_evidence     text,
  add column if not exists buyer_side_relevance  text,
  add column if not exists production_tier        text,
  add column if not exists partner_score          numeric,
  add column if not exists why_relevant           text,
  add column if not exists next_step              text,
  add column if not exists connection_note        text,
  add column if not exists priority               integer,
  add column if not exists linkedin_url           text;

alter table public.pn_escrow_title
  add column if not exists organization_type      text,
  add column if not exists regulator              text,
  add column if not exists license_status         text,
  add column if not exists county                 text,
  add column if not exists service_areas          text,
  add column if not exists partner_score          numeric,
  add column if not exists why_relevant           text,
  add column if not exists next_step              text,
  add column if not exists connection_note        text,
  add column if not exists priority               integer,
  add column if not exists linkedin_url           text;

alter table public.pn_activity_signals
  add column if not exists market                 text,
  add column if not exists relevance              text;
