# Habit & Task Tracker — Spec

Status: **r5 — v1.3 sync** (2026-10-04): optional sign-in that keeps every device in step through your own Supabase project. Built on r4 (v1.2 Planner, Habits, Review; 1.2.1 habit delete warning). Release `1.3.0`, data schema v3 (unchanged), IndexedDB v4, shipped as the side-by-side **beta**. r3 (v1.1 skills) was signed off 2026-10-01.

## 1. Scope

A Reminders-style PWA for one user on an iPhone Home Screen. Core loop: add items, check them off, earn XP, level up **skills** and an overall level, unlock achievements. **Lists** organize items (by day, place, task type); lists named after days are **day lists** that fill with your habits on their own. The **Planner** shows lists as widget-style tiles, the **Habits** page shows every habit with this week at a glance, and the **Review** page holds a yearly Annual Review and a mid-year Integrity Report (James Clear's formats) with the numbers filled in from your data. AI capture (photo, or JSON pasted from any Claude chat) is a secondary input path. Works offline with everything on the device; **optional sign-in (1.3)** syncs lists, items, history, skills, achievements, reviews and shared settings through the owner's Supabase project, so the same data is on the iPhone, a Mac and a Windows PC. The Anthropic API key and backups stay per device.

Out of scope: notifications, Home Screen widgets (native app later — WidgetKit + App Intents), due times, drag-to-reorder, real-time push between devices (sync runs on open, on change and every minute while open), sign-up from the app (accounts are made in the Supabase dashboard), password reset in the app, Claude pushing items in without a paste step, Siri/Shortcuts, items boosting more than one skill, a PDF export of reviews (Markdown text instead).

## 2. Files and architecture

| File | Role |
|---|---|
| `index.html` | All UI, storage, and AI code inline (CSS + JS). Single-page, hash-routed. `CHANNEL` (`'stable'` / `'beta'`) picks the database name, title and badge. |
| `game.js` | Pure rules: XP, levels, day keys, weeks, streaks, completion planning (incl. late check-offs), day lists and habit projection, skill inference, achievements, quick entry, year-in-numbers stats and review Markdown, AI request/response contracts, migration, backup validation. No DOM, no storage, no `Date.now()`. Shared by `index.html`, `tests.html`, and the future native port. |
| `config.js` | Sync setup: the Supabase Project URL and publishable key (blank = sync off). Both are safe to publish; the secret key never goes here. |
| `supabase/setup.sql` | Run once in the Supabase SQL Editor: the `records` table, Row Level Security, and the `push_records` function. Safe to re-run. |
| `sw.js` | Service worker: precache, network-first for `index.html`/`game.js`/`config.js` (config skips the HTTP cache), cache-first for the rest; never touches other origins. `CACHE_PREFIX` + version; it only deletes its own old caches. |
| `manifest.webmanifest`, `icons/` | Home Screen install (beta: "Habits β", orange icon with a β badge). |
| `tests.html` | Unit tests for `game.js` (135). |
| `README.md` | Deploy, beta side-by-side setup and promotion, API key + spend limit, backup/restore, release checklist. |

Layers in `index.html`: `DB` (IndexedDB) → `persist` (every write; stamps changes for sync) → actions (create/complete/merge/reassign, call `Game.*`, persist) → views (render per route) → `Boost` (completion celebration) → `SkillAI` (background Claude skill check) → capture (photo/paste) → review (stats, answers, share) → `Sync` (sign-in, push/pull, first-sign-in choices).

Routes: `#/` start page (Planner when on, else Lists) · `#/planner` · `#/lists` · `#/habits` · `#/skills` · `#/review` · `#/skill/<id>` · `#/list/today|scheduled|all|completed` · `#/list/<listId>` · `#/achievements` · `#/settings`. A hidden page's route falls back to the start page. Back buttons return to the tab you came from. Sheets are overlays; Back closes them.

## 3. Data model (schema v3)

```ts
List   { id, name, color, icon, sortOrder, createdAt,
         days: number[] | null,          // weekdays it stands for (0 Sun … 6 Sat); null = ordinary list
         showOnPlanner: boolean }         // IDB store + JSON key "categories" (v1 name, kept)
Skill  { id, name, icon, color, hint, sortOrder, createdAt }

Item {
  id, text, notes, type: 'task'|'habit', categoryId /* list; null allowed for habits */, tier: 1..5, parentId|null,
  skillId, skillSource: 'user'|'ai'|'auto'|null, aiCheckedAt,
  due, repeat: { kind: 'daily'|'weekly'|'custom', days }, timesPerDay, sortOrder, createdAt
}

Completion { id, itemId, categoryId, skillId|null, kind: 'task'|'habit'|'subtask',
             dayKey /* the day it counts for */, at /* when you logged it */, tier, xp, text }

Achievement { …as v1.1 }

Review { id: 'annual-2026' | 'integrity-2026', kind: 'annual'|'integrity', year,
         answers: { wentWell, notWell, workingToward } | { living, higher, values: { [valueId]: text } },
         completedAt, updatedAt }

Settings { id:'settings', dayStartHour: 4, defaultCategoryId, model, aiSkillCheck, lastBackupAt, firstLaunchAt, onboarded,
           pages: { planner, habits, review },            // Lists and Skills are always on
           coreValues: [{ id, name, questions, skillIds }],
           reviewDismissed: { [reviewId]: true }, plannerSetupDismissed?, schemaVersion: 3 }
Secret   { id:'anthropicKey', value }     // separate store; never exported, never synced
         { id:'syncState', deviceId, userId, email, url, cursor, initialized, lastSyncAt, lost }   // this device's sync state
         { id:'syncSession', access_token, refresh_token, expires_at, user: { id, email } }        // never exported
SyncMeta { id: 'store:recordId', u /* edit time, ms */, d /* 1 = waiting to upload */, x /* 1 = deleted */, v /* device */, p /* 1 = set aside */ }
```

IndexedDB `habit-tracker` v4 (beta: `habit-tracker-beta`): stores `categories`, `skills`, `items`, `completions`, `achievements`, `settings`, `secrets`, `reviews`, `syncmeta` (v4). Derived, never stored: XP totals, levels, streaks, done states, which habits appear in which day list.

Cloud (Supabase, `supabase/setup.sql`): one table `records (user_id, store, id, data jsonb, deleted, updated_at bigint ms, device, schema_version, seq, synced_at)`, primary key `(user_id, store, id)`; a trigger sets `seq` (from a sequence) and `synced_at` on every write. Row Level Security: signed-in users select/insert/update only their own rows; no delete grant (deletes are markers); nothing for signed-out requests. `push_records(p_rows jsonb) → { saved, refused[] }` upserts a batch where the incoming edit is newer (ties: higher device id) and the incoming app version isn't older than the stored one; `refused` holds the cloud's copy of each row it kept. Deleting the user deletes its rows (`on delete cascade`).

Fresh install seeds one list (**Reminders**), ten skills (💪 Strength · 🤸 Dexterity · 🏃 Endurance · ❤️ Vitality · 🧘 Clarity · 📚 Learning · 💼 Career · 💵 Wealth · 🗣️ Social · 🏠 Upkeep) and the seed achievements.

## 4. Rules (`game.js`)

### 4.1 Config

```js
XP_BY_TIER = {1:10, 2:25, 3:50, 4:100, 5:200}; DEFAULT_TIER = 2
LEVEL_BASE = 100, LEVEL_EXP = 1.3          // xpForLevel(L) = round(100 · L^1.3), no cap
TIER_LADDER = [10, 25, 50, 100, 250, 500, 1000]  // then doubling
DAY_START_HOUR = 4
WEEK_START = 1                              // weeks run Monday → Sunday
```

### 4.2 XP, levels, skills, completing

As v1.1: every completion adds XP to the overall level and its skill; habits up to `timesPerDay` per logical day; sub-task cascades; skill picked by keyword guess then Claude; history follows the skill.

### 4.3 Weeks and late check-offs

`weekStartKey`, `weekDates` (Mon → Sun), `dateInWeek(key, weekday)`. `planComplete(state, id, now, { date })` logs a **habit** for an earlier day this week: the completion's `dayKey` is that date (so it counts for that day's streak and XP), `at` is when you logged it, and the result says `late: true`. Upcoming days are blocked (`blocked: 'future'`), and so is anything before this week's Monday (`'past'`). `planUncomplete(…, { date })` removes that day's latest check-in. Tasks ignore the date: done is done.

