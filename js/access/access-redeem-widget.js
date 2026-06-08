/* ============================================================================
 * Pegasus Access Code Redemption Widget
 * js/access/access-redeem-widget.js
 *
 * Drop-in UI for "Have an invitation or upgrade code?". Used on:
 *   - membership.html  (Billing & Plan)
 *   - get-started.html (via PegActivation)
 *   - anywhere else: add <div data-pegasus-redeem></div> to the page
 *
 * Public API:
 *   PegAccessRedeemWidget.mountInto(containerEl, opts)
 *   PegAccessRedeemWidget.autoMount()  -- scans for [data-pegasus-redeem]
 *
 * Wraps PegAccess.redeem() with friendly UI feedback. After a successful
 * redemption it calls Pegasus.store.hydrate() so tier-gated pages on the
 * same session unlock without a navigation.
 * ========================================================================== */
(function () {
  "use strict";

  var W = (window.PegAccessRedeemWidget = window.PegAccessRedeemWidget || {});

  /* HTML markup. Uses existing Pegasus design tokens — no new CSS file. */
  function template(opts) {
    var title = (opts && opts.title) || "Have an invitation or upgrade code?";
    var sub   = (opts && opts.sub)   || "Enter the code you received to activate or upgrade your membership instantly.";
    var compact = !!(opts && opts.compact);
    return ''
      + '<div class="card" data-redeem-widget style="margin-bottom:18px;border:1px solid var(--border)">'
      +   '<div class="card-body" style="padding:' + (compact ? '16px 18px' : '22px 24px') + '">'
      +     '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap">'
      +       '<div style="flex:1;min-width:220px">'
      +         '<div style="font-weight:600;font-size:' + (compact ? '13px' : '15px') + ';color:var(--text);margin-bottom:4px">' + escapeHtml(title) + '</div>'
      +         '<div style="font-size:12px;color:var(--text2);line-height:1.5">' + escapeHtml(sub) + '</div>'
      +       '</div>'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap" data-row="input">'
      +       '<input type="text" data-redeem-input '
      +         'placeholder="Enter your access code" autocomplete="off" autocapitalize="characters" spellcheck="false" '
      +         'style="flex:1;min-width:200px;padding:10px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);font-family:var(--mono);font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--text)">'
      +       '<button class="btn btn-pri" data-redeem-btn style="white-space:nowrap">Apply Code</button>'
      +     '</div>'
      +     '<div data-redeem-status style="margin-top:14px;display:none"></div>'
      +   '</div>'
      + '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function setStatus(host, kind, msg) {
    var box = host.querySelector("[data-redeem-status]");
    if (!box) return;
    var bg, border, color, icon;
    if (kind === "success")     { bg = "rgba(34,139,86,0.08)";  border = "rgba(34,139,86,0.35)";  color = "#1f6b45"; icon = "✓"; }
    else if (kind === "error")  { bg = "rgba(176,40,40,0.08)";  border = "rgba(176,40,40,0.35)";  color = "#a02323"; icon = "✕"; }
    else if (kind === "info")   { bg = "rgba(34,113,195,0.08)"; border = "rgba(34,113,195,0.35)"; color = "#1856a8"; icon = "•"; }
    else                        { bg = "var(--bg2)";            border = "var(--border)";        color = "var(--text2)"; icon = ""; }
    box.style.display = "block";
    box.style.background = bg;
    box.style.border = "1px solid " + border;
    box.style.color = color;
    box.style.padding = "10px 14px";
    box.style.borderRadius = "8px";
    box.style.fontSize = "13px";
    box.style.lineHeight = "1.5";
    box.innerHTML = (icon ? '<span style="margin-right:8px;font-weight:600">' + icon + "</span>" : "") + msg;
  }

  function clearStatus(host) {
    var box = host.querySelector("[data-redeem-status]");
    if (box) box.style.display = "none";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch (e) { return iso; }
  }

  /* Render readable error from the RPC's standard reasons. */
  function reasonMessage(result) {
    if (!result) return "Something went wrong. Please try again.";
    if (result.error) return "Could not apply code: " + escapeHtml(result.error);
    var r = result.reason || "unknown";
    switch (r) {
      case "empty":         return "Please enter your access code.";
      case "not_found":     return "That code wasn't recognized. Double-check the spelling and try again.";
      case "inactive":      return "That code is no longer active. Contact the person who invited you, or reach out to support.";
      case "expired":       return "That code has expired. Contact the person who invited you, or reach out to support.";
      case "limit_reached": return "That code has reached its redemption limit.";
      case "no_session":    return "You need to be signed in to apply a code. Please refresh and sign in.";
      case "not_admin":     return "Only admins can perform this action.";
      default:              return "Could not apply code (" + escapeHtml(r) + "). Please try again or contact support.";
    }
  }

  async function handleSubmit(host) {
    var input = host.querySelector("[data-redeem-input]");
    var btn   = host.querySelector("[data-redeem-btn]");
    if (!input || !btn) return;

    var code = (input.value || "").trim().toUpperCase();
    if (!code) {
      setStatus(host, "error", reasonMessage({ reason: "empty" }));
      input.focus();
      return;
    }

    // Disable UI during the call
    var prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Applying…";
    input.disabled = true;
    setStatus(host, "info", "Checking your code…");

    try {
      if (!window.PegAccess || typeof PegAccess.redeem !== "function") {
        setStatus(host, "error", "Access system not loaded. Please refresh the page and try again.");
        return;
      }

      var result = await PegAccess.redeem(code);

      if (result && result.ok) {
        var tier = (result.membership_tier || "").toLowerCase();
        var tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Member";
        var until = formatDate(result.access_expires_at || result.trial_end);
        var verb = result.already ? "is already active" : "activated";
        setStatus(host, "success",
          "<strong>" + tierLabel + " access " + verb + "</strong> until " + escapeHtml(until) + ". "
          + "Your tier-gated pages (Deal Rooms, Showcase, Network Requests) are unlocked.");
        input.value = "";
        // Re-hydrate has already happened inside PegAccess.redeem, but call
        // it again defensively in case the page didn't pick it up.
        try {
          if (window.Pegasus && Pegasus.store && Pegasus.store.hydrate) await Pegasus.store.hydrate();
          else if (window.PegStore && PegStore.hydrate) await PegStore.hydrate();
        } catch (_) {}
        // Toast for the wider session
        try { if (window.Pegasus && Pegasus.toast) Pegasus.toast("✓", "var(--green)", tierLabel + " access activated", "Tier-gated pages unlocked"); } catch (_) {}
        // Optional caller-provided callback
        if (host._onSuccess) { try { host._onSuccess(result); } catch (_) {} }
      } else {
        setStatus(host, "error", reasonMessage(result));
      }
    } catch (e) {
      setStatus(host, "error", "Network error: " + (e && e.message || "unknown"));
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
      input.disabled = false;
    }
  }

  function attachHandlers(host) {
    var btn   = host.querySelector("[data-redeem-btn]");
    var input = host.querySelector("[data-redeem-input]");
    if (btn)   btn.addEventListener("click", function () { handleSubmit(host); });
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); handleSubmit(host); }
      else { clearStatus(host); }
    });
  }

  /* Mount the widget into a given container. */
  W.mountInto = function (container, opts) {
    if (!container) return null;
    container.innerHTML = template(opts || {});
    var host = container.querySelector("[data-redeem-widget]");
    if (host && opts && typeof opts.onSuccess === "function") host._onSuccess = opts.onSuccess;
    if (host) attachHandlers(host);
    return host;
  };

  /* Find every [data-pegasus-redeem] node on the page and mount into it.
     Lets pages drop the widget in with just a div. */
  W.autoMount = function () {
    var nodes = document.querySelectorAll("[data-pegasus-redeem]");
    for (var i = 0; i < nodes.length; i++) {
      // Idempotent: skip if already mounted
      if (nodes[i].querySelector("[data-redeem-widget]")) continue;
      var opts = {};
      var t = nodes[i].getAttribute("data-title");      if (t) opts.title = t;
      var s = nodes[i].getAttribute("data-sub");        if (s) opts.sub = s;
      if (nodes[i].hasAttribute("data-compact")) opts.compact = true;
      W.mountInto(nodes[i], opts);
    }
  };

  /* Auto-run on DOM ready. Pages that need it call autoMount() again after
     async content insertion. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", W.autoMount);
  } else {
    setTimeout(W.autoMount, 0);
  }
})();
