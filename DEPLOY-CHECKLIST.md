# Pegasus — Consolidated Deploy (everything live in one shot)

This bundle is the COMPLETE site with every recent change already layered in:
  • Domain loop fix (netlify.toml + build-info.json marker 2026-05-24T16:37:29Z)
  • Deal Room → Capital Workspace rebuild (deal-rooms.html, deal-room.html,
    js/pegasus-dealroom.js, css/dealroom.css)
  • Showcase system (showcase.html, showcase-admin.html,
    js/profile/profile-showcase.js, css/showcase.css, public-profile.html)
  • Shared files already merged for BOTH features (no overwrite conflict):
    js/pegasus-core.js (Showcase sidebar link), js/pegasus-entitlements.js
    (showcase tier limits)

The old "Open a Deal Room™" modal is REMOVED. Deploying this replaces it with the
full-screen "Launch a Capital Workspace" experience.

## STEP 1 — Run SQL migrations in Supabase (in order, idempotent)
In the Supabase SQL Editor, run each and confirm the verify SELECT at the bottom:
  1. supabase/015_reconcile_deal_rooms_columns.sql   (adds missing deal_rooms cols)
  2. supabase/016_deal_room_collaboration.sql         (messages, visibility, RPCs)
  3. supabase/017_showcase_system.sql                 (showcase table + entitlements)
If you have NOT run them before, run all three. If you already ran 015/016, they're
safe to re-run.

## STEP 2 — Deploy the site (publish root must contain index.html)
CLI (most reliable):
    cd <this-folder>
    netlify deploy --prod --dir=.
Drag-and-drop: open this folder and drop it onto Netlify Deploys — index.html is at
the top level here, so the publish root is correct (this avoids the earlier 404).

## STEP 3 — Confirm the new build is live
    curl -s https://pegasuscapitalnetwork.com/build-info.json
Expect: "PEGASUS_STABLE_BUILD": "2026-05-24T16:37:29Z"
Then:
    bash verify-domain.sh        (checks loop, routes, redirects)

## STEP 4 — Spot-check the rebuild
  • https://pegasuscapitalnetwork.com/deal-rooms.html → button reads
    "+ Launch Capital Workspace" (NOT "Open Deal Room"); clicking opens the
    full-screen workspace creation, not the small modal.
  • https://pegasuscapitalnetwork.com/showcase.html → Featured Opportunities manager.
  • A public profile shows the "Featured Opportunities" section.

## Domain note (if the loop ever returns)
apex/www canonicalization is owned by the Netlify dashboard Primary-domain setting,
NOT by netlify.toml. Keep Primary = pegasuscapitalnetwork.com (apex) and add www as a
domain so Netlify auto-redirects www→apex. Do not re-add an apex/www rule to the toml.
