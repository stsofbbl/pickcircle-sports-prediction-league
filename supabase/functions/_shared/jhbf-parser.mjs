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

export { normalizeSchoolName, roundKeyFor };
