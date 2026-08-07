const RESULT_FIRST_CHECK_MINUTES = 105;
const SCHEDULE_RETRY_MINUTES = 30;
const DELAY_REFRESH_MINUTES = 180;

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeSchoolName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\t\r\n\s　]+/gu, "")
    .trim();
}

export function jstDateKey(value) {
  const date = parseDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function jstMinutesOfDay(value) {
  const date = parseDate(value);
  if (!date) return -1;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function matchStartsAt(match) {
  return match?.starts_at || match?.startsAt || "";
}

export function pendingDueMatches(matches = [], now = new Date()) {
  const nowDate = parseDate(now) || new Date();
  const firstCheckMs = RESULT_FIRST_CHECK_MINUTES * 60 * 1000;
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => String(match?.status || "") !== "completed")
    .filter((match) => match?.team1_id && match?.team2_id)
    .filter((match) => {
      const startsAt = parseDate(matchStartsAt(match));
      return startsAt && nowDate.getTime() >= startsAt.getTime() + firstCheckMs;
    })
    .sort((left, right) => new Date(matchStartsAt(left)) - new Date(matchStartsAt(right)));
}

export function dueResultDates(matches = [], now = new Date()) {
  return [...new Set(pendingDueMatches(matches, now)
    .map((match) => jstDateKey(matchStartsAt(match)))
    .filter(Boolean))];
}

export function scheduleDecision(matches = [], state = {}, now = new Date()) {
  const nowDate = parseDate(now) || new Date();
  const relevant = (Array.isArray(matches) ? matches : [])
    .filter((match) => ["R1", "R2"].includes(String(match?.round_key || match?.roundKey || "")));
  const lastAttempt = parseDate(state?.last_schedule_attempt_at);
  const retryReady = !lastAttempt || nowDate.getTime() - lastAttempt.getTime() >= SCHEDULE_RETRY_MINUTES * 60 * 1000;
  if (relevant.length === 33 && relevant.some((match) => !matchStartsAt(match)) && retryReady) {
    return { due: true, reason: "missing_schedule" };
  }

  const today = jstDateKey(nowDate);
  const todayMatches = relevant
    .filter((match) => matchStartsAt(match) && jstDateKey(matchStartsAt(match)) === today)
    .sort((left, right) => new Date(matchStartsAt(left)) - new Date(matchStartsAt(right)));
  if (!todayMatches.length) return { due: false, reason: "no_match_today" };

  const minutes = jstMinutesOfDay(nowDate);
  if (minutes >= 5 * 60 && String(state?.schedule_morning_date || "") !== today && retryReady) {
    return { due: true, reason: "matchday_morning" };
  }

  const firstStart = parseDate(matchStartsAt(todayMatches[0]));
  if (firstStart) {
    const untilFirstMs = firstStart.getTime() - nowDate.getTime();
    if (untilFirstMs <= 60 * 60 * 1000 && untilFirstMs > 0
      && String(state?.schedule_pregame_date || "") !== today && retryReady) {
      return { due: true, reason: "pregame_check" };
    }
  }

  const delayed = pendingDueMatches(relevant, nowDate)
    .some((match) => nowDate.getTime() - new Date(matchStartsAt(match)).getTime() >= DELAY_REFRESH_MINUTES * 60 * 1000);
  if (delayed && (!lastAttempt || nowDate.getTime() - lastAttempt.getTime() >= 60 * 60 * 1000)) {
    return { due: true, reason: "delayed_result_check" };
  }
  return { due: false, reason: "not_due" };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function pairMatches(leftA, leftB, rightA, rightB) {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}

export function buildCanonicalResultRows(sourceRows = [], context = {}, allowedMatchIds = null) {
  const teams = Array.isArray(context?.teams) ? context.teams : [];
  const aliases = Array.isArray(context?.aliases) ? context.aliases : [];
  const matches = Array.isArray(context?.matches) ? context.matches : [];
  const imports = Array.isArray(context?.imports) ? context.imports : [];
  const exactByName = new Map(teams.map((team) => [normalizeSchoolName(team.name), String(team.id || team.team_id || team.teamId || "")]));
  const aliasByName = new Map(aliases.map((alias) => [
    normalizeSchoolName(alias.normalized_external_name || alias.normalizedExternalName || alias.external_name || alias.externalName),
    String(alias.team_id || alias.teamId || ""),
  ]));
  const importByKey = new Map(imports.map((item) => [String(item.external_key || item.externalKey || ""), item]));
  const allowed = allowedMatchIds instanceof Set ? allowedMatchIds : null;
  const ready = [];
  const skipped = [];
  const conflicts = [];

  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const teamAId = exactByName.get(normalizeSchoolName(row.teamANameRaw)) || aliasByName.get(normalizeSchoolName(row.teamANameRaw)) || "";
    const teamBId = exactByName.get(normalizeSchoolName(row.teamBNameRaw)) || aliasByName.get(normalizeSchoolName(row.teamBNameRaw)) || "";
    if (!teamAId || !teamBId || teamAId === teamBId) {
      conflicts.push({ reason: "team_mapping", row });
      continue;
    }
    const candidates = matches.filter((match) => String(match.round_key || match.roundKey || "") === String(row.roundKey || "")
      && pairMatches(teamAId, teamBId, String(match.team1_id || match.team1Id || ""), String(match.team2_id || match.team2Id || "")));
    if (candidates.length !== 1) {
      conflicts.push({ reason: candidates.length ? "ambiguous_match" : "unmatched_match", row });
      continue;
    }
    const match = candidates[0];
    const matchId = String(match.id || match.match_id || match.matchId || "");
    if (allowed && !allowed.has(matchId)) {
      skipped.push({ reason: "not_due", row });
      continue;
    }
    const team1Id = String(match.team1_id || match.team1Id || "");
    const team2Id = String(match.team2_id || match.team2Id || "");
    const teamAIsTeam1 = teamAId === team1Id;
    const team1Score = teamAIsTeam1 ? Number(row.teamAScore) : Number(row.teamBScore);
    const team2Score = teamAIsTeam1 ? Number(row.teamBScore) : Number(row.teamAScore);
    if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score) || team1Score < 0 || team2Score < 0 || team1Score === team2Score) {
      conflicts.push({ reason: "invalid_score", row });
      continue;
    }
    const winnerTeamId = team1Score > team2Score ? team1Id : team2Id;
    const loserTeamId = winnerTeamId === team1Id ? team2Id : team1Id;
    const normalizedPayload = {
      source: "jhbf",
      externalKey: String(row.externalKey || ""),
      matchDate: String(row.matchDate || ""),
      dailyMatchNo: Number(row.dailyMatchNo),
      roundKey: String(row.roundKey || ""),
      team1Id,
      team2Id,
      team1Score,
      team2Score,
      winnerTeamId,
      loserTeamId,
    };
    const existing = importByKey.get(normalizedPayload.externalKey);
    if (existing) {
      const status = String(existing.status || "");
      if (status === "canceled") {
        skipped.push({ reason: "manual_cancel_block", row, match });
        continue;
      }
      const existingPayload = existing.normalized_payload || existing.normalizedPayload || {};
      if (stableStringify(existingPayload) !== stableStringify(normalizedPayload)) {
        conflicts.push({ reason: "import_conflict", row, match });
        continue;
      }
      skipped.push({ reason: "already_imported", row, match });
      continue;
    }
    if (String(match.status || "") === "completed") {
      const same = Number(match.team1_score ?? match.team1Score) === team1Score
        && Number(match.team2_score ?? match.team2Score) === team2Score
        && String(match.winner_team_id || match.winnerTeamId || "") === winnerTeamId;
      if (same) skipped.push({ reason: "already_saved", row, match });
      else conflicts.push({ reason: "saved_result_conflict", row, match });
      continue;
    }
    ready.push({
      source: "jhbf",
      externalKey: normalizedPayload.externalKey,
      sourceUrl: String(row.sourceUrl || ""),
      fetchedAt: String(row.fetchedAt || ""),
      rawPayload: row.rawPayload || {},
      matchId,
      roundKey: normalizedPayload.roundKey,
      matchNo: Number(match.match_no || match.matchNo),
      team1Id,
      team2Id,
      team1Score,
      team2Score,
      winnerTeamId,
      loserTeamId,
      normalizedPayload,
    });
  }
  return { ready, skipped, conflicts };
}

export const AUTO_SYNC_LIMITS = Object.freeze({
  resultFirstCheckMinutes: RESULT_FIRST_CHECK_MINUTES,
  scheduleRetryMinutes: SCHEDULE_RETRY_MINUTES,
  delayRefreshMinutes: DELAY_REFRESH_MINUTES,
});
