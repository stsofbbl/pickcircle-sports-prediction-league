-- Actual captured RPC bodies; synthetic roster, not actual future schools.
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_prediction_select ON public.predictions FOR SELECT TO authenticated USING(
 (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND public.is_league_member(e.league_id))) OR public.is_prediction_public(event_id));
CREATE POLICY lifecycle_prediction_insert ON public.predictions FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
CREATE POLICY lifecycle_prediction_update ON public.predictions FOR UPDATE TO authenticated USING(user_id=auth.uid() AND public.is_prediction_open(event_id)) WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
ALTER TABLE public.phase1_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_picks_select ON public.phase1_picks FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid()) OR public.is_prediction_public(event_id));
CREATE POLICY lifecycle_picks_write ON public.phase1_picks FOR ALL TO authenticated USING(public.is_prediction_open(event_id) AND EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid())) WITH CHECK(public.is_prediction_open(event_id) AND EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.predictions,public.phase1_picks TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.predictions_id_seq TO authenticated;

CREATE FUNCTION public.fixture_roster() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_agg(jsonb_build_object('district_name',district,'school_name','Fixture school '||n) ORDER BY n)
 FROM unnest(ARRAY['北北海道','南北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東東京','西東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄']) WITH ORDINALITY d(district,n)
$$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
INSERT INTO public.events(id,league_id,preset_type,status,rules,name,season,prediction_deadline,created_by)
VALUES ('lifecycle-draft','00000000-0000-0000-0000-000000000010','koshien','draft','{"approvalPolicy":"admin","resultFlow":{"status":"none"},"config":{"teams":[],"startRoundsConfirmed":false,"externalResults":{"competitionType":"summer","year":2027}}}','Fixture 2027','2027',now()+interval '1 year',auth.uid());
SELECT public.replace_koshien_representatives('lifecycle-draft',public.fixture_roster(),2027)->>'count' AS representatives;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.teams WHERE event_id='lifecycle-draft')<>49 OR
    (SELECT count(*) FROM public.event_teams WHERE event_id='lifecycle-draft')<>49 THEN
   RAISE EXCEPTION 'real roster import failed';
 END IF;
END $$;
SELECT public.confirm_koshien_start_rounds('lifecycle-draft',(SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',CASE WHEN seed<=15 THEN 2 ELSE 1 END) ORDER BY seed) FROM public.teams WHERE event_id='lifecycle-draft'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ DECLARE v_ids uuid[]; BEGIN
 SELECT array_agg(id ORDER BY seed) INTO v_ids FROM (SELECT id,seed FROM public.teams WHERE event_id='lifecycle-draft' AND start_round=1 ORDER BY seed LIMIT 8) t;
 BEGIN
   PERFORM public.save_koshien_phase1_prediction('lifecycle-draft',v_ids,v_ids[1],'{"fixture":true}');
   RAISE EXCEPTION 'draft accepted prediction';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.open_koshien_draft('lifecycle-draft',public.koshien_admin_result_revision('lifecycle-draft'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ DECLARE v_ids uuid[]; v_result jsonb; BEGIN
 SELECT array_agg(id ORDER BY seed) INTO v_ids FROM (SELECT id,seed FROM public.teams WHERE event_id='lifecycle-draft' AND start_round=1 ORDER BY seed LIMIT 8) t;
 v_result:=public.save_koshien_phase1_prediction('lifecycle-draft',v_ids,v_ids[1],'{"fixture":true}');
 IF (v_result->>'pickCount')::int<>8 OR (SELECT count(*) FROM public.phase1_picks WHERE event_id='lifecycle-draft')<>8 OR (SELECT count(*) FROM public.phase1_picks WHERE event_id='lifecycle-draft' AND captain)<>1 OR (SELECT count(*) FROM public.predictions WHERE event_id='lifecycle-draft')<>1 THEN
 RAISE EXCEPTION 'prediction not saved'; END IF;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.predictions WHERE event_id='lifecycle-draft') OR EXISTS(SELECT 1 FROM public.phase1_picks WHERE event_id='lifecycle-draft') THEN
 RAISE EXCEPTION 'another member prediction exposed before deadline'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.matches WHERE event_id='test-finalize')<>48 OR (SELECT count(*) FROM public.scores WHERE event_id='test-finalize')<>1 THEN RAISE EXCEPTION 'existing fixture modified'; END IF;
END $$;
SELECT 'PASS: actual roster import -> confirm -> open -> member prediction with pre-deadline privacy';

-- Re-import and direct confirmation reset must both fail atomically after opening.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.replace_koshien_representatives('lifecycle-draft',public.fixture_roster(),2027);
   RAISE EXCEPTION 'open roster re-import succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
   UPDATE public.events SET rules=jsonb_set(rules,'{config,startRoundsConfirmed}','false')
   WHERE id='lifecycle-draft';
   RAISE EXCEPTION 'open confirmation reset succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='lifecycle-draft'
   AND status='open' AND rules->'config'->'startRoundsConfirmed'='true'::jsonb)
 THEN RAISE EXCEPTION 'open event confirmation changed'; END IF;
END $$;

-- The existing confirm RPC can otherwise move four of the member's eight
-- first-round picks into round two while keeping the total distribution 34/15.
-- Protect both actual representations, and prove statement rollback preserves
-- every roster and pick row rather than merely retaining the confirmation flag.
CREATE TEMP TABLE lifecycle_round_baseline AS
SELECT
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text) FROM public.teams t WHERE t.event_id='lifecycle-draft') AS teams,
 (SELECT md5(jsonb_agg(to_jsonb(et) ORDER BY et.id)::text) FROM public.event_teams et WHERE et.event_id='lifecycle-draft') AS event_teams,
 (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.phase1_picks p WHERE p.event_id='lifecycle-draft') AS picks;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ DECLARE v_rows jsonb; BEGIN
 SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',
  CASE WHEN seed BETWEEN 1 AND 4 THEN 1 WHEN seed BETWEEN 16 AND 19 THEN 2 ELSE start_round END) ORDER BY seed)
 INTO v_rows FROM public.teams WHERE event_id='lifecycle-draft';
 BEGIN
   PERFORM public.confirm_koshien_start_rounds('lifecycle-draft',v_rows);
   RAISE EXCEPTION 'changed confirmed round assignment accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.teams SET start_round=3-start_round WHERE event_id='lifecycle-draft' AND seed=16;
   RAISE EXCEPTION 'direct team start round changed';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
 -- event_teams direct writes are allowed for the real admin. Fixture grant and
 -- policy are added below so this checks the trigger rather than an RLS denial.
