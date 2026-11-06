import * as L from './logic.js';
import { load, save, flush, validateImport, requestPersistence, sampleProgramme, COLORS } from './store.js';

let data = load();
const ui = {
  calMonth: null, // [year, month]
  calSelected: L.todayISO(),
  progressEx: null,
  progressMetric: 'e1rm',
};
const $app = document.getElementById('app');
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- tiny DOM helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === '') continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- lookups ----------
const unit = () => data.settings.unit;
const exById = (id) => data.exercises.find((e) => e.id === id);
const exName = (id) => exById(id)?.name || 'Unknown exercise';
const progById = (id) => data.programmes.find((p) => p.id === id);
const dayOf = (pid, did) => progById(pid)?.days.find((d) => d.id === did);
const sessionById = (id) => data.sessions.find((s) => s.id === id);
const activeSession = () => {
  const s = data.activeSessionId && sessionById(data.activeSessionId);
  return s && !s.finishedAt ? s : null;
};
const sessionForEntry = (entryId) => data.sessions.find((s) => s.scheduleId === entryId && s.finishedAt);
const entryLabel = (e) => dayOf(e.programmeId, e.dayId)?.name || 'Workout';
const fmtW = (w) => `${L.fmtNum(w)} ${unit()}`;
const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  L.parseISO(iso).toLocaleDateString(undefined, opts);
const fmtRest = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
const targetText = (t) => `${t.sets} × ${t.repsMin === t.repsMax ? t.repsMin : `${t.repsMin}–${t.repsMax}`} · ${fmtRest(t.rest)} rest`;
const setsSummary = (sets) => sets.map((s) => `${L.fmtNum(s.weight)}×${s.reps}`).join(' · ');

function commit(rerender = true) {
  save(data);
  if (rerender) render();
}

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- bottom sheet ----------
const $sheet = document.getElementById('sheet');
const $backdrop = document.getElementById('sheet-backdrop');
function openSheet(title, ...content) {
  $sheet.replaceChildren();
  append($sheet, [h('div', { class: 'grab' }), title ? h('h2', {}, title) : null, content]);
  $sheet.hidden = false;
  $backdrop.hidden = false;
  $sheet.scrollTop = 0;
}
function closeSheet() {
  $sheet.hidden = true;
  $backdrop.hidden = true;
  $sheet.replaceChildren();
}
$backdrop.addEventListener('click', closeSheet);

// ---------- generic inputs ----------
function stepper(value, { step = 1, min = 0, decimal = false, onChange }) {
  const input = h('input', { class: 'input', type: 'number', inputmode: decimal ? 'decimal' : 'numeric', value, step: 'any', min });
  const set = (v) => {
    v = Math.max(min, Math.round(v * 100) / 100);
    input.value = v;
    onChange(v);
  };
  input.addEventListener('input', () => input.value !== '' && onChange(Number(input.value)));
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', onclick: () => set((Number(input.value) || 0) - step), 'aria-label': 'decrease' }, '−'),
    input,
    h('button', { type: 'button', onclick: () => set((Number(input.value) || 0) + step), 'aria-label': 'increase' }, '+'));
}
const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
function seg(options, current, onPick) {
  return h('div', { class: 'seg' }, options.map(([val, label]) =>
    h('button', { type: 'button', class: val === current ? 'on' : '', onclick: () => onPick(val) }, label)));
}
function topbar(title, { back, action } = {}) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'back', onclick: () => (location.hash = back), 'aria-label': 'Back' }, '‹') : null,
    h('h1', {}, title),
    action || null);
}

// =====================================================================
// Rest timer
// =====================================================================
const timer = { endsAt: 0, total: 0, beeped: false };
const $timer = document.getElementById('timer');
let audioCtx = null;

function startRest(sec) {
  if (!sec) return;
  timer.total = sec;
  timer.endsAt = Date.now() + sec * 1000;
  timer.beeped = false;
  // Unlock audio on a user gesture so we can beep later (iOS needs this).
  if (data.settings.sound && !audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  audioCtx?.resume?.();
  tick();
}
function stopRest() {
  timer.endsAt = 0;
  tick();
}
function beep() {
  navigator.vibrate?.([250, 120, 250, 120, 250]);
  if (!data.settings.sound || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((d) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch {}
}
function tick() {
  // Elapsed workout clocks
  document.querySelectorAll('.elapsed[data-start]').forEach((el) => {
    el.textContent = L.fmtDuration((Date.now() - Date.parse(el.dataset.start)) / 1000);
  });
  if (!timer.endsAt) {
    $timer.hidden = true;
    document.body.classList.remove('timer-on');
    return;
  }
  const left = (timer.endsAt - Date.now()) / 1000;
  if (left <= 0 && !timer.beeped) {
    timer.beeped = true;
    beep();
  }
  if (left < -30) return stopRest(); // auto-hide 30s after finishing
  $timer.hidden = false;
  document.body.classList.add('timer-on');
  $timer.classList.toggle('over', left <= 0);
  const pct = Math.max(0, Math.min(1, 1 - left / timer.total)) * 100;
  // Build once, then only update text, so taps on the buttons are never lost to a redraw.
  if (!$timer.firstChild) {
    $timer.innerHTML = `
      <div class="bar"></div>
      <div class="t"><span class="lbl"></span><span class="clock"></span></div>
      <button data-a="-15">−15</button><button data-a="15">+15</button><button data-a="x"></button>`;
  }
  $timer.querySelector('.bar').style.width = `${pct}%`;
  $timer.querySelector('.lbl').textContent = left > 0 ? 'Rest' : 'Go! Next set';
  $timer.querySelector('.clock').textContent = L.fmtDuration(Math.abs(left));
  $timer.querySelector('[data-a="x"]').textContent = left > 0 ? 'Skip' : 'Close';
}
$timer.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.a;
  if (!a) return;
  if (a === 'x') return stopRest();
  timer.endsAt += Number(a) * 1000;
  timer.total = Math.max(timer.total, (timer.endsAt - Date.now()) / 1000);
  timer.beeped = timer.endsAt <= Date.now();
  tick();
});
setInterval(tick, 250);

// Keep the screen awake during a workout.
let wakeLock = null;
async function syncWakeLock() {
  const want = !!activeSession() && location.hash.startsWith('#/workout');
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncWakeLock(); tick(); }
  else flush(data);
});

// =====================================================================
// Workouts
// =====================================================================
function makeSessionExercise(t) {
  const last = L.lastPerformance(data.sessions, t.exerciseId)?.exercise || null;
  const { sets, suggestion } = L.prefillSets(t, last);
  return {
    id: L.uid(),
    exerciseId: t.exerciseId,
    target: { sets: t.sets, repsMin: t.repsMin, repsMax: t.repsMax, rest: t.rest, increment: t.increment },
    sets,
    suggestion,
    notes: t.notes || '',
    group: t.group || undefined,
  };
}

function startWorkout({ programmeId = null, dayId = null, scheduleId = null } = {}) {
  const act = activeSession();
  if (act) {
    if (!confirm(`"${act.name}" is still in progress. Discard it and start a new workout?`)) {
      location.hash = `#/workout/${act.id}`;
      return;
    }
    data.sessions = data.sessions.filter((s) => s.id !== act.id);
  }
  const day = programmeId ? dayOf(programmeId, dayId) : null;
  const s = {
    id: L.uid(),
    date: L.todayISO(),
    programmeId, dayId, scheduleId,
    name: day?.name || 'Workout',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exercises: (day?.exercises || []).filter((t) => exById(t.exerciseId)).map(makeSessionExercise),
  };
  data.sessions.push(s);
  data.activeSessionId = s.id;
  flush(data);
  closeSheet();
  location.hash = `#/workout/${s.id}`;
}

