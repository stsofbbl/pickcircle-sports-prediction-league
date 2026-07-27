const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260726150000_add_club_membership_workflow.sql"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "js", "data-service.js"), "utf8");

function loadService(client) {
  const window = {
    location: { href: "https://example.test/?league=g-unit-koshien-2026" },
    YosoSupabase: {
      config: () => ({ inviteCode: "g-unit-koshien-2026", sync: { autoSaveKoshien: true } }),
      hasConfig: () => true,
      client: () => client,
      sessionUser: async () => ({ id: "user-id", email: "member@example.test", user_metadata: { display_name: "Member" } }),
    },
  };
  vm.runInNewContext(serviceSource, { console: { ...console, warn() {} }, window });
  return window.YosoDataService;
}

test("club migration converts the creator into the only owner and legacy admins into co-owners", () => {
  assert.match(migration, /creator membership is missing or ambiguous/i);
  assert.match(migration, /set role = 'owner'[\s\S]*lm\.user_id = l\.created_by/i);
  assert.match(migration, /set role = 'co_owner'[\s\S]*where role = 'admin'/i);
  assert.match(migration, /league_members_one_active_owner_idx[\s\S]*where role = 'owner' and membership_status = 'active'/i);
  assert.match(migration, /check \(role in \('owner', 'co_owner', 'member'\)\)/i);
});

test("club migration uses approval requests and role-checked RPCs without destructive table operations", () => {
  assert.match(migration, /create table if not exists public\.league_join_requests/i);
  assert.match(migration, /unique \(league_id, requester_id\)/i);
  assert.match(migration, /create or replace function public\.request_club_join/i);
  assert.match(migration, /create or replace function public\.review_club_join_request/i);
  assert.match(migration, /create or replace function public\.is_league_owner/i);
  assert.match(migration, /not public\.is_league_admin\(v_request\.league_id\)/i);
  assert.match(migration, /club owner permission is required/i);
  assert.match(migration, /join via approval request is required/i);
  assert.match(migration, /revoke all on function public\.review_club_join_request[\s\S]*from public, anon/i);
  assert.doesNotMatch(migration, /drop\s+table|truncate/i);
});

test("club migration aligns owner-only controls and co-owner safeguards", () => {
  assert.ok(migration.indexOf("drop constraint if exists league_admin_audit_previous_role_check")
    < migration.indexOf("update public.league_admin_audit\nset previous_role = 'co_owner'"));
  assert.match(migration, /create policy leagues_update_owner[\s\S]*is_league_owner/i);
  assert.match(migration, /create policy leagues_delete_owner[\s\S]*is_league_owner/i);
  assert.match(migration, /create policy league_members_delete_admin[\s\S]*role <> 'owner'[\s\S]*role = 'member'/i);
  assert.match(migration, /create or replace function public\.rename_club/i);
  assert.match(migration, /create or replace function public\.delete_club/i);
  assert.match(migration, /create or replace function public\.remove_club_member/i);
  assert.match(migration, /co-owner can remove members only/i);
});

test("club data service exposes request workflow RPCs and never auto-joins after sign-in", async () => {
  const calls = [];
  const client = {
    auth: {
      async signInWithPassword() {
        return { data: { user: { id: "user-id", email: "member@example.test" } }, error: null };
      },
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        limit() { return Promise.resolve({ data: [{ id: "league-id" }], error: null }); },
        maybeSingle() { return Promise.resolve({ data: { league_id: "league-id", role: "member" }, error: null }); },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "create_club") return { data: [{ league_id: "new-league", league_name: "新クラブ", invite_code: "ABC123" }], error: null };
      if (name === "search_clubs") return { data: [{ league_id: "club-id", league_name: "検索クラブ" }], error: null };
      if (name === "lookup_club_invite") return { data: [{ league_id: "club-id", league_name: "招待クラブ" }], error: null };
      if (name === "request_club_join") return { data: [{ request_id: "request-id", request_status: "pending", league_name: "検索クラブ" }], error: null };
      if (name === "review_club_join_request") return { data: [{ request_id: "request-id", request_status: "approved" }], error: null };
      if (name === "rename_club") return { data: [{ league_id: "club-id", league_name: "新しい名前" }], error: null };
      if (name === "delete_club") return { data: null, error: null };
      if (name === "remove_club_member") return { data: { removed: true }, error: null };
      return { data: [], error: null };
    },
  };
  const service = loadService(client);

  await service.auth.signIn({ email: "member@example.test", password: "password" });
  await service.league.createClub({ name: "新クラブ" });
  await service.league.searchClubs({ query: "検索" });
  await service.league.lookupClubInvite({ inviteCode: "ABC123" });
  await service.league.requestJoin({ leagueId: "club-id" });
  await service.league.reviewJoinRequest({ requestId: "request-id", approve: true });
  await service.league.renameClub({ leagueId: "club-id", name: "新しい名前" });
  await service.league.deleteClub({ leagueId: "club-id", confirmationName: "新しい名前" });
  await service.league.removeMember({ leagueId: "club-id", userId: "member-id" });

  assert.equal(calls.some((call) => call.name === "join_league_by_invite"), false);
  assert.deepEqual(calls.map((call) => call.name), [
    "create_club",
    "search_clubs",
    "lookup_club_invite",
    "request_club_join",
    "review_club_join_request",
    "rename_club",
    "delete_club",
    "remove_club_member",
  ]);
});
