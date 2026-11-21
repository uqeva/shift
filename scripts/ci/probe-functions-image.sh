#!/usr/bin/env bash
# Probes a built `shift-functions` image (story 20.2) with no way out to the
# internet.
#
#   bash scripts/ci/probe-functions-image.sh <image>
#
# The image runs on an `--internal` Docker network, beside a stand-in GoTrue
# (busybox's httpd serving one file, `/user`, so `GET /user` answers 200). A
# function that tried to fetch a module at cold start would fail here: every
# worker must start from the bundle the image built. Every value below is a
# throwaway made up on the spot, shaped as each handler's configuration check
# demands; none is a key of any environment.
#
# Story 16.4: the same busybox stands in for the one PostgREST RPC the feed
# calls, as a CGI script (`/cgi-bin/pg`, so the functions' SUPABASE_URL is
# `http://gotrue-stub:9999/cgi-bin/pg`). It answers the pinned vector's hash,
# sent by POST with the publishable key, with an empty assembly, and anything
# else `null`, the lookup's one miss. So `calendar-feed` must answer an
# unknown token with the 404 (AD-14's probe), and the vector with a calendar
# the bundled `@shift/domain` and `@shift/ics` wrote from the runtime's Intl.
#
# CI only (job `functions-image`). Never run it against a shared machine's
# Docker: it starts containers.
set -euo pipefail

image="${1:?usage: probe-functions-image.sh <image>}"
suffix="$$"
network="shift-functions-probe-$suffix"
name="shift-functions-probe-$suffix"
gotrue="shift-gotrue-stub-$suffix"
# busybox, pinned, for the stand-in GoTrue.
BUSYBOX_IMAGE='busybox:1.36.1'

repeat() { printf "%${2}s" '' | tr ' ' "$1"; }
secret_key="sb_secret_$(repeat x 40)"
publishable_key="sb_publishable_$(repeat y 40)"
invoke_secret="$(repeat i 64)"
# AD-19's pinned token vector (packages/domain/parity/fixtures.ts) and its
# SHA-256, which the SQL suite pins too; and a canonical token no row holds.
feed_vector='shift-parity-vector_0123456789abcdefghijklA'
feed_vector_hash='2375020bdd6e9ec86da48c727c62d31ca48a92d7ae541c1b47e8b9ec67dcc232'
feed_unknown="$(repeat x 42)A"
# One member on no team, over a window holding the spring transition of 2027:
# a calendar with its VTIMEZONE and no event.
feed_hit='{"window":{"from":"2026-11-01","to":"2027-05-31"},"inputs":{"organizationId":"o","timeZone":"Europe/Zagreb","memberId":"m","teams":[],"shiftTypes":[],"steps":[],"assignments":[],"assignmentStamps":[],"members":[{"id":"m","memberships":[],"statuses":[],"loans":[]}],"overrides":[],"rosterOverrides":[],"leave":[]}}'
# The CGI script, with the expected request and the answers written in.
rpc_stub="$(cat <<EOF
#!/bin/sh
body="\$(head -c "\${CONTENT_LENGTH:-0}")"
printf 'Content-Type: application/json\\r\\n\\r\\n'
case "\$PATH_INFO|\$REQUEST_METHOD|\$HTTP_APIKEY|\$body" in
  '/rest/v1/rpc/calendar_feed_inputs|POST|$publishable_key|{"p_token_hash":"$feed_vector_hash"}') printf '%s' '$feed_hit' ;;
  *) printf 'null' ;;
esac
EOF
)"