function finishWorkout(s) {
  const done = s.exercises.reduce((n, e) => n + L.doneSets(e).length, 0);
  const pending = s.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.done && Number(x.reps) > 0 && x.weight !== '').length, 0);
  if (!done) {
    if (confirm('No sets ticked off yet. Discard this workout?')) discardWorkout(s);
    return;
  }
  if (pending && !confirm(`${pending} set${pending > 1 ? 's are' : ' is'} not ticked and won't be saved. Finish anyway?`)) return;
  // Drop unticked sets and empty exercises.
  s.exercises.forEach((e) => (e.sets = e.sets.filter((x) => x.done)));
  s.exercises = s.exercises.filter((e) => e.sets.length);
  s.finishedAt = new Date().toISOString();
  data.activeSessionId = null;
  stopRest();
  flush(data);
  const prs = L.detectPRs(data.sessions, s);
  afterNav = () => showSummary(s, prs);
  location.hash = '#/today';
}

function showSummary(s, prs) {
  const mins = (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000;
  const sets = s.exercises.reduce((n, e) => n + e.sets.length, 0);
  openSheet('Workout complete 💪',
    h('div', { class: 'tiles' },
      tile(L.fmtDuration(mins), 'Duration'),
      tile(String(sets), 'Sets'),
      tile(L.fmtNum(Math.round(L.sessionVolume(s))), `Volume (${unit()})`)),
    prs.length
      ? h('div', { class: 'card' }, h('h3', {}, '🏆 New personal records'),
          h('ul', { class: 'list' }, prs.map((p) => h('li', { class: 'list-item' },
            h('span', { class: 'grow' }, exName(p.exerciseId)),
            h('span', { class: 'pr-badge' }, p.kind === 'weight' ? `${fmtW(p.value)} top set` : `${fmtW(L.roundTo(p.value, 0.5))} est. 1RM`)))))
      : null,
    h('button', { class: 'btn primary block big', onclick: closeSheet }, 'Done'));
}

function discardWorkout(s) {
  data.sessions = data.sessions.filter((x) => x.id !== s.id);
  if (data.activeSessionId === s.id) data.activeSessionId = null;
  stopRest();
  flush(data);
  location.hash = '#/today';
}

function viewWorkout(id) {
  const s = sessionById(id);
  if (!s) { location.hash = '#/today'; return h('div'); }
  const editing = !!s.finishedAt;
  const prog = progById(s.programmeId);

  const head = h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('input', { class: 'input title-input grow', value: s.name, 'aria-label': 'Workout name', oninput: (e) => { s.name = e.target.value; commit(false); } }),
      editing ? null : h('span', { class: 'elapsed status', 'data-start': s.startedAt }, '0:00')),
    h('div', { class: 'row small muted' },
      prog ? h('span', {}, prog.name, ' · ') : null,
      editing
        ? h('input', { class: 'input', type: 'date', value: s.date, style: 'max-width:180px', onchange: (e) => { if (e.target.value) { s.date = e.target.value; commit(false); } } })
        : h('span', {}, fmtDate(s.date))));

  const next = editing ? null : L.nextSet(s.exercises);
  const cards = L.groupBlocks(s.exercises).map((b, bi, all) => {
    const inner = b.items.map(({ item, index }) => exerciseCard(s, item, index, next));
    if (!b.group) return inner;
    return supersetWrap(supersetLetter(all, bi), b.items.map(({ item }) => exName(item.exerciseId)), inner);
  });

  return h('div', {},
    topbar(editing ? 'Edit workout' : 'Workout', { back: editing ? '#/calendar' : '#/today' }),
    head,
    cards,
    !s.exercises.length ? h('div', { class: 'empty' }, 'No exercises yet. Add one below.') : null,
    h('button', { class: 'btn block', onclick: () => pickExercise((exId) => {
      s.exercises.push(makeSessionExercise({ exerciseId: exId, sets: 3, repsMin: 8, repsMax: 12, rest: data.settings.defaultRest, increment: data.settings.increment }));
      closeSheet();
      commit();
    }) }, '+ Add exercise'),
    h('div', { class: 'btn-row' },
      editing
        ? [h('button', { class: 'btn danger', onclick: () => { if (confirm('Delete this workout from your history?')) { data.sessions = data.sessions.filter((x) => x.id !== s.id); flush(data); location.hash = '#/calendar'; } } }, 'Delete'),
           h('button', { class: 'btn primary', onclick: () => { s.exercises.forEach((e) => (e.sets = e.sets.filter((x) => x.done))); flush(data); toast('Saved'); location.hash = '#/calendar'; } }, 'Save')]
        : [h('button', { class: 'btn danger', onclick: () => confirm('Discard this workout? Nothing will be saved.') && discardWorkout(s) }, 'Discard'),
           h('button', { class: 'btn primary big', onclick: () => finishWorkout(s) }, 'Finish workout')]));
}

function exerciseCard(s, ex, idx, next) {
  const editing = !!s.finishedAt;
  const last = L.lastPerformance(data.sessions, ex.exerciseId, s.id);
  const prevSets = last ? L.doneSets(last.exercise) : [];
  const t = ex.target;
  const sug = ex.suggestion;

  const rows = ex.sets.map((st, i) => {
    const isNext = next && next[0] === idx && next[1] === i;
    const tr = h('tr', { class: st.done ? 'done' : isNext ? 'next' : '' },
      h('td', { class: 'n' }, i + 1),
      h('td', { class: 'prev' }, prevSets[i] ? `${L.fmtNum(prevSets[i].weight)}×${prevSets[i].reps}` : '–'),
      h('td', {}, h('input', {
        type: 'number', inputmode: 'decimal', step: 'any', value: st.weight === '' ? '' : L.fmtNum(st.weight), placeholder: unit(), 'aria-label': `Set ${i + 1} weight`,
        oninput: (e) => { st.weight = e.target.value === '' ? '' : Number(e.target.value); commit(false); },
        onfocus: (e) => e.target.select(),
      })),
      h('td', {}, h('input', {
        type: 'number', inputmode: 'numeric', step: '1', value: st.reps === '' ? '' : st.reps, placeholder: 'reps', 'aria-label': `Set ${i + 1} reps`,
        oninput: (e) => { st.reps = e.target.value === '' ? '' : Number(e.target.value); commit(false); },
        onfocus: (e) => e.target.select(),
      })),
      h('td', {}, h('button', {
        class: 'tick', 'aria-label': st.done ? 'Mark set not done' : 'Mark set done',
        onclick: () => {
          if (!st.done && !(Number(st.reps) > 0)) { toast('Enter reps first'); return; }
          if (st.weight === '') st.weight = 0;
          st.done = !st.done;
          // Carry this weight forward into later empty/untouched sets.
          if (st.done) {
            for (let j = i + 1; j < ex.sets.length; j++) if (!ex.sets[j].done && ex.sets[j].weight === '') ex.sets[j].weight = st.weight;
            if (!editing) {
              if (L.shouldRestAfter(s.exercises, idx, i)) startRest(t.rest || data.settings.defaultRest);
              else {
                const n = L.nextSet(s.exercises);
                if (n) toast(`Superset: straight to ${exName(s.exercises[n[0]].exerciseId)}`, 1600);
              }
            }
          }
          commit();
        },
      }, '✓')));
    return tr;
  });

  return h('div', { class: 'card ex-card' },
    h('div', { class: 'ex-head' },
      h('div', { class: 'grow' },
        h('h3', { class: 'ex-name' }, exName(ex.exerciseId)),
        h('div', { class: 'small muted' }, targetText(t))),
      h('button', { class: 'icon-btn', 'aria-label': 'Exercise options', onclick: () => exerciseMenu(s, ex, idx) }, '⋯')),
    !editing && sug ? h('div', { class: `hint ${sug.kind}` }, sug.kind === 'increase' ? '▲ ' : '', sug.message) : null,
    ex.notes ? h('div', { class: 'small muted', style: 'margin-top:6px' }, '📝 ', ex.notes) : null,
    h('table', { class: 'sets' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Set'), h('th', {}, 'Last'), h('th', {}, unit()), h('th', {}, 'Reps'), h('th', {}, ''))),
      h('tbody', {}, rows)),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'btn ghost sm', onclick: () => {
        const lastSet = ex.sets[ex.sets.length - 1];
        ex.sets.push({ weight: lastSet ? lastSet.weight : '', reps: lastSet ? lastSet.reps : t.repsMin, done: false });
        commit();
      } }, '+ Add set'),
      ex.sets.length ? h('button', { class: 'btn ghost sm', style: 'color:var(--muted)', onclick: () => { ex.sets.pop(); commit(); } }, '− Remove set') : null));
}

