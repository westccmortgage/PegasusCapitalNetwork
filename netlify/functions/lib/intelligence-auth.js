// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — shared admin authentication for functions
// Same pattern as delete-user.js: bearer Supabase JWT → real uid → confirm
// admin against the live profiles table. Service-role key stays server-side.
// ============================================================================
"use strict";

const { createClient } = require("@supabase/supabase-js");

function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Returns { ok:true, uid, supabase } or { ok:false, statusCode, reason }.
async function requireAdmin(event) {
  if (event.httpMethod !== "POST") return { ok: false, statusCode: 405, reason: "Method Not Allowed" };
  const supabase = serviceClient();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, statusCode: 401, reason: "missing auth token" };
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const uid = userData && userData.user && userData.user.id;
  if (userErr || !uid) return { ok: false, statusCode: 401, reason: "invalid auth token" };
  const { data: prof, error: profErr } = await supabase
    .from("profiles").select("is_admin, role").eq("id", uid).maybeSingle();
  if (profErr) return { ok: false, statusCode: 500, reason: "admin check failed: " + profErr.message };
  const isAdmin = !!(prof && (prof.is_admin === true || prof.role === "admin"));
  if (!isAdmin) return { ok: false, statusCode: 403, reason: "not authorized" };
  return { ok: true, uid, supabase };
}

// no-store on every sensitive response.
function resp(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
    body: JSON.stringify(obj),
  };
}

module.exports = { requireAdmin, serviceClient, resp };