### 4.4 Day lists

A list stands for weekdays when its `days` is set. On creation, rename (until you pick days yourself) and migration, `detectListDays(name)` reads them from the name: day names and abbreviations (Mon, Tues, Thurs…), combos (`Sat + Sun`, `Saturday & Sunday`, `Sat/Sun`), `Weekend`, `Weekdays`, ranges (`Mon-Fri`, `Fri to Mon`). Every word must be a day or a connector, so "Sunday dinner ideas" stays an ordinary list. The list editor shows the days as chips.

`dayListInstances(list, items, today)`: every top-level habit scheduled on one of the list's weekdays appears once per such weekday, dated in the current week, sorted by day (Monday first) then habit order. A daily habit appears in Monday … Sunday; **Sat + Sun shows it twice, labeled Saturday and Sunday**. Appearances are the habit itself — one item, one streak, one XP history. Habits whose home list is a day list appear through their schedule; one whose schedule misses all of that list's days (e.g. a v1.1 `^weekly` made on another weekday) still shows there as an ordinary row for today, so nothing seems to vanish. The list's tasks follow the habit rows. Renaming a list re-reads its days unless you picked days that differ from what the old name implied. Appearance states: past (checkable late, "Log late"), today, future (locked).

`Today` includes tasks due today or earlier **and** undated tasks in today's day list(s).

