const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DATA_SERVICE_PATH = path.join(__dirname, "..", "js", "data-service.js");

function createSupabaseMock({
  rpcError = null,
  phase1RpcError = null,
  teamError = null,
  playersError = null,
  playerRows = null,
  scoreRows = null,
  predictionRows = null,
  eventStatus = "open",
  predictionDeadline = "2099-08-31T15:00:00.000Z",
  missingEventId = "",
  existingEventTeams = null,
  existingEventRules = {},
  structuredTeamRows = null,
  resultPayload = null,
  matchRows = null,
} = {}) {
  const calls = [];
  const queries = [];
  const baseTeamNames = [
    "Team A", "Team B", "Team C", "Team D",
    "Team E", "Team F", "Team G", "Team H",
    ...Array.from({ length: 41 }, (_, index) => `School ${index + 9}`),
  ];
  const teamRows = structuredTeamRows || baseTeamNames.map((name, index) => ({
    id: index < 8 ? `team-${String.fromCharCode(97 + index)}-id` : `school-${index + 1}-id`,
    name,
    odds: index === 0 ? 4 : (index === 1 ? 9 : 1),
    sqrt_odds: index === 0 ? 2 : (index === 1 ? 3 : 1),
    metadata: { representative_key: `district-${index + 1}:school-${index + 1}` },
  }));

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = "select";
      this.payload = null;
      this.options = null;
      this.filters = {};
      this.expectsList = false;
    }

    select(columns) {
      this.columns = columns;
      return this;
    }

    eq(column, value) {
      this.filters[column] = value;
      return this;
    }

    order() {
      return this;
    }

    limit() {
      this.expectsList = true;
      return this.resolve();
    }

    upsert(payload, options) {
      this.operation = "upsert";
      this.payload = payload;
      this.options = options;
      calls.push({ table: this.table, operation: this.operation, payload, options });
      return this;
    }

    update(payload) {
      this.operation = "update";
      this.payload = payload;
      calls.push({ table: this.table, operation: this.operation, payload });
      return this;
    }

    insert(payload) {
      this.operation = "insert";
      this.payload = payload;
      calls.push({ table: this.table, operation: this.operation, payload });
      return this;
    }

    delete() {
      this.operation = "delete";
      calls.push({ table: this.table, operation: this.operation });
      return this;
    }

    single() {
      return this.resolve();
    }

    maybeSingle() {
      return this.resolve();
    }

    then(resolve, reject) {
      return Promise.resolve(this.resolve()).then(resolve, reject);
    }

    resolve() {
      queries.push({ table: this.table, operation: this.operation, columns: this.columns, filters: { ...this.filters } });
      if (this.table === "leagues") return { data: [{ id: "league-id", invite_code: "league-code" }], error: null };
      if (this.table === "league_members" && this.filters.user_id) {
        return { data: { league_id: "league-id", role: "admin" }, error: null };
      }
      if (this.table === "league_members") {
        return {
          data: [
            { user_id: "user-id", role: "admin", profiles: { display_name: "Admin" } },
            { user_id: "friend-1", role: "member", profiles: { display_name: "イノ" } },
            { user_id: "friend-2", role: "member", profiles: { display_name: "ギン" } },
            { user_id: "friend-3", role: "member", profiles: { display_name: "テストくん" } },
          ],
          error: null,
        };
      }
      if (this.table === "profiles") return { data: { display_name: "Admin" }, error: null };
      if (this.table === "event_teams" && this.operation === "select") {
        return {
          data: existingEventTeams || teamRows.map((team, index) => ({
            name: team.name,
            seed: index + 1,
            metadata: {
              representative_key: team.metadata?.representative_key,
              startRound: index < 15 ? 2 : 1,
            },
          })),
          error: null,
        };
      }
      if (this.table === "events" && this.operation === "select" && this.expectsList) {
        return {
          data: [{
            id: "event-id",
            league_id: "league-id",
            name: "YOSO 夏の甲子園2026",
            preset_type: "koshien",
            status: eventStatus,
            prediction_deadline: predictionDeadline,
            rules: existingEventRules,
          }],
          error: null,
        };
      }
      if (this.table === "events" && this.operation === "select" && this.filters.id) {
        if (this.filters.id === missingEventId) return { data: null, error: null };
        return {
          data: {
            id: this.filters.id,
            league_id: "league-id",
            name: "選択中の夏の甲子園",
            preset_type: "koshien",
            status: eventStatus,
            prediction_deadline: predictionDeadline,
            rules: existingEventRules,
          },
          error: null,
        };
      }
      if (this.table === "events" && this.operation === "select") return { data: { id: "event-id" }, error: null };
      if (this.table === "players" && this.operation === "upsert") return { data: { id: "player-id" }, error: null };
      if (this.table === "players") return {
        data: playerRows || [{ id: "player-id", profile_id: "user-id", display_name: "Admin" }],
        error: playersError,
      };
      if (this.table === "scores") return { data: scoreRows || [], error: null };
      if (this.table === "predictions") return { data: predictionRows || [], error: null };
      if (this.table === "results") return {
        data: resultPayload ? { payload: resultPayload, updated_at: "2026-08-05T00:00:00Z" } : null,
        error: null,
      };
      if (this.table === "matches") return { data: matchRows || [], error: null };
      if (this.table === "teams") return { data: teamRows, error: teamError };
      return { data: null, error: null };
    }
  }

  return {
    calls,
    queries,
    client: {
      from(table) {
        return new Query(table);
      },
      rpc(name, args) {
        calls.push({ operation: "rpc", name, args });
        const error = name === "save_koshien_result_snapshot"
          ? rpcError
          : (name === "save_koshien_phase1_prediction" ? phase1RpcError : null);
        return Promise.resolve({ data: null, error });
      },
    },
  };
}

