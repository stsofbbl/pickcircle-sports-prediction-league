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
-- captured 2026-11-25; the auto-sync writer is represented by privileged DML.
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

-- Test-only candidate. Foreign keys cover both child DML and later parent
-- identity changes, without row-lock order or RLS-dependent trigger lookups.
ALTER TABLE public.events ADD UNIQUE(id,season);
ALTER TABLE public.matches ADD UNIQUE(id,event_id);
ALTER TABLE public.external_match_imports
 ADD COLUMN import_year text GENERATED ALWAYS AS (split_part(external_key,':',3)) STORED NOT NULL,
 ADD CONSTRAINT fixture_import_event_year FOREIGN KEY(event_id,import_year) REFERENCES public.events(id,season),
 ADD CONSTRAINT fixture_import_match_event FOREIGN KEY(imported_match_id,event_id) REFERENCES public.matches(id,event_id),
 ADD CONSTRAINT fixture_import_identity CHECK (
  split_part(external_key,':',2)='summer'
  AND split_part(external_key,':',3)=left(split_part(external_key,':',4),4)
  AND normalized_payload->>'source' IS NOT DISTINCT FROM source
  AND normalized_payload->>'externalKey' IS NOT DISTINCT FROM external_key
  AND source_url IN (
   'https://www.jhbf.or.jp/sensyuken/'||import_year||'/schedule/schedule_'||replace(split_part(external_key,':',4),'-','')||'.html',
   'https://jhbf.or.jp/sensyuken/'||import_year||'/schedule/schedule_'||replace(split_part(external_key,':',4),'-','')||'.html'
  )
 );

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
ROLLBACK;
DO $$ BEGIN
 IF to_regclass('public.external_match_imports') IS NOT NULL OR
 EXISTS(SELECT 1 FROM public.events WHERE id='test-finalize' AND season IS NOT NULL) THEN
  RAISE EXCEPTION 'test prototype leaked schema or data'; END IF;
END $$;
SELECT 'PASS: import identity prototype, manual retry, cancellation/reconfirmation, RLS, privileged invalid write, rollback';
