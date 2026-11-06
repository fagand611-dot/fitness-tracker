// Pure functions: dates, scheduling, progression, stats. No DOM access, so
// everything here is unit-tested in tests/logic.test.js.

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- Dates (local time, ISO "YYYY-MM-DD" strings) ----------

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Monday = 0 ... Sunday = 6
export function weekdayIndex(iso) {
  return (parseISO(iso).getDay() + 6) % 7;
}

export function startOfWeek(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

// Cells for a month grid starting on Monday. Returns array of ISO dates
// (including leading/trailing days from adjacent months), length multiple of 7.
export function monthGrid(year, month) {
  const first = toISO(new Date(year, month, 1));
  const start = startOfWeek(first);
  const last = toISO(new Date(year, month + 1, 0));
  const end = addDays(startOfWeek(last), 6);
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);
  return cells;
}

// ---------- Scheduling ----------

/**
 * Lay a programme's days onto the calendar, cycling through them in order
 * on the chosen weekdays.
 * @param {object} opts
 * @param {object} opts.programme  {id, days:[{id}]}
 * @param {string} opts.startDate  ISO date
 * @param {number[]} opts.weekdays Monday=0..Sunday=6
 * @param {number} opts.weeks      how many weeks to fill
 * @returns {{id,date,programmeId,dayId}[]}
 */
export function generateSchedule({ programme, startDate, weekdays, weeks }) {
  const days = programme.days || [];
  if (!days.length || !weekdays.length || weeks < 1) return [];
  const wanted = new Set(weekdays);
  const end = addDays(startDate, weeks * 7 - 1);
  const out = [];
  let i = 0;
  for (let d = startDate; d <= end; d = addDays(d, 1)) {
    if (!wanted.has(weekdayIndex(d))) continue;
    const day = days[i % days.length];
    out.push({ id: uid(), date: d, programmeId: programme.id, dayId: day.id });
    i++;
  }
  return out;
}

// ---------- Strength maths ----------

