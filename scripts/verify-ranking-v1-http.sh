#!/usr/bin/env bash
# Only disposable GitHub Actions runner; no production credentials or hosts.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${1:-}" = yoso_ranking_v1_test
db="$1"
sdk="${RUNNER_TEMP:?}/yoso-ranking-sdk.js"
curl --fail --silent --show-error --location --max-time 30 https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js -o "$sdk"
container=yoso-ranking-http-fixture
auth_container=yoso-ranking-auth-fixture
auth_db=yoso_ranking_auth_test
password="$(openssl rand -hex 24)"
auth_password="$(openssl rand -hex 24)"
secret="$(openssl rand -hex 32)"
export YOSO_RANKING_HTTP_SECRET="$secret"
export YOSO_RANKING_HTTP_URL=http://127.0.0.1:39117
export YOSO_RANKING_AUTH_URL=http://127.0.0.1:39118
cleanup() {
  docker rm -f "$container" "$auth_container" >/dev/null 2>&1 || true
  sudo -u postgres dropdb --if-exists "$auth_db" >/dev/null 2>&1 || true
  sudo -u postgres psql -X -q -d postgres -c "DROP ROLE IF EXISTS yoso_ranking_auth_admin; DROP ROLE IF EXISTS yoso_ranking_authenticator;" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE yoso_ranking_authenticator LOGIN NOINHERIT PASSWORD '$password'; GRANT anon, authenticated TO yoso_ranking_authenticator; CREATE ROLE yoso_ranking_auth_admin LOGIN PASSWORD '$auth_password';"
sudo -u postgres createdb -O yoso_ranking_auth_admin "$auth_db"
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$auth_db" -c 'CREATE SCHEMA auth AUTHORIZATION yoso_ranking_auth_admin; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
# Adapt only the synthetic auth.uid() stub to real PostgREST claim format.
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$f$;
CREATE POLICY result_member_read ON public.results FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=results.event_id AND public.is_league_member(e.league_id)));
CREATE POLICY score_member_read ON public.scores FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=scores.event_id AND public.is_league_member(e.league_id)));
SQL
fingerprint() {
 sudo -u postgres psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT md5(jsonb_build_array((SELECT to_jsonb(e) FROM public.events e WHERE id='legacy'),(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.predictions p WHERE event_id='legacy'),(SELECT to_jsonb(r) FROM public.results r WHERE event_id='legacy'),(SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='legacy'))::text)"
}
before="$(fingerprint)"
# Auth uses a separate disposable database; fixture identities are mirrored
# after real signup. This avoids pretending the synthetic auth.users table
# is the full GoTrue schema.
docker run --detach --rm --name "$auth_container" --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=39118 \
  -e API_EXTERNAL_URL="$YOSO_RANKING_AUTH_URL" -e GOTRUE_SITE_URL="$YOSO_RANKING_AUTH_URL" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://yoso_ranking_auth_admin:$auth_password@127.0.0.1:5432/$auth_db?search_path=auth" \
  -e GOTRUE_DB_NAMESPACE=auth -e DB_NAMESPACE=auth \
  -e GOTRUE_JWT_SECRET="$secret" -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_EXP=3600 -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false \
  supabase/gotrue:v2.189.0@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf >/dev/null
# Resolve the exact version to a registry digest before executing it.
# The previously recorded digest returned registry 404.
docker pull postgrest/postgrest:v12.2.3
postgrest_image="$(docker image inspect --format '{{index .RepoDigests 0}}' postgrest/postgrest:v12.2.3)"
echo "PostgREST resolved image: $postgrest_image"
# Run the exact locally resolved digest. The CI logs reported two different
# digests for this version; do not silently accept another version.
case "${postgrest_image#docker.io/}" in
  postgrest/postgrest@sha256:729bf65c733b73f5b52777f0e4b853f22ed73ae67a22d38269d289779b0a8401|postgrest/postgrest@sha256:729bf65c733b73f5b52777f0e4b853f22ed73aa67a22d38269d289779b0a8401) ;;
  *) echo "Unreviewed PostgREST digest" >&2; exit 1 ;;
esac
docker run --detach --rm --name "$container" --network host \
  -e PGRST_DB_URI="postgres://yoso_ranking_authenticator:$password@127.0.0.1:5432/$db" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$secret" -e PGRST_SERVER_HOST=127.0.0.1 \
  -e PGRST_SERVER_PORT=39117 "$postgrest_image" >/dev/null
auth_ready=false
for attempt in $(seq 1 40); do
  if curl --silent --fail --max-time 2 "$YOSO_RANKING_AUTH_URL/health" >/dev/null; then auth_ready=true; break; fi
  sleep 1
done
if [[ "$auth_ready" != true ]]; then docker logs "$auth_container"; exit 1; fi
ready=false
for attempt in $(seq 1 30); do
  status="$(curl --silent --max-time 2 -o /dev/null -w '%{http_code}' "$YOSO_RANKING_HTTP_URL/events?select=id" || true)"
  if [[ "$status" =~ ^(200|401|403)$ ]]; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
node scripts/verify-ranking-v1-http.cjs "$sdk"
test "$before" = "$(fingerprint)"
echo "PASS: legacy event, predictions, results and scores unchanged"
