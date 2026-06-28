// ============================================================================
// PEGASUS NETWORK — Delete User (admin only)
// netlify/functions/delete-user.js
//
// Full account deletion. Removes the row from auth.users; everything that
// references it is cleaned up by the DB FK delete rules set in migration 046
// (messages -> SET NULL, badge_proof_submissions / rwa_* -> CASCADE, profiles
// -> CASCADE). The service_role key lives only here, never in the frontend.
//
// Client POSTs: { user_id }  with header Authorization: Bearer <supabase jwt>
// Returns:      { deleted: bool, reason? }
//
// Security:
//   1. Validate the caller's Supabase auth token -> real uid
//   2. Confirm that uid is an admin (profiles.is_admin = true OR role='admin')
//   3. Refuse to delete the caller's own account or the protected primary admin
// ============================================================================
"use strict";

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// The primary admin account is never deletable through this endpoint.
const SUPER_ADMIN_ID = "751a15a1-01e9-4f21-a9c8-57f83f12bb82";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return resp(405, { deleted: false, reason: "Method Not Allowed" });

  try {
    const targetId = (JSON.parse(event.body || "{}") || {}).user_id;
    if (!targetId) return resp(400, { deleted: false, reason: "missing user_id" });

    // 1. Authenticate the caller
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return resp(401, { deleted: false, reason: "missing auth token" });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const uid = userData && userData.user && userData.user.id;
    if (userErr || !uid) {
      console.warn("[delete-user] auth failed:", userErr && userErr.message);
      return resp(401, { deleted: false, reason: "invalid auth token" });
    }

    // 2. Authorize — caller must be an admin
    const { data: prof, error: profErr } = await supabase
      .from("profiles").select("is_admin, role").eq("id", uid).maybeSingle();
    if (profErr) return resp(500, { deleted: false, reason: "admin check failed: " + profErr.message });
    const isAdmin = !!(prof && (prof.is_admin === true || prof.role === "admin"));
    if (!isAdmin) {
      console.warn("[delete-user] non-admin attempted delete: uid=" + uid);
      return resp(403, { deleted: false, reason: "not authorized" });
    }

    // 3. Guards
    if (targetId === uid) return resp(400, { deleted: false, reason: "You cannot delete your own account." });
    if (targetId === SUPER_ADMIN_ID) return resp(400, { deleted: false, reason: "The primary admin account is protected." });

    // 4. Delete. If the first attempt fails (e.g. migration 046 not yet applied
    //    and a NO ACTION FK still blocks it), best-effort clean the known
    //    dependents and retry once — self-healing in the spirit of verify-checkout.
    let { error: delErr } = await supabase.auth.admin.deleteUser(targetId);
    if (delErr) {
      console.warn("[delete-user] first attempt failed, cleaning dependents:", delErr.message);
      await cleanupDependents(targetId);
      ({ error: delErr } = await supabase.auth.admin.deleteUser(targetId));
    }
    if (delErr) {
      console.error("[delete-user] failed user=" + targetId + ":", delErr.message);
      return resp(500, { deleted: false, reason: delErr.message });
    }

    console.log("[delete-user] deleted user=" + targetId + " by admin=" + uid);
    return resp(200, { deleted: true });
  } catch (err) {
    console.error("[delete-user] ERROR:", err.message);
    return resp(500, { deleted: false, reason: err.message });
  }
};

// Best-effort removal of rows that may block deletion when the FK delete rules
// aren't in place. Each task is isolated so a missing table/column is skipped,
// never aborting the rest. Mirrors what migration 046 does at the schema level.
async function cleanupDependents(targetId) {
  const tasks = [
    () => supabase.from("messages").update({ sender_id: null }).eq("sender_id", targetId),
    () => supabase.from("messages").update({ receiver_id: null }).eq("receiver_id", targetId),
    () => supabase.from("badge_proof_submissions").delete().eq("user_id", targetId),
    () => supabase.from("rwa_partner_profiles").delete().eq("user_id", targetId),
    () => supabase.from("rwa_project_intakes").delete().eq("submitter_id", targetId),
  ];
  for (const t of tasks) {
    try {
      const { error } = await t();
      if (error) console.warn("[delete-user] cleanup skipped:", error.message);
    } catch (e) {
      console.warn("[delete-user] cleanup error:", e.message);
    }
  }
}

function resp(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
