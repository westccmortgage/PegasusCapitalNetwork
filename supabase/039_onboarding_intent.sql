-- ============================================================================
-- 039 — Add onboarding_intent to profiles
--
-- Stores what the user said they came to do during onboarding.
-- Drives the personalized dashboard "Your Focus" section and
-- helps route users to the right content right after login.
-- ============================================================================

alter table public.profiles
  add column if not exists onboarding_intent text;

-- Allowed values (soft constraint — checked in app layer for flexibility)
comment on column public.profiles.onboarding_intent is
  'capital_seeker | capital_provider | attend_session | network_explore | rwa_interest | null (not set)';

select '039 complete — onboarding_intent column added to profiles' as status;
