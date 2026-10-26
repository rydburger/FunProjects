// =========================================================
// Error Correction Zoo Tycoon — investors.
//
// Pure functions over a metrics snapshot that park.js computes
// (Park.metrics). No game state lives here: the park keeps confidence,
// tours and the funding round, and calls these to judge them.
//
//   metrics: { revenue ($/day, last 7 days), growth (30-day revenue
//     growth, −1…1), logicalQubits, health (0–100), techUnits (Σ animals ×
//     d² × health), bestDistance, species, labLevels, headKeepers,
//     errorRate (logical errors per animal per day, last 30 days),
//     morale (0–100) }
//
// valuation(): what investors would pay for the whole zoo when pitching
// for a given round (VALUATION in zoo-data.js). impression(): how one
// tour went (0–100). Lines come from QUOTES, picked with the caller's RNG.
//
// Browser: load after zoo-data.js; exposes `window.Investors`.
// Node: require("./investors.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;
  var V = Z.VALUATION;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function pick(list, rng) { return list[Math.floor((rng || Math.random)() * list.length) % list.length]; }

  // ---------- roadmap ----------
  function milestoneMet(m, metrics) {
    var v = metrics[m.metric];
    if (m.min !== undefined && !(v >= m.min)) return false;
    if (m.max !== undefined && !(v <= m.max)) return false;
    return true;
  }
  // The round's milestones with { met } and the share met.
  function roadmap(roundIndex, metrics) {
    var r = Z.ROUNDS[roundIndex];
    var items = (r && r.roadmap || []).map(function (m) {
      return { metric: m.metric, label: m.label, min: m.min, max: m.max, value: metrics[m.metric], met: milestoneMet(m, metrics) };
    });
    var met = items.filter(function (i) { return i.met; }).length;
    return { items: items, met: met, share: items.length ? met / items.length : 1 };
  }

  // ---------- valuation ----------
  function hype(confidence) { return Math.pow(2, (confidence - 50) / V.hypeDoubling); }
  function valuation(roundIndex, metrics, confidence) {
    var r = Z.ROUNDS[Math.min(roundIndex, Z.ROUNDS.length - 1)];
    var multiple = V.revMultipleBase + V.revMultiplePerGrowth * clamp(metrics.growth, 0, 1);
    var revenuePart = metrics.revenue * 365 * multiple;
    var tech = V.perQubitD2 * metrics.techUnits + V.perSpecies * metrics.species + V.perLabLevel * metrics.labLevels;
    var rm = roadmap(roundIndex, metrics);
    var roadmapFactor = 1 - V.roadmapWeight * (1 - rm.share);
    var h = hype(confidence), premium = r.premium || 1;
    return {
      value: (revenuePart + tech) * h * premium * roadmapFactor,
      revenuePart: revenuePart, multiple: multiple, tech: tech, hype: h, premium: premium,
      roadmapFactor: roadmapFactor, roadmap: rm
    };
  }

  // ---------- tours ----------
  // Component scores (0–100) an investor weighs. route: { health } of the
  // animals they saw (null if none were on show).
  function tourScores(metrics, route) {
    return {
      health: route && route.health !== null ? route.health : metrics.health,
      errors: 100 * Math.exp(-metrics.errorRate / 0.05),
      team: metrics.morale,
      roadmap: 100 * metrics.roadmapShare,
      growth: 50 + 50 * clamp(metrics.growth, -1, 1),
      wow: Math.min(100, 10 * metrics.species + 4 * metrics.bestDistance * metrics.bestDistance)
    };
  }
  // tour: { focus, incidents, perk (id or null) } → { score, scores, weakest, strongest }
  function impression(tour, metrics, route) {
    var sc = tourScores(metrics, route), total = 0, weight = 0;
    Object.keys(sc).forEach(function (k) {
      var w = k === tour.focus ? 3 : 1;
      total += w * sc[k]; weight += w;
    });
    var score = total / weight - Z.TOURS.incidentPenalty * (tour.incidents || 0);
    var perk = tour.perk ? perkInfo(tour.perk) : null;
    if (perk) score += perk.boost;
    var keys = Object.keys(sc).sort(function (a, b) { return sc[a] - sc[b]; });
    return { score: clamp(score, 0, 100), scores: sc, weakest: keys[0], strongest: keys[keys.length - 1] };
  }
  function tourTier(score, incidents) {
    if (incidents) return "incident";
    return score >= 80 ? "dazzled" : score >= 62 ? "pleased" : score >= 45 ? "neutral" : score >= 28 ? "worried" : "appalled";
  }
  function perkInfo(id) {
    for (var i = 0; i < Z.PERKS.length; i++) if (Z.PERKS[i].id === id) return Z.PERKS[i];
    return null;
  }
  // A random investor: { name, fund, focus }.
  function randomInvestor(rng) {
    var f = pick(Z.INVESTORS, rng);
    return { name: pick(Z.INVESTOR_NAMES, rng), fund: f.fund, focus: f.focus };
  }

  // ---------- rounds ----------
  // Tier of a round outcome by valuation ÷ target.
  function roundTier(ratio) {
    return ratio >= 2 ? "legendary" : ratio >= 1.4 ? "great" : ratio >= 1 ? "good" : ratio >= Z.FUNDING.bridgeAt ? "bridge" : "pass";
  }
  // A few lines of praise or doubt, more of them (and louder) the better it went.
  function roundQuotes(tier, ipo, rng) {
    var pool = (ipo && tier !== "bridge" && tier !== "pass" ? Z.QUOTES.round.ipo : []).concat(Z.QUOTES.round[tier]);
    var n = { legendary: 3, great: 2 }[tier] || 1, out = [];
    while (out.length < n && out.length < pool.length) {
      var q = pick(pool, rng);
      if (out.indexOf(q) < 0) out.push(q);
    }
    return out;
  }

  var Investors = {
    milestoneMet: milestoneMet, roadmap: roadmap, hype: hype, valuation: valuation,
    tourScores: tourScores, impression: impression, tourTier: tourTier, perkInfo: perkInfo,
    randomInvestor: randomInvestor, roundTier: roundTier, roundQuotes: roundQuotes, pick: pick
  };
  if (isNode) module.exports = Investors;
  else root.Investors = Investors;
})(typeof window !== "undefined" ? window : this);