function exerciseMenu(s, ex, idx) {
  const move = (d) => {
    const j = idx + d;
    if (j < 0 || j >= s.exercises.length) return;
    [s.exercises[idx], s.exercises[j]] = [s.exercises[j], s.exercises[idx]];
    L.normalizeGroups(s.exercises);
    closeSheet();
    commit();
  };
  const notes = h('textarea', { class: 'input', placeholder: 'e.g. seat height 4, use the narrow grip' }, ex.notes || '');
  openSheet(exName(ex.exerciseId),
    field('Notes', notes),
    h('button', { class: 'btn primary block', onclick: () => { ex.notes = notes.value.trim(); closeSheet(); commit(); } }, 'Save notes'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => move(-1), disabled: idx === 0 }, '↑ Move up'),
      h('button', { class: 'btn', onclick: () => move(1), disabled: idx === s.exercises.length - 1 }, '↓ Move down')),
    supersetButtons(s.exercises, idx, () => { closeSheet(); commit(); }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => pickExercise((id) => {
        ex.exerciseId = id;
        const last = L.lastPerformance(data.sessions, id, s.id)?.exercise || null;
        const fresh = L.prefillSets(ex.target, last);
        ex.suggestion = fresh.suggestion;
        ex.sets = ex.sets.map((st, i) => (st.done ? st : fresh.sets[i] || { ...fresh.sets[0] }));
        closeSheet();
        commit();
      }) }, '⇄ Swap exercise'),
      h('button', { class: 'btn danger', onclick: () => { if (confirm('Remove this exercise from the workout?')) { s.exercises.splice(idx, 1); L.normalizeGroups(s.exercises); closeSheet(); commit(); } } }, 'Remove')));
}

// =====================================================================
// Supersets (shared by programme editor and workout)
// =====================================================================
function supersetLetter(blocks, bi) {
  const n = blocks.slice(0, bi + 1).filter((b) => b.group).length;
  return String.fromCharCode(64 + n);
}

function supersetWrap(letter, names, inner) {
  return h('div', { class: 'superset' },
    h('div', { class: 'superset-label' }, `Superset ${letter}`, h('span', { class: 'muted' }, ` · alternate ${names.join(' ↔ ')}, rest after each round`)),
    inner);
}

function supersetButtons(list, i, done) {
  const it = list[i];
  const inSuperset = L.groupBlocks(list).some((b) => b.group && b.items.some((x) => x.index === i));
  const nextLinked = inSuperset && list[i + 1] && list[i + 1].group === it.group;
  return h('div', { class: 'btn-row' },
    list[i + 1] && !nextLinked
      ? h('button', { class: 'btn', onclick: () => { L.linkWithNext(list, i); done(); } }, `⛓ Superset with ${exName(list[i + 1].exerciseId)}`)
      : null,
    inSuperset ? h('button', { class: 'btn', onclick: () => { L.unlinkItem(list, i); done(); } }, 'Remove from superset') : null);
}

// =====================================================================
// Exercise picker (shared)
// =====================================================================
function pickExercise(onPick) {
  const list = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search or create an exercise…', autocomplete: 'off' });
  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const matches = data.exercises
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.group || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const groups = {};
    for (const e of matches) (groups[e.group || 'Other'] ||= []).push(e);
    const exact = data.exercises.some((e) => e.name.toLowerCase() === q);
    list.replaceChildren();
    append(list, [
      q && !exact ? h('button', { class: 'btn primary block', style: 'margin-bottom:8px', onclick: () => {
        const name = search.value.trim().replace(/\s+/g, ' ');
        const e = { id: L.uid(), name: name[0].toUpperCase() + name.slice(1), group: 'Other' };
        data.exercises.push(e);
        save(data);
        onPick(e.id);
      } }, `+ Create “${search.value.trim()}”`) : null,
      Object.keys(groups).sort().map((g) => [
        h('div', { class: 'section-title' }, g),
        h('div', { class: 'card', style: 'padding:0 14px' }, groups[g].map((e) =>
          h('button', { class: 'list-item', onclick: () => onPick(e.id) }, h('span', { class: 'grow' }, e.name), h('span', { class: 'chev' }, '+')))),
      ]),
      !matches.length && !q ? h('div', { class: 'empty' }, 'No exercises') : null]);
  };
  search.addEventListener('input', renderList);
  renderList();
  openSheet('Choose exercise', h('div', { class: 'search' }, search), list);
}