// Epley estimated one-rep max.
export function e1rm(weight, reps) {
  weight = Number(weight);
  reps = Number(reps);
  if (!weight || !reps || reps < 1) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export const doneSets = (ex) =>
  (ex?.sets || []).filter((s) => s.done && Number(s.reps) > 0);

export function setVolume(s) {
  return (Number(s.weight) || 0) * (Number(s.reps) || 0);
}

export function sessionVolume(session) {
  let v = 0;
  for (const ex of session.exercises || []) for (const s of doneSets(ex)) v += setVolume(s);
  return v;
}

export const roundTo = (x, step = 0.5) => Math.round(x / step) * step;

// ---------- History lookups ----------

const finished = (sessions) =>
  sessions.filter((s) => s.finishedAt).sort((a, b) => (a.date + (a.startedAt || '')).localeCompare(b.date + (b.startedAt || '')));

/** Most recent finished performance of an exercise, optionally excluding a session. */
export function lastPerformance(sessions, exerciseId, excludeSessionId) {
  const list = finished(sessions).filter((s) => s.id !== excludeSessionId);
  for (let i = list.length - 1; i >= 0; i--) {
    const ex = list[i].exercises.find((e) => e.exerciseId === exerciseId);
    if (ex && doneSets(ex).length) return { session: list[i], exercise: ex };
  }
  return null;
}

/** One point per session: best e1RM, top weight, volume. */
export function exerciseHistory(sessions, exerciseId) {
  const out = [];
  for (const s of finished(sessions)) {
    const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const sets = doneSets(ex);
    if (!sets.length) continue;
    let best = 0, top = 0, vol = 0, bestSet = null;
    for (const st of sets) {
      const e = e1rm(st.weight, st.reps);
      if (e > best) { best = e; bestSet = st; }
      top = Math.max(top, Number(st.weight) || 0);
      vol += setVolume(st);
    }
    out.push({ date: s.date, sessionId: s.id, e1rm: best, topWeight: top, volume: vol, bestSet, sets });
  }
  return out;
}

export function personalRecords(sessions, exerciseId) {
  const hist = exerciseHistory(sessions, exerciseId);
  if (!hist.length) return null;
  const by = (k) => hist.reduce((a, b) => (b[k] > a[k] ? b : a));
  return { e1rm: by('e1rm'), topWeight: by('topWeight'), volume: by('volume') };
}

/** PRs set in `session` compared with all *other* finished sessions before it. */
export function detectPRs(sessions, session) {
  const prior = finished(sessions).filter(
    (s) => s.id !== session.id && (s.date < session.date || (s.date === session.date && (s.startedAt || '') < (session.startedAt || '')))
  );
  const out = [];
  for (const ex of session.exercises || []) {
    const sets = doneSets(ex);
    if (!sets.length) continue;
    const prev = exerciseHistory(prior, ex.exerciseId);
    if (!prev.length) continue; // first time isn't a "PR"
    const prevBest = Math.max(...prev.map((p) => p.e1rm));
    const prevTop = Math.max(...prev.map((p) => p.topWeight));
    const best = Math.max(...sets.map((s) => e1rm(s.weight, s.reps)));
    const top = Math.max(...sets.map((s) => Number(s.weight) || 0));
    if (top > prevTop) out.push({ exerciseId: ex.exerciseId, kind: 'weight', value: top });
    else if (best > prevBest + 1e-9) out.push({ exerciseId: ex.exerciseId, kind: 'e1rm', value: best });
  }
  return out;
}

// ---------- Progression (double progression) ----------

/**
 * Suggest the next working weight/reps for an exercise.
 * target: {sets, repsMin, repsMax, increment}
 * last:   the exercise entry from lastPerformance(), or null
 * Returns {weight, reps, kind: 'new'|'increase'|'reps'|'repeat', message}
 */
export function suggestNext(target, last) {
  const repsMin = Number(target.repsMin) || 1;
  const repsMax = Math.max(repsMin, Number(target.repsMax) || repsMin);
  const inc = Number(target.increment) || 2.5;
  const nSets = Number(target.sets) || 1;
  if (!last) return { weight: '', reps: repsMin, kind: 'new', message: 'First time: pick a weight you could do for a few more reps' };

  const sets = doneSets(last);
  // Working weight = heaviest weight used last time.
  const weight = Math.max(...sets.map((s) => Number(s.weight) || 0));
  const working = sets.filter((s) => Number(s.weight) === weight);
  const enoughSets = working.length >= nSets;
  const minReps = Math.min(...working.map((s) => Number(s.reps)));

  if (enoughSets && minReps >= repsMax) {
    return {
      weight: roundTo(weight + inc, 0.25),
      reps: repsMin,
      kind: 'increase',
      message: `Hit ${repsMax}+ reps on all sets. Go up to ${fmtNum(roundTo(weight + inc, 0.25))}`,
    };
  }
  if (enoughSets && minReps >= repsMin) {
    const r = Math.min(repsMax, minReps + 1);
    return { weight, reps: r, kind: 'reps', message: `Same weight, aim for ${r} reps` };
  }
  return { weight, reps: repsMin, kind: 'repeat', message: `Repeat ${fmtNum(weight)} and hit ${repsMin}+ reps on every set` };
}

/** Build the set rows for a new workout from a programme day entry + history. */
export function prefillSets(target, last) {
  const sug = suggestNext(target, last);
  const n = Number(target.sets) || 1;
  const prevSets = last ? doneSets(last) : [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    let weight = sug.weight;
    // If not increasing, reuse that set's own previous weight (handles warm-up/back-off patterns).
    if (sug.kind !== 'increase' && prevSets[i]) weight = Number(prevSets[i].weight);
    rows.push({ weight, reps: sug.reps, done: false });
  }
  return { sets: rows, suggestion: sug };
}

export function fmtNum(n) {
  n = Number(n);
  if (!isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- CSV export ----------

export function sessionsToCSV(data) {
  const exName = Object.fromEntries(data.exercises.map((e) => [e.id, e.name]));
  const prog = Object.fromEntries(data.programmes.map((p) => [p.id, p]));
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['date', 'programme', 'day', 'exercise', 'set', 'weight', 'reps', 'e1rm', 'notes']];
  for (const s of finished(data.sessions)) {
    const p = prog[s.programmeId];
    const day = p?.days.find((d) => d.id === s.dayId);
    for (const ex of s.exercises) {
      doneSets(ex).forEach((st, i) => {
        rows.push([s.date, p?.name || '', day?.name || s.name || '', exName[ex.exerciseId] || '', i + 1, st.weight, st.reps, fmtNum(roundTo(e1rm(st.weight, st.reps), 0.1)), ex.notes || '']);
      });
    }
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
