#!/usr/bin/env bash
# Disposable CI only, no hosted service or production credentials.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${1:-}" = yoso_koshien_conflict_test
db="$1"
container=yoso-koshien-conflict-http
password="$(openssl rand -hex 24)"
secret="$(openssl rand -hex 32)"
export YOSO_CONFLICT_HTTP_SECRET="$secret"
export YOSO_CONFLICT_HTTP_URL=http://127.0.0.1:39117
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  sudo -u postgres psql -X -q -d postgres -c 'DROP ROLE IF EXISTS yoso_conflict_http_authenticator;' >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE yoso_conflict_http_authenticator LOGIN NOINHERIT PASSWORD '$password'; GRANT anon,authenticated TO yoso_conflict_http_authenticator;"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$f$;
-- Never allow the fixture-only helper via PostgREST.
REVOKE ALL ON FUNCTION public.test_conflicts(text) FROM PUBLIC,anon,authenticated;
SQL
fingerprint() {
 sudo -u postgres psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.events x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.phase2_drafts x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.koshien_later_rounds x),(SELECT count(*) FROM public.phase2_draft_picks),(SELECT count(*) FROM public.final_score_predictions),(SELECT count(*) FROM public.revenge_picks),(SELECT count(*) FROM public.zombie_predictions),(SELECT count(*) FROM public.koshien_later_prediction_requests))::text)"
}
before="$(fingerprint)"
docker pull postgrest/postgrest:v12.2.3
postgrest_image="$(docker image inspect --format '{{index .RepoDigests 0}}' postgrest/postgrest:v12.2.3)"
echo "PostgREST resolved image: $postgrest_image"
case "${postgrest_image#docker.io/}" in
  postgrest/postgrest@sha256:729bf65c733b73f5b52777f0e4b853f22ed73ae67a22d38269d289779b0a8401|postgrest/postgrest@sha256:729bf65c733b73f5b52777f0e4b853f22ed73aa67a22d38269d289779b0a8401) ;;
  *) echo "Unreviewed PostgREST digest" >&2; exit 1 ;;
esac
docker run --detach --rm --name "$container" --network host \
  -e PGRST_DB_URI="postgres://yoso_conflict_http_authenticator:$password@127.0.0.1:5432/$db" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$secret" -e PGRST_SERVER_HOST=127.0.0.1 \
  -e PGRST_SERVER_PORT=39117 "$postgrest_image" >/dev/null
ready=false
for attempt in $(seq 1 30); do
  status="$(curl --silent --max-time 2 -o /dev/null -w '%{http_code}' "$YOSO_CONFLICT_HTTP_URL/events?select=id" || true)"
  if [[ "$status" =~ ^(200|401|403)$ ]]; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
node scripts/verify-koshien-conflict-http.cjs
test "$before" = "$(fingerprint)"
echo "PASS: all conflict requests left synthetic event, predictions, rounds and request history unchanged"
