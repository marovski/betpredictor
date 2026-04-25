// ── State ─────────────────────────────────────────────────────────────────────

let allMatches = [];
let currentFilter = 'all';
let confidenceChart = null;

// ── ESPN config ────────────────────────────────────────────────────────────────

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_LEAGUES = [
  { code: 'eng.1', name: 'Premier League' },
  { code: 'esp.1', name: 'La Liga' },
  { code: 'ita.1', name: 'Serie A' },
  { code: 'ger.1', name: 'Bundesliga' },
  { code: 'fra.1', name: 'Ligue 1' },
  { code: 'por.1', name: 'Liga Portugal' },
];

// ── ESPN fetch with session cache ──────────────────────────────────────────────

async function espnFetch(url, cacheKey = null) {
  if (cacheKey) {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }

  if (!res.ok) throw new Error(`ESPN API error ${res.status} for ${url}`);
  const data = await res.json();

  if (cacheKey) sessionStorage.setItem(cacheKey, JSON.stringify(data));
  return data;
}

// ── Data source badge ──────────────────────────────────────────────────────────

function setDataSourceBadge(isLive) {
  const badge = document.getElementById('dataSourceBadge');
  badge.textContent        = isLive ? '🟢 ESPN Live' : '🟡 Demo Data';
  badge.style.borderColor  = isLive ? '#34d399' : '#fbbf24';
  badge.style.color        = isLive ? '#34d399' : '#fbbf24';
  badge.style.background   = isLive ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)';
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getWeekendDates(offset = 0) {
  const today = new Date();
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7;
  const saturdayDate = new Date(today);
  saturdayDate.setDate(today.getDate() + daysUntilSaturday + offset * 7);
  return { start: saturdayDate };
}

