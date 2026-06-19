// netlify/functions/social-oauth-callback.js
// Browser redirect target for social OAuth flows (GET, no accessToken).
//
// IMPORTANT: Token exchange and secure server-side token storage are NOT
// implemented yet. This endpoint intentionally does NOT exchange the OAuth
// `code` for tokens and does NOT store, log, or return any tokens. It simply
// renders a small HTML page telling the user the connection isn't fully
// configured, then attempts to close the window.
//
// Env vars used: (none — this function is stateless and writes nothing)

exports.handler = async function (event) {
  const params = (event && event.queryStringParameters) || {};
  const oauthError = params.error || params.error_description || "";

  // Escape any provider-supplied text before placing it in HTML.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const errorBlock = oauthError
    ? `<p class="err"><strong>The provider returned an error:</strong><br>${esc(oauthError)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Social Connection</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width:420px; margin:24px; padding:28px; background:#1e293b; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.35); text-align:center; }
  h1 { font-size:18px; margin:0 0 12px; }
  p { font-size:14px; line-height:1.55; margin:10px 0; color:#cbd5e1; }
  .err { background:#3f1d1d; border:1px solid #7f1d1d; color:#fecaca; padding:10px 12px; border-radius:8px; text-align:left; word-break:break-word; }
  .muted { font-size:12px; color:#94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <h1>Social connection isn't fully configured yet</h1>
    ${errorBlock}
    <p>No tokens were exchanged or stored. This window can be safely closed.</p>
    <p class="muted">You can close this window. It will try to close automatically in a few seconds.</p>
  </div>
  <script>
    setTimeout(function () {
      try { window.close(); } catch (e) {}
    }, 3000);
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
};