// =====================================================================
// Today
// =====================================================================
function tile(v, k) {
  return h('div', { class: 'tile' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
}

function viewToday() {
  const today = L.todayISO();
  const act = activeSession();
  const todays = data.schedule.filter((e) => e.date === today);
  const upcoming = data.schedule
    .filter((e) => e.date > today && !sessionForEntry(e.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  // Missed in the last 7 days and not done: offer to catch up
  const missed = data.schedule
    .filter((e) => e.date < today && e.date >= L.addDays(today, -7) && !sessionForEntry(e.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const recent = data.sessions.filter((s) => s.finishedAt).sort((a, b) => b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt)).slice(0, 5);

  const weekStart = L.startOfWeek(today);
  const weekSessions = data.sessions.filter((s) => s.finishedAt && s.date >= weekStart && s.date <= today);
  const weekPlanned = data.schedule.filter((e) => e.date >= weekStart && e.date <= L.addDays(weekStart, 6)).length;

  const workoutCard = (entry, opts = {}) => {
    const day = dayOf(entry.programmeId, entry.dayId);
    const prog = progById(entry.programmeId);
    const done = sessionForEntry(entry.id);
    return h('div', { class: `card ${opts.hero && !done ? 'hero' : ''}` },
      h('div', { class: 'row' },
        h('div', { class: 'swatch', style: `background:${prog?.color || 'var(--accent)'}` }),
        h('div', { class: 'grow' },
          h('h2', {}, day?.name || 'Deleted workout'),
          h('div', { class: 'small muted' }, prog?.name || '', opts.when ? ` · ${opts.when}` : '')),
        done ? h('span', { class: 'status done' }, '✓ Done') : null),
      day && opts.hero && !done ? h('div', { class: 'small muted', style: 'margin:10px 0 0' }, day.exercises.map((t) => exName(t.exerciseId)).join(' · ')) : null,
      day && !done && opts.startable !== false
        ? h('button', { class: `btn ${opts.hero ? 'primary big' : ''} block`, style: 'margin-top:12px', onclick: () => startWorkout({ programmeId: entry.programmeId, dayId: entry.dayId, scheduleId: entry.id }) }, opts.hero ? 'Start workout' : 'Start now')
        : null,
      done ? h('button', { class: 'btn ghost sm', style: 'margin-top:6px', onclick: () => (location.hash = `#/workout/${done.id}`) }, 'View log') : null);
  };

  return h('div', {},
    topbar('Today'),
    h('div', { class: 'sub' }, fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })),
    act ? h('div', { class: 'card hero' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, `▶ ${act.name} in progress`), h('span', { class: 'elapsed status', 'data-start': act.startedAt })),
      h('button', { class: 'btn primary big block', style: 'margin-top:12px', onclick: () => (location.hash = `#/workout/${act.id}`) }, 'Resume workout')) : null,
    todays.length
      ? todays.map((e) => workoutCard(e, { hero: true }))
      : !act ? h('div', { class: 'card' },
          h('h2', {}, data.programmes.length ? 'Rest day' : 'Welcome 👋'),
          h('div', { class: 'small muted' }, data.programmes.length
            ? 'Nothing scheduled for today. You can still start a workout.'
            : 'Start by building a programme, then put it on your calendar.'),
          !data.programmes.length ? h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', onclick: () => (location.hash = '#/programmes') }, 'Build a programme')) : null) : null,
    h('button', { class: 'btn block', onclick: quickStartSheet }, todays.length ? 'Do a different workout' : 'Start a workout'),
    missed.length ? [h('div', { class: 'section-title' }, 'Missed this week'), missed.slice(0, 2).map((e) => workoutCard(e, { when: fmtDate(e.date) }))] : null,
    upcoming.length ? [h('div', { class: 'section-title' }, 'Coming up'),
      h('div', { class: 'card', style: 'padding:0 14px' }, upcoming.map((e) => h('button', { class: 'list-item', onclick: () => { ui.calSelected = e.date; ui.calMonth = null; location.hash = '#/calendar'; } },
        h('div', { class: 'swatch', style: `background:${progById(e.programmeId)?.color || 'var(--accent)'}` }),
        h('div', { class: 'grow' }, h('div', {}, entryLabel(e)), h('div', { class: 'small muted' }, fmtDate(e.date))),
        h('span', { class: 'chev' }, '›'))))] : null,
    h('div', { class: 'section-title' }, 'This week'),
    h('div', { class: 'tiles' },
      tile(weekPlanned ? `${weekSessions.length}/${weekPlanned}` : String(weekSessions.length), 'Workouts'),
      tile(String(weekSessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.length, 0), 0)), 'Sets'),
      tile(L.fmtNum(Math.round(weekSessions.reduce((v, s) => v + L.sessionVolume(s), 0))), `Volume ${unit()}`)),
    recent.length ? [h('div', { class: 'section-title' }, 'Recent'),
      h('div', { class: 'card', style: 'padding:0 14px' }, recent.map((s) => h('button', { class: 'list-item', onclick: () => (location.hash = `#/workout/${s.id}`) },
        h('div', { class: 'grow' }, h('div', {}, s.name), h('div', { class: 'small muted' }, `${fmtDate(s.date)} · ${s.exercises.length} exercises · ${L.fmtNum(Math.round(L.sessionVolume(s)))} ${unit()}`)),
        h('span', { class: 'chev' }, '›'))))] : null);
}

function quickStartSheet() {
  openSheet('Start a workout',
    data.programmes.map((p) => [
      h('div', { class: 'section-title' }, p.name),
      h('div', { class: 'card', style: 'padding:0 14px' }, p.days.map((d) =>
        h('button', { class: 'list-item', onclick: () => startWorkout({ programmeId: p.id, dayId: d.id, scheduleId: data.schedule.find((e) => e.date === L.todayISO() && e.dayId === d.id && !sessionForEntry(e.id))?.id || null }) },
          h('div', { class: 'swatch', style: `background:${p.color}` }),
          h('div', { class: 'grow' }, h('div', {}, d.name), h('div', { class: 'small muted ellipsis' }, d.exercises.map((t) => exName(t.exerciseId)).join(', ') || 'No exercises')),
          h('span', { class: 'chev' }, '›')))),
    ]),
    h('div', { class: 'section-title' }, 'Other'),
    h('button', { class: 'btn block', onclick: () => startWorkout() }, 'Empty workout (add exercises as you go)'));
}

// =====================================================================
// Calendar
// =====================================================================
function viewCalendar() {
  const today = L.todayISO();
  if (!ui.calMonth) {
    const d = L.parseISO(ui.calSelected);
    ui.calMonth = [d.getFullYear(), d.getMonth()];
  }
  const [y, m] = ui.calMonth;
  const cells = L.monthGrid(y, m);
  const byDate = {};
  for (const e of data.schedule) (byDate[e.date] ||= { entries: [], sessions: [] }).entries.push(e);
  for (const s of data.sessions) if (s.finishedAt) (byDate[s.date] ||= { entries: [], sessions: [] }).sessions.push(s);

  const shift = (d) => {
    const nd = new Date(y, m + d, 1);
    ui.calMonth = [nd.getFullYear(), nd.getMonth()];
    render();
  };

  const grid = h('div', { class: 'cal' },
    WD.map((w) => h('div', { class: 'wd' }, w)),
    cells.map((iso) => {
      const info = byDate[iso] || { entries: [], sessions: [] };
      const dots = [];
      const linked = new Set();
      for (const e of info.entries) {
        const done = sessionForEntry(e.id);
        if (done) linked.add(done.id);
        const color = progById(e.programmeId)?.color || 'var(--accent)';
        const cls = done ? 'filled' : iso < today ? 'missed' : '';
        dots.push(h('span', { class: `dot ${cls}`, style: `color:${color}` }));
      }
      for (const s of info.sessions) {
        if (s.scheduleId && data.schedule.some((e) => e.id === s.scheduleId && e.date === iso)) continue;
        dots.push(h('span', { class: 'dot filled', style: `color:${progById(s.programmeId)?.color || 'var(--muted)'}` }));
      }
      const d = L.parseISO(iso);
      return h('button', {
        class: `day ${d.getMonth() !== m ? 'other' : ''} ${iso === today ? 'today' : ''} ${iso === ui.calSelected ? 'sel' : ''}`,
        onclick: () => { ui.calSelected = iso; if (d.getMonth() !== m) ui.calMonth = [d.getFullYear(), d.getMonth()]; render(); },
        'aria-label': fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }),
      }, d.getDate(), h('span', { class: 'dots' }, dots.slice(0, 3)));
    }));

  const sel = ui.calSelected;
  const info = byDate[sel] || { entries: [], sessions: [] };
  const linkedSessionIds = new Set(info.entries.map((e) => sessionForEntry(e.id)?.id).filter(Boolean));
  const extraSessions = info.sessions.filter((s) => !linkedSessionIds.has(s.id));

  const detail = h('div', { class: 'card' },
    h('div', { class: 'row spread' },
      h('h3', {}, fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('button', { class: 'btn ghost sm', onclick: () => addToDateSheet(sel) }, '+ Add')),
    !info.entries.length && !extraSessions.length ? h('div', { class: 'small muted', style: 'padding:8px 0' }, 'Nothing planned.') : null,
    h('div', {},
      info.entries.map((e) => {
        const prog = progById(e.programmeId);
        const done = sessionForEntry(e.id);
        const status = done ? h('span', { class: 'status done' }, '✓ Done') : sel < today ? h('span', { class: 'status missed' }, 'Missed') : sel === today ? h('span', { class: 'status' }, 'Today') : null;
        return h('div', { class: 'list-item' },
          h('div', { class: 'swatch', style: `background:${prog?.color || 'var(--accent)'}` }),
          h('div', { class: 'grow' }, h('div', {}, entryLabel(e)), h('div', { class: 'small muted' }, prog?.name || 'Deleted programme')),
          status,
          h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: () => entryMenu(e, done) }, '⋯'));
      }),
      extraSessions.map((s) => h('button', { class: 'list-item', onclick: () => (location.hash = `#/workout/${s.id}`) },
        h('div', { class: 'swatch', style: `background:${progById(s.programmeId)?.color || 'var(--muted)'}` }),
        h('div', { class: 'grow' }, h('div', {}, s.name), h('div', { class: 'small muted' }, `${s.exercises.length} exercises · ${L.fmtNum(Math.round(L.sessionVolume(s)))} ${unit()}`)),
        h('span', { class: 'status done' }, '✓ Logged')))));

  return h('div', {},
    topbar('Calendar', { action: h('button', { class: 'btn primary sm', onclick: () => scheduleSheet() }, 'Schedule') }),
    h('div', { class: 'card' },
      h('div', { class: 'cal-head' },
        h('button', { class: 'icon-btn', onclick: () => shift(-1), 'aria-label': 'Previous month' }, '‹'),
        h('h2', {}, `${MONTHS[m]} ${y}`),
        h('button', { class: 'icon-btn', onclick: () => shift(1), 'aria-label': 'Next month' }, '›')),
      grid,
      h('div', { class: 'legend' },
        h('span', {}, h('span', { class: 'dot', style: 'color:var(--text-2)' }), 'Planned'),
        h('span', {}, h('span', { class: 'dot filled', style: 'color:var(--text-2)' }), 'Done'),
        h('span', {}, h('span', { class: 'dot missed', style: 'color:var(--text-2)' }), 'Missed'),
        (sel !== today || m !== new Date().getMonth()) ? h('button', { class: 'btn ghost sm', style: 'margin-left:auto', onclick: () => { ui.calSelected = today; ui.calMonth = null; render(); } }, 'Today') : null)),
    detail);
}