function loadDataService(supabase) {
  const window = {
    location: { href: "https://example.test/" },
    YosoSupabase: {
      config: () => ({ inviteCode: "league-code", sync: { autoSaveKoshien: true } }),
      hasConfig: () => true,
      client: () => supabase,
      sessionUser: async () => ({ id: "user-id", email: "admin@example.test", user_metadata: { display_name: "Admin" } }),
    },
  };
  window.YosoKoshienResults = require("../js/koshien-results.js");
  vm.runInNewContext(fs.readFileSync(DATA_SERVICE_PATH, "utf8"), { console: { ...console, warn() {} }, window });
  return window.YosoDataService;
}

function completedEvent() {
  return {
    id: "event-id",
    name: "YOSO 夏の甲子園2026",
    templateId: "koshien",
    status: "resultWait",
    config: {
      teams: ["Team A", "Team B"],
      teamMeta: {
        "Team A": { startRound: 1, odds: 4 },
        "Team B": { startRound: 1, odds: 9 },
      },
    },
    predictions: {},
    results: {
      matches: [{
        match_id: "R1-1",
        round: "R1",
        match_no: 1,
        team_a_id: "Team A",
        team_b_id: "Team B",
        score_a: 3,
        score_b: 1,
        winner_id: "Team A",
        loser_id: "Team B",
        status: "completed",
      }],
      finishes: { "Team B": "initial_loss" },
    },
  };
}

function completeRoster(count = 49) {
  const eventTeams = Array.from({ length: count }, (_, index) => ({
    name: `School ${index + 1}`,
    seed: index + 1,
    metadata: {
      representative_key: `district-${index + 1}:school-${index + 1}`,
      startRound: index < 15 ? 2 : 1,
    },
  }));
  const structuredTeams = eventTeams.map((row, index) => ({
    id: `school-${index + 1}-id`,
    name: row.name,
    odds: 1,
    sqrt_odds: 1,
    metadata: { representative_key: row.metadata.representative_key },
  }));
  return { eventTeams, structuredTeams };
}

function withDefault49Roster(event) {
  const teams = Array.from({ length: 49 }, (_, index) => `District ${index + 1}代表`);
  event.config.teams = teams;
  event.config.teamMeta = Object.fromEntries(teams.map((name, index) => [
    name,
    {
      district: `District ${index + 1}`,
      startRound: index < 15 ? 2 : 1,
      odds: 1,
    },
  ]));
  return event;
}

