# Lift Log

A simple, phone-first weight-training tracker. Build programmes, put them on a
calendar, and log sets with big tap targets instead of fighting a spreadsheet.

It is an installable web app (PWA). It works offline and keeps all data on your
device, with JSON backup and CSV export.

## Features

- **Programmes**: create as many as you like. Each has workout days (e.g. Upper A,
  Lower A …), and each day lists exercises with sets, rep range, rest and weight
  increment. Days and exercises can be reordered, duplicated or swapped. A sample
  Upper/Lower programme is included.
- **Calendar scheduling**: lay a programme onto chosen weekdays for N weeks. The
  app cycles through the days in order. You can move single workouts, push a whole
  programme back a day, add one-off workouts, and see planned, done and missed
  workouts at a glance.
- **Live workout logging**: each set is pre-filled from last time. Tap ✓ to log
  it. The previous session's numbers are shown alongside, and you can add, remove
  or swap exercises mid-workout. The screen stays awake.
- **Rest timer**: starts automatically when you tick a set, with −15 / +15 /
  skip. It beeps, and vibrates on Android.
- **Progression hints** (double progression): when you hit the top of the rep
  range on every set, the app suggests adding weight. Otherwise it suggests a rep
  target.
- **Progress**: estimated 1RM, top-set and volume charts for each exercise,
  personal records, PR badges when you finish a workout, and how much of your plan
  you have hit.
- **Your data**: JSON backup and restore, and CSV export of every set (opens in
  Google Sheets).

## Run locally

```bash
npm start          # serves on http://localhost:8080
npm test           # unit tests for scheduling / progression / stats
```

There is no build step and there are no dependencies: plain HTML, CSS and ES modules.

## Put it on your phone

1. Enable GitHub Pages for this repo (**Settings → Pages → Source: GitHub Actions**).
   The included workflow deploys on every push to `main`.
2. Open the Pages URL on your phone:
   - **iPhone**: in Safari, tap Share → **Add to Home Screen**
   - **Android**: in Chrome, tap ⋮ → **Install app**

Data lives in the browser's storage on that device. Use **Settings → Export
backup** now and then.