function entryMenu(e, done) {
  const moveInput = h('input', { class: 'input', type: 'date', value: e.date });
  openSheet(entryLabel(e),
    h('div', { class: 'small muted', style: 'margin:-6px 0 12px' }, `${progById(e.programmeId)?.name || ''} · ${fmtDate(e.date)}`),
    done
      ? h('button', { class: 'btn block', onclick: () => { closeSheet(); location.hash = `#/workout/${done.id}`; } }, 'View / edit log')
      : h('button', { class: 'btn primary block big', onclick: () => startWorkout({ programmeId: e.programmeId, dayId: e.dayId, scheduleId: e.id }) }, 'Start this workout now'),
    h('div', { class: 'section-title' }, 'Move to another day'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, moveInput),
      h('button', { class: 'btn', onclick: () => { if (moveInput.value) { e.date = moveInput.value; ui.calSelected = e.date; ui.calMonth = null; closeSheet(); commit(); toast('Moved'); } } }, 'Move')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => {
        // Push this and every later workout of the same programme back one day.
        data.schedule.filter((x) => x.programmeId === e.programmeId && x.date >= e.date && !sessionForEntry(x.id)).forEach((x) => (x.date = L.addDays(x.date, 1)));
        ui.calSelected = e.date; closeSheet(); commit(); toast('Pushed back a day');
      } }, 'Push this + later back 1 day')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn danger', onclick: () => { data.schedule = data.schedule.filter((x) => x.id !== e.id); closeSheet(); commit(); } }, 'Remove from calendar')));
}

function addToDateSheet(date) {
  if (!data.programmes.length) { toast('Create a programme first'); location.hash = '#/programmes'; return; }
  openSheet(`Add to ${fmtDate(date)}`,
    data.programmes.map((p) => [
      h('div', { class: 'section-title' }, p.name),
      h('div', { class: 'card', style: 'padding:0 14px' }, p.days.map((d) => h('button', { class: 'list-item', onclick: () => {
        data.schedule.push({ id: L.uid(), date, programmeId: p.id, dayId: d.id });
        closeSheet(); commit();
      } }, h('div', { class: 'swatch', style: `background:${p.color}` }), h('span', { class: 'grow' }, d.name), h('span', { class: 'chev' }, '+')))),
    ]),
    h('div', { class: 'section-title' }, 'Or lay out a whole programme'),
    h('button', { class: 'btn block', onclick: () => scheduleSheet(null, date) }, 'Schedule a programme from this date'));
}

const defaultWeekdays = (n) => ({ 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] }[Math.min(6, n)] || [0, 2, 4]);

function scheduleSheet(programmeId, startDate) {
  if (!data.programmes.length) { toast('Create a programme first'); location.hash = '#/programmes'; return; }
  const st = {
    pid: programmeId || data.programmes[0].id,
    start: startDate || L.todayISO(),
    weekdays: null,
    weeks: 8,
    replace: true,
  };
  st.weekdays = defaultWeekdays(progById(st.pid).days.length);

  const draw = () => {
    const prog = progById(st.pid);
    const preview = L.generateSchedule({ programme: prog, startDate: st.start, weekdays: st.weekdays, weeks: st.weeks });
    const existingFuture = data.schedule.filter((e) => e.programmeId === st.pid && e.date >= st.start && !sessionForEntry(e.id)).length;
    const firstWeek = preview.filter((e) => e.date < L.addDays(st.start, 7));
    openSheet('Schedule programme',
      field('Programme', h('select', { class: 'input', onchange: (e) => { st.pid = e.target.value; st.weekdays = defaultWeekdays(progById(st.pid).days.length); draw(); } },
        data.programmes.map((p) => h('option', { value: p.id, selected: p.id === st.pid }, `${p.name} (${p.days.length} days)`)))),
      field('Start date', h('input', { class: 'input', type: 'date', value: st.start, onchange: (e) => { if (e.target.value) { st.start = e.target.value; draw(); } } })),
      field('Train on', h('div', { class: 'days-pick' }, WD.map((w, i) => h('button', {
        type: 'button', class: st.weekdays.includes(i) ? 'on' : '', 'aria-pressed': st.weekdays.includes(i) ? 'true' : 'false',
        onclick: () => { st.weekdays = st.weekdays.includes(i) ? st.weekdays.filter((x) => x !== i) : [...st.weekdays, i].sort(); draw(); },
      }, w)))),
      field('For how many weeks', stepper(st.weeks, { step: 1, min: 1, onChange: (v) => { st.weeks = v || 1; } })),
      existingFuture ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.replace, onchange: (e) => (st.replace = e.target.checked) }),
        h('span', { class: 'small' }, `Replace ${existingFuture} already-planned workout${existingFuture > 1 ? 's' : ''} of this programme from the start date`)) : null,
      firstWeek.length ? h('div', { class: 'card small' }, h('div', { class: 'muted', style: 'margin-bottom:4px' }, 'First week:'),
        firstWeek.map((e) => h('div', {}, `${fmtDate(e.date)}: ${dayOf(e.programmeId, e.dayId)?.name}`))) : null,
      !prog.days.length ? h('div', { class: 'hint' }, 'This programme has no days yet.') : null,
      h('button', {
        class: 'btn primary block big', disabled: !preview.length,
        onclick: () => {
          const fresh = L.generateSchedule({ programme: prog, startDate: st.start, weekdays: st.weekdays, weeks: st.weeks });
          if (st.replace) data.schedule = data.schedule.filter((e) => !(e.programmeId === st.pid && e.date >= st.start && !sessionForEntry(e.id)));
          data.schedule.push(...fresh);
          ui.calSelected = st.start; ui.calMonth = null;
          closeSheet();
          if (location.hash !== '#/calendar') location.hash = '#/calendar'; else commit();
          save(data);
          toast(`Added ${fresh.length} workouts`);
        },
      }, preview.length ? 'Add to calendar' : 'Pick at least one day'));
  };
  draw();
}