test("transactional result failure rejects without falling back to separate table writes", async () => {
  const missingColumn = {
    code: "42703",
    message: "Could not find the 'loser_team_id' column of 'matches' in the schema cache",
  };
  const supabase = createSupabaseMock({ rpcError: missingColumn });
  const service = loadDataService(supabase.client);

  await assert.rejects(
    service.koshien.saveSnapshot({
      state: { approvalPolicy: "half" },
      event: completedEvent(),
      participantName: "Admin",
      scoreRows: [{ name: "Admin", score: 6, breakdown: { phase1: 6 } }],
    }),
    (error) => error?.stage === "result_transaction" && /loser_team_id/.test(error.message),
  );

  assert.equal(supabase.calls.some((call) => ["matches", "scores", "results"].includes(call.table)), false);
});

test("the four-submitted-player RPC error is localized before reaching the UI", async () => {
  const service = loadDataService({
    rpc: async () => ({ data: null, error: { message: "exactly four submitted players are required" } }),
  });

  await assert.rejects(
    service.koshien.prepareLaterPhase({
      eventId: "event-id",
      phase: "best16",
      opensAt: "2026-08-16T00:00:00.000Z",
      deadlineAt: "2026-08-17T00:00:00.000Z",
    }),
    (error) => error?.stage === "best16_prepare" && error?.message === "予想を提出済みの参加者が4人必要です",
  );
});

test("profile update writes the signed-in user's formal display name without creating another identity", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  const result = await service.auth.updateProfile({ displayName: "新しい表示名" });

  assert.equal(result.ok, true);
  const profileUpdate = supabase.calls.find((call) => call.table === "profiles" && call.operation === "update");
  const playerUpdate = supabase.calls.find((call) => call.table === "players" && call.operation === "update");
  assert.deepEqual(JSON.parse(JSON.stringify(profileUpdate.payload)), { display_name: "新しい表示名" });
  assert.deepEqual(JSON.parse(JSON.stringify(playerUpdate.payload)), { display_name: "新しい表示名" });
  assert.ok(supabase.queries.some((query) => query.table === "profiles" && query.filters.id === "user-id"));
  assert.ok(supabase.queries.some((query) => query.table === "players" && query.filters.profile_id === "user-id"));
  assert.equal(supabase.calls.some((call) => call.operation === "insert" || call.operation === "upsert"), false);
  assert.equal(supabase.calls.some((call) => ["league_members", "predictions", "scores"].includes(call.table)), false);
});

test("score payload preparation failure stops before the result transaction", async () => {
  const supabase = createSupabaseMock({ playersError: { code: "42501", message: "players RLS denied" } });
  const service = loadDataService(supabase.client);

  await assert.rejects(
    service.koshien.saveSnapshot({
      state: { approvalPolicy: "half" },
      event: completedEvent(),
      participantName: "Admin",
      scoreRows: [{ name: "Admin", score: 6, breakdown: { phase1: 6 } }],
    }),
    (error) => error?.stage === "scores" && /RLS denied/.test(error.message),
  );

  assert.equal(supabase.calls.some((call) => call.name === "save_koshien_result_snapshot"), false);
});

test("completed results reject when scoreRows is empty", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  await assert.rejects(
    service.koshien.saveSnapshot({
      state: { approvalPolicy: "half" },
      event: completedEvent(),
      participantName: "Admin",
      scoreRows: [],
    }),
    (error) => error?.stage === "scores" && /空/.test(error.message),
  );
  assert.equal(supabase.calls.some((call) => call.name === "save_koshien_result_snapshot"), false);
});

test("saveSnapshot returns ok only after matches, scores, and raw results succeed", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  const result = await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event: completedEvent(),
    participantName: "Admin",
    scoreRows: [{ name: "Admin", score: 6, breakdown: { phase1: 6 } }],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    stages: { structured: true, scores: true, results: true },
  });
  const transaction = supabase.calls.find((call) => call.name === "save_koshien_result_snapshot");
  assert.ok(transaction);
  assert.equal(transaction.args.p_match_rows[0].loser_team_id, "team-b-id");
  assert.equal(transaction.args.p_match_rows[0].status, "completed");
  assert.equal(transaction.args.p_score_rows[0].player_id, "player-id");
  assert.deepEqual(JSON.parse(JSON.stringify(transaction.args.p_results_payload)), completedEvent().results);
  assert.equal(supabase.calls.some((call) => ["matches", "scores", "results"].includes(call.table)), false);
});

