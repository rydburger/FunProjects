// =========================================================
// Error Correction Zoo Tycoon — staff wellbeing.
//
// One model for every staff role (STAFF in zoo-data.js). Only keepers
// exist so far; tour guides and others plug in with their own numbers.
//
// Fatigue (0–100) builds with work: fatiguePerDay × load^loadExponent,
// where load is how much a person is looking after (the park works it
// out per role). Staff with nothing to do rest. A logical error on their
// watch adds to it. Holidays, sick days and burnout leave take it away.
//
// Holidays: `allowance` days per year, taken in chunks of `chunk` days.
// When someone gets tired (fatigue ≥ autoAt) they book their next chunk
// `notice` days ahead, so the player can arrange cover; the player can
// also send them off straight away. Unused days lapse at the year's end.
//
// Tired staff fall sick (a few days off) and, past the burnout line,
// burn out (two weeks off and a hit to morale). Morale drifts toward
// base − perFatigue × fatigue; anyone whose morale sinks below quitBelow
// may resign.
//
// Everything here is DOM-free and takes the RNG from the caller.
// Browser: load after zoo-data.js; exposes `window.Staff`.
// Node: require("./staff.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;
  var DAYS_PER_YEAR = 365;

  function cfg(member) { return Z.STAFF[member.role]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Fields every staff member carries (merged into the role's own record).
  function create(role, day) {
    var c = Z.STAFF[role];
    if (!c || c.scaffold) throw new Error("No staff role " + role + " yet");
    return {
      role: role, fatigue: 0, morale: c.morale.start,
      absence: null,          // { kind: "vacation" | "sick" | "burnout", untilDay }
      plannedVacation: null,  // { fromDay, days }
      vacationLeft: c.vacation.allowance, vacationYear: Math.floor(day / DAYS_PER_YEAR),
      lastVacationDay: -Infinity, lastBonusDay: -Infinity
    };
  }
  function present(member) { return !member.absence; }
  function statusText(member) {
    if (!member.absence) return member.plannedVacation ? "holiday booked" : "working";
    return { vacation: "on holiday", sick: "off sick", burnout: "burned out" }[member.absence.kind];
  }

  function startAbsence(member, kind, day, days) {
    member.absence = { kind: kind, untilDay: day + days };
    if (kind === "vacation") {
      member.vacationLeft -= days;
      member.lastVacationDay = day;
      member.plannedVacation = null;
    }
  }
  // Send someone on holiday now (days defaults to one chunk, or what's left).
  function canVacation(member) {
    if (member.absence) return { ok: false, reason: "Already away." };
    if (member.vacationLeft < 1) return { ok: false, reason: "No holiday left this year." };
    return { ok: true, reason: null };
  }
  function sendOnVacation(member, day, days) {
    var c = canVacation(member);
    if (!c.ok) return c;
    days = Math.max(1, Math.min(days || cfg(member).vacation.chunk, member.vacationLeft));
    startAbsence(member, "vacation", day, days);
    return { ok: true, days: days, untilDay: member.absence.untilDay };
  }

  // One day passes. ctx: { day (absolute, 0-based), load, sickAnimals }.
  // Returns events: { kind: "planned", fromDay, days } | { kind: "vacation", days }
  //   | { kind: "back", from } | { kind: "sick", days } | { kind: "burnout", days } | { kind: "quit" }.
  function daily(member, ctx, rng) {
    var c = cfg(member), ev = [], day = ctx.day;
    var year = Math.floor(day / DAYS_PER_YEAR);
    if (year !== member.vacationYear) { member.vacationYear = year; member.vacationLeft = c.vacation.allowance; }

    if (member.absence) {
      var rec = member.absence.kind === "vacation" ? c.vacation.recovery : c[member.absence.kind].recovery;
      member.fatigue = clamp(member.fatigue - rec, 0, 100);
      if (day >= member.absence.untilDay) {
        ev.push({ kind: "back", from: member.absence.kind });
        member.absence = null;
      }
    } else if (member.plannedVacation && day >= member.plannedVacation.fromDay) {
      var days = Math.min(member.plannedVacation.days, member.vacationLeft);
      if (days >= 1) { startAbsence(member, "vacation", day, days); ev.push({ kind: "vacation", days: days }); }
      else member.plannedVacation = null;
    } else {
      var load = ctx.load || 0;
      member.fatigue += load > 0 ? c.fatiguePerDay * Math.pow(load, c.loadExponent) : -c.restPerDay;
      member.fatigue = clamp(member.fatigue + c.perSickAnimal * (ctx.sickAnimals || 0), 0, 100);
      var v = c.vacation;
      if (!member.plannedVacation && member.fatigue >= v.autoAt && member.vacationLeft >= 1 && day - member.lastVacationDay >= v.minGap) {
        member.plannedVacation = { fromDay: day + v.notice, days: Math.min(v.chunk, member.vacationLeft) };
        ev.push({ kind: "planned", fromDay: member.plannedVacation.fromDay, days: member.plannedVacation.days });
      }
      var b = c.burnout, s = c.sick;
      if (member.fatigue >= b.at && rng() < (member.fatigue - b.at) / b.per) {
        startAbsence(member, "burnout", day, b.days);
        member.morale = clamp(member.morale - b.morale, 0, 100);
        ev.push({ kind: "burnout", days: b.days });
      } else if (member.fatigue >= s.at && rng() < (member.fatigue - s.at) / s.per) {
        var sd = s.days[0] + Math.floor(rng() * (s.days[1] - s.days[0] + 1));
        startAbsence(member, "sick", day, sd);
        ev.push({ kind: "sick", days: sd });
      }
    }

    var m = c.morale;
    member.morale = clamp(member.morale + (m.base - m.perFatigue * member.fatigue - member.morale) * m.drift, 0, 100);
    if (member.morale < m.quitBelow && rng() < (m.quitBelow - member.morale) / m.quitPer) ev.push({ kind: "quit" });
    return ev;
  }

  function addMorale(member, amount) { member.morale = clamp(member.morale + amount, 0, 100); }

  var Staff = {
    DAYS_PER_YEAR: DAYS_PER_YEAR,
    create: create, present: present, statusText: statusText, canVacation: canVacation,
    sendOnVacation: sendOnVacation, daily: daily, addMorale: addMorale
  };
  if (isNode) module.exports = Staff;
  else root.Staff = Staff;
})(typeof window !== "undefined" ? window : this);