### 4.5 Duplicate habits

`duplicateHabitGroups(items)`: top-level habits with the same normalized name. `planMergeHabits` keeps the oldest: schedule = union of days (all 7 → daily), times per day = max (1 if it has sub-tasks), skill = your own pick if any, else the kept habit's; all completions, sub-tasks and item-scoped achievements move to it. Overall XP is unchanged. The Planner and Habits page show a "set up N times — Merge into one" card.

### 4.6 Skills: prayer

Clarity's built-in keywords add pray/prayer (weight 2), devotional, worship, church, bible, bible study, scripture, sermon, faith, rosary, quran, salah, sabbath, spiritual. Clarity's seed hint becomes "journaling, meditation, prayer, …" (migration updates it only if you never edited it). Claude's skill prompt maps prayer to clarity-type skills.

### 4.7 Reviews

`yearStats(state, year, today)`: check-ins (habit/task/sub-task split), active days, XP earned, overall level start → end, check-ins and XP by month, best month, quietest finished month, top 5 habits by check-ins, top 3 streaks inside the year, XP per skill with level change, achievements unlocked. `reviewMarkdown('annual'|'integrity', …)` renders James Clear's formats: Annual Review = year in numbers + "What went well this year? / What didn't go so well this year? / What am I working toward?"; Integrity Report = "What are the core values that drive my life and work?" (values + self-check questions), "How am I living and working with integrity right now?" (per value: notes + evidence = this year's XP in the value's linked skills; plus overall), "How can I set a higher standard in the future?". `reviewDue(today)`: Annual Review in December (and January for the year just ended), Integrity Report in June–July, unless completed or dismissed.

### 4.8 Pages and onboarding