test("phase 1 autosave never writes later-phase tables directly", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.config.teams = ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F", "Team G", "Team H"];
  event.config.teamMeta = Object.fromEntries(event.config.teams.map((name) => [name, { startRound: 1, odds: 1 }]));
  event.predictions.Admin = {
    teams: ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F", "Team G", "Team H"],
    captain: "Team A",
    revengePick: "Team A",
    zombiePick: "Team B",
    finalScorePrediction: { champion: "Team A", runnerUp: "Team B", championScore: 5, runnerUpScore: 3 },
  };
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  const writtenTables = supabase.calls.filter((call) => call.table).map((call) => call.table);
  assert.equal(writtenTables.includes("revenge_picks"), false);
  assert.equal(writtenTables.includes("zombie_predictions"), false);
  assert.equal(writtenTables.includes("final_score_predictions"), false);
  assert.equal(supabase.calls.some((call) => call.name === "save_koshien_phase1_prediction"), true);
  assert.equal(supabase.calls.some((call) => call.table === "predictions"), false);
});

test("phase 1 save uses the explicitly displayed event id for the RPC", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  const displayedEventId = "2930e8b6-0fe7-45c4-bcf6-edeb8b1407f0";
  event.id = displayedEventId;
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.results = { matches: [], finishes: {} };
  event.config.teams = ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F", "Team G", "Team H"];
  event.config.teamMeta = Object.fromEntries(event.config.teams.map((name) => [name, { startRound: 1, odds: 1 }]));
  event.predictions.Admin = {
    teams: ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F", "Team G", "Team H"],
    captain: "Team A",
  };
  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    eventId: displayedEventId,
    participantName: "Admin",
    scoreRows: [],
  });

  const phase1Rpc = supabase.calls.find((call) => call.name === "save_koshien_phase1_prediction");
  assert.equal(phase1Rpc?.args?.p_event_id, displayedEventId);

  await assert.rejects(
    service.koshien.saveSnapshot({
      state: { approvalPolicy: "half" },
      event,
      eventId: "stale-local-event-id",
      participantName: "Admin",
      scoreRows: [],
    }),
    /大会IDが一致しません/,
  );
  assert.equal(
    supabase.calls.filter((call) => call.name === "save_koshien_phase1_prediction").length,
    1,
  );

  const rpcError = { code: "P0002", message: "koshien event was not found" };
  const failingSupabase = createSupabaseMock({ phase1RpcError: rpcError });
  const failingService = loadDataService(failingSupabase.client);
  await assert.rejects(
    failingService.koshien.saveSnapshot({
      state: { approvalPolicy: "half" },
      event,
      eventId: displayedEventId,
      participantName: "Admin",
      scoreRows: [],
    }),
    (error) => error?.message === rpcError.message && error?.code === rpcError.code,
  );
});

test("existing Koshien autosave never rewrites the roster or draw-owned rules", async () => {
  const { eventTeams, structuredTeams } = completeRoster();
  const supabase = createSupabaseMock({
    existingEventTeams: eventTeams,
    structuredTeamRows: structuredTeams,
  });
  const service = loadDataService(supabase.client);
  const event = withDefault49Roster(completedEvent());
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  const eventWrite = supabase.calls.find((call) => call.table === "events" && call.operation === "update");
  const eventTeamWrite = supabase.calls.find((call) => call.table === "event_teams" && call.operation === "upsert");
  const structuredTeamWrite = supabase.calls.find((call) => call.table === "teams" && call.operation === "upsert");
  assert.equal(Object.hasOwn(eventWrite.payload, "rules"), false);
  assert.equal(eventTeamWrite, undefined);
  assert.equal(structuredTeamWrite, undefined);
  assert.equal(supabase.calls.some((call) => call.name === "replace_koshien_representatives"), false);
});

test("new Koshien roster initialization uses the atomic representative RPC", async () => {
  const supabase = createSupabaseMock({ missingEventId: "event-id" });
  const service = loadDataService(supabase.client);
  const event = withDefault49Roster(completedEvent());
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  assert.equal(supabase.calls.some((call) => call.name === "replace_koshien_representatives"), true);
  assert.equal(supabase.calls.some((call) => call.table === "event_teams" && call.operation === "upsert"), false);
  assert.equal(supabase.calls.some((call) => call.table === "teams" && call.operation === "upsert"), false);
});

