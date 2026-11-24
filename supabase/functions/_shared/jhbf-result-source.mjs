// A date key denotes a calendar day in JST, not a timestamp. UTC is used
// only for calendar arithmetic, avoiding host-time-zone and locale differences.
export function isJhbfDateKey(dateKey, year) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)
      || !Number.isInteger(year) || year < 2020 || year > 2035
      || Number(dateKey.slice(0, 4)) !== year) return false;
  const date = new Date(dateKey + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
}

export function jhbfResultDates(baseDate, year) {
  if (!isJhbfDateKey(baseDate, year)) throw new Error("baseDate must be a valid date in the requested year");
  const previous = new Date(baseDate + "T00:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousKey = previous.toISOString().slice(0, 10);
  return [baseDate, previousKey].filter(date => isJhbfDateKey(date, year));
}

export function jhbfResultSourceUrl(competitionType, year, dateKey) {
  if (!["summer", "senbatsu"].includes(competitionType) || !isJhbfDateKey(dateKey, year)) {
    throw new Error("JHBF result date or competition does not match the requested season");
  }
  const root = competitionType === "summer" ? "sensyuken" : "senbatsu";
  return new URL("https://www.jhbf.or.jp/" + root + "/" + year + "/schedule/schedule_" + dateKey.replaceAll("-", "") + ".html");
}

export function assertSameJhbfResultSource(url, requestedUrl) {
  if (url.protocol !== "https:" || !["jhbf.or.jp", "www.jhbf.or.jp"].includes(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== requestedUrl.pathname) {
    throw new Error("JHBF result source does not match the requested match date");
  }
}
