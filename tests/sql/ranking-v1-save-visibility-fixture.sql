-- Synthetic data; six core table definitions and eight existing triggers captured from production catalog, 2026-11-27. Not a full schema clone.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$f$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 display_name text NOT NULL,deleted_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.leagues(id uuid PRIMARY KEY,name text NOT NULL,created_by uuid NOT NULL REFERENCES public.profiles(id));
CREATE TABLE public.league_members (
 league_id uuid NOT NULL,
 user_id uuid NOT NULL,
 role text NOT NULL,
 joined_at timestamp with time zone DEFAULT now() NOT NULL,
 membership_status text DEFAULT 'active'::text NOT NULL,
 CONSTRAINT league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
 CONSTRAINT league_members_membership_status_check CHECK ((membership_status = ANY (ARRAY['active'::text, 'removed'::text]))),
 CONSTRAINT league_members_pkey PRIMARY KEY (league_id, user_id),
 CONSTRAINT league_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'co_owner'::text, 'member'::text]))),
 CONSTRAINT league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE FUNCTION public.is_league_member(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.league_members WHERE league_id=p_league_id AND user_id=auth.uid() AND membership_status='active')
$f$;
CREATE FUNCTION public.is_league_admin(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.league_members WHERE league_id=p_league_id AND user_id=auth.uid() AND membership_status='active' AND role IN('owner','co_owner'))
$f$;
CREATE TABLE public.events (
 id text DEFAULT (gen_random_uuid())::text NOT NULL,
 league_id uuid NOT NULL,
 name text NOT NULL,
 preset_type text NOT NULL,
 status text DEFAULT 'open'::text NOT NULL,
 prediction_deadline timestamp with time zone,
 rules jsonb DEFAULT '{}'::jsonb NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 sport_type text,
 season text,
 current_phase text DEFAULT 'setup'::text NOT NULL,
 rules_config jsonb DEFAULT '{}'::jsonb NOT NULL,
 archived_at timestamp with time zone,
 CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT,
 CONSTRAINT events_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
 CONSTRAINT events_pkey PRIMARY KEY (id),
 CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'resultWait'::text, 'finalized'::text, 'archive'::text])))
);
CREATE TABLE public.predictions (
 id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
 event_id text NOT NULL,
 user_id uuid NOT NULL,
 payload jsonb DEFAULT '{}'::jsonb NOT NULL,
 submitted_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT predictions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
 CONSTRAINT predictions_event_id_user_id_key UNIQUE (event_id, user_id),
 CONSTRAINT predictions_pkey PRIMARY KEY (id),
 CONSTRAINT predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE public.results (
 id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
 event_id text NOT NULL,
 payload jsonb DEFAULT '{}'::jsonb NOT NULL,
 updated_by uuid NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT results_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
 CONSTRAINT results_event_id_key UNIQUE (event_id),
 CONSTRAINT results_pkey PRIMARY KEY (id),
 CONSTRAINT results_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE RESTRICT
);
CREATE TABLE public.players (
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 league_id uuid NOT NULL,
 profile_id uuid,
 display_name text NOT NULL,
 is_admin boolean DEFAULT false NOT NULL,
 created_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT players_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
 CONSTRAINT players_league_id_profile_id_key UNIQUE (league_id, profile_id),
 CONSTRAINT players_pkey PRIMARY KEY (id),
 CONSTRAINT players_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
-- Match the live scores numeric columns/defaults and stored generated total (catalog verified 2026-11-27).
CREATE TABLE public.scores (
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 phase1_score numeric(12,3) DEFAULT 0 NOT NULL,
 phase2_score numeric(12,3) DEFAULT 0 NOT NULL,
 phase3_score numeric(12,3) DEFAULT 0 NOT NULL,
 revenge_score numeric(12,3) DEFAULT 0 NOT NULL,
 zombie_score numeric(12,3) DEFAULT 0 NOT NULL,
 total_score numeric(12,3) GENERATED ALWAYS AS (((((phase1_score + phase2_score) + phase3_score) + revenge_score) + zombie_score)) STORED,
 breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT scores_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
 CONSTRAINT scores_event_id_player_id_key UNIQUE (event_id, player_id),
 CONSTRAINT scores_pkey PRIMARY KEY (id),
 CONSTRAINT scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE FUNCTION public.is_prediction_open(p_event_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.status='open'
  AND (e.prediction_deadline IS NULL OR now()<e.prediction_deadline) AND public.is_league_member(e.league_id))
$f$;
CREATE FUNCTION public.is_prediction_public(p_event_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event_id AND public.is_league_member(e.league_id)
  AND (e.status IN('resultWait','finalized','archive') OR (e.prediction_deadline IS NOT NULL AND now()>=e.prediction_deadline)))
$f$;
-- Captured live RLS predicates on the six core tables (2026-11-27).
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_delete_admin ON public.events AS PERMISSIVE FOR DELETE TO authenticated USING ((is_league_admin(league_id) AND ((preset_type IS DISTINCT FROM 'koshien'::text) OR ((status IS DISTINCT FROM 'finalized'::text) AND (status IS DISTINCT FROM 'archive'::text) AND (((rules -> 'resultFlow'::text) ->> 'status'::text) IS DISTINCT FROM 'finalized'::text)))));
CREATE POLICY events_insert_admin ON public.events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND is_league_admin(league_id)));
CREATE POLICY events_select_members ON public.events AS PERMISSIVE FOR SELECT TO authenticated USING (is_league_member(league_id));
CREATE POLICY events_update_admin ON public.events AS PERMISSIVE FOR UPDATE TO authenticated USING (is_league_admin(league_id)) WITH CHECK (is_league_admin(league_id));
CREATE POLICY league_members_select_same_league ON public.league_members AS PERMISSIVE FOR SELECT TO authenticated USING (((membership_status = 'active'::text) AND is_league_member(league_id)));
CREATE POLICY players_insert_self_member ON public.players AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = ( SELECT auth.uid() AS uid)) AND is_league_member(league_id)));
CREATE POLICY players_select_members ON public.players AS PERMISSIVE FOR SELECT TO authenticated USING (is_league_member(league_id));
CREATE POLICY players_update_self_or_admin ON public.players AS PERMISSIVE FOR UPDATE TO authenticated USING (((profile_id = ( SELECT auth.uid() AS uid)) OR is_league_admin(league_id))) WITH CHECK (((profile_id = ( SELECT auth.uid() AS uid)) OR is_league_admin(league_id)));
CREATE POLICY predictions_delete_self_before_deadline ON public.predictions AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND is_prediction_open(event_id)));
CREATE POLICY predictions_insert_self_before_deadline ON public.predictions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND is_prediction_open(event_id)));
CREATE POLICY predictions_select_owner_or_public ON public.predictions AS PERMISSIVE FOR SELECT TO authenticated USING ((((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = predictions.event_id) AND is_league_member(e.league_id))))) OR is_prediction_public(event_id)));
CREATE POLICY predictions_update_self_before_deadline ON public.predictions AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND is_prediction_open(event_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND is_prediction_open(event_id)));
CREATE POLICY results_insert_admin ON public.results AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((updated_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))));
CREATE POLICY results_select_members ON public.results AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_member(e.league_id)))));
CREATE POLICY results_update_admin ON public.results AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))) WITH CHECK (((updated_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))));
CREATE POLICY scores_admin_all ON public.scores AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_admin(e.league_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_admin(e.league_id)))));
CREATE POLICY scores_select_members ON public.scores AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_member(e.league_id)))));
-- Match Data API DML grants only; this is not a clone of every role/ACL.
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.events,public.predictions,public.results,public.scores,public.players TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.league_members TO anon;
GRANT SELECT,INSERT,DELETE ON public.league_members TO authenticated;
GRANT USAGE ON SEQUENCE public.predictions_id_seq,public.results_id_seq TO anon,authenticated;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
INSERT INTO public.profiles(id,auth_user_id,display_name) SELECT id,id,'Fixture' FROM auth.users;
INSERT INTO public.leagues VALUES
 ('00000000-0000-0000-0000-000000000010','Fixture Club','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000020','Other Club','00000000-0000-0000-0000-000000000003');
