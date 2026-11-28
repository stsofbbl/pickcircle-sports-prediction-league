// REVIEW PROTOTYPE ONLY (#59). Not imported by the app or deployed.
// Stable candidate IDs, shared organizer-set multipliers, exact decimal
// scoring. Existing points formula is preserved for valid complete entries.
"use strict";
const VERSION = 1;
const EXACT_POINTS = Object.freeze([10, 7, 5, 3]);
const OTHER_TOP_FOUR_POINTS = 2;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
function requireThat(condition, message) {
  if (!condition) throw new TypeError(message);
}
function exactObject(value, keys, label) {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), label);
  const actual = Object.keys(value);
  requireThat(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)), label);
}
function validateConfig(config) {
  exactObject(config, ["version", "candidates"], "invalid ranking config");
  requireThat(config.version === VERSION, "unsupported ranking version");
  requireThat(Array.isArray(config.candidates) && config.candidates.length >= 4 && config.candidates.length <= 128, "candidate count outside draft contract");
  const ids = new Set(), labels = new Set();
  return Object.freeze({
    version: VERSION,
    candidates: Object.freeze(config.candidates.map(candidate => {
      exactObject(candidate, ["id", "label", "multiplierTenths"], "invalid candidate");
      const { id, label, multiplierTenths } = candidate;
      requireThat(typeof id === "string" && ID.test(id) && !ids.has(id), "invalid or duplicate candidate ID");
      requireThat(typeof label === "string" && label.length >= 1 && label.length <= 100 && label.trim() === label, "invalid candidate label");
      const normalized = label.normalize("NFC");
      requireThat(!labels.has(normalized), "duplicate candidate label");
      requireThat(Number.isInteger(multiplierTenths) && multiplierTenths >= 1 && multiplierTenths <= 1000, "invalid game multiplier");
      ids.add(id);
      labels.add(normalized);
      return Object.freeze({ id, label, multiplierTenths });
    })),
  });
}
function validateOrder(input, config) {
  exactObject(input, ["version", "candidateIds"], "invalid ranking payload");
  requireThat(input.version === VERSION, "unsupported ranking version");
  const ids = input.candidateIds;
  requireThat(Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4, "four distinct candidates required");
  const valid = new Set(config.candidates.map(candidate => candidate.id));
  requireThat(ids.every(id => typeof id === "string" && valid.has(id)), "unknown candidate");
  return Object.freeze({ version: VERSION, candidateIds: Object.freeze([...ids]) });
}
function validatePrediction(input, config) {
  return validateOrder(input, validateConfig(config));
}
function validateResult(input, config) {
  return validateOrder(input, validateConfig(config));
}
function scoreRanking({ config, prediction, result }) {
  const canonical = validateConfig(config);
  const picks = validateOrder(prediction, canonical).candidateIds;
  const actual = validateOrder(result, canonical).candidateIds;
  const multipliers = new Map(canonical.candidates.map(candidate => [candidate.id, candidate.multiplierTenths]));
  const breakdown = picks.map((id, index) => {
    const actualIndex = actual.indexOf(id);
    const basePoints = actualIndex === -1 ? 0 : actualIndex === index ? EXACT_POINTS[index] : OTHER_TOP_FOUR_POINTS;
    return Object.freeze({
      candidateId: id,
      predictedRank: index + 1,
      actualRank: actualIndex === -1 ? null : actualIndex + 1,
      basePoints,
      multiplierTenths: multipliers.get(id),
      scoreTenths: basePoints * multipliers.get(id),
    });
  });
  return Object.freeze({
    version: VERSION,
    scoreTenths: breakdown.reduce((sum, entry) => sum + entry.scoreTenths, 0),
    breakdown: Object.freeze(breakdown),
  });
}
module.exports = Object.freeze({ VERSION, EXACT_POINTS, OTHER_TOP_FOUR_POINTS, validateConfig, validatePrediction, validateResult, scoreRanking });