END $$;
RESET ROLE;
CREATE POLICY lifecycle_event_teams_admin ON public.event_teams FOR UPDATE TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_teams.event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_teams.event_id AND public.is_league_admin(e.league_id)));
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
   UPDATE public.event_teams SET metadata=jsonb_set(metadata,'{startRound}','2') WHERE event_id='lifecycle-draft' AND name='Fixture school 16';
   RAISE EXCEPTION 'direct event team start round changed';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM lifecycle_round_baseline b WHERE
   b.teams IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text) FROM public.teams t WHERE t.event_id='lifecycle-draft')
   OR b.event_teams IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(et) ORDER BY et.id)::text) FROM public.event_teams et WHERE et.event_id='lifecycle-draft')
   OR b.picks IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.phase1_picks p WHERE p.event_id='lifecycle-draft')) THEN
 RAISE EXCEPTION 'denied round change mutated roster or picks'; END IF;
END $$;
-- Same-value changes and unrelated odds update are not prohibited.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.confirm_koshien_start_rounds('lifecycle-draft',(
 SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',start_round) ORDER BY seed)
 FROM public.teams WHERE event_id='lifecycle-draft'));
UPDATE public.teams SET odds=2 WHERE event_id='lifecycle-draft' AND seed=16;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.teams WHERE event_id='lifecycle-draft' AND seed=16 AND odds=2 AND start_round=1) THEN
 RAISE EXCEPTION 'unrelated odds update blocked'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: confirmed open start-round change rejected; roster/picks unchanged; same assignment and odds preserved';

-- TEST-ONLY prototype: official import identity constraints. Do not apply to
-- production. Reuses the actual manual-record and match-status sync RPC bodies
-- captured 2026-11-25; includes the real auto-sync writer and privileged DML.
-- Explicit season required here; legacy null-season policy requires review.
BEGIN;
UPDATE public.events SET season='2026' WHERE id='test-finalize';
CREATE TABLE public.external_match_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source='jhbf'),
 external_key text NOT NULL CHECK(external_key ~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$'),
 source_url text NOT NULL, normalized_payload jsonb NOT NULL CHECK(jsonb_typeof(normalized_payload)='object'),
 raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(raw_payload)='object'),
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','canceled')),
 imported_match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
 fetched_at timestamptz NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), canceled_at timestamptz, canceled_by uuid,
 UNIQUE(event_id,source,external_key)
);
ALTER TABLE public.external_match_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.external_match_imports TO authenticated;
CREATE POLICY external_match_imports_admin_all ON public.external_match_imports FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=external_match_imports.event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK (confirmed_by=auth.uid() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=external_match_imports.event_id AND public.is_league_admin(e.league_id)));

-- @include supabase/release-candidates/koshien-official-integrity/import-identity.sql

