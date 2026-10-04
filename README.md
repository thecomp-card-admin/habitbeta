# Habit & Task Tracker (v1.2)

Reminders-style tasks and habits with a light game layer. A **Planner** lays your lists out like Reminders widgets, day lists ("Monday", "Sat + Sun") fill with your habits on their own, every check-off boosts a **skill** (Strength, Clarity, Learning…), and a **Review** page holds your yearly Annual Review and Integrity Report with the numbers filled in. Plain HTML/CSS/JS, no build step, no server: everything lives in IndexedDB on the phone. See `SPEC.md` for the rules and data model.

```
index.html             app (UI, storage, AI) — all inline
game.js                pure rules + AI contracts (shared with tests and the future native app)
sw.js                  service worker: offline cache, network-first index.html/game.js
manifest.webmanifest   Home Screen install metadata
icons/                 180 / 192 / 512 / 512-maskable PNGs
tests.html             unit tests for game.js (open in a browser)
SPEC.md                spec
```

There are two builds of the same code: **habit-app** (the live app, blue icon, "Habits") and **habit-app-beta** (the test copy, orange β icon, "Habits β", its own data). Section 2 walks through testing the beta without touching your live data.

## 1. Deploy to GitHub Pages

1. Create a repo (public is fine — it never contains your key or data) and push the files to `main` at the repo root.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. After a minute, open `https://<you>.github.io/<repo>/` in Safari on the iPhone. All paths are relative, so a sub-path works.

Local preview: `python3 -m http.server 8000` in the folder, then `http://localhost:8000/`. Service workers need HTTPS or localhost.

## 2. Test the beta side by side (your live data stays untouched)

The beta has its own database, name, icon and offline cache, so it can't read or change the live app's data.