test("a 49-row display roster with an incomplete structured roster is atomically repaired", async () => {
  const { eventTeams, structuredTeams } = completeRoster();
  const supabase = createSupabaseMock({
    existingEventTeams: eventTeams,
    structuredTeamRows: structuredTeams.slice(0, 48),
  });
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.config.teams = eventTeams.map((row) => row.name);
  event.config.teamMeta = Object.fromEntries(eventTeams.map((row) => [
    row.name,
    {
      district: `district-${row.seed}`,
      representativeKey: row.metadata.representative_key,
      startRound: row.metadata.startRound,
      odds: 1,
    },
  ]));
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  assert.equal(supabase.calls.some((call) => call.name === "replace_koshien_representatives"), true);
});

test("an incomplete display roster is repaired from the saved 49-school rules snapshot", async () => {
  const { eventTeams, structuredTeams } = completeRoster();
  const savedTeams = eventTeams.map((row) => row.name);
  const savedTeamMeta = Object.fromEntries(eventTeams.map((row) => [
    row.name,
    {
      district: `district-${row.seed}`,
      representativeKey: row.metadata.representative_key,
      startRound: row.metadata.startRound,
      odds: 1,
    },
  ]));
  const supabase = createSupabaseMock({
    existingEventTeams: eventTeams.slice(0, 48),
    structuredTeamRows: structuredTeams,
    existingEventRules: { config: { teams: savedTeams, teamMeta: savedTeamMeta } },
  });
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.config.teams = eventTeams.slice(0, 48).map((row) => row.name);
  event.config.teamMeta = Object.fromEntries(eventTeams.slice(0, 48).map((row) => [
    row.name,
    savedTeamMeta[row.name],
  ]));
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  const repairCall = supabase.calls.find((call) => call.name === "replace_koshien_representatives");
  assert.equal(repairCall.args.p_rows.length, 49);
});

test("existing Koshien autosave preserves confirmed DB start rounds", async () => {
  const { eventTeams, structuredTeams } = completeRoster();
  const supabase = createSupabaseMock({
    existingEventTeams: eventTeams,
    structuredTeamRows: structuredTeams,
    existingEventRules: {
      config: {
        startRoundsConfirmed: true,
        startRoundsConfirmedAt: "2026-07-29T09:00:00.000Z",
        teamMeta: Object.fromEntries(eventTeams.map((row) => [
          row.name,
          {
            startRound: row.metadata.startRound,
            representativeKey: row.metadata.representative_key,
          },
        ])),
      },
    },
  });
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  event.status = "open";
  event.deadline = "2099-08-31T15:00:00.000Z";
  event.config.teamMeta["Team A"].startRound = 2;
  event.config.teamMeta["Team B"].startRound = 1;
  event.results = { matches: [], finishes: {} };

  await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  const eventWrite = supabase.calls.find((call) => call.table === "events" && call.operation === "update");
  const structuredTeamWrite = supabase.calls.find((call) => call.table === "teams" && call.operation === "upsert");
  assert.equal(Object.hasOwn(eventWrite.payload, "rules"), false);
  assert.equal(structuredTeamWrite, undefined);
  assert.equal(supabase.calls.some((call) => call.name === "replace_koshien_representatives"), false);
});

test("resultWait result save does not rewrite prediction tables after the deadline", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const event = completedEvent();
  event.predictions.Admin = { teams: ["Team A"], captain: "Team A" };

  const result = await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [{ name: "Admin", score: 2.4, breakdown: { phase1: 2.4 } }],
  });

  assert.equal(result.ok, true);
  assert.equal(supabase.calls.some((call) => call.table === "predictions"), false);
  assert.equal(supabase.calls.some((call) => call.table === "phase1_picks"), false);
});