CREATE OR REPLACE FUNCTION public.record_koshien_external_imports(p_event_id text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_item jsonb;
  v_payload jsonb;
  v_external_key text;
  v_source_url text;
  v_imported_match_id uuid;
  v_existing public.external_match_imports;
  v_match public.matches;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'import rows must be an array';
  end if;
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien';
  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    if v_item->>'source' <> 'jhbf' then raise exception 'unsupported import source'; end if;
    v_external_key := v_item->>'externalKey';
    v_source_url := v_item->>'sourceUrl';
    v_imported_match_id := nullif(v_item->>'importedMatchId', '')::uuid;
    v_payload := v_item->'normalizedPayload';
    if v_external_key is null or v_external_key !~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$' then
      raise exception 'invalid external match key';
    end if;
    if v_source_url is null or v_source_url !~ '^https://(www\.)?jhbf\.or\.jp/(sensyuken|senbatsu)/[0-9]{4}/schedule/schedule_[0-9]{8}\.html$' then
      raise exception 'source URL is outside the JHBF allowlist';
    end if;
    if jsonb_typeof(coalesce(v_payload, 'null'::jsonb)) <> 'object'
       or v_payload->>'source' <> 'jhbf'
       or v_payload->>'externalKey' is distinct from v_external_key
       or coalesce(v_payload->>'roundKey', '') not in ('R1','R2','R3','QF','SF','F')
       or coalesce(v_payload->>'team1Id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'team2Id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'winnerTeamId', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'loserTeamId', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'team1Score', '') !~ '^[0-9]+$'
       or coalesce(v_payload->>'team2Score', '') !~ '^[0-9]+$'
       or (v_payload->>'team1Score')::integer = (v_payload->>'team2Score')::integer then
      raise exception 'normalized import payload is invalid';
    end if;
    select m.* into v_match
    from public.matches m
    where m.id = v_imported_match_id and m.event_id = p_event_id;
    if v_match.id is null or v_match.status <> 'completed'
       or v_match.round_key is distinct from v_payload->>'roundKey'
       or v_match.team1_id is distinct from (v_payload->>'team1Id')::uuid
       or v_match.team2_id is distinct from (v_payload->>'team2Id')::uuid
       or v_match.team1_score is distinct from (v_payload->>'team1Score')::integer
       or v_match.team2_score is distinct from (v_payload->>'team2Score')::integer
       or v_match.winner_team_id is distinct from (v_payload->>'winnerTeamId')::uuid
       or v_match.loser_team_id is distinct from (v_payload->>'loserTeamId')::uuid then
      raise exception 'saved match does not match external import payload';
    end if;
    select i.* into v_existing
    from public.external_match_imports i
    where i.event_id = p_event_id and i.source = 'jhbf' and i.external_key = v_external_key
    for update;
    if v_existing.id is not null then
      if v_existing.status = 'canceled' then
        update public.external_match_imports
        set source_url = v_source_url,
            normalized_payload = v_payload,
            raw_payload = coalesce(v_item->'rawPayload', '{}'::jsonb),
            imported_match_id = v_imported_match_id,
            fetched_at = coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now()),
            status = 'confirmed',
            confirmed_at = now(),
            confirmed_by = auth.uid(),
            canceled_at = null,
            canceled_by = null
        where id = v_existing.id;
        v_count := v_count + 1;
        continue;
      end if;
      if v_existing.normalized_payload is distinct from v_payload
         or v_existing.imported_match_id is distinct from v_imported_match_id then
        raise exception 'external import payload conflict' using errcode = '23505';
      end if;
      continue;
    end if;
    insert into public.external_match_imports (
      event_id, source, external_key, source_url, normalized_payload, raw_payload,
      imported_match_id, fetched_at, confirmed_by
    ) values (
      p_event_id, 'jhbf', v_external_key, v_source_url, v_payload,
      coalesce(v_item->'rawPayload', '{}'::jsonb), v_imported_match_id,
      coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now()), auth.uid()
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_external_import_status_with_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = 'completed' and new.status = 'scheduled' then
    update public.external_match_imports
    set status = 'canceled',
        canceled_at = now(),
        canceled_by = auth.uid()
    where imported_match_id = new.id
      and status = 'confirmed';
  elsif old.status = 'scheduled' and new.status = 'completed' then
    update public.external_match_imports
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = coalesce(auth.uid(), confirmed_by),
        canceled_at = null,
        canceled_by = null
    where imported_match_id = new.id
      and status = 'canceled'
      and normalized_payload->>'roundKey' is not distinct from new.round_key
      and (normalized_payload->>'team1Id')::uuid is not distinct from new.team1_id
      and (normalized_payload->>'team2Id')::uuid is not distinct from new.team2_id
      and (normalized_payload->>'team1Score')::integer is not distinct from new.team1_score
      and (normalized_payload->>'team2Score')::integer is not distinct from new.team2_score
      and (normalized_payload->>'winnerTeamId')::uuid is not distinct from new.winner_team_id
      and (normalized_payload->>'loserTeamId')::uuid is not distinct from new.loser_team_id;
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER fixture_sync_external_import AFTER UPDATE OF status ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.sync_external_import_status_with_match();

