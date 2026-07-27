const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260727144206_add_safe_club_and_account_deletion.sql",
);
const migration = [
  fs.readFileSync(path.join(root, "supabase", "migrations", "20260726150000_add_club_membership_workflow.sql"), "utf8"),
  fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "",
].join("\n");
const edgeFunctionPath = path.join(root, "supabase", "functions", "delete-account", "index.ts");
const edgeFunction = fs.existsSync(edgeFunctionPath) ? fs.readFileSync(edgeFunctionPath, "utf8") : "";
const serviceSource = fs.readFileSync(path.join(root, "js", "data-service.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function loadService(client) {
  const window = {
    location: { href: "https://example.test/" },
    YosoSupabase: {
      config: () => ({ url: "https://example.supabase.co", anonKey: "public-key" }),
      hasConfig: () => true,
      client: async () => client,
      sessionUser: async () => ({ id: "member-id", email: "member@example.test" }),
    },
  };
  vm.runInNewContext(serviceSource, { console, localStorage: { getItem() {}, setItem() {} }, window });
  return window.YosoDataService;
}

test("member removal is reversible and preserves prediction, player, score, and ranking history", () => {
  assert.match(migration, /create or replace function public\.remove_club_member/i);
  assert.match(migration, /set membership_status = 'removed'[\s\S]*role = 'member'/i);
  assert.match(migration, /update public\.players[\s\S]*set is_admin = false/i);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.remove_club_member[\s\S]*?delete from public\.(predictions|players|scores)/i,
  );
  assert.match(migration, /drop policy if exists league_members_delete_admin/i);
  assert.match(migration, /create policy profiles_select_members[\s\S]*join public\.players/i);
  const snapshotStart = app.indexOf("function applyKoshienOnlineSnapshot");
  const snapshotEnd = app.indexOf("function koshienLoadSkipMessage", snapshotStart + 1);
  const snapshot = app.slice(snapshotStart, snapshotEnd > snapshotStart ? snapshotEnd : undefined);
  assert.match(snapshot, /const participants = uniqueStrings\(\[[\s\S]*\.\.\.predictionEntries/i);
});

test("club and co-owner management is enforced by owner/admin RPC checks", () => {
  assert.match(migration, /create or replace function public\.rename_club[\s\S]*is_league_owner/i);
  assert.match(migration, /create or replace function public\.delete_club[\s\S]*is_league_owner/i);
  assert.match(migration, /club name confirmation does not match/i);
  assert.match(migration, /create or replace function public\.manage_league_admin[\s\S]*is_league_owner/i);
  assert.match(migration, /co-owner can remove members only/i);
});

test("normal account deletion detaches auth while anonymizing and preserving historical rows", () => {
  assert.match(migration, /add column if not exists auth_user_id uuid/i);
  assert.match(migration, /references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /add column if not exists deleted_at timestamptz/i);
  assert.match(migration, /before delete on auth\.users/i);
  assert.match(migration, /club owner must delete or transfer owned clubs before deleting the account/i);
  assert.match(migration, /after delete on auth\.users/i);
  assert.match(migration, /退会済みメンバー-/);
  assert.match(migration, /set membership_status = 'removed'[\s\S]*role = 'member'/i);
  assert.doesNotMatch(migration, /delete from public\.(predictions|players|scores)/i);
});

test("account deletion endpoint verifies the caller and password before hard deleting Auth", () => {
  assert.match(edgeFunction, /verify_jwt/i);
  assert.match(edgeFunction, /auth\.getUser\(/i);
  assert.match(edgeFunction, /signInWithPassword/i);
  assert.match(edgeFunction, /confirmedUser\.id !== user\.id/i);
  assert.match(edgeFunction, /auth\.admin\.deleteUser\(user\.id/i);
  assert.doesNotMatch(edgeFunction, /console\.(log|error)\([^)]*password/i);
});

test("data service exposes password-confirmed account deletion through the Edge Function", async () => {
  const calls = [];
  const client = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return { data: { deleted: true }, error: null };
      },
    },
  };
  const service = loadService(client);
  const result = await service.auth.deleteAccount({ password: "confirmed-password" });
  assert.equal(result.deleted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "delete-account");
  assert.equal(calls[0].options.body.password, "confirmed-password");
});

test("settings require a password and explicit confirmation before account deletion", () => {
  assert.match(html, /id="accountDeletePassword"[^>]*autocomplete="current-password"/);
  assert.match(html, /id="accountDeleteButton"/);
  assert.match(app, /handleAccountDelete/);
  assert.match(app, /accountDeletePassword/);
  assert.match(app, /window\.confirm\(/);
});

test("online members cannot use legacy participant or tournament management controls", () => {
  assert.match(app, /const onlineClubMode = isSupabaseAuthEnabled\(\) && Boolean\(currentAuthUser\(\)\)/);
  assert.match(app, /onlineClubMode[\s\S]*data-event-delete/);
  assert.match(app, /if \(isSupabaseAuthEnabled\(\) && currentAuthUser\(\) && !isClubAdmin\(\)\) return;/);
  assert.match(app, /クラブ参加者の追加・削除は加入申請とメンバー管理を使います/);
});
