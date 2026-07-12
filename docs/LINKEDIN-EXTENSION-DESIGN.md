# LinkedIn Assisted Outreach — Chrome Extension DESIGN (specification only)

**Status: design only. Not built, not deployed.** This document specifies an
optional "Assisted Browser Extension" mode for the Pegasus Partner Network
Outreach Approval Queue. It exists so a human can send an **admin-approved**
connection note faster — with a **final human click** — without Pegasus ever
automating LinkedIn actions.

Default product mode remains **Manual** (open profile + copy note). The
extension is only relevant when an admin explicitly selects *Assisted Browser
Extension* in **Outreach Approval → LinkedIn sending mode**.

## Hard boundaries (non-negotiable)

The extension **must not**:
- scrape LinkedIn search results, connection lists, or profiles;
- send messages or invitations in bulk;
- auto-click **Connect** or **Send** (a human performs the final click);
- exceed or attempt to bypass LinkedIn invitation limits or rate controls;
- store LinkedIn credentials or read the user's LinkedIn session tokens;
- bypass any LinkedIn UI control, consent, or warning;
- operate on any prospect not **approved** in Pegasus, or one marked
  **do_not_contact**.

If official LinkedIn Invitations API partner access is not configured, the
product shows **"Manual confirmation required"** and never presents outreach as
fully automatic. The extension does not change that — it only pre-fills an
approved note for a human to review and send.

## What it does (happy path)

1. **Authenticate to Pegasus** using the admin's existing Pegasus session
   (OAuth/session token via the Pegasus origin — never a LinkedIn credential).
2. **Read only admin-approved outreach items** for that admin, via a scoped,
   read-limited Pegasus endpoint returning only: prospect id, name,
   `linkedin_url`, approved `connection_note`, and status. Only prospects with
   status `approved` (and not `do_not_contact`) are returned.
3. When the admin clicks **Open in LinkedIn** (in the extension popup or in
   Pegasus), open the approved `linkedin_url` in a tab.
4. On the profile page, when the admin **requests it**, insert the approved note
   into LinkedIn's own connection-note field (populate only — no click).
5. The admin **manually clicks** LinkedIn's Send/Connect. The extension never
   clicks it.
6. After the human confirms it was sent, the extension **records the result back
   to Pegasus** (status → `sent`) via a Pegasus endpoint, with an audit event.
   Nothing is recorded without the user's explicit confirmation.

## Architecture

- **Manifest V3**, minimal permissions:
  - `activeTab` + explicit host permission for `https://www.linkedin.com/*`
    (content script runs only on a profile page the user opened);
  - host permission for the Pegasus origin (API calls);
  - `storage` for a short-lived Pegasus session token only.
  - **No** `tabs` broad access, **no** `webRequest`, **no** `scripting` on
    search pages, **no** access to LinkedIn cookies.
- **Popup** lists only approved items fetched from Pegasus (read-only). No local
  prospect database; the extension is a thin client of Pegasus.
- **Content script** (profile pages only): a single function
  `insertApprovedNote(text)` that fills the visible connection-note textarea.
  It does **not** query the DOM for other people, does not read the page's data,
  and does not click any button.
- **Background service worker**: token refresh + Pegasus API calls
  (`GET /approved-outreach`, `POST /outreach/:id/mark-sent`). Rate-limited
  client-side to one action at a time; no batch loop.

## Pegasus API surface (server side — separate, minimal)

- `GET  /.netlify/functions/outreach-approved` → returns the admin's `approved`
  prospects only (id, name, linkedin_url, connection_note). Admin JWT required;
  RLS-scoped; excludes `do_not_contact`.
- `POST /.netlify/functions/outreach-record` `{ id, result: 'sent' }` → writes
  the status transition + a `pn_outreach_events` audit row. Requires admin JWT;
  only transitions an already-`approved`/`opened_in_linkedin` item.

These endpoints reuse the existing admin-JWT + RLS + audit model. They are
**not** implemented as part of this design doc — they are the integration points
if/when the Assisted mode is built.

## Consent & audit

- The extension shows, before any action, exactly what it will do ("insert the
  approved note; you click Send").
- Every action (open, insert, record-sent) creates a `pn_outreach_events` row in
  Pegasus with the actor and timestamp.
- The admin can revoke the extension's Pegasus token at any time from Pegasus.

## Why this respects LinkedIn

- No scraping, no automation of Connect/Send, no bulk, no limit-bypass, no
  credential handling. The extension is a note-prefill convenience with a
  mandatory human send — functionally the same as copy-paste, but faster — and
  it only ever touches prospects a human already approved inside Pegasus.

## Official API mode

The **Official API** mode stays disabled in Pegasus unless approved LinkedIn
Invitations API credentials **and** a partnership are configured. This design
doc does not enable it and does not implement automated sending.