-- Real manual recording, idempotent retry, wrong-year and cross-event rejection.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ DECLARE
 v_match public.matches; v_payload jsonb; v_item jsonb; v_result jsonb;
 v_key text:='jhbf:summer:2026:2026-08-10:1';
 v_url text:='https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html';
BEGIN
 SELECT * INTO v_match FROM public.matches WHERE event_id='test-finalize' AND round_key='R1' AND match_no=1;
 v_payload:=jsonb_build_object('source','jhbf','externalKey',v_key,'roundKey',v_match.round_key,
 'team1Id',v_match.team1_id,'team2Id',v_match.team2_id,'team1Score',v_match.team1_score,'team2Score',v_match.team2_score,
 'winnerTeamId',v_match.winner_team_id,'loserTeamId',v_match.loser_team_id);
 v_item:=jsonb_build_object('source','jhbf','externalKey',v_key,'sourceUrl',v_url,'importedMatchId',v_match.id,'normalizedPayload',v_payload);
 v_result:=public.record_koshien_external_imports('test-finalize',jsonb_build_array(v_item));
 IF v_result->>'inserted' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'manual import failed'; END IF;
 v_result:=public.record_koshien_external_imports('test-finalize',jsonb_build_array(v_item));
 IF v_result->>'inserted' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'retry was not idempotent'; END IF;

 BEGIN
  INSERT INTO public.external_match_imports(event_id,source,external_key,source_url,normalized_payload,imported_match_id,fetched_at,confirmed_by)
  VALUES('test-finalize','jhbf','jhbf:summer:2027:2027-08-10:1','https://www.jhbf.or.jp/sensyuken/2027/schedule/schedule_20270810.html',
   jsonb_set(v_payload,'{externalKey}','"jhbf:summer:2027:2027-08-10:1"'),v_match.id,now(),auth.uid());
  RAISE EXCEPTION 'wrong year accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.external_match_imports(event_id,source,external_key,source_url,normalized_payload,imported_match_id,fetched_at,confirmed_by)
  VALUES('lifecycle-draft','jhbf','jhbf:summer:2027:2027-08-10:1','https://www.jhbf.or.jp/sensyuken/2027/schedule/schedule_20270810.html',
   jsonb_set(v_payload,'{externalKey}','"jhbf:summer:2027:2027-08-10:1"'),v_match.id,now(),auth.uid());
  RAISE EXCEPTION 'cross event match accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.external_match_imports SET source_url=replace(v_url,'20260810','20260811') WHERE event_id='test-finalize';
  RAISE EXCEPTION 'wrong URL date accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.external_match_imports SET normalized_payload=jsonb_set(v_payload,'{externalKey}','"bad"') WHERE event_id='test-finalize';
  RAISE EXCEPTION 'wrong normalized key accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.events SET season='2028' WHERE id='test-finalize';
  RAISE EXCEPTION 'parent season change accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.matches SET event_id='lifecycle-draft' WHERE id=v_match.id;
  RAISE EXCEPTION 'parent match move accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF (SELECT count(*) FROM public.external_match_imports WHERE event_id='test-finalize')<>1 THEN RAISE EXCEPTION 'denied operation changed count'; END IF;

 -- Real status trigger must preserve cancellation and exact reconfirmation.
 UPDATE public.matches SET status='scheduled' WHERE id=v_match.id;
 IF NOT EXISTS (SELECT 1 FROM public.external_match_imports WHERE imported_match_id=v_match.id AND status='canceled' AND canceled_by=auth.uid()) THEN
  RAISE EXCEPTION 'cancel did not propagate'; END IF;
 UPDATE public.matches SET status='completed' WHERE id=v_match.id;
 IF NOT EXISTS (SELECT 1 FROM public.external_match_imports WHERE imported_match_id=v_match.id AND status='confirmed' AND canceled_at IS NULL) THEN
  RAISE EXCEPTION 'reconfirmation did not propagate'; END IF;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.external_match_imports) THEN RAISE EXCEPTION 'member can read admin history'; END IF;
 BEGIN
  PERFORM public.record_koshien_external_imports('test-finalize','[]');
  RAISE EXCEPTION 'member can call manual record';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Privileged writers (such as service-side auto-sync) cannot bypass constraints.
