import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const prog = { id: 'p', days: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

test('generateSchedule cycles days across chosen weekdays', () => {
  // 2026-11-02 is a Monday
  const s = L.generateSchedule({ programme: prog, startDate: '2026-11-02', weekdays: [0, 2, 4], weeks: 2 });
  assert.equal(s.length, 6);
  assert.deepEqual(s.map((e) => e.date), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13']);
  assert.deepEqual(s.map((e) => e.dayId), ['a', 'b', 'c', 'a', 'b', 'c']);
});

test('generateSchedule starting mid-week only fills from start date', () => {
  const s = L.generateSchedule({ programme: prog, startDate: '2026-11-05', weekdays: [0, 3], weeks: 1 });
  assert.deepEqual(s.map((e) => e.date), ['2026-11-05', '2026-11-09']);
});

test('generateSchedule handles empty inputs', () => {
  assert.equal(L.generateSchedule({ programme: { days: [] }, startDate: '2026-11-02', weekdays: [0], weeks: 4 }).length, 0);
  assert.equal(L.generateSchedule({ programme: prog, startDate: '2026-11-02', weekdays: [], weeks: 4 }).length, 0);
});

test('date helpers cross month/DST boundaries', () => {
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(L.weekdayIndex('2026-11-08'), 6); // Sunday
  assert.equal(L.startOfWeek('2026-11-08'), '2026-11-02');
  const g = L.monthGrid(2026, 10); // November 2026
  assert.equal(g.length % 7, 0);
  assert.equal(g[0], '2026-10-26');
  assert.ok(g.includes('2026-11-30'));
});

test('e1rm (Epley)', () => {
  assert.equal(L.e1rm(100, 1), 100);
  assert.equal(Math.round(L.e1rm(100, 5)), 117);
  assert.equal(L.e1rm(0, 5), 0);
});

const target = { sets: 3, repsMin: 8, repsMax: 12, increment: 2.5 };
const ex = (sets) => ({ exerciseId: 'x', sets: sets.map(([weight, reps]) => ({ weight, reps, done: true })) });

test('suggestNext: increase when top of range hit on all sets', () => {
  const s = L.suggestNext(target, ex([[60, 12], [60, 12], [60, 13]]));
  assert.equal(s.kind, 'increase');
  assert.equal(s.weight, 62.5);
  assert.equal(s.reps, 8);
});

test('suggestNext: add reps when within range', () => {
  const s = L.suggestNext(target, ex([[60, 10], [60, 9], [60, 9]]));
  assert.equal(s.kind, 'reps');
  assert.equal(s.weight, 60);
  assert.equal(s.reps, 10);
});

test('suggestNext: repeat when below range or missing sets', () => {
  assert.equal(L.suggestNext(target, ex([[60, 8], [60, 6], [60, 5]])).kind, 'repeat');
  assert.equal(L.suggestNext(target, ex([[60, 12], [60, 12]])).kind, 'repeat');
  assert.equal(L.suggestNext(target, null).kind, 'new');
});

test('prefillSets keeps per-set weights unless increasing', () => {
  const last = ex([[60, 10], [55, 10], [50, 10]]);
  const { sets } = L.prefillSets(target, last);
  assert.deepEqual(sets.map((s) => s.weight), [60, 55, 50]);
  const up = L.prefillSets(target, ex([[60, 12], [60, 12], [60, 12]]));
  assert.deepEqual(up.sets.map((s) => s.weight), [62.5, 62.5, 62.5]);
});

const session = (id, date, sets) => ({ id, date, startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:00:00Z`, exercises: [ex(sets)] });

test('history, lastPerformance, PRs', () => {
  const sessions = [
    session('s1', '2026-11-01', [[60, 10], [60, 10]]),
    session('s2', '2026-11-03', [[62.5, 8], [62.5, 8]]),
    { ...session('s3', '2026-11-05', [[70, 1]]), finishedAt: null }, // in progress: ignored
  ];
  assert.equal(L.lastPerformance(sessions, 'x').session.id, 's2');
  assert.equal(L.lastPerformance(sessions, 'x', 's2').session.id, 's1');
  const h = L.exerciseHistory(sessions, 'x');
  assert.equal(h.length, 2);
  assert.equal(h[0].volume, 1200);
  const pr = L.personalRecords(sessions, 'x');
  assert.equal(pr.topWeight.topWeight, 62.5);

  const s4 = session('s4', '2026-11-06', [[65, 6]]);
  const prs = L.detectPRs([...sessions, s4], s4);
  assert.deepEqual(prs.map((p) => p.kind), ['weight']);
  // First-ever performance is not a PR
  assert.equal(L.detectPRs([s4], s4).length, 0);
});

test('undone sets are ignored', () => {
  const s = session('s', '2026-11-01', [[100, 5]]);
  s.exercises[0].sets.push({ weight: 200, reps: 5, done: false });
  assert.equal(L.sessionVolume(s), 500);
});

test('CSV export escapes and includes sets', () => {
  const csv = L.sessionsToCSV({
    exercises: [{ id: 'x', name: 'Bench, Flat' }],
    programmes: [{ id: 'p', name: 'Prog', days: [{ id: 'd', name: 'Day A' }] }],
    sessions: [{ ...session('s', '2026-11-01', [[60, 10]]), programmeId: 'p', dayId: 'd' }],
  });
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, 10);
  assert.equal(lines[1], '2026-11-01,Prog,Day A,"Bench, Flat",1,60,10,,80,');
});

const ss = (group, n) => ({ group, sets: Array.from({ length: n }, () => ({ done: false })) });

test('groupBlocks only links consecutive items; singletons are not supersets', () => {
  const b = L.groupBlocks([ss(null, 1), ss('g', 1), ss('g', 1), ss('h', 1), ss('g', 1)]);
  assert.deepEqual(b.map((x) => [x.group, x.items.length]), [[null, 1], ['g', 2], [null, 1], [null, 1]]);
});

test('linkWithNext / unlinkItem', () => {
  const list = [{}, {}, {}, {}];
  L.linkWithNext(list, 0);
  L.linkWithNext(list, 1); // three-way superset
  assert.ok(list[0].group && list[0].group === list[1].group && list[1].group === list[2].group);
  assert.equal(list[3].group, undefined);
  L.unlinkItem(list, 0);
  assert.equal(list[0].group, undefined);
  assert.ok(list[1].group && list[1].group === list[2].group);
  L.unlinkItem(list, 1); // leaves list[2] alone -> cleaned up
  assert.equal(list[1].group, undefined);
  assert.equal(list[2].group, undefined);
  // merging two existing groups
  const m = [{}, {}, {}, {}];
  L.linkWithNext(m, 0); L.linkWithNext(m, 2); L.linkWithNext(m, 1);
  assert.equal(new Set(m.map((x) => x.group)).size, 1);
});

test('setOrder alternates within supersets; nextSet and rest rules', () => {
  const ex = [ss(null, 2), ss('g', 2), ss('g', 3), ss(null, 1)];
  assert.deepEqual(L.setOrder(ex), [[0, 0], [0, 1], [1, 0], [2, 0], [1, 1], [2, 1], [2, 2], [3, 0]]);
  ex[0].sets.forEach((s) => (s.done = true));
  ex[1].sets[0].done = true;
  assert.deepEqual(L.nextSet(ex), [2, 0]);
  assert.equal(L.shouldRestAfter(ex, 0, 0), true);  // normal exercise
  assert.equal(L.shouldRestAfter(ex, 1, 0), false); // A1 -> go straight to B1
  assert.equal(L.shouldRestAfter(ex, 2, 0), true);  // B1 ends the round
  assert.equal(L.shouldRestAfter(ex, 1, 1), false);
  assert.equal(L.shouldRestAfter(ex, 2, 2), true);  // B3 (A has no 3rd set)
});

const cx = (group, n, rest = 60) => ({ group, target: { rest }, sets: Array.from({ length: n }, () => ({ done: false })) });

test('circuits: single-exercise circuit is kept, rounds alternate, rest rules', () => {
  const meta = { c: { type: 'circuit', rounds: 2, transition: 15, roundRest: 90 } };
  assert.equal(L.groupBlocks([cx('c', 2)], meta)[0].group, 'c'); // circuit of one survives
  assert.equal(L.groupBlocks([cx('s', 2)], {})[0].group, null);  // superset of one doesn't

  const ex = [cx(null, 1, 120), cx('c', 2), cx('c', 2), cx('c', 2), cx(null, 1)];
  assert.deepEqual(L.setOrder(ex, meta), [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1], [4, 0]]);
  assert.equal(L.restAfter(ex, meta, 0, 0), 120); // normal exercise uses its own rest
  assert.equal(L.restAfter(ex, meta, 1, 0), 15);  // between exercises
  assert.equal(L.restAfter(ex, meta, 3, 0), 90);  // end of round 1
  assert.equal(L.restAfter(ex, meta, 3, 1), 0);   // end of final round
  // superset rules unchanged
  const sup = [cx('s', 2, 75), cx('s', 2, 45)];
  assert.equal(L.restAfter(sup, {}, 0, 0), 0);
  assert.equal(L.restAfter(sup, {}, 1, 0), 45);
});

test('normalizeGroups drops settings for circuits that no longer exist', () => {
  const meta = { c: { type: 'circuit' }, gone: { type: 'circuit' } };
  L.normalizeGroups([{ group: 'c' }], meta);
  assert.deepEqual(Object.keys(meta), ['c']);
});

test('syncCircuitRounds updates programme targets and session rows', () => {
  const meta = { c: { type: 'circuit', rounds: 3 } };
  const targets = [{ group: 'c', sets: 2 }, { sets: 5 }];
  L.syncCircuitRounds(targets, meta, 'c');
  assert.deepEqual(targets.map((t) => t.sets), [3, 5]);
  const sess = [{ group: 'c', sets: [{ weight: 10, reps: 8, done: true }, { weight: 10, reps: 8, done: false }] }];
  L.syncCircuitRounds(sess, meta, 'c');
  assert.equal(sess[0].sets.length, 3);
  meta.c.rounds = 1;
  L.syncCircuitRounds(sess, meta, 'c');
  assert.equal(sess[0].sets.length, 1); // undone rows removed, done kept
});

test('timed sets count as done, prefill uses duration, history tracks longest', () => {
  const target = { mode: 'time', duration: 40, sets: 3 };
  const first = L.prefillSets(target, null);
  assert.deepEqual(first.sets[0], { weight: '', time: 40, done: false });
  const exT = { exerciseId: 'p', sets: [{ time: 40, done: true }, { time: 45, done: true }, { time: 30, done: false }] };
  assert.equal(L.doneSets(exT).length, 2);
  const again = L.prefillSets(target, exT);
  assert.match(again.suggestion.message, /up to 45s/);
  const sessions = [{ id: 's', date: '2026-11-01', startedAt: 'a', finishedAt: 'b', exercises: [exT] }];
  assert.equal(L.exerciseHistory(sessions, 'p')[0].maxTime, 45);
  assert.equal(L.exerciseHistory(sessions, 'p')[0].e1rm, 0);
});

test('moveItem jumps over whole groups', () => {
  const names = (l) => l.map((x) => x.n).join('');
  const l = [{ n: 'X' }, { n: 'A', group: 'c' }, { n: 'B', group: 'c' }, { n: 'C', group: 'c' }, { n: 'Y' }];
  assert.equal(L.moveItem(l, 0, 1), 3);
  assert.equal(names(l), 'ABCXY');
  L.moveItem(l, 4, -1);
  assert.equal(names(l), 'ABCYX');
  L.moveItem(l, 3, -1);
  assert.equal(names(l), 'YABCX');
  L.moveItem(l, 1, 1); // inside the group: plain swap
  assert.equal(names(l), 'YBACX');
  assert.equal(L.moveItem(l, 0, -1), 0); // edge: no-op
});
