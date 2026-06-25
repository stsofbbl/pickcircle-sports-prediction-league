-- Optional seed for the first online Koshien league.
-- Replace the ADMIN_USER_ID value with the id from Supabase Auth > Users.
-- This seed creates only the Koshien foundation; it does not online-enable World Cup presets.

do $$
declare
  v_admin_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_league_id uuid;
  v_event_id text := 'koshien-2026';
  v_teams text[] := array[
    '北海道代表1', '北海道代表2', '青森代表', '岩手代表', '宮城代表', '秋田代表', '山形代表',
    '福島代表', '茨城代表', '栃木代表', '群馬代表', '埼玉代表', '千葉代表', '東東京代表',
    '西東京代表', '神奈川代表', '山梨代表', '新潟代表', '長野代表', '富山代表', '石川代表',
    '福井代表', '静岡代表', '愛知代表', '岐阜代表', '三重代表', '滋賀代表', '京都代表',
    '大阪代表', '兵庫代表', '奈良代表', '和歌山代表', '鳥取代表', '島根代表', '岡山代表',
    '広島代表', '山口代表', '香川代表', '徳島代表', '愛媛代表', '高知代表', '福岡代表',
    '佐賀代表', '長崎代表', '熊本代表', '大分代表', '宮崎代表', '鹿児島代表', '沖縄代表'
  ];
  v_team text;
  v_seed integer := 1;
begin
  if v_admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace ADMIN_USER_ID before running seed.sql';
  end if;

  insert into public.profiles (id, display_name)
  values (v_admin_user_id, 'YOSO Admin')
  on conflict (id) do nothing;

  insert into public.leagues (name, invite_code, created_by)
  values ('G-UNIT YOSO League', 'g-unit-koshien-2026', v_admin_user_id)
  on conflict (invite_code) do update
    set name = excluded.name,
        updated_at = now()
  returning id into v_league_id;

  insert into public.league_members (league_id, user_id, role)
  values (v_league_id, v_admin_user_id, 'admin')
  on conflict (league_id, user_id) do update set role = excluded.role;

  insert into public.events (
    id,
    league_id,
    name,
    preset_type,
    status,
    prediction_deadline,
    rules,
    created_by
  )
  values (
    v_event_id,
    v_league_id,
    '夏の甲子園2026 YOSO',
    'koshien',
    'draft',
    null,
    jsonb_build_object(
      'pickCount', 8,
      'stagePoints', jsonb_build_object(
        'best32', 1,
        'best16', 2,
        'best8', 4,
        'semifinal', 8,
        'runnerUp', 16,
        'champion', 32
      ),
      'source', 'supabase/seed.sql'
    ),
    v_admin_user_id
  )
  on conflict (id) do update
    set name = excluded.name,
        rules = excluded.rules,
        updated_at = now();

  foreach v_team in array v_teams loop
    insert into public.event_teams (event_id, name, seed, metadata)
    values (v_event_id, v_team, v_seed, jsonb_build_object('placeholder', true))
    on conflict (event_id, name) do update
      set seed = excluded.seed,
          metadata = excluded.metadata;
    v_seed := v_seed + 1;
  end loop;
end $$;