DO $$ BEGIN
 BEGIN
  UPDATE public.external_match_imports SET source_url='https://example.invalid/' WHERE event_id='test-finalize';
  RAISE EXCEPTION 'privileged malformed URL accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT count(*) FROM public.external_match_imports WHERE status='confirmed')<>1 THEN RAISE EXCEPTION 'history changed'; END IF;
END $$;
-- Extend the disposable fixture for the real production auto-apply RPC.
-- No service key, HTTP call or real event data is used.
ALTER TABLE public.matches ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.results ADD COLUMN id uuid DEFAULT gen_random_uuid(),
 ADD COLUMN updated_by uuid, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.scores ADD COLUMN phase1_score numeric DEFAULT 0,
 ADD COLUMN phase2_score numeric DEFAULT 0, ADD COLUMN phase3_score numeric DEFAULT 0,
 ADD COLUMN revenge_score numeric DEFAULT 0, ADD COLUMN zombie_score numeric DEFAULT 0,
 ADD COLUMN breakdown jsonb DEFAULT '{}'::jsonb, ADD COLUMN updated_at timestamptz DEFAULT now(),
 ADD UNIQUE(event_id,player_id);
UPDATE public.events SET created_by='00000000-0000-0000-0000-000000000001' WHERE id='test-finalize';
UPDATE public.teams SET name='Fixture auto '||id::text WHERE event_id='test-finalize';
UPDATE public.matches SET status='scheduled',team1_score=NULL,team2_score=NULL,
 winner_team_id=NULL,loser_team_id=NULL
 WHERE event_id='test-finalize' AND round_key='R1' AND match_no IN (2,3);
UPDATE public.results SET payload=jsonb_build_object('matches',jsonb_build_array(
 jsonb_build_object('round','R1','match_no',2,'status','scheduled'),
 jsonb_build_object('round','R1','match_no',3,'status','scheduled')))
 WHERE event_id='test-finalize';

