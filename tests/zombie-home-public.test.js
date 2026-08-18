const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homeToday = require("../js/home-today-all-phases.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260819004000_publish_koshien_zombie_infection.sql"),
  "utf8",
);

test("rest day markup is explicit instead of showing a phantom game", () => {
  const html = homeToday.todaysYosoMarkup({
    eventName: "夏の甲子園2026 YOSO",
    phase1Rows: [],
    phase2Rows: [],
    restDay: true,
  });
  assert.match(html, /本日のYOSO/);
  assert.match(html, /本日は休養日です/);
  assert.doesNotMatch(html, /10:30/);
});

test("public zombie status identifies infected team and source", () => {
  const html = homeToday.zombieHeroMarkup([{ team_name: "天理", display_name: "50銭" }]);
  assert.match(html, /50銭[\s\S]*ゾンビモード発動/);
  assert.match(html, /ゾンビウイルス感染中/);
  assert.match(html, /天理/);
  assert.match(html, /感染源[\s\S]*50銭/);
  assert.match(html, /data-zombie-team="天理"/);
  assert.match(html, /data-zombie-source="50銭"/);
});

test("zombie period class is added for an open round and removed otherwise", () => {
  const bodyClasses = new Set();
  const homeClasses = new Set();
  const classList = (classes) => ({
    toggle(name, active) {
      if (active) classes.add(name);
      else classes.delete(name);
    },
  });
  const root = {
    location: { hash: "#home" },
    document: {
      body: { classList: classList(bodyClasses) },
      querySelector(selector) {
        return selector === "#home" ? { classList: classList(homeClasses) } : null;
      },
    },
  };

  assert.equal(homeToday.syncZombieTheme(root, { rounds: { zombie: { status: "open" } } }), true);
  assert.equal(bodyClasses.has("is-zombie-mypage"), true);
  assert.equal(homeClasses.has("zombie-theme-active"), true);
  assert.equal(homeToday.syncZombieTheme(root, { rounds: { zombie: { status: "closed" } } }), false);
  assert.equal(bodyClasses.has("is-zombie-mypage"), false);
  assert.equal(homeClasses.has("zombie-theme-active"), false);

  root.location.hash = "#ranking";
  assert.equal(homeToday.syncZombieTheme(root, { rounds: { zombie: { status: "open" } } }), false);
  assert.equal(bodyClasses.has("is-zombie-mypage"), false);
});

test("public infection is visible only while the zombie round is open", () => {
  assert.equal(homeToday.zombieRoundIsActive({ rounds: { zombie: { status: "open" } } }), true);
  assert.equal(homeToday.zombieRoundIsActive({ rounds: { zombie: { status: "closed" } } }), false);
});

test("the same public infection markup is shared across viewer contexts", () => {
  const rows = [{ player_id: "p4", display_name: "50銭", team_id: "t8", team_name: "天理" }];
  const viewerOne = homeToday.zombieHeroMarkup(rows, "夏の甲子園2026 YOSO");
  const viewerTwo = homeToday.zombieHeroMarkup(rows, "夏の甲子園2026 YOSO");
  assert.equal(viewerOne, viewerTwo);
  const source = fs.readFileSync(path.join(__dirname, "../js/home-today-all-phases.js"), "utf8");
  const publicStateReader = source.match(/function zombiePublicPredictions\(\)[\s\S]*?\n  }/)?.[0] || "";
  assert.doesNotMatch(publicStateReader, /currentParticipantName|eligibility/);
});

test("zombie status uses a stable signature and does not restore per-team mutation badges", () => {
  const rows = [{
    player_id: "p1",
    team_id: "t1",
    team_name: "天理",
    updated_at: "2026-08-19T00:00:00Z",
  }];
  assert.equal(homeToday.zombiePublicSignature(rows), homeToday.zombiePublicSignature(rows));
  const source = fs.readFileSync(path.join(__dirname, "../js/home-today-all-phases.js"), "utf8");
  assert.match(source, /existing\?\.dataset\?\.zombiePublicSignature === signature/);
  assert.match(source, /grid\.prepend\(status\)/);
  assert.doesNotMatch(source, /zombie-infected-badge/);
});

test("repatching the same public state does not add another hero for any viewer", () => {
  const rows = [{ player_id: "p4", display_name: "50銭", team_id: "t8", team_name: "天理" }];
  let hero = null;
  let prepends = 0;
  let innerHtmlWrites = 0;
  const grid = {
    prepend(node) {
      hero = node;
      prepends += 1;
    },
  };
  const home = {
    querySelector(selector) {
      if (selector === ".home-global-grid") return grid;
      if (selector === "[data-zombie-public-status]") return hero;
      return null;
    },
  };
  const root = {
    document: {
      querySelector(selector) { return selector === "#home" ? home : null; },
      createElement() {
        const node = {
          className: "",
          dataset: {},
          markup: "",
          setAttribute() {},
          remove() { hero = null; },
        };
        Object.defineProperty(node, "innerHTML", {
          get() { return node.markup; },
          set(value) {
            node.markup = value;
            innerHtmlWrites += 1;
          },
        });
        return node;
      },
    },
  };

  assert.equal(homeToday.patchZombieStatus(root, rows), true);
  const firstMarkup = hero.innerHTML;
  assert.equal(homeToday.patchZombieStatus(root, rows), true);
  assert.equal(prepends, 1);
  assert.equal(innerHtmlWrites, 1);
  assert.equal(hero.innerHTML, firstMarkup);
  assert.match(firstMarkup, /50銭[\s\S]*天理/);
});

test("theme installation does not poll and its observer routes through the guarded patch", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/home-today-all-phases.js"), "utf8");
  const installer = source.match(/function installBrowser\(root\)[\s\S]*?return true;\n  }/)?.[0] || "";
  assert.doesNotMatch(installer, /setInterval/);
  assert.match(installer, /MutationObserver\(\(\) => patchCard\(root\)\)/);
  assert.match(source, /existing\?\.dataset\?\.zombiePublicSignature === signature/);
  assert.doesNotMatch(source, /50銭ゾンビモード発動/);
});

test("later phase state publishes only the zombie public prediction summary alongside viewer state", () => {
  assert.match(migration, /'public_predictions'/);
  assert.match(migration, /'display_name', p\.display_name/);
  assert.match(migration, /'team_name', t\.name/);
  assert.match(migration, /where zp\.event_id = p_event_id/);
  assert.match(migration, /and x\.player_id = v_player_id/);
});