test("prediction-only fallback reports partial when structured tables are missing", async () => {
  const supabase = createSupabaseMock({
    teamError: { code: "PGRST205", message: "Could not find the table 'teams' in the schema cache" },
  });
  const service = loadDataService(supabase.client);
  const event = withDefault49Roster(completedEvent());
  event.status = "open";
  event.results = { matches: [], finishes: {} };
  event.predictions.Admin = { teams: ["Team A"], captain: "Team A" };

  const result = await service.koshien.saveSnapshot({
    state: { approvalPolicy: "half" },
    event,
    participantName: "Admin",
    scoreRows: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.deepEqual(Array.from(result.warnings), ["structured_tables_missing"]);
  assert.equal(result.stages.structured, false);
});

test("loadSnapshot returns all league members while predictions remain private before the deadline", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot();

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.members)), [
    { user_id: "user-id", role: "admin", profiles: { display_name: "Admin" } },
    { user_id: "friend-1", role: "member", profiles: { display_name: "イノ" } },
    { user_id: "friend-2", role: "member", profiles: { display_name: "ギン" } },
    { user_id: "friend-3", role: "member", profiles: { display_name: "テストくん" } },
  ]);
  const predictionQuery = supabase.queries.find((call) => call.table === "predictions" && call.operation === "select");
  assert.equal(predictionQuery?.filters?.user_id, "user-id");
});

test("loadSnapshot returns players and official scores independently of private predictions", async () => {
  const players = [
    { id: "player-1", profile_id: "user-id", display_name: "Admin" },
    { id: "player-2", profile_id: "friend-1", display_name: "イノ" },
    { id: "player-3", profile_id: "friend-2", display_name: "ギン" },
    { id: "player-4", profile_id: "friend-3", display_name: "テストくん" },
  ];
  const scores = [{
    player_id: "player-2",
    phase1_score: 12,
    phase2_score: 20,
    phase3_score: 30,
    revenge_score: 4,
    zombie_score: -20,
    total_score: 46,
    breakdown: { scoring_basis: "current_stage" },
  }];
  const supabase = createSupabaseMock({ playerRows: players, scoreRows: scores });
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot();

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.players)), players);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.scores)), scores);
  assert.equal(supabase.queries.find((query) => query.table === "scores")?.filters?.event_id, "event-id");
  assert.equal(supabase.queries.find((query) => query.table === "predictions")?.filters?.user_id, "user-id");
});

test("loadSnapshot publishes all phase 1 predictions after the deadline without changing score loading", async () => {
  const predictions = [
    { user_id: "user-id", payload: { teams: ["Team A"] } },
    { user_id: "friend-1", payload: { teams: ["Team B"] } },
    { user_id: "friend-2", payload: { teams: ["Team C"] } },
    { user_id: "friend-3", payload: { teams: ["Team D"] } },
  ];
  const scores = [{ player_id: "player-id", phase1_score: 2, total_score: 2 }];
  const supabase = createSupabaseMock({
    predictionDeadline: "2020-08-01T00:00:00.000Z",
    predictionRows: predictions,
    scoreRows: scores,
  });
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot();

  assert.equal(snapshot.predictionsPublic, true);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.predictions)), predictions);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.scores)), scores);
  assert.equal(supabase.queries.find((query) => query.table === "predictions")?.filters?.user_id, undefined);
});

test("result cancellation sends all active ranking rows so every affected score trigger can rerun", async () => {
  const players = [
    { id: "player-1", profile_id: "user-id", display_name: "Admin" },
    { id: "player-2", profile_id: "friend-1", display_name: "イノ" },
    { id: "player-3", profile_id: "friend-2", display_name: "ギン" },
    { id: "player-4", profile_id: "friend-3", display_name: "テストくん" },
  ];
  const supabase = createSupabaseMock({ playerRows: players });
  const service = loadDataService(supabase.client);
  const scoreRows = players.map((player) => ({
    name: player.display_name,
    playerId: player.id,
    profileId: player.profile_id,
    score: 0,
    breakdown: { phase1: 0, phase2: 0, phase3: 0, revenge: 0, zombie: 0 },
  }));

  await service.koshien.cancelKoshienMatchResult({
    eventId: "event-id",
    roundKey: "R1",
    matchNo: 1,
    resultsPayload: { matches: [], finishes: {} },
    scoreRows,
  });

  const request = supabase.calls.find((call) => call.name === "cancel_koshien_match_result");
  assert.equal(request.args.p_score_rows.length, 4);
  assert.deepEqual(request.args.p_score_rows.map((row) => row.player_id), players.map((player) => player.id));
});