CREATE OR REPLACE FUNCTION public.auto_apply_koshien_official_results(p_event_id text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_result public.results;
  v_payload jsonb;
  v_item jsonb;
  v_match public.matches;
  v_existing public.external_match_imports;
  v_round text;
  v_match_no integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_winner_id uuid;
  v_loser_id uuid;
  v_team1_score integer;
  v_team2_score integer;
  v_team1_name text;
  v_team2_name text;
  v_winner_name text;
  v_loser_name text;
  v_external_key text;
  v_source_url text;
  v_fetched_at timestamptz;
  v_normalized jsonb;
  v_slot_index integer;
  v_slot jsonb;
  v_new_slot jsonb;
  v_changed integer := 0;
  v_skipped integer := 0;
  v_blocked integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'result rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 8 then
    raise exception 'too many automatic result rows';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien'
  for update;
  if v_event.id is null or v_event.created_by is null then
    raise exception 'koshien event not found';
  end if;

  select r.* into v_result
  from public.results r
  where r.event_id = p_event_id
  for update;
  if v_result.id is null or jsonb_typeof(v_result.payload->'matches') <> 'array' then
    raise exception 'results payload does not contain tournament match slots';
  end if;
  v_payload := v_result.payload;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_round := v_item->>'roundKey';
    v_match_no := nullif(v_item->>'matchNo', '')::integer;
    v_team1_id := nullif(v_item->>'team1Id', '')::uuid;
    v_team2_id := nullif(v_item->>'team2Id', '')::uuid;
    v_team1_score := nullif(v_item->>'team1Score', '')::integer;
    v_team2_score := nullif(v_item->>'team2Score', '')::integer;
    v_winner_id := nullif(v_item->>'winnerTeamId', '')::uuid;
    v_loser_id := nullif(v_item->>'loserTeamId', '')::uuid;
    v_external_key := v_item->>'externalKey';
    v_source_url := v_item->>'sourceUrl';
    v_fetched_at := coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now());
    v_normalized := v_item->'normalizedPayload';

    if v_round not in ('R1','R2','R3','QF','SF','F')
       or v_match_no is null
       or v_team1_id is null or v_team2_id is null or v_team1_id = v_team2_id
       or v_team1_score is null or v_team2_score is null or v_team1_score < 0 or v_team2_score < 0 or v_team1_score = v_team2_score
       or v_winner_id not in (v_team1_id, v_team2_id)
       or v_loser_id not in (v_team1_id, v_team2_id)
       or v_winner_id = v_loser_id
       or (v_team1_score > v_team2_score and (v_winner_id <> v_team1_id or v_loser_id <> v_team2_id))
       or (v_team2_score > v_team1_score and (v_winner_id <> v_team2_id or v_loser_id <> v_team1_id)) then
      raise exception 'invalid automatic result payload';
    end if;
    if coalesce(v_external_key, '') !~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$' then
      raise exception 'invalid external match key';
    end if;
    if coalesce(v_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/(sensyuken|senbatsu)/[0-9]{4}/schedule/schedule_[0-9]{8}\.html$' then
      raise exception 'source URL is outside the JHBF allowlist';
    end if;
    if jsonb_typeof(coalesce(v_normalized, 'null'::jsonb)) <> 'object'
       or v_normalized->>'source' <> 'jhbf'
       or v_normalized->>'externalKey' is distinct from v_external_key
       or v_normalized->>'roundKey' is distinct from v_round
       or v_normalized->>'team1Id' is distinct from v_team1_id::text
       or v_normalized->>'team2Id' is distinct from v_team2_id::text
       or (v_normalized->>'team1Score')::integer is distinct from v_team1_score
       or (v_normalized->>'team2Score')::integer is distinct from v_team2_score
       or v_normalized->>'winnerTeamId' is distinct from v_winner_id::text
       or v_normalized->>'loserTeamId' is distinct from v_loser_id::text then
      raise exception 'normalized automatic result payload is invalid';
    end if;

    select i.* into v_existing
    from public.external_match_imports i
    where i.event_id = p_event_id and i.source = 'jhbf' and i.external_key = v_external_key
    for update;
    if v_existing.id is not null and v_existing.status = 'canceled' then
      v_blocked := v_blocked + 1;
      continue;
    end if;
    if v_existing.id is not null and (
      v_existing.normalized_payload is distinct from v_normalized
      or v_existing.imported_match_id is distinct from nullif(v_item->>'matchId', '')::uuid
    ) then
      raise exception 'external import payload conflict' using errcode = '23505';
    end if;

    select m.* into v_match
    from public.matches m
    where m.event_id = p_event_id and m.round_key = v_round and m.match_no = v_match_no
    for update;
    if v_match.id is null
       or v_match.id is distinct from nullif(v_item->>'matchId', '')::uuid
       or v_match.team1_id is distinct from v_team1_id
       or v_match.team2_id is distinct from v_team2_id then
      raise exception 'automatic result does not match the saved tournament card';
    end if;
    if v_match.status = 'completed' then
      if v_match.team1_score is distinct from v_team1_score
         or v_match.team2_score is distinct from v_team2_score
         or v_match.winner_team_id is distinct from v_winner_id
         or v_match.loser_team_id is distinct from v_loser_id then
        raise exception 'saved result conflicts with official result' using errcode = '23505';
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_match.status <> 'scheduled' then
      raise exception 'automatic result target is not scheduled';
    end if;

    select t.name into v_team1_name from public.teams t where t.id = v_team1_id and t.event_id = p_event_id;
    select t.name into v_team2_name from public.teams t where t.id = v_team2_id and t.event_id = p_event_id;
    select t.name into v_winner_name from public.teams t where t.id = v_winner_id and t.event_id = p_event_id;
    select t.name into v_loser_name from public.teams t where t.id = v_loser_id and t.event_id = p_event_id;
    if v_team1_name is null or v_team2_name is null or v_winner_name is null or v_loser_name is null then
      raise exception 'automatic result contains an unknown team';
    end if;

    update public.matches
    set team1_score = v_team1_score,
        team2_score = v_team2_score,
        winner_team_id = v_winner_id,
        loser_team_id = v_loser_id,
        status = 'completed',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'official_result_source', 'jhbf',
          'official_result_source_url', v_source_url,
          'official_result_fetched_at', v_fetched_at,
          'official_result_auto_applied', true
        ),
        updated_at = now()
    where id = v_match.id;

    select (slot.ordinality - 1)::integer, slot.value
    into v_slot_index, v_slot
    from jsonb_array_elements(v_payload->'matches') with ordinality slot(value, ordinality)
    where slot.value->>'round' = v_round
      and nullif(slot.value->>'match_no', '')::integer = v_match_no
    limit 1;
    if v_slot_index is null then
      raise exception 'results payload result slot mismatch';
    end if;

    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
      'team_a_id', v_team1_name,
      'team_b_id', v_team2_name,
      'score_a', v_team1_score,
      'score_b', v_team2_score,
      'winner_id', v_winner_name,
      'loser_id', v_loser_name,
      'status', 'completed',
      'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || jsonb_build_object(
        'winner_name', v_winner_name,
        'loser_name', v_loser_name,
        'official_result_source', 'jhbf',
        'official_result_source_url', v_source_url,
        'official_result_fetched_at', v_fetched_at,
        'official_result_auto_applied', true
      )
    );
    v_payload := jsonb_set(v_payload, array['matches', v_slot_index::text], v_new_slot, false);
    v_slot_index := null;

    insert into public.external_match_imports (
      event_id, source, external_key, source_url, normalized_payload, raw_payload,
      imported_match_id, fetched_at, confirmed_by, status, confirmed_at
    ) values (
      p_event_id, 'jhbf', v_external_key, v_source_url, v_normalized,
      coalesce(v_item->'rawPayload', '{}'::jsonb), v_match.id, v_fetched_at,
      v_event.created_by, 'confirmed', now()
    )
    on conflict (event_id, source, external_key) do nothing;

    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    update public.results
    set payload = v_payload,
        updated_by = v_event.created_by,
        updated_at = now()
    where event_id = p_event_id;

    insert into public.scores (
      event_id, player_id, phase1_score, phase2_score, phase3_score,
      revenge_score, zombie_score, breakdown, updated_at
    )
    select p_event_id, p.id, 0, 0, 0, 0, 0, '{}'::jsonb, now()
    from public.players p
    where p.league_id = v_event.league_id
    on conflict (event_id, player_id) do update set updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object('ok', true, 'changed', v_changed, 'skipped', v_skipped, 'blocked', v_blocked);
