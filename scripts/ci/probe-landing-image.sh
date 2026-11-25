#!/usr/bin/env bash
# Probes a built `shift-landing` image (story 21.21; AD-28) with no network at all.
#
#   bash scripts/ci/probe-landing-image.sh <image> [<dist>]
#
# <dist> (default apps/landing/dist) is the build the image was made from: the
# hashed stylesheet and font names are read from it. The six headers every
# answer must carry are written HERE, independently of the image's own
# `security-headers.conf` (test/landing.test.ts holds the two equal).
#
# The container runs with `--network none` and a read-only root (only /tmp is
# a tmpfs), so it can reach nothing and write nothing but its pid and temp
# files. Requests go through `docker exec` to the image's busybox `nc` on
# 127.0.0.1:8080, as raw HTTP/1.0 (busybox `wget` hides an error response's
# headers), as probe-web-image.sh does.
#
# CI (job `landing-image`), or a local docker this session owns: it starts one
# container, named for this shell's pid, and removes it on exit.
set -euo pipefail

image="${1:?usage: probe-landing-image.sh <image> [<dist>]}"
dist="${2:-apps/landing/dist}"
name="shift-landing-probe-$$"

cleanup() { docker rm -f "$name" > /dev/null 2>&1 || true; }
trap cleanup EXIT

expected=(
  "Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  'Strict-Transport-Security: max-age=31536000'
  'Referrer-Policy: no-referrer'
  'X-Content-Type-Options: nosniff'
  'X-Frame-Options: DENY'
  'Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), browsing-topics=()'
)

[ -f "$dist/index.html" ] || { echo "FAIL  $dist/index.html is missing"; exit 1; }
stylesheet="$(cd "$dist" && find assets -maxdepth 1 -name 'styles-*.css' | head -n 1)"
font="$(cd "$dist" && find assets -maxdepth 1 -name 'outfit-latin-wght-normal-*.woff2' | head -n 1)"
font_ext="$(cd "$dist" && find assets -maxdepth 1 -name 'outfit-latin-ext-wght-normal-*.woff2' | head -n 1)"
[ -n "$stylesheet" ] || { echo "FAIL  no assets/styles-*.css in $dist"; exit 1; }
[ -n "$font" ] || { echo "FAIL  no assets/outfit-latin-wght-normal-*.woff2 in $dist"; exit 1; }
[ -n "$font_ext" ] || { echo "FAIL  no assets/outfit-latin-ext-wght-normal-*.woff2 in $dist"; exit 1; }
grep -qF "href=\"/$stylesheet\"" "$dist/index.html" || { echo "FAIL  $dist/index.html does not link /$stylesheet"; exit 1; }

docker run -d --name "$name" --network none --read-only --tmpfs /tmp "$image" > /dev/null

# One raw request, with a deadline: status line, headers, body.
#   request <method> <path> [<extra header lines, \r\n-terminated>] [<HTTP version>]
request() {
  docker exec "$name" timeout 10 sh -c \
    'printf "%s %s HTTP/%s\r\nHost: probe\r\nConnection: close\r\n%b\r\n" "$1" "$2" "$4" "$3" | nc 127.0.0.1 8080' \
    probe "$1" "$2" "${3:-}" "${4:-1.0}"
}

ready=0
for _ in $(seq 1 30); do
  if request GET / 2> /dev/null | head -n 1 | grep -q '^HTTP/'; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL  nginx never answered on 8080"
  docker logs "$name" 2>&1 | tail -n 40
  exit 1
fi

failed=0
fail() { echo "FAIL  $*"; failed=1; }

# expect <path> <status> <content-type prefix|-> <cache-control|-|none> [<body marker>]
# METHOD (default GET), EXTRA (header lines) and PROTO (default 1.0) shape the
# request; the last answer's headers are left in $last_head.
last_head=''
expect() {
  local path="$1" status="$2" type="$3" cache="$4" marker="${5:-}" method="${METHOD:-GET}"
  local got head line
  got="$( (request "$method" "$path" "${EXTRA:-}" "${PROTO:-1.0}" || true) | tr -d '\000')"
  head="${got%%$'\r\n\r\n'*}"
  head="${head//$'\r'/}"
  line="${head%%$'\n'*}"
  local ok=1
  [[ "$line" == "HTTP/1.1 $status "* ]] || { fail "$method $path -> '$line', expected $status"; ok=0; }
  # Every header, exactly once, with its exact value.
  local header named exact
  for header in "${expected[@]}"; do
    exact="$(grep -cFx -- "$header" <<< "$head" || true)"
    named="$(grep -ci -- "^${header%%:*}:" <<< "$head" || true)"
    [ "$exact" = 1 ] && [ "$named" = 1 ] || { fail "$method $path: '${header%%:*}' is not exactly once with its value"; ok=0; }
  done
  if [ "$type" != - ] && ! grep -qi "^Content-Type: $type" <<< "$head"; then
    fail "$method $path: Content-Type is not $type"; ok=0
  fi
  case "$cache" in
    -) ;;
    none) if grep -qi '^Cache-Control:' <<< "$head"; then fail "$method $path: has a Cache-Control"; ok=0; fi ;;
    *) if [ "$(grep -ciFx -- "Cache-Control: $cache" <<< "$head" || true)" != 1 ] \
         || [ "$(grep -ci '^Cache-Control:' <<< "$head" || true)" != 1 ]; then
         fail "$method $path: Cache-Control is not exactly '$cache'"; ok=0
       fi ;;
  esac
  if grep -qi '^Server: .*[0-9]' <<< "$head"; then fail "$method $path: the Server header names a version"; ok=0; fi
  if grep -qi '^Set-Cookie:' <<< "$head"; then fail "$method $path: sets a cookie"; ok=0; fi
  if [ -n "$marker" ] && [[ "$got" != *"$marker"* ]]; then fail "$method $path: the body is not the expected one"; ok=0; fi
  last_head="$head"
  [ "$ok" = 1 ] && echo "ok    $method $path -> $status${type:+ $type} ${cache}"
  return 0
}