// =====================================================================
// Programmes
// =====================================================================
function viewProgrammes() {
  return h('div', {},
    topbar('Programmes', { action: h('button', { class: 'btn primary sm', onclick: newProgramme }, '+ New') }),
    !data.programmes.length ? h('div', { class: 'card empty' },
      h('div', { class: 'big' }, '🏋️'),
      h('p', {}, 'A programme is a set of workout days (e.g. Push / Pull / Legs). Each day lists exercises with target sets, reps and rest.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: newProgramme }, 'Create my own'),
        h('button', { class: 'btn', onclick: () => { const p = sampleProgramme(data.exercises); data.programmes.push(p); commit(false); location.hash = `#/programme/${p.id}`; } }, 'Use a sample'))) : null,
    data.programmes.map((p) => {
      const next = data.schedule.filter((e) => e.programmeId === p.id && e.date >= L.todayISO() && !sessionForEntry(e.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
      return h('button', { class: 'card list-item', style: 'border:1px solid var(--border);padding:14px', onclick: () => (location.hash = `#/programme/${p.id}`) },
        h('div', { class: 'swatch', style: `background:${p.color}` }),
        h('div', { class: 'grow' },
          h('h3', {}, p.name),
          h('div', { class: 'small muted ellipsis' }, `${p.days.length} day${p.days.length === 1 ? '' : 's'}: ${p.days.map((d) => d.name).join(', ')}`),
          h('div', { class: 'small muted' }, next ? `Next: ${fmtDate(next.date)}` : 'Not scheduled')),
        h('span', { class: 'chev' }, '›'));
    }));
}

function newProgramme() {
  const p = {
    id: L.uid(),
    name: 'New programme',
    color: COLORS[data.programmes.length % COLORS.length],
    days: [{ id: L.uid(), name: 'Day 1', exercises: [] }],
  };
  data.programmes.push(p);
  commit(false);
  location.hash = `#/programme/${p.id}`;
}

function viewProgrammeEdit(id) {
  const p = progById(id);
  if (!p) { location.hash = '#/programmes'; return h('div'); }

  const dayCard = (d, di) => h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('input', { class: 'input title-input grow', value: d.name, 'aria-label': 'Day name', oninput: (e) => { d.name = e.target.value; commit(false); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Day options', onclick: () => dayMenu(p, d, di) }, '⋯')),
    d.exercises.length ? h('div', {}, L.groupBlocks(d.exercises).map((b, bi, all) => {
      const rows = b.items.map(({ item: t, index: ti }) => h('button', { class: 'list-item', onclick: () => editTarget(p, d, ti) },
        h('span', { class: 'muted small', style: 'width:18px' }, ti + 1),
        h('div', { class: 'grow' }, h('div', {}, exName(t.exerciseId)), h('div', { class: 'small muted' }, targetText(t))),
        h('span', { class: 'chev' }, '›')));
      return b.group ? h('div', { class: 'superset compact' }, h('div', { class: 'superset-label' }, `Superset ${supersetLetter(all, bi)}`), rows) : rows;
    }))
      : h('div', { class: 'small muted', style: 'padding:6px 0' }, 'No exercises yet.'),
    h('button', { class: 'btn ghost sm', style: 'margin-top:4px', onclick: () => pickExercise((exId) => {
      d.exercises.push({ id: L.uid(), exerciseId: exId, sets: 3, repsMin: 8, repsMax: 12, rest: data.settings.defaultRest, increment: data.settings.increment, notes: '' });
      save(data);
      editTarget(p, d, d.exercises.length - 1);
      render();
    }) }, '+ Add exercise'));

  return h('div', {},
    topbar('Edit programme', { back: '#/programmes' }),
    h('div', { class: 'card' },
      field('Name', h('input', { class: 'input', value: p.name, oninput: (e) => { p.name = e.target.value; commit(false); } })),
      field('Colour (shown on calendar)', h('div', { class: 'colors' }, COLORS.map((c) => h('button', {
        type: 'button', class: c === p.color ? 'on' : '', style: `background:${c}`, 'aria-label': `Colour ${c}`,
        onclick: () => { p.color = c; commit(); },
      }))))),
    h('div', { class: 'section-title' }, 'Workout days'),
    p.days.map(dayCard),
    h('button', { class: 'btn block', onclick: () => { p.days.push({ id: L.uid(), name: `Day ${p.days.length + 1}`, exercises: [] }); commit(); } }, '+ Add day'),
    h('div', { class: 'section-title' }, 'Calendar'),
    h('button', { class: 'btn primary block big', onclick: () => scheduleSheet(p.id) }, '📅 Schedule on calendar'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => {
        const n = data.schedule.filter((e) => e.programmeId === p.id && e.date >= L.todayISO() && !sessionForEntry(e.id)).length;
        if (!n) return toast('Nothing planned from today on');
        if (confirm(`Remove ${n} upcoming planned workouts of this programme?`)) {
          data.schedule = data.schedule.filter((e) => !(e.programmeId === p.id && e.date >= L.todayISO() && !sessionForEntry(e.id)));
          commit(); toast('Removed from calendar');
        }
      } }, 'Clear upcoming')),
    h('div', { class: 'section-title' }, 'More'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = L.uid(); copy.name = `${p.name} (copy)`;
        copy.days.forEach((d) => { d.id = L.uid(); d.exercises.forEach((t) => (t.id = L.uid())); });
        data.programmes.push(copy); commit(false); location.hash = `#/programme/${copy.id}`; toast('Duplicated');
      } }, 'Duplicate'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Delete "${p.name}"? Its planned (not completed) calendar workouts are removed too. Logged workouts stay in your history.`)) return;
        data.programmes = data.programmes.filter((x) => x.id !== p.id);
        data.schedule = data.schedule.filter((e) => e.programmeId !== p.id || sessionForEntry(e.id));
        commit(false); location.hash = '#/programmes';
      } }, 'Delete programme')));
}

function dayMenu(p, d, di) {
  const move = (dir) => {
    const j = di + dir;
    if (j < 0 || j >= p.days.length) return;
    [p.days[di], p.days[j]] = [p.days[j], p.days[di]];
    closeSheet(); commit();
  };
  openSheet(d.name,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', disabled: di === 0, onclick: () => move(-1) }, '↑ Move up'),
      h('button', { class: 'btn', disabled: di === p.days.length - 1, onclick: () => move(1) }, '↓ Move down')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => {
        const copy = JSON.parse(JSON.stringify(d));
        copy.id = L.uid(); copy.name = `${d.name} (copy)`; copy.exercises.forEach((t) => (t.id = L.uid()));
        p.days.splice(di + 1, 0, copy); closeSheet(); commit();
      } }, 'Duplicate day'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Delete "${d.name}"? Planned calendar entries for it are removed too.`)) return;
        p.days.splice(di, 1);
        data.schedule = data.schedule.filter((e) => e.dayId !== d.id || sessionForEntry(e.id));
        closeSheet(); commit();
      } }, 'Delete day')));
}