end;
$function$
;
REVOKE ALL ON FUNCTION public.auto_apply_koshien_official_results(text,jsonb) FROM PUBLIC;
CREATE ROLE fixture_import_service NOLOGIN;
GRANT USAGE ON SCHEMA public TO fixture_import_service;
GRANT EXECUTE ON FUNCTION public.auto_apply_koshien_official_results(text,jsonb) TO fixture_import_service;
-- The service-role test cannot read the fixture tables directly.
CREATE TEMP TABLE fixture_auto_inputs AS
SELECT jsonb_agg(payload ORDER BY match_no) AS correct,
 jsonb_agg(CASE WHEN match_no=3 THEN
   payload||jsonb_build_object('externalKey','jhbf:summer:2027:2027-08-10:3',
    'sourceUrl','https://www.jhbf.or.jp/sensyuken/2027/schedule/schedule_20270810.html',
    'normalizedPayload',jsonb_set(payload->'normalizedPayload','{externalKey}','"jhbf:summer:2027:2027-08-10:3"'))
   ELSE payload END ORDER BY match_no) AS wrong_year
FROM (
 SELECT match_no,jsonb_build_object('matchId',id,'roundKey',round_key,'matchNo',match_no,
  'team1Id',team1_id,'team2Id',team2_id,'team1Score',2,'team2Score',1,
  'winnerTeamId',team1_id,'loserTeamId',team2_id,
  'externalKey','jhbf:summer:2026:2026-08-10:'||match_no,
  'sourceUrl','https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html',
  'normalizedPayload',jsonb_build_object('source','jhbf',
   'externalKey','jhbf:summer:2026:2026-08-10:'||match_no,'roundKey',round_key,
   'team1Id',team1_id,'team2Id',team2_id,'team1Score',2,'team2Score',1,
   'winnerTeamId',team1_id,'loserTeamId',team2_id)) AS payload
 FROM public.matches WHERE event_id='test-finalize' AND round_key='R1' AND match_no IN(2,3)
) x;
GRANT SELECT ON fixture_auto_inputs TO fixture_import_service;
CREATE TEMP TABLE fixture_auto_baseline AS SELECT
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.matches m WHERE event_id='test-finalize') AS matches,
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='test-finalize') AS results,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='test-finalize') AS scores,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.external_match_imports i) AS imports;
SET ROLE fixture_import_service;
DO $$ BEGIN
 BEGIN
  PERFORM public.auto_apply_koshien_official_results('test-finalize',(SELECT wrong_year FROM fixture_auto_inputs));
  RAISE EXCEPTION 'mixed-year automatic batch accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixture_auto_baseline b WHERE
  b.matches IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.matches m WHERE event_id='test-finalize')
  OR b.results IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.results r WHERE event_id='test-finalize')
  OR b.scores IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='test-finalize')
  OR b.imports IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.external_match_imports i))
 THEN RAISE EXCEPTION 'wrong-year batch mutated results, matches, scores or import history'; END IF;
END $$;
SET ROLE fixture_import_service;
DO $$ DECLARE v jsonb; BEGIN
 v:=public.auto_apply_koshien_official_results('test-finalize',(SELECT correct FROM fixture_auto_inputs));
 IF v->>'changed' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'valid automatic batch failed: %',v; END IF;
 v:=public.auto_apply_koshien_official_results('test-finalize',(SELECT correct FROM fixture_auto_inputs));
 IF v->>'changed' IS DISTINCT FROM '0' OR v->>'skipped' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'automatic retry failed: %',v; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.external_match_imports WHERE event_id='test-finalize' AND status='confirmed')<>3
 OR (SELECT count(*) FROM public.matches WHERE event_id='test-finalize' AND round_key='R1' AND match_no IN(2,3) AND status='completed')<>2
 OR (SELECT count(*) FROM public.results r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'matches') j WHERE r.event_id='test-finalize' AND j->>'status'='completed')<>2
 OR NOT EXISTS(SELECT 1 FROM public.scores WHERE event_id='test-finalize' AND player_id='00000000-0000-0000-0000-000000000011' AND total_score=30)
 THEN RAISE EXCEPTION 'valid automatic batch did not preserve expected result and score state'; END IF;