test("loadSnapshot merges saved game multipliers by representative key or unique school name", async () => {
  const eventTeams = [
    { name: "横浜", seed: 1, metadata: { representative_key: "kanagawa:yokohama", startRound: 1, district: "神奈川" } },
    { name: "享栄", seed: 2, metadata: { startRound: 2, district: "愛知" } },
    { name: "横手", seed: 3, metadata: { representative_key: "akita:yokote", startRound: 1, district: "秋田" } },
  ];
  const structuredTeams = [
    { id: "team-1", name: "横浜高校", game_multiplier: 2.2, metadata: { representative_key: "kanagawa:yokohama" } },
    { id: "team-2", name: "享栄", game_multiplier: 7.08, metadata: {} },
    { id: "team-3", name: "横手", game_multiplier: null, metadata: { representative_key: "akita:yokote" } },
  ];
  const supabase = createSupabaseMock({ existingEventTeams: eventTeams, structuredTeamRows: structuredTeams });
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot();

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.teams)), [
    { name: "横浜", seed: 1, metadata: { representative_key: "kanagawa:yokohama", startRound: 1, district: "神奈川", gameMultiplier: 2.2 } },
    { name: "享栄", seed: 2, metadata: { startRound: 2, district: "愛知", gameMultiplier: 7.08 } },
    { name: "横手", seed: 3, metadata: { representative_key: "akita:yokote", startRound: 1, district: "秋田", gameMultiplier: null } },
  ]);
});

test("loadSnapshot uses the currently selected event id", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot({ eventId: "selected-event-id" });

  assert.equal(snapshot.event.id, "selected-event-id");
  const eventQuery = supabase.queries.find((call) => call.table === "events" && call.operation === "select");
  assert.equal(eventQuery?.filters?.id, "selected-event-id");
});

test("loadSnapshot projects canonical public matches into the result editor payload", async () => {
  const resultPayload = {
    matches: [{
      match_id: "R1-1", round: "R1", match_no: 1,
      team_a_id: "", team_b_id: "", score_a: "", score_b: "",
      winner_id: "", loser_id: "", status: "scheduled",
    }],
    finishes: {},
  };
  const supabase = createSupabaseMock({
    resultPayload,
    structuredTeamRows: [
      { id: "team-sapporo", name: "札幌日大", game_multiplier: 2, metadata: {} },
      { id: "team-sendai", name: "仙台育英", game_multiplier: 2, metadata: {} },
    ],
    matchRows: [{
      id: "db-match-1", round_key: "R1", match_no: 1,
      team1_id: "team-sapporo", team2_id: "team-sendai",
      team1_score: null, team2_score: null,
      winner_team_id: null, loser_team_id: null, status: "scheduled", metadata: {},
    }],
  });
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot();

  assert.equal(snapshot.results.payload.matches[0].team_a_id, "札幌日大");
  assert.equal(snapshot.results.payload.matches[0].team_b_id, "仙台育英");
  assert.ok(supabase.queries.some((query) => query.table === "matches" && query.filters.event_id === "event-id"));
});

test("loadSnapshot falls back to the league event when the local selected id is stale", async () => {
  const supabase = createSupabaseMock({ missingEventId: "stale-local-event-id" });
  const service = loadDataService(supabase.client);

  const snapshot = await service.koshien.loadSnapshot({ eventId: "stale-local-event-id" });

  assert.equal(snapshot.event.id, "event-id");
  assert.equal(supabase.queries.some((call) => call.table === "events" && call.filters.id === "stale-local-event-id"), true);
  assert.equal(supabase.queries.some((call) => call.table === "events" && !call.filters.id), true);
});

test("representative replacement uses one event-scoped RPC", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const rows = [{ districtName: "北北海道", schoolName: "白樺学園" }];

  await service.koshien.replaceRepresentatives({ eventId: "event-id", rows, year: 2026 });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "replace_koshien_representatives"))),
    {
      operation: "rpc",
      name: "replace_koshien_representatives",
      args: {
        p_event_id: "event-id",
        p_rows: [{ district_name: "北北海道", school_name: "白樺学園" }],
        p_source_year: 2026,
      },
    },
  );
});

test("start rounds are confirmed through one event-scoped 49-school RPC", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const rows = Array.from({ length: 49 }, (_, index) => ({
    representativeKey: `district-${index + 1}:school-${index + 1}`,
    startRound: index < 15 ? 2 : 1,
  }));

  await service.koshien.updateStartRounds({ eventId: "event-id", rows });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "confirm_koshien_start_rounds"))),
    {
      operation: "rpc",
      name: "confirm_koshien_start_rounds",
      args: {
        p_event_id: "event-id",
        p_rows: rows.map((row) => ({
          representative_key: row.representativeKey,
          start_round: row.startRound,
        })),
      },
    },
  );
});