function formatDate(date) {
  // ESPN scoreboard requires YYYYMMDD (no dashes)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatDateISO(date) {
  // HTML <input type="date"> requires YYYY-MM-DD
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── Control handlers ───────────────────────────────────────────────────────────

function handleWeekendChange() {
  const select = document.getElementById('weekendSelect');
  const customGroup = document.getElementById('customDateGroup');
  if (select.value === 'custom') {
    customGroup.style.display = 'flex';
    document.getElementById('customDate').value = formatDateISO(new Date());
  } else {
    customGroup.style.display = 'none';
    loadWeekendMatches(select.value);
  }
}

function handleDateChange() {
  loadMatchesForDate(new Date(document.getElementById('customDate').value + 'T00:00:00'));
}

function loadWeekendMatches(weekendType) {
  const today = new Date();
  if (weekendType === 'this' && today.getDay() === 0) {
    loadMatchesForDate(today);
    return;
  }
  const { start } = getWeekendDates(weekendType === 'next' ? 1 : 0);
  loadMatchesForDate(start);
}

// ── Main data loader ───────────────────────────────────────────────────────────

async function loadMatchesForDate(date) {
  const container = document.getElementById('predictionsContainer');
  document.getElementById('selectedDate').textContent =
    date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  container.innerHTML = loadingHTML('Fetching fixtures from ESPN…');

  try {
    const dateStr = formatDate(date);

    // Fetch all 6 leagues in parallel — no API key or rate limits
    const results = await Promise.allSettled(
      ESPN_LEAGUES.map(league =>
        espnFetch(
          `${ESPN_BASE}/${league.code}/scoreboard?dates=${dateStr}`,
          `espn_${league.code}_${dateStr}`
        ).then(data => extractESPNFixtures(data, league.name, league.code))
      )
    );

    const fixtures = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    if (fixtures.length === 0) {
      setDataSourceBadge(false);
      container.innerHTML = '<div class="no-predictions">No top-league fixtures found for this date. Try another weekend.</div>';
      updateStats([]);
      generateMockMatches();
      return;
    }

    setDataSourceBadge(true);
    container.innerHTML = loadingHTML(`Loading historical form data…`);
    await loadHistoricalMatches();

    container.innerHTML = loadingHTML(`Analysing ${fixtures.length} fixtures…`);
    allMatches = (await Promise.all(fixtures.slice(0, 15).map(f => enrichFixture(f)))).filter(Boolean);
    displayMatches();

  } catch (err) {
    showApiError(err.message);
  }
}

// ── Fixture extraction ─────────────────────────────────────────────────────────

function extractESPNFixtures(data, leagueName, leagueCode) {
  if (!data?.events) return [];

  return data.events
    .map(event => {
      const comp = event.competitions?.[0];
      if (!comp) return null;

      const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
      const awayComp = comp.competitors?.find(c => c.homeAway === 'away');
      if (!homeComp?.team || !awayComp?.team) return null;

      const completed  = comp.status?.type?.completed ?? false;
      const homeScore  = completed ? (parseInt(homeComp.score) || 0) : null;
      const awayScore  = completed ? (parseInt(awayComp.score) || 0) : null;

      const matchDate = new Date(event.date);
      const time = matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      return {
        id:         event.id,
        league:     leagueName,
        leagueCode,
        homeTeam:   homeComp.team.displayName,
        awayTeam:   awayComp.team.displayName,
        homeId:     homeComp.team.id,
        awayId:     awayComp.team.id,
        time,
        completed,
        // Normalized format expected by analyzeForm / analyzeH2H
        home: { id: homeComp.team.id, score: homeScore },
        away: { id: awayComp.team.id, score: awayScore },
      };
    })
    .filter(Boolean);
}

// ── Historical match cache ─────────────────────────────────────────────────────

const HISTORICAL_CACHE_KEY = 'historicalMatchesESPN_v1';
let historicalMatches = null;

async function loadHistoricalMatches() {
  // 1. In-memory
  if (historicalMatches) return;

  // 2. sessionStorage (survives page reload within same tab session)
  const stored = sessionStorage.getItem(HISTORICAL_CACHE_KEY);
  if (stored) {
    historicalMatches = JSON.parse(stored);
    return;
  }

  // 3. Fetch last 5 weekends (10 dates); each date fetches all 6 leagues in parallel
  const dates = getPastWeekendDates(5);
  historicalMatches = [];

  for (const date of dates) {
    const dateStr = formatDate(date);
    const results = await Promise.allSettled(
      ESPN_LEAGUES.map(league =>
        espnFetch(
          `${ESPN_BASE}/${league.code}/scoreboard?dates=${dateStr}`,
          `espn_${league.code}_${dateStr}`
        ).then(data => extractESPNFixtures(data, league.name, league.code))
      )
    );

    const dayMatches = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .filter(m => m.completed);   // only finished matches for form/H2H analysis

    historicalMatches.push(...dayMatches);
  }

  sessionStorage.setItem(HISTORICAL_CACHE_KEY, JSON.stringify(historicalMatches));
}

function getPastWeekendDates(numWeeks) {
  const dates = [];
  const today = new Date();
  const daysToLastSat = (today.getDay() + 1) % 7 || 7;
  for (let i = 1; i <= numWeeks; i++) {
    const sat = new Date(today);
    sat.setDate(today.getDate() - daysToLastSat - (i - 1) * 7);
    dates.push(sat);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    dates.push(sun);
  }
  return dates;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── ESPN team-schedule H2H ─────────────────────────────────────────────────────
// Fetches the home team's schedule for current + previous season to find all
// completed fixtures where the opponent was the away team.
// One team's schedule contains all games (home & away), so a single fetch is enough.

async function fetchTeamScheduleH2H(homeId, awayId, leagueCode) {
  const endYear = new Date().getFullYear();   // ESPN uses the year the season ends
  const seasons = [endYear, endYear - 1];     // e.g. 2026 (current) + 2025 (previous)

  const schedules = await Promise.allSettled(
    seasons.map(yr =>
      espnFetch(
        `${ESPN_BASE}/${leagueCode}/teams/${homeId}/schedule?season=${yr}`,
        `espn_sched_${leagueCode}_${homeId}_${yr}`
      )
    )
  );

  const h2h = [];
  for (const result of schedules) {
    if (result.status !== 'fulfilled' || !result.value?.events) continue;
    for (const event of result.value.events) {
      const comp = event.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;
      if (!comp.competitors.some(c => c.team?.id == awayId)) continue;

      const hc = comp.competitors.find(c => c.homeAway === 'home');
      const ac = comp.competitors.find(c => c.homeAway === 'away');
      if (!hc || !ac) continue;

      h2h.push({
        home: { id: hc.team.id, score: parseInt(hc.score) || 0 },
        away: { id: ac.team.id, score: parseInt(ac.score) || 0 },
        completed: true,
      });
    }
  }
  return h2h;
}

// ── Fixture enrichment ─────────────────────────────────────────────────────────

async function enrichFixture(fixture) {
  const { homeId, awayId, homeTeam, awayTeam } = fixture;

  // Form: derived from cached historical weekend data
  const homeMatches = historicalMatches?.filter(m => m.home?.id == homeId || m.away?.id == homeId) ?? [];
  const awayMatches = historicalMatches?.filter(m => m.home?.id == awayId || m.away?.id == awayId) ?? [];

  // H2H: ESPN team schedule (2 seasons) — much richer than just 5 weekends
  let h2hMatches = [];
  if (fixture.leagueCode) {
    h2hMatches = await fetchTeamScheduleH2H(homeId, awayId, fixture.leagueCode).catch(() => []);
  }
  // Fallback to historical weekend data if schedule lookup returned nothing
  if (h2hMatches.length === 0) {
    h2hMatches = historicalMatches?.filter(m =>
      (m.home?.id == homeId && m.away?.id == awayId) ||
      (m.home?.id == awayId && m.away?.id == homeId)
    ) ?? [];
  }

  const homeForm = analyzeForm(homeMatches.slice(0, 5), homeId);
  const awayForm = analyzeForm(awayMatches.slice(0, 5), awayId);
  const h2h      = h2hMatches.length >= 2 ? analyzeH2H(h2hMatches) : null;

  const prediction = buildPrediction(homeForm, awayForm, h2h, homeTeam, awayTeam);

  return {
    ...fixture,
    homeForm,
    awayForm,
    h2h,
    prediction,
    confidence: prediction.confidence,
    roi:        prediction.roi,
  };
}

// ── Stats analysis ─────────────────────────────────────────────────────────────

function analyzeForm(matches, teamId) {
  if (!matches.length) return null;

  const stats = matches.slice(0, 5).reduce((acc, m) => {
    const isHome   = m.home?.id == teamId;
    const scored   = isHome ? (m.home?.score ?? 0) : (m.away?.score ?? 0);
    const conceded = isHome ? (m.away?.score ?? 0) : (m.home?.score ?? 0);
    const won      = scored > conceded;
    const lost     = scored < conceded;

    return {
      games:         acc.games + 1,
      goalsScored:   acc.goalsScored   + scored,
      goalsConceded: acc.goalsConceded + conceded,
      wins:          acc.wins          + (won  ? 1 : 0),
      draws:         acc.draws         + (!won && !lost ? 1 : 0),
      losses:        acc.losses        + (lost ? 1 : 0),
      cleanSheets:   acc.cleanSheets   + (conceded === 0 ? 1 : 0),
      scoredInGame:  acc.scoredInGame  + (scored   >  0 ? 1 : 0),
      results:       [...acc.results, won ? 'W' : (lost ? 'L' : 'D')],
    };
  }, { games: 0, goalsScored: 0, goalsConceded: 0, wins: 0, draws: 0, losses: 0, cleanSheets: 0, scoredInGame: 0, results: [] });

  return {
    ...stats,
    avgGoalsScored:   stats.goalsScored   / stats.games,
    avgGoalsConceded: stats.goalsConceded / stats.games,
    winRate:          stats.wins          / stats.games,
    scoringRate:      stats.scoredInGame  / stats.games,
    cleanSheetRate:   stats.cleanSheets   / stats.games,
  };
}

function analyzeH2H(matches) {
  if (!matches.length) return null;

  const stats = matches.slice(0, 10).reduce((acc, m) => {
    const hg = m.home?.score ?? 0;
    const ag = m.away?.score ?? 0;
    return {
      games:       acc.games + 1,
      totalGoals:  acc.totalGoals  + hg + ag,
      bttsCount:   acc.bttsCount   + (hg > 0 && ag > 0 ? 1 : 0),
      over25Count: acc.over25Count + (hg + ag > 2 ? 1 : 0),
      homeWins:    acc.homeWins    + (hg > ag ? 1 : 0),
      draws:       acc.draws       + (hg === ag ? 1 : 0),
      awayWins:    acc.awayWins    + (ag > hg ? 1 : 0),
    };
  }, { games: 0, totalGoals: 0, bttsCount: 0, over25Count: 0, homeWins: 0, draws: 0, awayWins: 0 });

  return {
    ...stats,
    avgGoals:    stats.totalGoals  / stats.games,
    bttsRate:    stats.bttsCount   / stats.games,
    over25Rate:  stats.over25Count / stats.games,
    homeWinRate: stats.homeWins    / stats.games,
    drawRate:    stats.draws       / stats.games,
    awayWinRate: stats.awayWins    / stats.games,
  };
}

// ── Prediction engine ──────────────────────────────────────────────────────────

function buildPrediction(homeForm, awayForm, h2h, homeName, awayName) {
  const homeScoreProb = homeForm?.scoringRate  ?? 0.60;
  const awayScoreProb = awayForm?.scoringRate  ?? 0.60;
  let bttsProbability = homeScoreProb * awayScoreProb;
  if (h2h?.games >= 3) bttsProbability = bttsProbability * 0.6 + h2h.bttsRate * 0.4;

  const formAvgGoals   = (homeForm?.avgGoalsScored ?? 1.4) + (awayForm?.avgGoalsScored ?? 1.1);
  const expectedGoals  = h2h?.games >= 3 ? formAvgGoals * 0.6 + h2h.avgGoals * 0.4 : formAvgGoals;
  const over25Probability = 1 / (1 + Math.exp(-(expectedGoals - 2.5) * 1.2));

  let homeWinProb = homeForm?.winRate ?? 0.45;
  let awayWinProb = awayForm?.winRate ?? 0.30;
  if (h2h?.games >= 3) {
    homeWinProb = homeWinProb * 0.6 + h2h.homeWinRate * 0.4;
    awayWinProb = awayWinProb * 0.6 + h2h.awayWinRate * 0.4;
  }

  const bets = [
    { type: 'BTTS Yes',          prob: bttsProbability,   odds: 1.80 },
    { type: 'Over 2.5',          prob: over25Probability, odds: 1.85 },
    { type: `${homeName} Win`,   prob: homeWinProb,       odds: 2.10 },
    { type: `${awayName} Win`,   prob: awayWinProb,       odds: 2.80 },
  ];
  bets.forEach(b => { b.roi = (b.prob * b.odds - 1) * 100; });
  bets.sort((a, b) => b.roi - a.roi);
  const best = bets[0];

  return {
    type:        best.type,
    probability: (best.prob * 100).toFixed(0),
    roi:         Math.max(0, best.roi).toFixed(1),
    confidence:  best.prob >= 0.65 ? 'strong' : best.prob >= 0.52 ? 'medium' : 'weak',
    reasoning:   buildReasoning(homeName, awayName, homeForm, awayForm, h2h, best),
  };
}

function buildReasoning(home, away, homeForm, awayForm, h2h, best) {
  const lines = [];
  if (homeForm) lines.push(`${home}: ${homeForm.wins}W ${homeForm.draws}D ${homeForm.losses}L — ${homeForm.avgGoalsScored.toFixed(1)} scored / ${homeForm.avgGoalsConceded.toFixed(1)} conceded per game (last ${homeForm.games})`);
  if (awayForm) lines.push(`${away}: ${awayForm.wins}W ${awayForm.draws}D ${awayForm.losses}L — ${awayForm.avgGoalsScored.toFixed(1)} scored / ${awayForm.avgGoalsConceded.toFixed(1)} conceded per game (last ${awayForm.games})`);
  if (h2h?.games > 0) lines.push(`H2H (${h2h.games} meetings): avg ${h2h.avgGoals.toFixed(1)} goals, BTTS ${(h2h.bttsRate * 100).toFixed(0)}%, home wins ${(h2h.homeWinRate * 100).toFixed(0)}%`);
  if (!homeForm && !awayForm && !h2h) lines.push('No historical data available — prediction based on league defaults');
  const icon = best.prob >= 0.65 ? '🟢' : best.prob >= 0.52 ? '🟡' : '🔴';
  lines.push(`${icon} Model probability: ${(best.prob * 100).toFixed(0)}% — ROI edge: +${Math.max(0, best.roi).toFixed(1)}%`);
  return lines;
}

// ── Mock data (fallback when ESPN returns no fixtures) ─────────────────────────

const LEAGUES = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Liga Portugal'];
const TEAMS = {
  'Premier League': ['Arsenal', 'Liverpool', 'Manchester City', 'Chelsea', 'Brighton', 'Everton', 'Fulham', 'Burnley', 'Leeds', 'Brentford'],
  'La Liga':        ['Barcelona', 'Real Madrid', 'Atletico Madrid', 'Sevilla', 'Valencia', 'Levante', 'Oviedo', 'Getafe', 'Osasuna', 'Girona'],
  'Serie A':        ['Napoli', 'Inter Milan', 'AC Milan', 'Juventus', 'Roma', 'Lazio', 'Parma', 'Cremonese', 'Torino', 'Sassuolo'],
  'Bundesliga':     ['Bayern Munich', 'Borussia Dortmund', 'Union Berlin', 'Hamburg', 'Cologne', 'Gladbach', 'Wolfsburg', 'Bremen', 'Leipzig', 'Leverkusen'],
  'Ligue 1':        ['PSG', 'Nice', 'Marseille', 'Lyon', 'Toulouse', 'Lorient', 'Auxerre', 'Brest', 'Lens', 'Strasbourg'],
  'Liga Portugal':  ['Benfica', 'Porto', 'Sporting', 'Vitória', 'Braga', 'Moreirense', 'Famalicão', 'Santa Clara', 'Tondela', 'AVS'],
};

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateMockForm() {
  const games = 5, wins = Math.floor(Math.random() * 4);
  const draws = Math.floor(Math.random() * (games - wins));
  const losses = games - wins - draws;
  const goalsScored = Math.round((Math.random() * 2 + 0.5) * games);
  const goalsConceded = Math.round((Math.random() * 1.5 + 0.5) * games);
  const scoredInGame = Math.min(games, Math.floor(goalsScored * 0.7 + 1));
  const cleanSheets = Math.max(0, Math.round(games * (1 - goalsConceded / (games * 2))));
  return {
    games, wins, draws, losses, goalsScored, goalsConceded, scoredInGame, cleanSheets,
    avgGoalsScored: goalsScored / games, avgGoalsConceded: goalsConceded / games,
    winRate: wins / games, scoringRate: scoredInGame / games, cleanSheetRate: cleanSheets / games,
    results: Array.from({ length: games }, () => pickRandom(['W', 'W', 'D', 'L'])),
  };
}

function generateMockH2H() {
  const games = Math.floor(Math.random() * 6) + 3;
  const homeWins = Math.floor(Math.random() * games);
  const draws = Math.floor(Math.random() * (games - homeWins));
  const awayWins = games - homeWins - draws;
  const totalGoals = Math.round((Math.random() * 1.5 + 1.5) * games);
  const bttsCount = Math.floor(totalGoals * 0.35);
  const over25Count = Math.floor(games * (Math.random() * 0.5 + 0.2));
  return {
    games, homeWins, draws, awayWins, totalGoals, bttsCount, over25Count,
    avgGoals: totalGoals / games, bttsRate: bttsCount / games, over25Rate: over25Count / games,
    homeWinRate: homeWins / games, drawRate: draws / games, awayWinRate: awayWins / games,
  };
}

function generateMockMatches() {
  allMatches = [];
  for (const league of LEAGUES) {
    const leagueTeams = TEAMS[league];
    for (let i = 0; i < Math.floor(Math.random() * 3) + 2; i++) {
      let homeTeam = pickRandom(leagueTeams), awayTeam = pickRandom(leagueTeams);
      while (awayTeam === homeTeam) awayTeam = pickRandom(leagueTeams);
      const homeForm = generateMockForm(), awayForm = generateMockForm(), h2h = generateMockH2H();
      const prediction = buildPrediction(homeForm, awayForm, h2h, homeTeam, awayTeam);
      allMatches.push({
        id: Math.random(), league, homeTeam, awayTeam,
        time: `${Math.floor(Math.random() * 12) + 10}:${String(Math.floor(Math.random() * 6) * 10).padStart(2, '0')}`,
        homeForm, awayForm, h2h, prediction, confidence: prediction.confidence, roi: prediction.roi,
      });
    }
  }
  displayMatches();
}

// ── Error display ──────────────────────────────────────────────────────────────

function showApiError(msg) {
  setDataSourceBadge(false);
  document.getElementById('predictionsContainer').innerHTML = `
    <div class="api-error">
      <div class="api-error-title">⚠️ Data Error</div>
      <div class="api-error-msg">${msg}</div>
      <div class="api-error-hint">Showing demo data instead.</div>
    </div>`;
  generateMockMatches();
}

function loadingHTML(msg) {
  return `<div class="loading"><div class="spinner"></div><span>${msg}</span></div>`;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function formBadges(form) {
  if (!form?.results) return '';
  return form.results.map(r => `<span class="form-badge form-${r.toLowerCase()}">${r}</span>`).join('');
}

function displayMatches() {
  document.getElementById('totalMatches').textContent = allMatches.length;
  applyFilters(currentFilter);
}

function applyFilters(filter = currentFilter, btn = null) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelector(`.filter-btn[data-filter="${filter}"]`)?.classList.add('active');
  }

  const leagueFilter     = document.getElementById('leagueSelect').value;
  const confidenceFilter = document.getElementById('confidenceSelect').value;

  const filtered = allMatches.filter(match => {
    const leagueMatch = leagueFilter === 'all' || match.league === leagueFilter;
    const confMatch   = confidenceFilter === 'all' || match.confidence === confidenceFilter ||
      (confidenceFilter === 'medium' && (match.confidence === 'medium' || match.confidence === 'strong'));
    const typeMatch   = currentFilter === 'all' ||
      (currentFilter === 'strong' && match.confidence === 'strong') ||
      (currentFilter === 'btts'   && match.prediction.type.includes('BTTS')) ||
      (currentFilter === 'over'   && match.prediction.type.includes('Over'));
    return leagueMatch && confMatch && typeMatch;
  });

  renderMatches(filtered);
}

function renderMatches(filtered) {
  const container = document.getElementById('predictionsContainer');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-predictions">No matches found for selected filters.</div>';
    updateStats([]);
    return;
  }

  container.innerHTML = filtered.map(match => {
    const confClass     = `confidence-${match.confidence}`;
    const confText      = match.confidence.charAt(0).toUpperCase() + match.confidence.slice(1);
    const reasoningHTML = (match.prediction.reasoning || [])
      .map(line => `<div class="reasoning-line">${line}</div>`).join('');
    const hasForm = match.homeForm || match.awayForm;

    return `
      <div class="bet-card ${match.confidence}">
        <div class="bet-header">
          <div>
            <div class="bet-match">${match.homeTeam} vs ${match.awayTeam}</div>
            <div class="match-time">🕐 ${match.time}</div>
            <span class="badge">${match.league}</span>
          </div>
          <span class="bet-confidence ${confClass}">${confText}</span>
        </div>
        <div class="bet-prediction">
          <div class="prediction-name">📌 ${match.prediction.type}</div>
          <div class="prediction-details">
            <div class="odds">
              <span class="odds-label">Probability</span>
              <span class="odds-value">${match.prediction.probability}%</span>
              <span class="roi">+${match.prediction.roi}% ROI</span>
            </div>
          </div>
        </div>
        ${hasForm ? `
        <div class="form-row">
          <div class="form-team">
            <span class="form-label">${match.homeTeam}</span>
            <div class="form-badges">${formBadges(match.homeForm)}</div>
          </div>
          <div class="form-team">
            <span class="form-label">${match.awayTeam}</span>
            <div class="form-badges">${formBadges(match.awayForm)}</div>
          </div>
        </div>` : ''}
        ${reasoningHTML ? `<div class="reasoning">${reasoningHTML}</div>` : ''}
        <div class="stats-breakdown">
          <div class="stat-item">
            <div class="stat-item-label">Exp. Goals</div>
            <div class="stat-item-value">${match.homeForm && match.awayForm
              ? (match.homeForm.avgGoalsScored + match.awayForm.avgGoalsScored).toFixed(1)
              : '—'}</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-label">H2H Meetings</div>
            <div class="stat-item-value">${match.h2h ? match.h2h.games : '—'}</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-label">BTTS Rate</div>
            <div class="stat-item-value">${match.h2h
              ? (match.h2h.bttsRate * 100).toFixed(0) + '%'
              : match.homeForm && match.awayForm
                ? (match.homeForm.scoringRate * match.awayForm.scoringRate * 100).toFixed(0) + '%'
                : '—'}</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-label">Over 2.5 Rate</div>
            <div class="stat-item-value">${match.h2h ? (match.h2h.over25Rate * 100).toFixed(0) + '%' : '—'}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  updateStats(filtered);
  updateChart(filtered);
}

// ── Stats & chart ──────────────────────────────────────────────────────────────

function updateStats(filtered) {
  document.getElementById('totalPredictions').textContent = filtered.length;
  document.getElementById('strongCount').textContent = filtered.filter(m => m.confidence === 'strong').length;
  const avgROI = filtered.length > 0
    ? (filtered.reduce((sum, m) => sum + parseFloat(m.roi), 0) / filtered.length).toFixed(1) : 0;
  document.getElementById('avgROI').textContent = avgROI + '%';
}

function updateChart(filtered) {
  const counts = [
    filtered.filter(m => m.confidence === 'strong').length,
    filtered.filter(m => m.confidence === 'medium').length,
    filtered.filter(m => m.confidence === 'weak').length,
  ];
  if (confidenceChart) {
    confidenceChart.data.datasets[0].data = counts;
    confidenceChart.update();
    return;
  }
  confidenceChart = new Chart(
    document.getElementById('confidenceChart').getContext('2d'),
    {
      type: 'doughnut',
      data: {
        labels: ['Strong', 'Medium', 'Weak'],
        datasets: [{ data: counts, backgroundColor: ['#34d399', '#fbbf24', '#ef4444'], borderColor: '#1e293b', borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 13 }, padding: 20 } } },
      },
    }
  );
}

// ── Init ───────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  loadWeekendMatches('this');
});
