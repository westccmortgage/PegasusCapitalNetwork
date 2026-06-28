-- ============================================================================
-- PEGASUS Migration 063 — Banner focal-point support
--
-- Adds banner_focal to profiles so users can store their preferred
-- object-position value for the cover banner image (e.g. 'center 30%').
-- Defaults to 'center' which maps to CSS object-position: center.
-- IDEMPOTENT.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banner_focal text DEFAULT 'center';
