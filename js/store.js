// Persistence in localStorage, plus seed data.
import { uid } from './logic.js';

const KEY = 'liftlog.v1';

const SEED_EXERCISES = [
  ['Barbell Bench Press', 'Chest'], ['Incline Dumbbell Press', 'Chest'], ['Dumbbell Bench Press', 'Chest'],
  ['Cable Fly', 'Chest'], ['Dips', 'Chest'], ['Push-up', 'Chest'],
  ['Back Squat', 'Legs'], ['Front Squat', 'Legs'], ['Leg Press', 'Legs'], ['Romanian Deadlift', 'Legs'],
  ['Bulgarian Split Squat', 'Legs'], ['Leg Curl', 'Legs'], ['Leg Extension', 'Legs'], ['Calf Raise', 'Legs'],
  ['Hip Thrust', 'Legs'], ['Walking Lunge', 'Legs'],
  ['Deadlift', 'Back'], ['Pull-up', 'Back'], ['Lat Pulldown', 'Back'], ['Barbell Row', 'Back'],
  ['Seated Cable Row', 'Back'], ['Dumbbell Row', 'Back'], ['Face Pull', 'Back'],
  ['Overhead Press', 'Shoulders'], ['Dumbbell Shoulder Press', 'Shoulders'], ['Lateral Raise', 'Shoulders'],
  ['Rear Delt Fly', 'Shoulders'],
  ['Barbell Curl', 'Arms'], ['Dumbbell Curl', 'Arms'], ['Hammer Curl', 'Arms'],
  ['Triceps Pushdown', 'Arms'], ['Overhead Triceps Extension', 'Arms'], ['Skull Crusher', 'Arms'],
  ['Plank', 'Core'], ['Hanging Leg Raise', 'Core'], ['Cable Crunch', 'Core'],
];

export const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899'];

function fresh() {
  return {
    version: 1,
    settings: { unit: 'kg', defaultRest: 120, increment: 2.5, sound: true },
    exercises: SEED_EXERCISES.map(([name, group]) => ({ id: uid(), name, group })),
    programmes: [],
    schedule: [],
    sessions: [],
    activeSessionId: null,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('Failed to load data', e);
  }
  return fresh();
}

function migrate(d) {
  const base = fresh();
  return {
    ...base,
    ...d,
    settings: { ...base.settings, ...(d.settings || {}) },
    exercises: d.exercises?.length ? d.exercises : base.exercises,
  };
}

let saveTimer = null;
export function save(data, immediate = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      alert('Could not save. Storage may be full. Export a backup from Settings.');
    }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 250);
}

export function flush(data) {
  save(data, true);
}

export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a valid backup file');
  for (const k of ['exercises', 'programmes', 'schedule', 'sessions']) {
    if (!Array.isArray(obj[k])) throw new Error(`Backup is missing "${k}"`);
  }
  return migrate(obj);
}

// Ask the browser not to evict our data (important on iOS Safari).
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

export function sampleProgramme(exercises) {
  const id = (name) => exercises.find((e) => e.name === name)?.id;
  const ex = (name, sets, repsMin, repsMax, rest = 120, increment = 2.5) => ({
    id: uid(), exerciseId: id(name), sets, repsMin, repsMax, rest, increment,
  });
  return {
    id: uid(),
    name: 'Upper / Lower (sample)',
    color: COLORS[0],
    days: [
      { id: uid(), name: 'Upper A', exercises: [
        ex('Barbell Bench Press', 3, 5, 8, 180), ex('Barbell Row', 3, 6, 10, 150),
        ex('Overhead Press', 3, 6, 10, 150), ex('Lat Pulldown', 3, 8, 12, 90, 5),
        ex('Dumbbell Curl', 2, 10, 15, 60, 1), ex('Triceps Pushdown', 2, 10, 15, 60, 2.5),
      ] },
      { id: uid(), name: 'Lower A', exercises: [
        ex('Back Squat', 3, 5, 8, 180, 5), ex('Romanian Deadlift', 3, 8, 10, 150, 5),
        ex('Leg Press', 3, 10, 15, 120, 10), ex('Leg Curl', 3, 10, 15, 90), ex('Calf Raise', 3, 10, 15, 60),
      ] },
      { id: uid(), name: 'Upper B', exercises: [
        ex('Incline Dumbbell Press', 3, 8, 12, 120, 2), ex('Pull-up', 3, 6, 10, 150),
        ex('Dumbbell Shoulder Press', 3, 8, 12, 120, 2), ex('Seated Cable Row', 3, 8, 12, 90, 5),
        ex('Lateral Raise', 3, 12, 20, 60, 1), ex('Hammer Curl', 2, 10, 15, 60, 1),
      ] },
      { id: uid(), name: 'Lower B', exercises: [
        ex('Deadlift', 3, 3, 6, 180, 5), ex('Front Squat', 3, 6, 10, 150),
        ex('Bulgarian Split Squat', 3, 8, 12, 90, 2), ex('Leg Extension', 3, 10, 15, 60),
        ex('Hanging Leg Raise', 3, 10, 15, 60, 0),
      ] },
    ],
  };
}
