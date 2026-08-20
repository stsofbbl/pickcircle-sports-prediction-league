const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("later-phase render preserves zombie, revenge, and phase3 inputs", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/koshien-later-phases.js"), "utf8");
  const timers = [];
  let form;

  function makeForm(values) {
    const controls = {
      "[data-koshien-revenge-team]": { value: values.revenge },
      "[data-koshien-zombie-team]": { value: values.zombie },
      "[data-koshien-phase3-score='a']": { value: values.scoreA },
      "[data-koshien-phase3-score='b']": { value: values.scoreB },
      "[data-koshien-phase3-tiebreak-score='a']": { value: values.tiebreakScoreA },
      "[data-koshien-phase3-tiebreak-score='b']": { value: values.tiebreakScoreB },
    };
    return { querySelector: (selector) => controls[selector] || null };
  }

  form = makeForm({ revenge: "revenge-team", zombie: "zombie-team", scoreA: "4", scoreB: "2", tiebreakScoreA: "7", tiebreakScoreB: "6" });
  const context = {
    console,
    document: { querySelector: (selector) => (selector === "#eventForm" ? form : null) },
    addEventListener() {},
    setTimeout(callback) { timers.push(callback); return timers.length; },
    render() {
      form = makeForm({ revenge: "", zombie: "", scoreA: "", scoreB: "", tiebreakScoreA: "", tiebreakScoreB: "" });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "koshien-later-phases.js" });
  while (timers.length) timers.shift()();

  context.render();

  assert.equal(form.querySelector("[data-koshien-revenge-team]").value, "revenge-team");
  assert.equal(form.querySelector("[data-koshien-zombie-team]").value, "zombie-team");
  assert.equal(form.querySelector("[data-koshien-phase3-score='a']").value, "4");
  assert.equal(form.querySelector("[data-koshien-phase3-score='b']").value, "2");
  assert.equal(form.querySelector("[data-koshien-phase3-tiebreak-score='a']").value, "7");
  assert.equal(form.querySelector("[data-koshien-phase3-tiebreak-score='b']").value, "6");
});