`enabledPages(settings)` → tab order Planner | Lists | Habits | Skills | Review; Planner, Habits, Review can be turned off (hidden only). `startPage` = Planner if on, else Lists. `habitSuggestions(skills)`: daily habits grouped by the skill they boost (each suggestion's keyword guess matches its group — tested).

### 4.9 Migration v2 → v3 (and v1 → v3)

On first launch of 1.2 (or importing an older backup): lists get `days` from their names and `showOnPlanner: true`; settings get `pages` (all on), `coreValues: []`, `reviewDismissed: {}`; the Clarity hint gains prayer if untouched; an empty `reviews` store is added. Items, completions and XP are unchanged. v1 data runs the v1 → v2 skill upgrade first. One toast announces the new tabs ("Your N day lists now fill with your habits"). Upgrades are each device's own business: they're never sent to sync (1.3).

### 4.10 Sync rules (1.3)

- `SYNC_STORES`: categories, items, completions, achievements, skills, reviews, settings. Settings sync as one record holding only `SYNCED_SETTINGS` (day start hour, default list, model, Claude-checks-skills, pages, core values, dismissed reviews, Planner setup dismissed) — never the API key, backup date, first launch or onboarding flag.
- `syncStamp(prev, now) = max(now, prev + 1)`: an edit always beats the version this device last saw, even on a slow clock. `syncNewer(a, b)`: newer `u` wins; equal `u` → higher device id (same rule as the server).
- `normalizeRecord(store, data, id)`: the per-record normalizers that loading a backup uses; the row's id wins; unusable rows → null (skipped). `normalizeSyncedSettings` keeps only known, valid fields; skill links in values are kept even if the skill hasn't arrived yet.
- `cleanForSync`: lone UTF-16 surrogates → U+FFFD, `\u0000` removed, non-finite numbers → null (Postgres refuses them in JSON).
- `syncConfig(config.js)`: off when blank; refuses a secret key (`sb_secret_…` or a legacy `service_role` JWT) and non-https URLs (localhost allowed).
- First sign-in on a device, `firstSyncPlan(cloudHasData, hasUserData(device))`: empty account → **upload** this device; empty device (starter data only) → **download** the account; both → **choose**: use the account's data (replace this device), **merge** (`mergePlan`: the account wins records both have, except a review edited more recently here; this device's other records are added; its starter achievements and their later tiers are dropped when the account has them; core values from both via `mergeCoreValues`), or cancel. Signing in as a **different account** than the device last synced asks before replacing this device's data with that account's; nothing is copied across accounts.
- Achievement tiers created by `checkAchievements` get ids from their series (`<seriesId>-t<tier>`) and are created once per series and tier, so two devices that reach a tier before syncing make the same record.

## 5. Screens