function editTarget(p, d, ti) {
  const t = d.exercises[ti];
  const draft = { ...t };
  const restOpts = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  if (!restOpts.includes(draft.rest)) restOpts.push(draft.rest), restOpts.sort((a, b) => a - b);
  const move = (dir) => {
    const j = ti + dir;
    if (j < 0 || j >= d.exercises.length) return;
    [d.exercises[ti], d.exercises[j]] = [d.exercises[j], d.exercises[ti]];
    L.normalizeGroups(d.exercises);
    closeSheet(); commit();
  };
  openSheet(exName(t.exerciseId),
    h('div', { class: 'grid-2' },
      field('Sets', stepper(draft.sets, { min: 1, onChange: (v) => (draft.sets = v) })),
      field('Rest', h('select', { class: 'input', onchange: (e) => (draft.rest = Number(e.target.value)) },
        restOpts.map((r) => h('option', { value: r, selected: r === draft.rest }, fmtRest(r)))))),
    h('div', { class: 'grid-2' },
      field('Reps (min)', stepper(draft.repsMin, { min: 1, onChange: (v) => (draft.repsMin = v) })),
      field('Reps (max)', stepper(draft.repsMax, { min: 1, onChange: (v) => (draft.repsMax = v) }))),
    h('div', { class: 'small muted', style: 'margin:-4px 0 12px' }, 'When you hit the max reps on every set, the app suggests adding weight.'),
    field(`Weight increase (${unit()})`, stepper(draft.increment, { step: 0.5, min: 0, decimal: true, onChange: (v) => (draft.increment = v) })),
    field('Notes', h('input', { class: 'input', value: draft.notes || '', placeholder: 'Optional', oninput: (e) => (draft.notes = e.target.value) })),
    h('button', { class: 'btn primary block big', onclick: () => {
      if (draft.repsMax < draft.repsMin) draft.repsMax = draft.repsMin;
      Object.assign(t, draft); closeSheet(); commit();
    } }, 'Save'),
    supersetButtons(d.exercises, ti, () => { closeSheet(); commit(); }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', disabled: ti === 0, onclick: () => move(-1) }, '↑'),
      h('button', { class: 'btn', disabled: ti === d.exercises.length - 1, onclick: () => move(1) }, '↓'),
      h('button', { class: 'btn', onclick: () => pickExercise((id) => { t.exerciseId = id; closeSheet(); commit(); }) }, 'Swap'),
      h('button', { class: 'btn danger', onclick: () => { d.exercises.splice(ti, 1); L.normalizeGroups(d.exercises); closeSheet(); commit(); } }, 'Remove')));
}

// =====================================================================
// Progress
// =====================================================================
function viewProgress() {
  const done = data.sessions.filter((s) => s.finishedAt);
  const lastUsed = {};
  for (const s of done) for (const e of s.exercises) if (L.doneSets(e).length && (!lastUsed[e.exerciseId] || s.date > lastUsed[e.exerciseId])) lastUsed[e.exerciseId] = s.date;
  const exIds = Object.keys(lastUsed).filter(exById).sort((a, b) => lastUsed[b].localeCompare(lastUsed[a]));
  const today = L.todayISO();
  const monthStart = today.slice(0, 8) + '01';
  const monthCount = done.filter((s) => s.date >= monthStart).length;
  const total = done.length;
  // Adherence: last 28 days of schedule
  const from = L.addDays(today, -27);
  const planned = data.schedule.filter((e) => e.date >= from && e.date <= today);
  const hit = planned.filter((e) => sessionForEntry(e.id)).length;

  if (!exIds.length) {
    return h('div', {}, topbar('Progress'),
      h('div', { class: 'card empty' }, h('div', { class: 'big' }, '📈'), h('p', {}, 'Finish your first workout and your charts and personal records will show up here.')));
  }
  if (!ui.progressEx || !exIds.includes(ui.progressEx)) ui.progressEx = exIds[0];
  const hist = L.exerciseHistory(data.sessions, ui.progressEx);
  const prs = L.personalRecords(data.sessions, ui.progressEx);
  const metric = ui.progressMetric;
  const metricLabel = { e1rm: 'Estimated 1-rep max', topWeight: 'Heaviest set', volume: 'Volume (weight × reps)' }[metric];

  return h('div', {},
    topbar('Progress'),
    h('div', { class: 'tiles' },
      tile(String(monthCount), 'This month'),
      tile(String(total), 'All time'),
      tile(planned.length ? `${Math.round((hit / planned.length) * 100)}%` : '–', 'Plan hit (4 wk)')),
    h('div', { class: 'card' },
      h('select', { class: 'input', 'aria-label': 'Exercise', onchange: (e) => { ui.progressEx = e.target.value; render(); } },
        exIds.map((id) => h('option', { value: id, selected: id === ui.progressEx }, exName(id)))),
      h('div', { style: 'margin-top:10px' }, seg([['e1rm', 'Est. 1RM'], ['topWeight', 'Top set'], ['volume', 'Volume']], metric, (v) => { ui.progressMetric = v; render(); })),
      h('div', { class: 'small muted', style: 'margin-top:10px' }, `${metricLabel} (${unit()})`),
      lineChart(hist.map((p) => ({ x: p.date, y: metric === 'e1rm' ? L.roundTo(p.e1rm, 0.5) : p[metric], label: setsSummary(p.sets) })))),
    h('div', { class: 'section-title' }, 'Personal records'),
    h('div', { class: 'tiles' },
      tile(fmtW(L.roundTo(prs.e1rm.e1rm, 0.5)), `Est. 1RM · ${fmtDate(prs.e1rm.date, { day: 'numeric', month: 'short' })}`),
      tile(fmtW(prs.topWeight.topWeight), `Heaviest · ${fmtDate(prs.topWeight.date, { day: 'numeric', month: 'short' })}`),
      tile(L.fmtNum(Math.round(prs.volume.volume)), `Best volume · ${fmtDate(prs.volume.date, { day: 'numeric', month: 'short' })}`)),
    h('div', { class: 'section-title' }, 'History'),
    h('div', { class: 'card', style: 'padding:0 14px' }, hist.slice().reverse().slice(0, 20).map((p) =>
      h('button', { class: 'list-item', onclick: () => (location.hash = `#/workout/${p.sessionId}`) },
        h('div', { class: 'grow' },
          h('div', { class: 'small muted' }, fmtDate(p.date)),
          h('div', {}, setsSummary(p.sets))),
        p.e1rm === prs.e1rm.e1rm ? h('span', { class: 'pr-badge' }, 'PR') : null))));
}

