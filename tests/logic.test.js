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
  assert.equal(lines[1], '2026-11-01,Prog,Day A,"Bench, Flat",1,60,10,80,');
});
