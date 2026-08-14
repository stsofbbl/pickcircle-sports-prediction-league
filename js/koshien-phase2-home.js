(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienPhase2Home = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FINISH_LABELS = Object.freeze({
    best16: "ベスト16",
    best8: "ベスト8",
    best4: "ベスト4",
    runner_up: "準優勝",
    champion: "優勝",
  });
  const FINISH_ORDER = Object.freeze(["best16", "best8", "best4", "runner_up", "champion"]);
  const CREST_DIRECTORY = "./assets/koshien-school-crests";

  function normalizedId(value) {
    return String(value || "").trim();
  }

  function officialScoreForViewer(officialScores, viewerPlayerId) {
    const row = (Array.isArray(officialScores) ? officialScores : []).find((score) => (
      normalizedId(score?.player_id || score?.playerId) === viewerPlayerId
    ));
    if (!row || row.phase2_score === null || row.phase2_score === undefined || row.phase2_score === ""
      || !Number.isFinite(Number(row.phase2_score))) return null;
    return Number(row.phase2_score);
  }

  function buildPointLegend(officialPoints) {
    if (!officialPoints || typeof officialPoints !== "object") return [];
    return FINISH_ORDER.map((finish) => ({
      finish,
      label: FINISH_LABELS[finish],
      score: Number(officialPoints[finish]),
    })).filter((item) => Number.isFinite(item.score));
  }

  function buildViewerPhase2Summary({
    draftView,
    officialScores = [],
    officialPoints,
    calculateFormalPhase2Scores,
  } = {}) {
    const viewerPlayerId = normalizedId(draftView?.viewerPlayerId || draftView?.viewer_player_id);
    if (!draftView?.available
      || draftView?.loadedFromDb !== true
      || draftView?.formalDraftExists !== true
      || draftView?.completed !== true
      || !viewerPlayerId
      || typeof calculateFormalPhase2Scores !== "function") return null;

    const players = Array.isArray(draftView.players) ? draftView.players : [];
    const viewer = players.find((player) => normalizedId(player?.playerId || player?.player_id) === viewerPlayerId);
    const teams = Array.isArray(draftView.eligibleTeams) ? draftView.eligibleTeams : [];
    const picks = Array.isArray(draftView.picks) ? draftView.picks : [];
    if (!viewer || teams.length !== 16 || picks.length !== 16) return null;

    const teamById = new Map(teams.map((team) => [normalizedId(team?.teamId || team?.team_id), team]));
    const finishesByTeamId = Object.fromEntries(teams.map((team) => [
      normalizedId(team?.teamId || team?.team_id),
      team?.finish,
    ]));
    const projection = calculateFormalPhase2Scores({ players, picks, finishesByTeamId });
    const projectedViewer = projection?.rows?.find((row) => normalizedId(row?.playerId) === viewerPlayerId);
    const scoreByTeamId = new Map((projectedViewer?.teams || []).map((team) => [normalizedId(team.teamId), team]));

    const viewerPicks = picks
      .filter((pick) => normalizedId(pick?.playerId || pick?.player_id) === viewerPlayerId)
      .sort((left, right) => Number(left?.draftRound) - Number(right?.draftRound) || Number(left?.pickNo) - Number(right?.pickNo));
    if (viewerPicks.length !== 4) return null;

    const selectedTeams = viewerPicks.map((pick) => {
      const teamId = normalizedId(pick?.teamId || pick?.team_id);
      const team = teamById.get(teamId);
      const projected = scoreByTeamId.get(teamId);
      if (!team || !projected) return null;
      return {
        teamId,
        teamName: String(team.name || "高校"),
        draftRound: Number(pick.draftRound || pick.draft_round),
        pickNo: Number(pick.pickNo || pick.pick_no),
        finish: projected.finish,
        finishLabel: FINISH_LABELS[projected.finish] || "ベスト16",
        score: Number(projected.score) || 0,
        crestSrc: `${CREST_DIRECTORY}/${encodeURIComponent(teamId)}.png`,
      };
    });
    if (selectedTeams.some((team) => !team)) return null;

    const totalScore = officialScoreForViewer(officialScores, viewerPlayerId);
    if (totalScore === null) return null;
    return {
      eventId: normalizedId(draftView.eventId || draftView.event_id),
      viewerPlayerId,
      displayName: String(viewer.displayName || viewer.display_name || "参加者"),
      selectedTeams,
      totalScore,
      pointLegend: buildPointLegend(officialPoints),
    };
  }

  return Object.freeze({
    CREST_DIRECTORY,
    FINISH_LABELS,
    buildPointLegend,
    buildViewerPhase2Summary,
  });
});