test("official first-round cards use one admin RPC without touching start-round confirmation", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const matches = [{ roundKey: "R1", matchNo: 1, team1Id: "team-a", team2Id: "team-b" }];

  await service.koshien.registerOfficialFirstRoundMatches({
    eventId: "event-id",
    matches,
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/tournament/",
    fetchedAt: "2026-08-05T00:00:00Z",
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "register_koshien_official_first_round_matches"))),
    {
      operation: "rpc",
      name: "register_koshien_official_first_round_matches",
      args: {
        p_event_id: "event-id",
        p_matches: [{ round_key: "R1", match_no: 1, team1_id: "team-a", team2_id: "team-b" }],
        p_source_url: "https://www.jhbf.or.jp/sensyuken/2026/tournament/",
        p_fetched_at: "2026-08-05T00:00:00Z",
      },
    },
  );
});

test("official second-round slots use one dedicated admin RPC", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);

  await service.koshien.registerOfficialSecondRoundSlots({
    eventId: "event-id",
    matches: [{
      roundKey: "R2", matchNo: 8,
      team1Id: "starter-15", team2Id: null,
      team1SourceMatchNo: null, team2SourceMatchNo: 1,
    }],
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/tournament/",
    fetchedAt: "2026-08-07T00:00:00Z",
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "register_koshien_official_second_round_slots"))),
    {
      operation: "rpc",
      name: "register_koshien_official_second_round_slots",
      args: {
        p_event_id: "event-id",
        p_matches: [{
          round_key: "R2", match_no: 8,
          team1_id: "starter-15", team2_id: null,
          team1_source_match_no: null, team2_source_match_no: 1,
        }],
        p_source_url: "https://www.jhbf.or.jp/sensyuken/2026/tournament/",
        p_fetched_at: "2026-08-07T00:00:00Z",
      },
    },
  );
});

test("one edited school's odds use the event-scoped RPC without resending stale peers", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const rows = [{ representativeKey: "district-1:school-1", odds: 2.5 }];

  await service.koshien.updateOdds({ eventId: "event-id", rows });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "update_koshien_odds"))),
    {
      operation: "rpc",
      name: "update_koshien_odds",
      args: {
        p_event_id: "event-id",
        p_rows: rows.map((row) => ({
          representative_key: row.representativeKey,
          odds: row.odds,
        })),
      },
    },
  );
});

test("all 49 saved game multipliers use one event-scoped RPC and preserve unset values", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const rows = Array.from({ length: 49 }, (_, index) => ({
    representativeKey: `district-${index + 1}:school-${index + 1}`,
    gameMultiplier: index === 48 ? null : (index + 1) / 10,
  }));

  await service.koshien.updateGameMultipliers({ eventId: "event-id", rows });

  assert.deepEqual(
    JSON.parse(JSON.stringify(supabase.calls.find((call) => call.name === "update_koshien_game_multipliers"))),
    {
      operation: "rpc",
      name: "update_koshien_game_multipliers",
      args: {
        p_event_id: "event-id",
        p_rows: rows.map((row) => ({
          representative_key: row.representativeKey,
          game_multiplier: row.gameMultiplier,
        })),
      },
    },
  );
});

test("game multiplier save rejects values outside the greater-than-zero through 50 range", async () => {
  const supabase = createSupabaseMock();
  const service = loadDataService(supabase.client);
  const rows = Array.from({ length: 49 }, (_, index) => ({
    representativeKey: `district-${index + 1}:school-${index + 1}`,
    gameMultiplier: 1,
  }));

  rows[0].gameMultiplier = 0;
  await assert.rejects(service.koshien.updateGameMultipliers({ eventId: "event-id", rows }), /0より大きく50以下/);
  rows[0].gameMultiplier = 50.1;
  await assert.rejects(service.koshien.updateGameMultipliers({ eventId: "event-id", rows }), /0より大きく50以下/);
  assert.equal(supabase.calls.some((call) => call.name === "update_koshien_game_multipliers"), false);
});