END $$;
SELECT 'PASS: real auto-apply RPC, mixed-year whole-batch rollback, correct batch and idempotent retry';

-- A matching year alone must not allow history on a non-Koshien event.
-- New or legacy null-season events can exist, but cannot record official imports.
INSERT INTO public.events(id,league_id,preset_type,status,rules,name,season,created_by) VALUES
 ('fixture-non-koshien','00000000-0000-0000-0000-000000000010','other','draft','{}','Other sport','2026','00000000-0000-0000-0000-000000000001'),
 ('fixture-legacy-koshien','00000000-0000-0000-0000-000000000010','koshien','draft','{"approvalPolicy":"admin","resultFlow":{"status":"none"}}','Legacy no season',NULL,'00000000-0000-0000-0000-000000000001');
INSERT INTO public.matches(event_id,round_key,match_no,status) VALUES
 ('fixture-non-koshien','R1',1,'scheduled'),('fixture-legacy-koshien','R1',1,'scheduled');
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['fixture-non-koshien','fixture-legacy-koshien'] LOOP
  BEGIN
   INSERT INTO public.external_match_imports(event_id,source,external_key,source_url,normalized_payload,imported_match_id,fetched_at,confirmed_by)
   SELECT target,'jhbf','jhbf:summer:2026:2026-08-10:1',
    'https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html',
    '{"source":"jhbf","externalKey":"jhbf:summer:2026:2026-08-10:1"}',id,now(),
    '00000000-0000-0000-0000-000000000001'
   FROM public.matches WHERE event_id=target;
   RAISE EXCEPTION 'invalid event identity accepted: %',target;
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 END LOOP;
 BEGIN
  UPDATE public.events SET preset_type='other' WHERE id='test-finalize';
  RAISE EXCEPTION 'parent preset change accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT 'PASS: non-Koshien and legacy missing-season imports rejected; parent preset protected';


-- Compare event-deletion behavior with/without the proposed FKs. Both attempts
-- are rolled back in subtransactions; an existing RESTRICT is not silently
-- removed. Club-level deletion and finalized events still require review.
DO $$ DECLARE baseline text; candidate text; BEGIN
 BEGIN
  ALTER TABLE public.external_match_imports DROP CONSTRAINT yoso_import_event_identity,DROP CONSTRAINT yoso_import_match_event;
  BEGIN
   DELETE FROM public.events WHERE id='test-finalize';
   baseline:='success';
  EXCEPTION WHEN foreign_key_violation THEN baseline:='fk_rejected'; END;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback baseline deletion probe';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 BEGIN
  BEGIN
   DELETE FROM public.events WHERE id='test-finalize';
   candidate:='success';
  EXCEPTION WHEN foreign_key_violation THEN candidate:='fk_rejected'; END;
  RAISE EXCEPTION USING ERRCODE='ZX002',MESSAGE='rollback candidate deletion probe';
 EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL; END;
 IF baseline IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'event delete behavior changed: baseline %, candidate %',baseline,candidate; END IF;
 IF (SELECT count(*) FROM public.external_match_imports)<>3 OR NOT EXISTS(SELECT 1 FROM public.events WHERE id='test-finalize') THEN
  RAISE EXCEPTION 'deletion probe was not rolled back'; END IF;
 RAISE NOTICE 'event deletion baseline and candidate: %',candidate;
END $$;
-- Verify the exact rollback candidate removes new objects and retains all rows.
-- @include supabase/release-candidates/koshien-official-integrity/rollback-import-identity.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.external_match_imports)<>3
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='external_match_imports' AND column_name IN ('import_year','import_preset'))
 OR EXISTS(SELECT 1 FROM pg_constraint WHERE conname IN ('yoso_import_event_identity','yoso_import_match_event','yoso_import_identity','yoso_import_event_identity_unique','yoso_import_match_identity_unique'))
 THEN RAISE EXCEPTION 'rollback failed or removed import history'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF to_regclass('public.external_match_imports') IS NOT NULL OR
 EXISTS(SELECT 1 FROM public.events WHERE id='test-finalize' AND season IS NOT NULL) THEN
  RAISE EXCEPTION 'test prototype leaked schema or data'; END IF;
END $$;
SELECT 'PASS: import identity prototype, manual retry, cancellation/reconfirmation, RLS, privileged invalid write, rollback';