INSERT INTO public.league_members(league_id,user_id,role,membership_status) VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','member','active'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','owner','active');
CREATE TEMP TABLE inputs AS SELECT
 '{"version":1,"candidates":[{"id":"a","label":"A","multiplierTenths":10},{"id":"b","label":"B","multiplierTenths":13},{"id":"c","label":"C","multiplierTenths":16},{"id":"d","label":"D","multiplierTenths":19}]}'::jsonb config,
 '{"version":1,"candidateIds":["a","b","c","d"]}'::jsonb pick;
GRANT SELECT ON inputs TO authenticated;
INSERT INTO public.events(id,league_id,name,preset_type,status,prediction_deadline,rules,created_by,sport_type) VALUES
 ('legacy','00000000-0000-0000-0000-000000000010','old','koshien','open',now()+interval '1 day','{}','00000000-0000-0000-0000-000000000001','baseball'),
 ('expired','00000000-0000-0000-0000-000000000010','past','ranking_v1','open',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'),
 ('expired-draft','00000000-0000-0000-0000-000000000010','draft','ranking_v1','draft',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'),
 ('management-expired','00000000-0000-0000-0000-000000000010','expired','ranking_v1','open',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball');
INSERT INTO public.predictions(event_id,user_id,payload) VALUES
 ('legacy','00000000-0000-0000-0000-000000000001','{"legacy":true}'),
 ('expired','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs)),
 ('expired-draft','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs));
INSERT INTO public.results(event_id,payload,updated_by) VALUES('legacy','{"legacy":true}','00000000-0000-0000-0000-000000000001');
INSERT INTO public.players(id,league_id,profile_id,display_name) VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Fixture'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','Fixture'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','Fixture');
INSERT INTO public.scores(event_id,player_id,phase1_score) VALUES('legacy','00000000-0000-0000-0000-000000000001',25);
-- Prove the old prototype's write shape cannot work even as the fixture owner.
DO $f$ BEGIN
 BEGIN
  INSERT INTO public.scores(event_id,player_id,total_score)
  VALUES('legacy','00000000-0000-0000-0000-000000000012',999);
  RAISE EXCEPTION 'generated total accepted explicit insert';
 EXCEPTION WHEN SQLSTATE '428C9' THEN NULL; END;
 IF (SELECT total_score FROM public.scores WHERE event_id='legacy') IS DISTINCT FROM 25::numeric THEN
  RAISE EXCEPTION 'generated total fixture mismatch';
 END IF;
END $f$;
INSERT INTO public.events(id,league_id,name,preset_type,status,prediction_deadline,rules,created_by,sport_type)
 SELECT x.id,'00000000-0000-0000-0000-000000000010','Finalize fixture','ranking_v1','resultWait',now()-interval '1 day',
 (SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'
 FROM (VALUES('finalize-case'),('missing-player'),('invalid-saved'),('empty-submissions')) x(id);
INSERT INTO public.predictions(event_id,user_id,payload) VALUES
 ('finalize-case','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs)),
 ('finalize-case','00000000-0000-0000-0000-000000000002','{"version":1,"candidateIds":["b","a","d","c"]}'),
 ('missing-player','00000000-0000-0000-0000-000000000003',(SELECT pick FROM inputs)),
 ('invalid-saved','00000000-0000-0000-0000-000000000001','{"version":1,"candidateIds":["a","a","b","c"]}');
CREATE TEMP TABLE legacy_snapshot AS SELECT jsonb_build_array(
 (SELECT to_jsonb(e) FROM public.events e WHERE id='legacy'),
 (SELECT to_jsonb(p) FROM public.predictions p WHERE event_id='legacy'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='legacy'),
 (SELECT to_jsonb(s) FROM public.scores s WHERE event_id='legacy')) AS state;
-- Reproduce existing early-publication path in a rolled-back subtransaction.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $f$ BEGIN
 BEGIN
  UPDATE public.events SET status='resultWait' WHERE id='legacy';
  IF NOT public.is_prediction_public('legacy') THEN RAISE EXCEPTION 'baseline not reproduced'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback probe';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $f$;
RESET ROLE;

-- Existing production trigger compatibility, not a production migration.
-- Install after synthetic seed rows (legacy Koshien score computation needs additional sport tables not reproduced here).
CREATE SCHEMA yoso_admin_finalize_private;
REVOKE ALL ON SCHEMA yoso_admin_finalize_private FROM PUBLIC,anon,authenticated;
CREATE TABLE yoso_admin_finalize_private.permits (
 event_id text NOT NULL,
 txid bigint NOT NULL,
 actor uuid NOT NULL,
 CONSTRAINT permits_pkey PRIMARY KEY (event_id)
);
CREATE TABLE public.koshien_result_reopens (
 id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
 event_id text NOT NULL,
 previous_event jsonb NOT NULL,
 reopened_by uuid NOT NULL,
 reopened_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT koshien_result_reopens_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
 CONSTRAINT koshien_result_reopens_pkey PRIMARY KEY (id),
 CONSTRAINT koshien_result_reopens_reopened_by_fkey FOREIGN KEY (reopened_by) REFERENCES profiles(id) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_jhbf_import_test_event_marker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_marker jsonb;
begin
  v_marker := coalesce(
    old.rules->'testHarness',
    old.rules->'config'->'testHarness',
    old.rules_config->'testHarness'
  );

  if old.name = '【TEST】高野連結果取込確認'
    and v_marker->>'kind' = 'jhbf_minimal_import'
    and old.id = 'jhbf-import-test-' || replace(old.league_id::text, '-', '') then
    new.name := old.name;
    new.league_id := old.league_id;
    new.preset_type := 'koshien';
    new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{testHarness}', v_marker, true);
    new.rules_config := jsonb_set(coalesce(new.rules_config, '{}'::jsonb), '{testHarness}', v_marker, true);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION yoso_admin_finalize_private.guard_event_finalization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old_final boolean;
  v_identity_same boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.preset_type = 'koshien' AND (
      NEW.status = 'finalized' OR NEW.rules->'resultFlow'->>'status' = 'finalized'
    ) THEN
      RAISE EXCEPTION 'Koshien result finalization requires server validation'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.preset_type = 'koshien' AND (
    (NEW.status = 'finalized' AND OLD.status IS DISTINCT FROM 'finalized')
    OR (NEW.rules->'resultFlow'->>'status' = 'finalized'
      AND NEW.rules->'resultFlow' IS DISTINCT FROM OLD.rules->'resultFlow')
  ) AND NOT EXISTS (
    SELECT 1 FROM yoso_admin_finalize_private.permits p
    WHERE p.event_id = NEW.id AND p.txid = txid_current() AND p.actor = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Koshien result finalization requires server validation'
      USING ERRCODE = '42501';
  END IF;
  -- Existing production reopen_koshien_results() records an audit row
  -- BEFORE it updates events. Require that specific insert in this transaction.
  -- Authenticated clients cannot insert audit rows (RLS has SELECT only).
  v_old_final := OLD.preset_type = 'koshien'
    AND (OLD.status = 'finalized'
      OR OLD.rules->'resultFlow'->>'status' = 'finalized');
  v_identity_same := NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.preset_type IS NOT DISTINCT FROM OLD.preset_type
    AND NEW.league_id IS NOT DISTINCT FROM OLD.league_id;
  IF v_old_final AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.rules IS DISTINCT FROM NEW.rules
    OR NOT v_identity_same
  ) AND NOT (
    v_identity_same
    AND OLD.status = 'finalized' AND NEW.status = 'archive'
    AND NEW.rules IS NOT DISTINCT FROM OLD.rules
  ) AND NOT (
    v_identity_same AND NEW.status = 'resultWait'
    AND NEW.rules->'resultFlow'->>'status' = 'none'
    AND EXISTS (
      SELECT 1 FROM public.koshien_result_reopens a
      WHERE a.event_id = OLD.id
        AND a.reopened_by = auth.uid()
        AND a.previous_event = to_jsonb(OLD)
        AND a.xmin::text::bigint = (txid_current() % 4294967296::bigint)
    )
  ) THEN
    RAISE EXCEPTION 'finalized Koshien result requires audited reopen'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.strip_koshien_match_message_from_results()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if jsonb_typeof(coalesce(new.payload, '{}'::jsonb)) = 'object' then
    new.payload := coalesce(new.payload, '{}'::jsonb) - 'matchMessage';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event_id text;
  v_status text;
  v_flow_status text;
BEGIN
  FOR v_event_id IN
    SELECT DISTINCT id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.event_id ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.event_id ELSE NULL END
    ]) AS ids(id)
    WHERE id IS NOT NULL
    ORDER BY id
  LOOP
    v_status := NULL;
    v_flow_status := NULL;
    SELECT e.status, e.rules->'resultFlow'->>'status' INTO v_status, v_flow_status
    FROM public.events e
    WHERE e.id = v_event_id AND e.preset_type = 'koshien'
    FOR SHARE NOWAIT;
    IF v_status = 'finalized' OR v_flow_status = 'finalized' THEN
      RAISE EXCEPTION 'reopen finalized Koshien results before editing'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.recompute_koshien_current_scores()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_phase1 numeric := 0;
  v_phase2 numeric := 0;
  v_revenge numeric := 0;
  v_zombie numeric := 0;
  v_phase3 numeric := 0;
begin
  if not exists (
    select 1
    from public.events e
    where e.id = new.event_id
      and e.preset_type = 'koshien'
  ) then
    return new;
  end if;

  select coalesce(sum(
    public.koshien_arrival_points(public.koshien_team_current_stage(new.event_id, p1.team_id))
      * coalesce(t.game_multiplier, 0)
      * case when p1.captain then 1.2 else 1 end
  ), 0)
  into v_phase1
  from public.phase1_picks p1
  join public.teams t on t.id = p1.team_id and t.event_id = new.event_id
  where p1.event_id = new.event_id
    and p1.player_id = new.player_id;

  if exists (
    select 1
    from public.phase2_drafts d
    where d.event_id = new.event_id
      and d.status in ('drafting', 'completed', 'locked')
      and new.player_id = any(d.ordered_player_ids)
  ) then
    select coalesce(sum(case public.koshien_team_current_stage(new.event_id, dp.team_id)
      when 'best8' then 20
      when 'best4' then 40
      when 'runner_up' then 60
      when 'champion' then 100
      else 0
    end), 0)
    into v_phase2
    from public.phase2_drafts d
    join public.phase2_draft_picks dp on dp.draft_id = d.id
    where d.event_id = new.event_id
      and dp.player_id = new.player_id;
  end if;

  select coalesce(
    greatest(
      0,
      public.koshien_arrival_points(public.koshien_team_current_stage(new.event_id, rp.target_team_id)) - 1.5
    ) * least(t.sqrt_odds, 50),
    0
  )
  into v_revenge
  from public.revenge_picks rp
  join public.teams t on t.id = rp.target_team_id
  where rp.event_id = new.event_id
    and rp.player_id = new.player_id;

  select coalesce(sum(hit.adjustment), 0)
  into v_zombie
  from (
    select case
      when count(*) >= 2 then -40
      when count(*) = 1 then -20
      else 0
    end as adjustment
    from public.phase2_draft_picks dp
    join public.phase2_drafts d on d.id = dp.draft_id
    join public.zombie_predictions zp on zp.event_id = d.event_id and zp.team_id = dp.team_id
    where d.event_id = new.event_id
      and dp.player_id = new.player_id
      and public.koshien_team_finish(new.event_id, dp.team_id) = 'best4'
    group by dp.team_id
  ) hit;

  v_phase3 := public.koshien_phase3_points(new.event_id, new.player_id);

  new.phase1_score := coalesce(v_phase1, 0);
  new.phase2_score := coalesce(v_phase2, 0);
  new.revenge_score := coalesce(v_revenge, 0);
  new.zombie_score := coalesce(v_zombie, 0);
  new.phase3_score := coalesce(v_phase3, 0);
  new.breakdown := jsonb_set(coalesce(new.breakdown, '{}'::jsonb), '{phase1}', to_jsonb(new.phase1_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{phase2}', to_jsonb(new.phase2_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{revenge}', to_jsonb(new.revenge_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{zombie}', to_jsonb(new.zombie_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{phase3}', to_jsonb(new.phase3_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{total}', to_jsonb(
    new.phase1_score + new.phase2_score + new.revenge_score + new.zombie_score + new.phase3_score
  ), true);
  new.breakdown := jsonb_set(new.breakdown, '{scoring_basis}', to_jsonb('current_stage'::text), true);
  return new;
end;
$function$;
CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER protect_jhbf_import_test_event_marker BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.protect_jhbf_import_test_event_marker();
CREATE TRIGGER yoso_guard_admin_result_finalization BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_event_finalization();
CREATE TRIGGER predictions_set_updated_at BEFORE UPDATE ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER strip_koshien_match_message_from_results BEFORE INSERT OR UPDATE OF payload ON public.results FOR EACH ROW EXECUTE FUNCTION public.strip_koshien_match_message_from_results();
CREATE TRIGGER yoso_guard_finalized_results BEFORE INSERT OR DELETE OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER scores_recompute_koshien_current BEFORE INSERT OR UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION public.recompute_koshien_current_scores();
CREATE TRIGGER yoso_guard_finalized_scores BEFORE INSERT OR DELETE OR UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
-- Confirm the existing Koshien guard is active before exercising ranking.
SET LOCAL ROLE authenticated;
DO $f$ BEGIN
 BEGIN
  UPDATE public.events SET status='finalized' WHERE id='legacy';
  RAISE EXCEPTION 'existing Koshien finalization guard missing';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM 'Koshien result finalization requires server validation' THEN RAISE; END IF;
 END;
END $f$;
RESET ROLE;
SELECT 'PASS: captured core schema and eight existing triggers installed; Koshien finalization guard active';