1. **New repo for the beta**, e.g. `habit-app-beta`. Upload the contents of `habit-app-beta.zip` to its root and enable Pages as in §1. Use a separate repo — not a `/beta` folder inside the live repo.
2. **Back up the live app**: open Habits → Settings → **Export backup…** → **Save to Files** (iCloud Drive).
3. **Install the beta**: open `https://<you>.github.io/habit-app-beta/` in Safari → Share → **Add to Home Screen**. It shows up as **Habits β** with an orange icon and a BETA badge.
4. **Load your data into the beta**: on its welcome screen tap **Restore from a backup** (or later: Settings → **Import backup…**) and pick the file from step 2. It's upgraded on the way in; the live app is not touched.
5. Keep logging day to day in the **live app** (it's the source of truth). Re-import a fresh backup into the beta whenever you want to test with current data — import replaces the beta's data.
6. **At sign-off**: export a backup from the live app, push the **stable 1.2 build** (`habit-app-v1.2-stable.zip`) to the live repo, and open the live app once with a connection — it upgrades in place, like 1.0 → 1.1. Then delete the Habits β icon (that deletes its data) and the beta repo.
   - If you ended up living in the beta instead: export from the beta, promote as above, then import that backup into the live app.

## 3. Install on the iPhone

1. Open the Pages URL in **Safari**.
2. **Share** → **Add to Home Screen** → **Add**. (The app shows these steps itself while it runs in a tab.)
3. Open it from the Home Screen → **Get started** → pick the daily habits that make you better (or **Skip for now**).

The Home Screen app has its own storage, separate from the Safari tab, so use only the installed app. Removing the icon deletes that storage — export a backup first.

**Updating from 1.1:** your data upgrades automatically. Lists named after days (Monday, Tues, Sat + Sun, Weekend, Mon-Fri) become day lists, and a toast confirms it. If the same habit was added to several day lists (say, Prayer), the Planner offers **Merge into one** so it has a single streak.

## 4. How it works

- **Planner** (the start page): one tile per list, day lists first (Monday → Sunday), today's tile ringed. Tap a circle to check off, a tile to open the list, **+** to add to that list, **Edit** to choose which lists get tiles. No day lists yet? The Planner offers to create Mon–Fri + Sat & Sun or Mon–Sun.
- **Day lists**: a habit shows up in every day list its schedule matches — a daily habit in Monday … Sunday; **Sat + Sun** shows it twice, labeled Saturday and Sunday. It's still one habit with one streak. Rename a list to a day, or pick its days in the list editor (list → **…** → Edit List → "This list is for"). A habit you kept in a day list that isn't scheduled for that day (say, weekly on Wednesday in Sat + Sun) still shows there as an ordinary row; change its days in the habit to move it.
- **Late check-offs**: checking off an earlier day this week (Monday's row on Wednesday, or Monday in a habit's week strip) counts for that day — streak and XP. Upcoming days stay locked until they arrive. Weeks run Monday → Sunday.
- **Habits** page: every habit with this week at a glance. **✚** asks how it repeats (daily, weekly, specific days) before anything else; **✨** suggests habits by skill.
- **New Reminder** (Planner and Lists): a quick sheet for a one-off task — title, notes, list, due date. Return adds it and keeps the sheet open for the next one.
- **Skills**: every item boosts one skill, picked for you (prayer/journaling → Clarity, lifting → Strength, stretching → Dexterity, reading → Learning), then double-checked by Claude if your API key is set. Change it under **Boosts** in the item; its past XP moves with it.
- **Review**: the Annual Review (December) and Integrity Report (June) in James Clear's formats. The year in numbers — check-ins by month, top habits, longest streaks, skills that grew — comes from your data; you answer the questions. Add core values with self-check questions and link skills as evidence. Answers save on the device and in backups; **Share** sends the report as text (Notes, Mail, Files). A banner reminds you when one is due.
- **Settings → Pages**: hide Planner, Habits or Review. Lists and Skills are always on. Hiding a page only hides it.

## 5. API key and spend limit (photo capture + skill checks)

1. [console.anthropic.com](https://console.anthropic.com) → **API Keys** → create a key for this app only.
2. Console → **Settings → Limits** (or Billing → Limits): set a **monthly spend limit**, e.g. $5. A card photo is a few thousand input tokens; a skill check is a few hundred tokens per batch of new items. Check current pricing in the Console; the limit is the backstop.
3. In the app: **Settings → AI → API key → Save**. Stored on-device only, sent only to `api.anthropic.com`, never exported; **Clear key** removes it. The beta has its own key slot — add it there too if you want AI in the beta.
4. **Model**: `claude-sonnet-5` (default) or `claude-haiku-4-5-20251001` (cheaper, plenty for skill checks). *Custom…* accepts any model ID.
5. **Claude checks skills** (on by default) sends only item titles and your skill list — never notes. Turn it off to keep typed items fully offline; the keyword guess still works.

Photo capture: camera button (Planner, Lists, a list's New Item row, or New Reminder → *Scan a note card instead*) → **Take Photo** → review → **Add N items**.

### Capture from another device or account (Paste from Claude)

Settings → AI → **Copy Claude prompt** (it includes your lists and skills), paste it into a Claude Project's instructions or a chat with the card photo, copy the JSON block Claude returns, then in the app tap camera → **Paste from Claude**. Re-copy the prompt after adding or renaming lists or skills.

## 6. Back up and restore

- **Settings → Backup → Export backup…** opens the share sheet → **Save to Files** → iCloud Drive (`habit-tracker-backup-YYYY-MM-DD.json`, schema 3, key excluded; the beta names its files `habit-tracker-beta-backup-…`). Desktop browsers download it.
- **Import backup…** replaces everything after a confirm. Older backups (1.0, 1.1) import and upgrade. A live-app backup imports into the beta any time; a beta backup imports into the live app once the live app is on 1.2 (1.1 safely refuses newer files).
- The start page nudges you when the last backup is older than 7 days. **Erase all data** wipes the device copy, key included.

## 7. Quick entry

| token | meaning |
|---|---|
| `!1` … `!5` | difficulty tier (10 / 25 / 50 / 100 / 200 XP) |
| `#monday` | list (name prefix) |
| `+clarity` | skill (name prefix, e.g. `+clar`) — otherwise it's picked for you |
| `@today` `@tomorrow` `@fri` `@10/3` `@2026-10-03` | due date |
| `^daily` `^weekly` `^mon,wed,fri` `^weekdays` `^weekends` | habit with that schedule (`^weekly` typed in a day list means that list's day) |
| `x8` | habit target of 8 check-ins a day (implies `^daily`) |

## 8. Releasing an update

1. Bump `APP_VERSION` in `index.html` **and** the version in `CACHE_VERSION` in `sw.js` together (currently `1.2.0` / `habits-v1.2.0`).
2. Run `tests.html` in a browser — all green.
3. Push to `main`. On the phone, opening the app with a connection loads the new code (network-first); an open app shows **Update ready — Reload**.
4. Beta builds differ from stable in exactly these lines: `CHANNEL = 'beta'` in `index.html`, the `<title>` and `apple-mobile-web-app-title` ("Habits β"), `CACHE_PREFIX = 'habits-beta-v'` in `sw.js`, the manifest `name`/`short_name`, and the orange icons.

## 9. Troubleshooting

- **A habit shows up several times in a day list**: it was added more than once. Use **Merge into one** on the Planner or Habits page.
- **Can't check off Friday's row**: upcoming days unlock on the day. Earlier days this week can be logged late; last week can't.
- **An item has no skill icon**: nothing matched the keyword guess yet. With a key set, Claude sorts it within seconds; otherwise pick one under **Boosts**.
- **The beta shows none of my data**: it has its own storage by design. Import a backup from the live app (§2).
- **Items vanished**: you're probably in the Safari tab instead of the Home Screen app (separate storage). Import the latest backup.
- **"The app is open in another tab"** after an update: close the other copy (e.g. a Safari tab) and reopen.