page_marker='<h1 id="naslov">Raspored smjena'
missing_marker='<h1 id="naslov">Ta stranica ne postoji</h1>'
immutable='public, max-age=31536000, immutable'

expect / 200 text/html no-cache "$page_marker"
expect /index.html 200 text/html no-cache "$page_marker"
expect "/$stylesheet" 200 text/css "$immutable"
expect "/$font" 200 font/woff2 "$immutable"
expect "/$font_ext" 200 font/woff2 "$immutable"
expect /favicon.svg 200 image/svg+xml no-cache
expect /favicon.ico 200 image/ no-cache
expect /apple-touch-icon-180x180.png 200 image/png no-cache
# No SPA fallback: an unknown path, a client-route-looking path, a missing
# asset, a directory and the 404 page itself are each the 404 page with 404,
# never the page and never immutable.
expect /nope 404 text/html no-cache "$missing_marker"
expect /kalendar/2026-09 404 text/html no-cache "$missing_marker"
expect /prijava 404 text/html no-cache "$missing_marker"
expect /assets/nope.css 404 text/html no-cache "$missing_marker"
expect /assets/ 404 text/html no-cache "$missing_marker"
expect /assets 404 text/html no-cache "$missing_marker"
expect /404.html 404 text/html no-cache "$missing_marker"
expect /sw.js 404 text/html no-cache "$missing_marker"
# An error nginx makes itself still carries every header; HEAD answers them too.
METHOD=POST EXTRA='Content-Length: 0\r\n' expect / 405 - no-cache
METHOD=HEAD expect / 200 text/html no-cache
# gzip (HTTP/1.1 only): the stylesheet compressed, and caches told it varies.
PROTO=1.1 EXTRA='Accept-Encoding: gzip\r\n' expect "/$stylesheet" 200 text/css "$immutable"
grep -qix 'Content-Encoding: gzip' <<< "$last_head" || fail "/$stylesheet: not gzipped for Accept-Encoding: gzip"
grep -qix 'Vary: Accept-Encoding' <<< "$last_head" || fail "/$stylesheet: no Vary: Accept-Encoding"

# Revalidation (what no-cache causes): a 304 carries every header too, and the
# same Cache-Control as the 200.
for path in / "/$stylesheet"; do
  modified="$( (request GET "$path" || true) | tr -d '\r' | sed -n 's/^Last-Modified: //p' | head -n 1)"
  if [ -z "$modified" ]; then fail "$path: no Last-Modified"; continue; fi
  if [ "$path" = / ]; then cache=no-cache; else cache="$immutable"; fi
  EXTRA="If-Modified-Since: $modified\r\n" expect "$path" 304 - "$cache"
done

# A request nginx refuses before choosing a location (a header over
# large_client_header_buffers): the server-level include still applies.
EXTRA="X-Oversized: $(printf '%*s' 9000 '' | tr ' ' a)\r\n" expect / 400 - none

# The image's own HEALTHCHECK command, run as the image runs it.
check="$(docker inspect --format '{{index .Config.Healthcheck.Test 1}}' "$name" 2> /dev/null || true)"
if [ -z "$check" ]; then
  fail "the image has no HEALTHCHECK"
elif docker exec "$name" sh -c "$check"; then
  echo "ok    the HEALTHCHECK passes"
else
  fail "the HEALTHCHECK fails: $check"
fi

# The process runs as uid 101.
uid="$(docker exec "$name" awk '/^Uid:/ { print $2 }' /proc/1/status)"
[ "$uid" = 101 ] && echo "ok    nginx runs as uid 101" || fail "nginx runs as uid '$uid'"

# Nothing outside /tmp is owned by, or writable by, uid 101 (the read-only
# root hides that from a write test, so it is read off the modes). Read as
# root, so a directory uid 101 cannot list is still checked.
writable="$(docker exec --user 0 "$name" find / -xdev -path /tmp -prune -o \
  \( -user 101 -o -group 101 -perm -0020 -o -perm -0002 \) ! -type l -print 2>&1 || echo 'find failed')"
[ -z "$writable" ] && echo "ok    no file outside /tmp is writable by uid 101" || fail "writable by uid 101: $writable"

# The image holds the built page only: no script anywhere in it.
scripts="$(docker exec "$name" find /usr/share/nginx/html -name '*.js' -o -name '*.map' 2>&1 || echo 'find failed')"
[ -z "$scripts" ] && echo "ok    no script or source map in the image" || fail "scripts in the image: $scripts"

echo '--- container log'
docker logs "$name" 2>&1 | tail -n 20
exit "$failed"