function lineChart(points) {
  const wrap = h('div', { class: 'chart' });
  if (points.length < 2) {
    wrap.append(h('div', { class: 'small muted', style: 'padding:24px 0;text-align:center' },
      points.length ? `One session so far: ${L.fmtNum(points[0].y)} ${unit()}. Log another to see a trend.` : 'No data'));
    return wrap;
  }
  const W = 340, H = 190, padL = 36, padR = 10, padT = 12, padB = 24;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 5; hi += 5; }
  const span = hi - lo;
  lo = Math.max(0, lo - span * 0.1); hi = hi + span * 0.1;
  const t0 = L.parseISO(points[0].x).getTime(), t1 = L.parseISO(points[points.length - 1].x).getTime();
  const X = (iso) => padL + ((L.parseISO(iso).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const shortD = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart, ${points.length} sessions, from ${L.fmtNum(points[0].y)} to ${L.fmtNum(points[points.length - 1].y)}">
      ${ticks.map((v) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis-text" x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <text class="axis-text" x="${padL}" y="${H - 6}">${esc(shortD(points[0].x))}</text>
      <text class="axis-text" x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(shortD(points[points.length - 1].x))}</text>
      <path class="line" d="${path}"/>
      <line class="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
      ${points.map((p) => `<circle class="pt" cx="${X(p.x)}" cy="${Y(p.y)}" r="4"/>`).join('')}
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="tip" hidden></div>`;
  const svg = wrap.querySelector('svg');
  const tip = wrap.querySelector('.tip');
  const cross = wrap.querySelector('.cross');
  const pts = wrap.querySelectorAll('.pt');
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(X(p.x) - cx) < Math.abs(X(points[best].x) - cx)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x)); cross.setAttribute('visibility', 'visible');
    pts.forEach((c, i) => c.setAttribute('r', i === best ? 6 : 4));
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(L.fmtNum(p.y))} ${esc(unit())}</b> · ${esc(shortD(p.x))}<br><span style="opacity:.8">${esc(p.label)}</span>`;
    const px = (X(p.x) / W) * r.width;
    tip.style.left = `${Math.min(r.width - 80, Math.max(80, px))}px`;
    tip.style.top = `-${tip.offsetHeight + 4}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); pts.forEach((c) => c.setAttribute('r', 4)); };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  return wrap;
}

// =====================================================================
// Settings
// =====================================================================
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function viewSettings() {
  const s = data.settings;
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = validateImport(JSON.parse(await f.text()));
      if (!confirm(`Replace all current data with this backup (${obj.sessions.length} workouts, ${obj.programmes.length} programmes)?`)) return;
      data = obj; flush(data); render(); toast('Backup restored');
    } catch (err) { alert(`Import failed: ${err.message}`); }
    e.target.value = '';
  } });
  const lastBackup = s.lastBackup ? fmtDate(s.lastBackup.slice(0, 10)) : 'never';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  return h('div', {},
    topbar('Settings'),
    !isStandalone ? h('div', { class: 'card hero' },
      h('h3', {}, '📲 Install on your phone'),
      h('div', { class: 'small' },
        h('b', {}, 'iPhone: '), 'open in Safari, tap Share ', h('b', {}, '⬆'), ', then ', h('b', {}, 'Add to Home Screen'), '.', h('br'),
        h('b', {}, 'Android: '), 'Chrome menu ', h('b', {}, '⋮'), ', then ', h('b', {}, 'Install app'), '.', h('br'),
        'It then opens full-screen and works offline.')) : null,
    h('div', { class: 'card' },
      field('Units', seg([['kg', 'kg'], ['lb', 'lb']], s.unit, (v) => { s.unit = v; commit(); })),
      h('div', { class: 'small muted', style: 'margin:-6px 0 12px' }, 'Changes labels only; logged numbers are not converted.'),
      field('Default rest between sets', h('select', { class: 'input', onchange: (e) => { s.defaultRest = Number(e.target.value); commit(false); } },
        [30, 45, 60, 90, 120, 150, 180, 240, 300].map((r) => h('option', { value: r, selected: r === s.defaultRest }, fmtRest(r))))),
      field(`Default weight increase (${s.unit})`, stepper(s.increment, { step: 0.5, min: 0, decimal: true, onChange: (v) => { s.increment = v; commit(false); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.sound, onchange: (e) => { s.sound = e.target.checked; commit(false); } }), h('span', {}, 'Beep when rest is over (plus vibration on Android)'))),
    h('div', { class: 'section-title' }, 'Your data'),
    h('div', { class: 'card' },
      h('div', { class: 'small muted', style: 'margin-bottom:10px' },
        'Everything is stored on this device only. Export a backup now and then (last backup: ', lastBackup, ').'),
      h('div', { class: 'btn-row', style: 'margin-top:0' },
        h('button', { class: 'btn primary', onclick: () => {
          s.lastBackup = new Date().toISOString(); flush(data);
          download(`liftlog-backup-${L.todayISO()}.json`, JSON.stringify(data, null, 1), 'application/json');
          render();
        } }, 'Export backup'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import backup')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => download(`liftlog-sets-${L.todayISO()}.csv`, L.sessionsToCSV(data), 'text/csv') }, 'Export sets as CSV (for Sheets)')),
      fileInput),
    h('div', { class: 'section-title' }, 'Exercises'),
    h('div', { class: 'card' },
      h('div', { class: 'small muted', style: 'margin-bottom:10px' }, `${data.exercises.length} exercises in your library.`),
      h('button', { class: 'btn block', onclick: manageExercises }, 'Manage exercise library')),
    h('div', { class: 'section-title' }, 'Danger zone'),
    h('div', { class: 'card' },
      h('button', { class: 'btn danger block', onclick: () => {
        if (!confirm('Erase ALL programmes, schedule and workout history on this device?')) return;
        if (!confirm('Really erase everything? This cannot be undone.')) return;
        localStorage.clear(); data = load(); flush(data); location.hash = '#/today'; render();
      } }, 'Erase all data')),
    h('div', { class: 'small muted', style: 'text-align:center;margin:16px 0' }, 'Lift Log · works offline'));
}

function manageExercises() {
  const used = new Set();
  for (const p of data.programmes) for (const d of p.days) for (const t of d.exercises) used.add(t.exerciseId);
  for (const s of data.sessions) for (const e of s.exercises) used.add(e.exerciseId);
  const draw = () => openSheet('Exercise library',
    h('div', { class: 'small muted', style: 'margin:-6px 0 8px' }, 'Tap to rename. Exercises in use can’t be deleted.'),
    h('div', { class: 'card', style: 'padding:0 14px' }, data.exercises.slice().sort((a, b) => a.name.localeCompare(b.name)).map((e) =>
      h('div', { class: 'list-item' },
        h('button', { class: 'grow', style: 'background:none;border:0;text-align:left;padding:0;cursor:pointer', onclick: () => {
          const n = prompt('Exercise name', e.name);
          if (n && n.trim()) { e.name = n.trim(); save(data); draw(); }
        } }, h('div', {}, e.name), h('div', { class: 'small muted' }, e.group || 'Other')),
        used.has(e.id) ? h('span', { class: 'small muted' }, 'in use') : h('button', { class: 'icon-btn', 'aria-label': `Delete ${e.name}`, onclick: () => {
          data.exercises = data.exercises.filter((x) => x.id !== e.id); save(data); draw();
        } }, '🗑')))));
  draw();
}

// =====================================================================
// Router
// =====================================================================
const routes = [
  [/^#\/today$/, viewToday, 'today'],
  [/^#\/calendar$/, viewCalendar, 'calendar'],
  [/^#\/programmes$/, viewProgrammes, 'programmes'],
  [/^#\/programme\/(\w+)$/, viewProgrammeEdit, 'programmes'],
  [/^#\/workout\/(\w+)$/, viewWorkout, 'today'],
  [/^#\/progress$/, viewProgress, 'progress'],
  [/^#\/settings$/, viewSettings, 'settings'],
];
let lastHash = null;
let afterNav = null; // run once after the next navigation (e.g. open a sheet on the new page)

function render() {
  const hash = location.hash || '#/today';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.hash = '#/today'; return; }
  const [re, view, tab] = route;
  const args = hash.match(re).slice(1);
  const sameView = hash === lastHash;
  const y = window.scrollY;
  $app.replaceChildren(view(...args));
  if (sameView) window.scrollTo(0, y); else window.scrollTo(0, 0);
  lastHash = hash;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  tick();
  syncWakeLock();
  if (afterNav) { const f = afterNav; afterNav = null; f(); }
}

window.addEventListener('hashchange', () => { closeSheet(); render(); });
window.addEventListener('pagehide', () => flush(data));

if (!location.hash) {
  const act = activeSession();
  location.hash = act ? `#/workout/${act.id}` : '#/today';
}
requestPersistence();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
