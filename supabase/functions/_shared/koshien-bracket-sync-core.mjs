export const LATE_ROUND_COUNTS = Object.freeze({ R3: 8, QF: 4, SF: 2, F: 1 });

export function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\t\r\n\s　]+/gu, "")
    .trim();
}

function stripTags(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function schoolFromTeamCell(cellHtml) {
  const label = stripTags(cellHtml);
  if (!label) return "";
  const match = label.match(/^(.+?)\s*[（(][^()（）]+[）)]$/u);
  return normalizeName(match ? match[1] : label);
}

function section(html, startPattern, endPattern = null) {
  const source = String(html || "");
  const startMatch = startPattern.exec(source);
  if (!startMatch) return "";
  const start = startMatch.index;
  if (!endPattern) return source.slice(start);
  const remainder = source.slice(start + startMatch[0].length);
  const endMatch = endPattern.exec(remainder);
  return endMatch ? source.slice(start, start + startMatch[0].length + endMatch.index) : source.slice(start);
}

function teamSlotFromRow(rowHtml) {
  for (const match of String(rowHtml || "").matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const className = String(match[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    if (!/(?:^|\s)teamName(?:\s|$)/i.test(className)) continue;
    return { found: true, name: schoolFromTeamCell(match[2]) };
  }
  return { found: false, name: "" };
}

function redrawMatchesInSection(sectionHtml, expectedMatches) {
  const rows = [...String(sectionHtml || "").matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const matches = [];
  const usedMatchNos = new Set();

  rows.forEach((rowHtml, rowIndex) => {
    const label = stripTags(rowHtml);
    const marker = label.match(/第\s*\d+\s*日\s*第\s*([1-9][0-9]*)\s*試合/u);
    if (!marker) return;
    const matchNo = Number(marker[1]);
    if (!Number.isInteger(matchNo) || matchNo < 1 || matchNo > expectedMatches || usedMatchNos.has(matchNo)) return;

    let above = { found: false, name: "" };
    for (let index = rowIndex - 1; index >= 0; index -= 1) {
      above = teamSlotFromRow(rows[index]);
      if (above.found) break;
    }
    let below = { found: false, name: "" };
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      below = teamSlotFromRow(rows[index]);
      if (below.found) break;
    }

    if (!above.found || !below.found || !above.name || !below.name || above.name === below.name) return;
    usedMatchNos.add(matchNo);
    matches.push({ matchNo, team1Name: above.name, team2Name: below.name });
  });

  return matches.sort((left, right) => left.matchNo - right.matchNo);
}

export function parseJhbfRedrawTeams(html) {
  const qfSection = section(
    html,
    /準々決勝の組み合わせ/gu,
    /準決勝(?:以降|、決勝)?の組み合わせ/gu,
  );
  const sfSection = section(html, /準決勝(?:以降|、決勝)?の組み合わせ/gu);
  const qfMatches = redrawMatchesInSection(qfSection, 4);
  const sfMatches = redrawMatchesInSection(sfSection, 2);
  return {
    qfMatches,
    sfMatches,
    qf: qfMatches.length === 4 ? qfMatches.flatMap((match) => [match.team1Name, match.team2Name]) : [],
    sf: sfMatches.length === 2 ? sfMatches.flatMap((match) => [match.team1Name, match.team2Name]) : [],
  };
}

export function parseJhbfFinalSchedule(html, year) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear)) return null;
  const text = stripTags(html);
  const match = text.match(/(\d{1,2})月(\d{1,2})日[\s\S]{0,120}?[（(]\s*第\s*(\d+)\s*日\s*[）)][\s\S]{0,180}?(\d{1,2})時(\d{2})分\s*決勝/u);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const dayNo = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!month || !day || !dayNo || hour > 23 || minute > 59) return null;
  const pad2 = (value) => String(value).padStart(2, "0");
  return {
    dayNo,
    dailyMatchNo: 1,
    month,
    day,
    scheduledTime: `${pad2(hour)}:${pad2(minute)}`,
    startsAt: `${normalizedYear}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+09:00`,
    roundLabel: "決勝",
  };
}

export function pairRoundTeams(roundKey, teamIds = []) {
  const count = LATE_ROUND_COUNTS[roundKey];
  if (!count || !["QF", "SF"].includes(roundKey)) return [];
  if (!Array.isArray(teamIds) || teamIds.length !== count * 2) return [];
  return Array.from({ length: count }, (_, index) => ({
    round_key: roundKey,
    match_no: index + 1,
    team1_id: String(teamIds[index * 2] || ""),
    team2_id: String(teamIds[index * 2 + 1] || ""),
  }));
}

export function pendingRedrawRound(matches = []) {
  const rows = Array.isArray(matches) ? matches : [];
  const byRound = (round) => rows.filter((match) => String(match?.round_key || match?.roundKey || "") === round);
  const completedCount = (round) => byRound(round)
    .filter((match) => String(match.status || "") === "completed" && (match.winner_team_id || match.winnerTeamId)).length;
  if (completedCount("R3") > 0 && byRound("QF").length < 4) return "QF";
  if (byRound("QF").length === 4 && completedCount("QF") > 0 && byRound("SF").length < 2) return "SF";
  return "";
}

export function buildLateScheduleRows(scheduleRows = [], existingMatches = []) {
  const existing = new Set((Array.isArray(existingMatches) ? existingMatches : [])
    .map((match) => `${String(match?.round_key || match?.roundKey || "")}:${Number(match?.match_no ?? match?.matchNo)}`));
  const grouped = new Map();
  for (const row of Array.isArray(scheduleRows) ? scheduleRows : []) {
    const label = normalizeName(row?.roundLabel);
    const roundKey = label.includes("3回戦") ? "R3"
      : label.includes("準々決勝") ? "QF"
        : label.includes("準決勝") ? "SF"
          : label.includes("決勝") ? "F"
            : "";
    if (!roundKey) continue;
    const list = grouped.get(roundKey) || [];
    list.push(row);
    grouped.set(roundKey, list);
  }

  const output = [];
  for (const roundKey of ["R3", "QF", "SF", "F"]) {
    const expected = LATE_ROUND_COUNTS[roundKey];
    const rows = (grouped.get(roundKey) || [])
      .slice()
      .sort((a, b) => Number(a.dayNo) - Number(b.dayNo) || Number(a.dailyMatchNo) - Number(b.dailyMatchNo));
    if (rows.length < expected) continue;
    rows.slice(0, expected).forEach((row, index) => {
      const matchNo = index + 1;
      if (!existing.has(`${roundKey}:${matchNo}`)) return;
      if (!row.startsAt || !Number(row.dayNo) || !Number(row.dailyMatchNo)) return;
      output.push({
        round_key: roundKey,
        match_no: matchNo,
        starts_at: String(row.startsAt),
        tournament_day_no: Number(row.dayNo),
        daily_match_no: Number(row.dailyMatchNo),
      });
    });
  }
  return output;
}
