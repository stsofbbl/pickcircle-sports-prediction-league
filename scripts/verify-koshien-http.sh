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
export YOSO_AUTH_URL=http://127.0.0.1:39118
auth_container="yoso-auth-fixture"
auth_db="$db"
auth_password="$(openssl rand -hex 24)"
cleanup() {
  docker rm -f "$container" "$auth_container" >/dev/null 2>&1 || true
  sudo -u postgres psql -X -q -d postgres -c "ALTER ROLE yoso_auth_fixture_admin NOLOGIN" >/dev/null 2>&1 || true
  sudo -u postgres psql -X -q -d postgres -c "ALTER ROLE yoso_http_authenticator NOLOGIN" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" < supabase/migrations/20261124040000_protect_finalized_koshien_event_delete.sql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" < tests/sql/fixtures/koshien-http-fixture.sql
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "ALTER ROLE yoso_http_authenticator PASSWORD '$password'"
# Verify old tournament data before and after real HTTP writes.
fingerprint() {
 sudo -u postgres psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT md5(jsonb_build_object('event',(SELECT to_jsonb(e) FROM public.events e WHERE id='test-finalize'),'matches',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.matches m WHERE event_id='test-finalize'),'scores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='test-finalize'))::text)"
}
before="$(fingerprint)"
# Co-locate genuine Auth and YOSO fixtures in the known disposable CI DB.
# This is NOT a production connection or schema migration.
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE yoso_auth_fixture_admin LOGIN PASSWORD '$auth_password'"
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $db OWNER TO yoso_auth_fixture_admin"
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "ALTER SCHEMA auth OWNER TO yoso_auth_fixture_admin; ALTER FUNCTION auth.uid() OWNER TO yoso_auth_fixture_admin; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
docker run --detach --rm --name "$auth_container" --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=39118 \
  -e API_EXTERNAL_URL="$YOSO_AUTH_URL" -e GOTRUE_SITE_URL="$YOSO_AUTH_URL" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://yoso_auth_fixture_admin:$auth_password@127.0.0.1:5432/$auth_db?search_path=auth" \
  -e GOTRUE_DB_NAMESPACE=auth -e DB_NAMESPACE=auth \
  -e GOTRUE_JWT_SECRET="$secret" -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_EXP=3600 -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false \
  supabase/gotrue:v2.189.0@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf >/dev/null
auth_ready=false
for attempt in $(seq 1 40); do
  if curl --silent --fail --max-time 2 "$YOSO_AUTH_URL/health" >/dev/null; then auth_ready=true; break; fi
  sleep 1
done
if [[ "$auth_ready" != true ]]; then docker logs "$auth_container"; exit 1; fi
# Install captured application triggers only after GoTrue created auth.users.
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $db OWNER TO postgres"
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "GRANT CONNECT ON DATABASE $db TO yoso_auth_fixture_admin; ALTER FUNCTION auth.uid() OWNER TO postgres; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" < tests/sql/fixtures/koshien-production-auth-triggers.sql
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
