const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const begin = source.indexOf("async function upsertKoshienPlayerWithLockRetry(");
const end = source.indexOf("\n  async function saveKoshienStructuredTables(", begin);
assert.ok(begin >= 0 && end > begin);

function fixture(responses) {
  const calls = [];
  const payload = { league_id: "league-a", profile_id: "user-a", display_name: "A" };
  const supabase = {
    from(table) {
      assert.equal(table, "players");
      return {
        upsert(value, options) {
          calls.push({ value, options });
          return {
            select(column) {
              assert.equal(column, "id");
              return {
                async single() { return responses.shift(); },
              };
            },
          };
        },
      };
    },
  };
  const context = vm.createContext({ window: { setTimeout: (callback) => callback() } });
  vm.runInContext(source.slice(begin, end), context);
  return { upsert: () => context.upsertKoshienPlayerWithLockRetry(supabase, payload), calls, payload };
}

test("player upsert retries one 55P03 with the same identity", async () => {
  const { upsert, calls, payload } = fixture([
    { data: null, error: { code: "55P03" } },
    { data: { id: "player-a" }, error: null },
  ]);
  assert.equal((await upsert()).id, "player-a");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].value, payload);
  assert.equal(calls[1].value, payload);
  assert.equal(calls[0].options.onConflict, "league_id,profile_id");
});

test("deleted club or lost membership fails on retry without a third write", async () => {
  for (const code of ["23503", "42501"]) {
    const { upsert, calls } = fixture([
      { data: null, error: { code: "55P03" } },
      { data: null, error: { code } },
    ]);
    await assert.rejects(upsert(), (error) => error.code === code);
    assert.equal(calls.length, 2);
  }
});

test("player upsert never retries authorization errors or a second lock conflict", async () => {
  const denied = fixture([{ data: null, error: { code: "42501" } }]);
  await assert.rejects(denied.upsert(), (error) => error.code === "42501");
  assert.equal(denied.calls.length, 1);
  const locked = fixture([
    { data: null, error: { code: "55P03" } },
    { data: null, error: { code: "55P03" } },
  ]);
  await assert.rejects(locked.upsert(), (error) => error.code === "55P03");
  assert.equal(locked.calls.length, 2);
});
