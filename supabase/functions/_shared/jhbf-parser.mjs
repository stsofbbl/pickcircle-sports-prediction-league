const ROUND_KEYS = Object.freeze({
  "1回戦": "R1",
  "2回戦": "R2",
  "3回戦": "R3",
  "準々決勝": "QF",
  "準決勝": "SF",
  "決勝": "F",
});

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function htmlToStructuredText(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|main|h[1-6]|li|tr|table|thead|tbody|tfoot|dl|dt|dd)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeRoundLabel(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "");
}

function roundKeyFor(label) {
  const normalized = normalizeRoundLabel(label);
  return ROUND_KEYS[normalized] || "";
}

function normalizeSchoolName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\t\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSegment(value) {
  return String(value || "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseScoreSummary(segment) {
  const compact = compactSegment(segment);
  const pattern = /([^()（）]{1,100}?)\s*[（(]([^()（）]{1,30})[）)]\s*(\d+)\s*[-－–—]\s*(\d+)\s*([^()（）]{1,100}?)\s*[（(]([^()（）]{1,30})[）)]/u;
  const match = compact.match(pattern);
  if (!match) return null;
  const teamANameRaw = normalizeSchoolName(match[1]);
  const teamBNameRaw = normalizeSchoolName(match[5]);
  const teamAScore = Number(match[3]);
  const teamBScore = Number(match[4]);
  if (!teamANameRaw || !teamBNameRaw || !Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) return null;
  return {
    teamANameRaw,
    teamBNameRaw,
    teamAPrefecture: normalizeSchoolName(match[2]),
    teamBPrefecture: normalizeSchoolName(match[6]),
    teamAScore,
    teamBScore,
  };
}

export function externalKeyFor({ competitionType, year, matchDate, dailyMatchNo }) {
  return `jhbf:${competitionType}:${year}:${matchDate}:${dailyMatchNo}`;
}

export function parseJhbfResultsHtml(html, options = {}) {
  const {
    sourceUrl = "",
    fetchedAt = new Date().toISOString(),
    competitionType = "summer",
    year,
    matchDate,
  } = options;
  if (!Number.isInteger(Number(year))) throw new Error("year is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(matchDate || ""))) throw new Error("matchDate is required");

  const text = htmlToStructuredText(html);
  const headingPattern = /第\s*(\d+)\s*試合\s*[（(]([^）)]+)[）)](?:\s+(\d{1,2}:\d{2}))?/gu;
  const headings = [...text.matchAll(headingPattern)];
  if (!headings.length) {
    return { rows: [], warnings: ["match_headings_not_found"], textSample: text.slice(0, 300) };
  }

  const rows = [];
  const warnings = [];
  headings.forEach((heading, index) => {
    const dailyMatchNo = Number(heading[1]);
    const roundLabel = normalizeRoundLabel(heading[2]);
    const roundKey = roundKeyFor(roundLabel);
    const start = (heading.index || 0) + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
    const segment = text.slice(start, end);
    if (!roundKey) {
      warnings.push(`unknown_round:${roundLabel || "missing"}`);
      return;
    }
    if (!/終了時間/u.test(segment)) return;
    const score = parseScoreSummary(segment);
    if (!score) {
      warnings.push(`score_summary_not_found:${dailyMatchNo}`);
      return;
    }
    if (score.teamAScore === score.teamBScore) {
      warnings.push(`tied_completed_score:${dailyMatchNo}`);
      return;
    }
    const teamAWon = score.teamAScore > score.teamBScore;
    const winnerNameRaw = teamAWon ? score.teamANameRaw : score.teamBNameRaw;
    const loserNameRaw = teamAWon ? score.teamBNameRaw : score.teamANameRaw;
    rows.push({
      source: "jhbf",
      sourceUrl,
      fetchedAt,
      competitionYear: Number(year),
      competitionType,
      matchDate,
      dailyMatchNo,
      externalKey: externalKeyFor({ competitionType, year: Number(year), matchDate, dailyMatchNo }),
      roundLabel,
      roundKey,
      scheduledTime: heading[3] || "",
      ...score,
      winnerNameRaw,
      loserNameRaw,
      status: "completed",
      rawPayload: {
        heading: heading[0].replace(/\s+/g, " ").trim(),
        summary: `${score.teamANameRaw} ${score.teamAScore}-${score.teamBScore} ${score.teamBNameRaw}`,
      },
    });
  });
  return { rows, warnings, textSample: "" };
}

export function parseJhbfRepresentativeTeamsHtml(html, options = {}) {
  const {
    sourceUrl = "",
    fetchedAt = new Date().toISOString(),
    competitionType = "summer",
    year,
  } = options;
  if (!Number.isInteger(Number(year))) throw new Error("year is required");

  const rows = [];
  const warnings = [];
  const stableKeys = new Set();
  const appendRow = (row) => {
    const stableKey = `${normalizeSchoolName(row.districtName)}:${normalizeSchoolName(row.schoolName)}`;
    if (stableKeys.has(stableKey)) {
      warnings.push(`duplicate_representative_row:${row.districtName}:${row.schoolName}`);
      return;
    }
    stableKeys.add(stableKey);
    rows.push(row);
  };
  const htmlRows = [...String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  htmlRows.forEach((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => normalizeSchoolName(htmlToStructuredText(cell[1])));
    if (cells.length < 2) return;
    const districtName = cells[0];
    const schoolName = cells[1];
    if (!districtName || districtName === "地方大会" || /^-+$/.test(districtName)) return;
    appendRow({
      source: "jhbf",
      sourceUrl,
      fetchedAt,
      competitionYear: Number(year),
      competitionType,
      districtName,
      schoolName,
      rawPayload: { cells },
    });
  });
  const text = htmlToStructuredText(html);
  if (rows.length) return { rows, warnings, textSample: "" };
  text.split("\n").forEach((line) => {
    if (!line.includes("|")) return;
    const parts = line.split("|").map((part) => normalizeSchoolName(part));
    if (parts.length < 2) return;
    const districtName = parts[0];
    const schoolName = parts[1];
    if (!districtName || districtName === "地方大会" || /^-+$/.test(districtName)) return;
    if (districtName.includes("大会情報") || districtName.includes("出場校")) return;
    appendRow({
      source: "jhbf",
      sourceUrl,
      fetchedAt,
      competitionYear: Number(year),
      competitionType,
      districtName,
      schoolName,
      rawPayload: { line },
    });
  });
  if (!rows.length) warnings.push("representative_table_not_found");
  return { rows, warnings, textSample: rows.length ? "" : text.slice(0, 300) };
}

function tournamentTeamFromRow(rowHtml) {
  const cell = [...String(rowHtml || "").matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
    .find((match) => /(?:^|\s)teamName(?:\s|$)/i.test(String(match[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || ""));
  if (!cell) return null;
  const label = normalizeSchoolName(htmlToStructuredText(cell[2]));
  const match = label.match(/^(.+?)\s*[（(]([^()（）]+)[）)]$/u);
  if (!match) return null;
  return {
    schoolName: normalizeSchoolName(match[1]),
    districtName: normalizeSchoolName(match[2]),
  };
}

export function parseJhbfStartRoundsHtml(html, options = {}) {
  const {
    sourceUrl = "",
    fetchedAt = new Date().toISOString(),
    competitionType = "summer",
    year,
  } = options;
  if (!Number.isInteger(Number(year))) throw new Error("year is required");
  if (competitionType !== "summer") throw new Error("start rounds are only supported for summer");

  const tournamentTables = [...String(html || "").matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
    .filter((match) => /(?:^|\s)tournamentTable(?:\s|$)/i.test(
      String(match[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || "",
    ));
  if (!tournamentTables.length) {
    return { rows: [], matches: [], round2Matches: [], warnings: ["tournament_table_not_found"], textSample: htmlToStructuredText(html).slice(0, 300) };
  }

  const tableRows = [];
  tournamentTables.forEach((table, tableIndex) => {
    [...table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].forEach((match, rowIndex) => {
      const rowHtml = match[1];
      const cells = [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
      const gameCellIndex = cells.findIndex((cell) => /(?:^|\s)gameDay(?:\s|$)/i.test(
        String(cell[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || "",
      ));
      tableRows.push({
        tableIndex,
        rowIndex,
        globalIndex: tableRows.length,
        team: tournamentTeamFromRow(rowHtml),
        gameCellIndex,
        gameLabel: gameCellIndex >= 0 ? normalizeSchoolName(htmlToStructuredText(cells[gameCellIndex][2])) : "",
      });
    });
  });

  const rows = [];
  const matches = [];
  const firstRoundNodes = [];
  const firstRoundTeamRows = new Set();
  let firstRoundGameCount = 0;
  tableRows.forEach((row, index) => {
    if (row.gameCellIndex !== 1 || !/^第\d+日\s*第\d+試合$/u.test(row.gameLabel)) return;
    const teamARow = tableRows.slice(0, index).reverse().find((candidate) => candidate.team);
    const teamBRow = tableRows.slice(index + 1).find((candidate) => candidate.team);
    if (!teamARow?.team || !teamBRow?.team) return;
    firstRoundGameCount += 1;
    firstRoundTeamRows.add(teamARow.globalIndex);
    firstRoundTeamRows.add(teamBRow.globalIndex);
    firstRoundNodes.push({
      tableIndex: row.tableIndex,
      globalIndex: row.globalIndex,
      sourceMatch: { roundKey: "R1", matchNo: firstRoundGameCount },
    });
    matches.push({
      roundKey: "R1",
      matchNo: firstRoundGameCount,
      gameLabel: row.gameLabel,
      teamA: teamARow.team,
      teamB: teamBRow.team,
    });
    [teamARow.team, teamBRow.team].forEach((team) => rows.push({
      source: "jhbf",
      sourceUrl,
      fetchedAt,
      competitionYear: Number(year),
      competitionType,
      roundKey: "R1",
      gameLabel: row.gameLabel,
      ...team,
    }));
  });

  const secondRoundNodes = [
    ...firstRoundNodes,
    ...tableRows
      .filter((row) => row.team && !firstRoundTeamRows.has(row.globalIndex))
      .map((row) => ({ tableIndex: row.tableIndex, globalIndex: row.globalIndex, team: row.team })),
  ].sort((left, right) => left.globalIndex - right.globalIndex);
  const round2Matches = [];
  const secondRoundStructureWarnings = [];
  for (let index = 0; index + 1 < secondRoundNodes.length; index += 2) {
    const teamANode = secondRoundNodes[index];
    const teamBNode = secondRoundNodes[index + 1];
    const gameRows = tableRows.filter((row) => (
      row.tableIndex === teamANode.tableIndex
      && row.tableIndex === teamBNode.tableIndex
      && row.gameCellIndex === 3
      && row.globalIndex > teamANode.globalIndex
      && row.globalIndex < teamBNode.globalIndex
      && /^第\d+日\s*第\d+試合$/u.test(row.gameLabel)
    ));
    if (gameRows.length !== 1) {
      secondRoundStructureWarnings.push(`second_round_slot_structure:${index + 1}`);
      continue;
    }
    round2Matches.push({
      roundKey: "R2",
      matchNo: index / 2 + 1,
      gameLabel: gameRows[0].gameLabel,
      teamA: teamANode.team || null,
      teamB: teamBNode.team || null,
      sourceMatchA: teamANode.sourceMatch || null,
      sourceMatchB: teamBNode.sourceMatch || null,
    });
  }

  const warnings = [];
  const stableKeys = rows.map((row) => `${normalizeSchoolName(row.districtName)}:${normalizeSchoolName(row.schoolName)}`);
  const duplicateKeys = [...new Set(stableKeys.filter((key, index) => stableKeys.indexOf(key) !== index))];
  if (firstRoundGameCount !== 17) warnings.push(`first_round_game_count:${firstRoundGameCount}`);
  if (rows.length !== 34) warnings.push(`first_round_team_count:${rows.length}`);
  duplicateKeys.forEach((key) => warnings.push(`duplicate_first_round_team:${key}`));
  const secondRoundTeams = round2Matches.flatMap((match) => [match.teamA, match.teamB]).filter(Boolean);
  const secondRoundSources = round2Matches.flatMap((match) => [match.sourceMatchA, match.sourceMatchB]).filter(Boolean);
  const secondRoundTeamKeys = secondRoundTeams.map((team) => `${normalizeSchoolName(team.districtName)}:${normalizeSchoolName(team.schoolName)}`);
  const secondRoundSourceKeys = secondRoundSources.map((source) => `${source.roundKey}:${source.matchNo}`);
  if (round2Matches.length !== 16) warnings.push(`second_round_game_count:${round2Matches.length}`);
  if (secondRoundTeams.length !== 15) warnings.push(`second_round_team_count:${secondRoundTeams.length}`);
  if (secondRoundSources.length !== 17) warnings.push(`second_round_source_count:${secondRoundSources.length}`);
  [...new Set(secondRoundTeamKeys.filter((key, index) => secondRoundTeamKeys.indexOf(key) !== index))]
    .forEach((key) => warnings.push(`duplicate_second_round_team:${key}`));
  [...new Set(secondRoundSourceKeys.filter((key, index) => secondRoundSourceKeys.indexOf(key) !== index))]
    .forEach((key) => warnings.push(`duplicate_second_round_source:${key}`));
  warnings.push(...secondRoundStructureWarnings);
  return {
    rows,
    matches,
    round2Matches,
    warnings,
    textSample: warnings.length ? htmlToStructuredText(tournamentTables.map((table) => table[0]).join("\n")).slice(0, 300) : "",
  };
}

export { normalizeSchoolName, roundKeyFor };
