#!/usr/bin/env bash
# Runs only on a fresh hosted CI runner against the known disposable database.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${1:-}" = yoso_koshien_lifecycle_test
sdk="${RUNNER_TEMP:?}/yoso-supabase-sdk.js"
test -s "$sdk"
db="$1"
container="yoso-http-fixture"
password="$(openssl rand -hex 24)"
secret="$(openssl rand -hex 32)"
export YOSO_HTTP_SECRET="$secret"
export YOSO_HTTP_URL=http://127.0.0.1:39117
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  sudo -u postgres psql -X -q -d postgres -c "ALTER ROLE yoso_http_authenticator NOLOGIN" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" < tests/sql/fixtures/koshien-http-fixture.sql
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "ALTER ROLE yoso_http_authenticator PASSWORD '$password'"
# Verify old tournament data before and after real HTTP writes.
fingerprint() {
 sudo -u postgres psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT md5(jsonb_build_object('event',(SELECT to_jsonb(e) FROM public.events e WHERE id='test-finalize'),'matches',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.matches m WHERE event_id='test-finalize'),'scores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='test-finalize'))::text)"
}
before="$(fingerprint)"
docker run --detach --rm --name "$container" --network host \
  -e PGRST_DB_URI="postgres://yoso_http_authenticator:$password@127.0.0.1:5432/$db" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$secret" -e PGRST_SERVER_HOST=127.0.0.1 \
  -e PGRST_SERVER_PORT=39117 postgrest/postgrest:v12.2.3@sha256:729bf65c733b73f5b52777f0e4b853f22ed73aa67a22d38269d289779b0a8401 >/dev/null
# A 200/401/403 response proves PostgREST is listening with a usable schema.
ready=false
for attempt in $(seq 1 30); do
  status="$(curl --silent --max-time 2 -o /dev/null -w '%{http_code}' "$YOSO_HTTP_URL/events?select=id" || true)"
  if [[ "$status" =~ ^(200|401|403)$ ]]; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
node "scripts/verify-koshien-http.cjs" "$sdk"
test "$before" = "$(fingerprint)"
echo "PASS: previous tournament event, matches and scores byte-for-byte unchanged"