1. **Install gate** — as before; names "Habits β" in the beta.
2. **Onboarding** — welcome (Get started / Restore from a backup) → **"What daily habits make you better?"**: suggestion chips grouped by skill, "Add your own", "Add N habits" or "Skip for now". Picks become daily habits with no list.
3. **Tab bar** — Planner | Lists | Habits | Skills | Review (enabled pages only).
4. **Planner** — "This week · Sep 28 – Oct 4"; 2-column tiles: list name in its color, date(s) for day lists ("Today", "Sep 28", "Oct 3 – 4"), open count, up to 3 open rows with round checkboxes (multi-day lists label the day; counts like `0/8`), "+N more", "All Completed"/"No Reminders", a + per tile (quick add to that list). Today's day list has a ring in its color. Day lists come first (Monday → Sunday), then the rest in list order. **Edit** picks which lists get a tile. With no day lists, a card offers "Mon–Fri + Sat & Sun" or "Mon–Sun". **New Reminder** at the bottom.
5. **Lists** — as v1.1 plus day-list labels ("Monday · today"), counts that include habit appearances, and **New Reminder**.
6. **List view** — day lists show the date(s) and what checking off means ("Checking off counts for Monday", "Habits open on Saturday"); habit rows for each day (locked upcoming rows, "Log late" on missed earlier days). Every row swipes to Delete: tasks and sub-tasks delete straight away with Undo; a **habit** (any of its rows, or Delete Habit in its details) first shows a warning — it disappears from every day list, the Planner and the Habits page, its streak is lost, past XP stays — and only **Delete Habit** confirms (Keep Habit backs out; Undo still follows). New Item row as before (`^weekly` in a day list means that list's day).
7. **New Reminder** sheet — title (tokens + live hint), notes, list, due (None/Today/Tomorrow/Pick), "Scan a note card instead". Return adds and keeps the sheet open.
8. **Habits** — every habit: today's checkbox, schedule, 🔥 streak, skill chip, list, and a Monday → Sunday strip (done, partial count, today ring, dashed upcoming, dot = not scheduled). Tapping an earlier scheduled day logs it late. **New Habit** (✚) asks Daily / Weekly / Specific days first, then times per day, Boosts (auto from the name, or your pick), optional list, difficulty. ✨ opens suggestions. Merge card for duplicates.
9. **Skills / skill view / achievements** — as v1.1.
10. **Review** — year switcher, Annual Review | Integrity Report. Annual: KPI tiles (check-ins, XP + level change, habit check-ins, achievements), check-ins-by-month column chart (best month in the accent, others gray, value on the best column, tap/hover tooltip, "Show as table"), top habits, longest streaks, skills ranked by XP gained (bars, values at the tips), achievements, then the three questions with data-driven prompts. Integrity: core values (add from ideas: Growth, Health, Faith, Family, Craft, Generosity, Courage, or your own; link skills for evidence), per-value notes, overall, higher standard. Answers autosave; Mark complete; Share as text (share sheet, else a `.md` download).
11. **Due banner** — on the start page when a review is due; tap to open, ✕ to dismiss for that review.
12. **Item detail** — habits: List can be None; Monday-first day chips; this week's strip under the stats.
13. **List editor** — "This list is for" day chips (auto from the name) and **Show on Planner**.
14. **Settings** — **Sync** (off until config.js is filled in; Sign in to sync…; when signed in: account, status like "Synced 2 min ago · 1 change waiting · 1 item couldn't sync", Sync now, Sign out…), General (note on weeks), **Pages** toggles (Lists/Skills always on), Backup, AI, About (version + "beta").
15. **Completion celebration** — as v1.1; a late check-off says "Logged for Monday".
16. **Sync sheets** (1.3) — Sign In (email + password, autofill-friendly; errors in place: wrong password, unconfirmed email, rate limit, wrong key, not set up); **Both Have Data** (Use My Account's Data / Merge This Device In / Cancel and Sign Out); **Different Account** (Replace This Device's Data / Cancel and Sign Out, with the count of changes that never synced); **Sign Out** (Sign Out — keep this device's copy / Sign Out and Erase This Device). The welcome screen offers **Sign in to sync** next to Get started. Start-page banners: "Sync is paused" (session ended → Sign in) and "Update to keep syncing" (another device runs a newer version → Reload).
17. **Computers** — on screens 760 px and wider the app is a centered 720 px column (sheets 640 px), not stretched edge to edge.

## 6. Storage, backup, offline, install

IDB v4 adds `syncmeta` (v3 added `reviews`). Backups are schema 3 and include `reviews` (settings carry pages and core values); schemas 1–2 import and upgrade; backups never include the API key, the sync session or sync bookkeeping. Deleting a list deletes its tasks; its habits stay with no list. Release `1.3.0` / cache `habits-v1.3.0`; each worker deletes only caches with its own prefix.

**Sync (1.3).** Offline-first: IndexedDB stays the working copy. Every write goes through `persist()`; while the device is linked to an account, each changed record is stamped and queued in `syncmeta` in the same transaction (deletes become markers; a cleared store marks everything it held). `Sync.run()` pushes waiting records (batches of 400 via `push_records`; refused rows come back and are applied), then pulls rows whose `synced_at` ≥ last pull − 2 minutes, paged 1,000 at a time by `seq`, applying each only if it's newer than this device's copy. It runs on launch, after changes (0.8 s), when the app comes back to the foreground or online, every minute while open, and right away (keepalive) when the app goes to the background. Failures back off (5 s → 5 min); offline shows "Offline · N changes waiting". Requests time out after 30 s. A pull still runs when a push fails. A batch the cloud refuses (4xx) is split until the record at fault is found and set aside ("1 item couldn't sync"; editing it retries); if even an empty batch fails, nothing is set aside. A row from a newer app version stops syncing (pull and push) until this device updates. Sign-in uses Supabase Auth's password grant; the access token refreshes a minute before it expires, one tab at a time (Web Locks), and only definite "session over" answers sign the device out (rate limits and odd replies retry). Sign out ends this device's session only (`scope=local`); "Sign Out and Erase" also wipes the device, and nothing in flight is written afterwards. Restoring a backup on a linked device replaces the account's data everywhere (it warns first, also when signed out). Erase all data signs out first; the account keeps its data. A session left from an unfinished first sign-in is dropped on launch. Changing the Supabase URL in config.js unlinks the device (sign in again and choose). Open edit sheets save only the fields you changed, so edits that synced in meanwhile stay; an open item sheet refreshes when its item changes elsewhere (unless you're typing in it).

**Beta channel.** The beta is the same code with `CHANNEL = 'beta'`: database `habit-tracker-beta`, title and Home Screen name "Habits β", a BETA badge, orange β icons, cache prefix `habits-beta-v`, backup files named `habit-tracker-beta-backup-…`. It's served from its own repo path (`/habit-app-beta/`), so its service worker scope never overlaps the live app's. Backups are interchangeable (same app id).

## 7. AI contracts

Unchanged from v1.1 (`record_items`, Paste from Claude, `assign_skills`); the skill prompt now names prayer under clarity-type skills.

## 8. Assumptions (r4 additions; earlier ones still hold unless replaced)

1. Weeks run Monday → Sunday (a constant, not a setting). Late check-offs reach back to this week's Monday only; on a Monday, last Sunday can't be logged.
2. Every habit appears in the day lists its schedule matches; there's no per-habit opt-out.
3. Habit appearances in a list containing several days are sorted by day, then habit order, each labeled with its day; tasks follow.
4. Unchecked appearances on earlier days stay open (counted) until the week ends, like unchecked Reminders.
5. Undated tasks in today's day list show in Today; tasks in earlier day lists don't carry over.
6. New habits from the New Habit sheet or onboarding have no list by default.
7. The Planner opens the app when it's on. Tile order: day lists Monday → Sunday, then other lists in list order.
8. Duplicate habits are merged only when you tap Merge; merging can't be undone (export a backup first if unsure). Records sharing an id (hand-edited backups) keep the first copy on load.
9. Reviews are stored per year and kind; answers are plain text; Share sends Markdown text. Core values are global (not per year); evidence is this year's XP in linked skills.
10. Review banners: Annual Dec–Jan, Integrity Jun–Jul, in-app only.
11. The beta and the live app share an origin; isolation relies on separate database names, cache prefixes and repo paths.
12. (1.3) Conflicts resolve per record, newest edit wins, by each device's clock (an edit always beats the version that device last saw). Two devices editing different fields of the same item at once: the later save wins the whole record.
13. (1.3) Checking off the same habit for the same day on two devices before they sync records two check-ins (uncheck one). Tiers and records with fixed ids don't double.
14. (1.3) One Supabase project; beta and live use the same `records` (the beta is the daily driver until 1.3 goes live). Accounts are created in the dashboard with sign-ups turned off; one account per person.
15. (1.3) Deleted records stay in the cloud as small markers so every device learns about the delete.

## 9. Decisions from review

v1.0 (2026-09-23): Completed tile = total completions; multi-check habits via `timesPerDay`; quick-entry tokens; captured tasks due today with a batch date control; multi-device capture via Paste from Claude.

v1.1 (2026-10-01): skills are standalone categories boosted by completing items, separate from lists; levels on their own tab; skill auto-decided (keyword guess, then Claude); check-off animation shows the skill's XP going up; tasks and habits both count; fresh install = one Reminders list + prebuilt skills.

v1.2 (2026-10-01/03, from testing): quick add from the main screen; keep Lists and add a Planner of widget-style tiles; widgets proper wait for the native app; a separate Habits page whose New Habit flow asks how it repeats; habits fill matching day lists (daily → every day; Sat + Sun shows two labeled rows); Planner, Habits and Review can be hidden, Lists and Skills can't; onboarding asks for the daily habits that make you better; prayer feeds **Clarity**; a checked-off earlier day this week **counts for that day** (upcoming days locked); in-app Review page for the Annual Review and Integrity Report; release as a side-by-side beta (separate repo, database, name, icon) until sign-off.

v1.2.1 (2026-10-04, from beta testing): habits can be swipe-deleted like tasks, but deleting one shows a warning (streak lost, removed from every day) and needs a second confirm.

v1.3 (2026-10-04): accounts + cloud sync on **Supabase** (Free plan while Virgil is the only user; Pro when others join), built into the beta now rather than after 1.2 sign-off; the beta becomes the daily app on every device. Sync is optional and offline-first; email + password sign-in with the account made in the dashboard and sign-ups off; the publishable key ships in config.js (public repo is fine); the API key stays per device. Computers get a centered layout.

## 10. Verification

`tests.html`: 135 unit tests green. Sync (1.3), against a local Supabase stand-in (Postgres 16 running `setup.sql` as a non-superuser owner with Supabase's roles and default grants, plus an Auth/REST gateway with Supabase's CORS, apikey check and JSON shapes): SQL behaviour (RLS isolation, newest-wins, version guard, markers, grants, cascade) 25/25; multi-device flows (upload, download, live edits both ways, conflicts, offline queue, deletes, token refresh/401 retry/lost session, sign out and back, merge, use account's data, cancel, import, newer-app guard, second account, sign out and erase, convergence) 49/49; service worker + offline launch, background push, 1.2.1 → 1.3 upgrade, a year of data (2,920 check-ins up in ~1.3 s, down in ~1.0 s locally), slow clock, shared settings, open review, duplicate merge 17/17; code-review findings (stale sheets, filtered 200 replies, half-finished sign-in, bad record isolation, pull while push fails, version guard, restore while signed out, account switch, refresh 429, timeouts, erase race, double tap, tier ids, merge of reviews/values) 31/31. Headless iPhone-viewport walkthroughs (light + dark): v1.2 smoke (onboarding picks → Planner → day lists → late check-off → locks → Sat + Sun labels → Habits strip → New Habit → quick add → Review → page toggles) 36/36; edges (Planner tile toggles, list delete keeps habits, week rollover, review due banners, Markdown export, year switcher, Review off) 17/17; real v1.1 data → v1.2 in place (day lists detected, duplicate Prayer merged, late logging repairs the streak, v1.1 backup import upgrades) 26/26; live v1.1 + beta on one origin (separate databases, caches and workers; backup import into the beta; live untouched) 15/15; code-review fixes (Edit List from the menu, rename → days, off-schedule habits stay in their list, Completed order) 9/9; habit delete warning (swipe in day and ordinary lists, details sheet, Keep/Delete/Undo, tasks unchanged) 17/17; v1.1 regression walkthroughs 40/40, 27/27, 11/11, 26/26, 52/52.
