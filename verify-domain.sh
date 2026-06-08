#!/usr/bin/env bash
# ============================================================================
# Pegasus — domain & route verification (run AFTER deploying the fix)
# Confirms the canonical host serves, the alias redirects, and key routes load.
# Usage:  bash verify-domain.sh
# Requires: curl
# ============================================================================
set -u
CANON="https://pegasuscapitalnetwork.com"
WWW="https://www.pegasuscapitalnetwork.com"
ALIAS="https://pegasuslendersgroup.com"

pass=0; fail=0
hr(){ printf '%s\n' "----------------------------------------------------------------"; }

# code URL -> prints status + final URL (follows redirects)
codeof(){ curl -s -o /dev/null -w "%{http_code}" -L --max-time 15 "$1"; }
raw(){    curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$1"; }      # no follow
locof(){  curl -s -o /dev/null -w "%{redirect_url}" --max-time 15 "$1"; }

check(){ # label  url  expected_substring_in_status (e.g. 200)
  local label="$1" url="$2" want="$3"
  local code; code="$(codeof "$url")"
  if [ "$code" = "$want" ]; then printf "  PASS  %-28s %s (%s)\n" "$label" "$code" "$url"; pass=$((pass+1));
  else printf "  FAIL  %-28s got %s, want %s (%s)\n" "$label" "$code" "$want" "$url"; fail=$((fail+1)); fi
}

echo "Pegasus domain stabilization — production check"; hr
echo "BUILD MARKER (must match the build you deployed):"
echo "  $CANON/build-info.json ->"
curl -s --max-time 15 "$CANON/build-info.json" || echo "  (could not fetch — canonical host not serving)"
hr

echo "CANONICAL HOST — must serve 200 at root (and NOT loop):"
# loop check: cap redirects; report the count and the http code
loopcode="$(curl -s -o /dev/null -w "%{http_code}" -L --max-redirs 10 --max-time 15 "$CANON/")"
nredir="$(curl -s -o /dev/null -w "%{num_redirects}" -L --max-redirs 10 --max-time 15 "$CANON/")"
if [ "$nredir" -ge 10 ] 2>/dev/null; then
  printf "  FAIL  apex/www LOOP detected (%s redirects, capped). Set Netlify Primary domain to the apex and remove any apex<->www redirect from netlify.toml.\n" "$nredir"; fail=$((fail+1));
else
  printf "  info  apex resolved in %s redirect(s), final code %s\n" "$nredir" "$loopcode"
fi
check "canonical /"            "$CANON/"                 200
check "canonical /index.html"  "$CANON/index.html"       200
check "build-info.json"        "$CANON/build-info.json"  200
hr

echo "CORE ROUTES (200 after rewrite):"
for r in profile.html dashboard.html membership.html deal-rooms.html showcase.html signin.html signup.html members.html; do
  check "/$r" "$CANON/$r" 200
done
echo "  extensionless + slug rewrites:"
check "/profile (rewrite)"     "$CANON/profile"          200
check "/dashboard (rewrite)"   "$CANON/dashboard"        200
check "/membership (rewrite)"  "$CANON/membership"       200
check "/u/test-slug"           "$CANON/u/test-slug"      200
hr

echo "WWW CANONICAL — should 301 to apex:"
wcode="$(raw "$WWW/")"; wloc="$(locof "$WWW/")"
if [ "$wcode" = "301" ] || [ "$wcode" = "308" ]; then printf "  PASS  www 3xx -> %s\n" "${wloc:-?}"; pass=$((pass+1));
else printf "  WARN  www returned %s (expected 301). Check DNS/alias for www.\n" "$wcode"; fi
hr

echo "LEGACY ALIAS — should 301 to canonical, preserving path/query:"
acode="$(raw "$ALIAS/membership.html?upgrade=success")"
aloc="$(locof "$ALIAS/membership.html?upgrade=success")"
if [ "$acode" = "301" ] || [ "$acode" = "308" ]; then printf "  PASS  alias 3xx -> %s\n" "${aloc:-?}"; pass=$((pass+1));
else printf "  WARN  alias returned %s (expected 301).\n" "$acode"; fi
echo "    (query string must appear in the target above)"
hr

echo "SUMMARY: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && echo "Canonical homepage + routes are serving." || echo "See FAILs above. If canonical / fails, the domain is not attached/pointed in Netlify (dashboard + DNS)."