cleanup() {
  docker rm -f "$name" "$gotrue" > /dev/null 2>&1 || true
  docker network rm "$network" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$network" > /dev/null
docker run -d --name "$gotrue" --network "$network" --network-alias gotrue-stub -e RPC_STUB="$rpc_stub" "$BUSYBOX_IMAGE" \
  sh -c 'mkdir -p /www/cgi-bin && echo "{\"id\":\"probe\",\"aud\":\"authenticated\"}" > /www/user && printf "%s\n" "$RPC_STUB" > /www/cgi-bin/pg && chmod 0755 /www/cgi-bin/pg && exec httpd -f -p 9999 -h /www' > /dev/null

# SUPABASE_URL is the stand-in RPC (story 16.4). admin-auth and notify read it
# too, and answer their probes (PAYLOAD_INVALID, INVOKE_SECRET_REFUSED) before
# any call to it.
docker run -d --name "$name" --network "$network" \
  -e SHIFT_AUTH_URL=http://gotrue-stub:9999 \
  -e SUPABASE_URL=http://gotrue-stub:9999/cgi-bin/pg \
  -e SHIFT_SECRET_KEY="$secret_key" \
  -e SHIFT_PUBLISHABLE_KEY="$publishable_key" \
  -e SHIFT_ALLOWED_ORIGINS=https://app.example.test \
  -e SHIFT_APP_URL=https://app.example.test \
  -e NOTIFY_INVOKE_SECRET="$invoke_secret" \
  -e 'NOTIFY_EMAIL_FROM=Shift <probe@example.test>' \
  -e RESEND_API_KEY=re_probe \
  -e VAPID_PUBLIC_KEY= -e VAPID_PRIVATE_KEY= \
  -e VAPID_SUBJECT=mailto:probe@example.test \
  "$image" > /dev/null

# One HTTP/1.1 request over the image's own bash (it ships no HTTP client),
# with a deadline, printed raw: status line, headers, body.
request() {
  docker exec "$name" timeout 30 bash -c '
    exec 3<>/dev/tcp/127.0.0.1/9000
    printf "%s %s HTTP/1.1\r\nHost: probe\r\nConnection: close\r\nContent-Length: %s\r\n%b\r\n%s" \
      "$1" "$2" "${#4}" "$3" "$4" >&3
    cat <&3
  ' probe "$@"
}

ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000' 2> /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL  the main service never listened on 9000"
  docker logs "$name" 2>&1 | tail -n 40
  exit 1
fi

failed=0
# expect <status> <code> <method> <path> [headers] [body]
expect() {
  local status="$1" code="$2"; shift 2
  local got
  got="$(request "$1" "$2" "${3:-}" "${4:-}" || true)"
  local line="${got%%$'\r'*}"
  if [[ "$line" == "HTTP/1.1 $status "* && "$got" == *"\"code\":\"$code\""* ]]; then
    echo "ok    $1 $2 -> $status $code"
  else
    echo "FAIL  $1 $2 -> '${line}', expected $status $code"
    failed=1
  fi
}

expect 404 FUNCTION_NOT_FOUND GET /nope
expect 404 FUNCTION_NOT_FOUND GET /_internal/health
expect 404 FUNCTION_NOT_FOUND POST /admin%2Dauth
# A dot segment the runtime's URL parser would resolve: refused on the raw
# path, so no function runs under a spelling Kong's log does not name.
expect 404 FUNCTION_NOT_FOUND POST /notify/%2e%2e/admin-auth
# notify's worker starts from its bundle and its own check answers.
expect 401 INVOKE_SECRET_REFUSED POST /notify
expect 401 INVOKE_SECRET_REFUSED POST /notify 'Authorization: Bearer not-the-secret\r\n'
# admin-auth: refused by the router before its worker, with no bearer token.
expect 401 AUTHORIZATION_MISSING POST /admin-auth
expect 401 AUTHORIZATION_MISSING POST /admin-auth 'Authorization: Basic eA==\r\n'
# admin-auth: GoTrue (the stand-in) accepts the token, the worker starts from
# its bundle with its own variables, and the handler itself answers.
expect 400 PAYLOAD_INVALID POST /admin-auth \
  'Authorization: Bearer a.b.c\r\nOrigin: https://app.example.test\r\nContent-Type: application/json\r\n' \
  '{"operation":"resetPassword"}'

# calendar-feed (story 16.4; AD-14, D-S8): public, so the router asks GoTrue
# nothing; the worker starts from its bundle with both packages inside.
expect 404 FEED_NOT_FOUND GET "/calendar-feed/$feed_unknown.ics"
expect 404 FEED_NOT_FOUND GET /calendar-feed/not-a-token.ics
expect 405 METHOD_NOT_ALLOWED POST "/calendar-feed/$feed_vector.ics"
# The two misses are one answer: the same status line, headers and body, the
# runtime's Date header aside.
miss_of() { request GET "$1" '' '' | tr -d '\r' | grep -iv '^date:' || true; }
unknown_miss="$(miss_of "/calendar-feed/$feed_unknown.ics")"
if [[ "$unknown_miss" == 'HTTP/1.1 404 '* && "$unknown_miss" = "$(miss_of /calendar-feed/not-a-token.ics)" ]]; then
  echo "ok    the unknown and the malformed token get one identical 404"
else
  echo "FAIL  the unknown and the malformed token are answered differently"
  failed=1
fi
# The vector's hash is a hit: the calendar of an empty assembly, its
# VTIMEZONE written by the bundled serializer from the runtime's zone data.
feed="$(request GET "/calendar-feed/$feed_vector.ics" '' '' || true)"
if [[ "${feed%%$'\r'*}" == 'HTTP/1.1 200 '* && "$feed" == *'text/calendar; charset=utf-8'* \
  && "$feed" == *'private, max-age=900'* && "$feed" == *$'BEGIN:VCALENDAR\r\n'* \
  && "$feed" == *$'TZID:Europe/Zagreb\r\n'* && "$feed" == *$'DTSTART:20270328T020000\r\n'* \
  && "$feed" == *$'END:VCALENDAR\r'* ]]; then
  echo "ok    GET the vector's feed -> 200 text/calendar with the zone's observances"
else
  echo "FAIL  GET the vector's feed -> '${feed%%$'\r'*}', expected 200 and a calendar"
  # The stand-in's own data, nothing of any environment.
  printf '%s\n' "$feed" | tr -d '\r' | head -n 40
  failed=1
fi

# GoTrue gone: a token must be refused 503, never passed.
docker rm -f "$gotrue" > /dev/null
# And with it the stand-in RPC: the feed cannot be asked, which is no miss.
expect 503 FEED_UNAVAILABLE GET "/calendar-feed/$feed_vector.ics"
expect 503 AUTHORIZATION_UNVERIFIED POST /admin-auth 'Authorization: Bearer a.b.c\r\n'

echo '--- container log'
docker logs "$name" 2>&1 | tail -n 20
exit "$failed"
