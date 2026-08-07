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

function htmlToStructuredText(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|main|h[1-6]|li|tr|table|thead|tbody|tfoot|dl|dt|dd|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeLabel(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function startsAtFor({ year, month, day, hour, minute }) {
  return `${Number(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+09:00`;
}

export function parseJhbfScheduleHtml(html, options = {}) {
  const year = Number(options.year);
  if (!Number.isInteger(year)) throw new Error("year is required");

  const text = htmlToStructuredText(html);
  const dayPattern = /(\d{1,2})月(\d{1,2})日[\s\S]{0,80}?[（(]第\s*(\d+)\s*日[）)]/gu;
  const headings = [...text.matchAll(dayPattern)];
  const rows = [];
  const warnings = [];

  headings.forEach((heading, index) => {
    const month = Number(heading[1]);
    const day = Number(heading[2]);
    const dayNo = Number(heading[3]);
    const start = (heading.index || 0) + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
    const segment = text.slice(start, end).replace(/\n+/g, " ");

    const seenMatchNos = new Set();
    const matchPattern = /(\d{1,2})(?:時|:)(\d{2})(?:分)?\s*第\s*(\d+)\s*試合(?:\s*[（(]([^）)]*)[）)])?/gu;
    for (const match of segment.matchAll(matchPattern)) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const dailyMatchNo = Number(match[3]);
      if (seenMatchNos.has(dailyMatchNo)) continue;
      if (hour > 23 || minute > 59 || dailyMatchNo < 1 || dailyMatchNo > 4) continue;
      seenMatchNos.add(dailyMatchNo);
      rows.push({
        dayNo,
        dailyMatchNo,
        month,
        day,
        scheduledTime: `${pad2(hour)}:${pad2(minute)}`,
        startsAt: startsAtFor({ year, month, day, hour, minute }),
        roundLabel: String(match[4] || "").trim(),
      });
    }

    if (!seenMatchNos.size && /第\s*\d+\s*試合/u.test(segment)) {
      warnings.push(`schedule_times_not_found:day_${dayNo}`);
    }
  });

  if (!headings.length) warnings.push("schedule_day_headings_not_found");
  if (!rows.length) warnings.push("schedule_match_times_not_found");

  const duplicateKeys = rows
    .map((row) => `${row.dayNo}:${row.dailyMatchNo}`)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  [...new Set(duplicateKeys)].forEach((key) => warnings.push(`duplicate_schedule_slot:${key}`));

  return { rows, warnings, textSample: rows.length ? "" : text.slice(0, 300) };
}

export function parseJhbfTournamentScheduleSlots(html) {
  const tables = [...String(html || "").matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
    .filter((match) => /(?:^|\s)tournamentTable(?:\s|$)/i.test(
      String(match[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || "",
    ));
  const r1 = [];
  const r2 = [];
  for (const table of tables) {
    for (const row of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
      const gameCellIndex = cells.findIndex((cell) => /(?:^|\s)gameDay(?:\s|$)/i.test(
        String(cell[1] || "").match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || "",
      ));
      if (gameCellIndex !== 1 && gameCellIndex !== 3) continue;
      const gameLabel = normalizeLabel(htmlToStructuredText(cells[gameCellIndex][2]));
      if (!/^第\d+日\s*第\d+試合$/u.test(gameLabel)) continue;
      const target = gameCellIndex === 1 ? r1 : r2;
      target.push({ roundKey: gameCellIndex === 1 ? "R1" : "R2", matchNo: target.length + 1, gameLabel });
    }
  }
  const warnings = [];
  if (r1.length !== 17) warnings.push(`first_round_game_count:${r1.length}`);
  if (r2.length !== 16) warnings.push(`second_round_game_count:${r2.length}`);
  return { matches: [...r1, ...r2], warnings };
}

export function gameLabelSlot(value) {
  const match = String(value || "").normalize("NFKC").match(/^第\s*(\d+)\s*日\s*第\s*(\d+)\s*試合$/u);
  return match ? { dayNo: Number(match[1]), dailyMatchNo: Number(match[2]) } : null;
}

export function attachStartsAt(matches = [], scheduleRows = []) {
  const bySlot = new Map((Array.isArray(scheduleRows) ? scheduleRows : []).map((row) => [
    `${Number(row.dayNo)}:${Number(row.dailyMatchNo)}`,
    row,
  ]));
  const warnings = [];
  const rows = (Array.isArray(matches) ? matches : []).map((match) => {
    const slot = gameLabelSlot(match?.gameLabel);
    const schedule = slot ? bySlot.get(`${slot.dayNo}:${slot.dailyMatchNo}`) : null;
    if (!slot) warnings.push(`invalid_game_label:${match?.roundKey || "?"}-${match?.matchNo || "?"}`);
    else if (!schedule) warnings.push(`schedule_slot_not_found:${slot.dayNo}:${slot.dailyMatchNo}`);
    return {
      ...match,
      startsAt: schedule?.startsAt || "",
      scheduledTime: schedule?.scheduledTime || "",
      tournamentDayNo: slot?.dayNo || null,
      dailyMatchNo: slot?.dailyMatchNo || null,
    };
  });
  return { rows, warnings };
}
