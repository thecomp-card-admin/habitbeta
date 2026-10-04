# Habit & Task Tracker (v1.3)

Reminders-style tasks and habits with a light game layer. A **Planner** lays your lists out like Reminders widgets, day lists ("Monday", "Sat + Sun") fill with your habits on their own, every check-off boosts a **skill** (Strength, Clarity, Learning…), and a **Review** page holds your yearly Annual Review and Integrity Report with the numbers filled in. Plain HTML/CSS/JS, no build step. Everything works offline on the device; **sign in to sync** (1.3) and the same data follows you to your iPhone, Mac and Windows PC through your own free Supabase project. See `SPEC.md` for the rules and data model.

```
index.html             app (UI, storage, sync, AI) — all inline
game.js                pure rules + AI contracts (shared with tests and the future native app)
config.js              sync setup: your Supabase Project URL + publishable key (blank = sync off)
supabase/setup.sql     run once in Supabase's SQL Editor: the table, security rules and save function
sw.js                  service worker: offline cache, network-first index.html/game.js/config.js
manifest.webmanifest   Home Screen install metadata
icons/                 180 / 192 / 512 / 512-maskable PNGs
tests.html             unit tests for game.js (open in a browser)
SPEC.md                spec
```

There are two builds of the same code: **habit-app** (the live app, blue icon, "Habits") and **habit-app-beta** (the test copy, orange β icon, "Habits β", its own data). Section 2 walks through testing the beta without touching your live data; section 3 sets up sync.

## 1. Deploy to GitHub Pages

1. Create a repo (public is fine — it never contains your API key, passwords or data; the Supabase publishable key in `config.js` is meant to be public) and push the files to `main` at the repo root.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. After a minute, open `https://<you>.github.io/<repo>/` in Safari on the iPhone. All paths are relative, so a sub-path works.

Local preview: `python3 -m http.server 8000` in the folder, then `http://localhost:8000/`. Service workers need HTTPS or localhost.

## 2. Test the beta side by side (your live data stays untouched)

The beta has its own database, name, icon and offline cache, so it can't read or change the live app's data.

1. **New repo for the beta**, e.g. `habit-app-beta`. Upload the contents of `habit-app-beta.zip` to its root and enable Pages as in §1. Use a separate repo — not a `/beta` folder inside the live repo.
2. **Back up the live app**: open Habits → Settings → **Export backup…** → **Save to Files** (iCloud Drive).
3. **Install the beta**: open `https://<you>.github.io/habit-app-beta/` in Safari → Share → **Add to Home Screen**. It shows up as **Habits β** with an orange icon and a BETA badge.
4. **Load your data into the beta**: on its welcome screen tap **Restore from a backup** (or later: Settings → **Import backup…**) and pick the file from step 2. It's upgraded on the way in; the live app is not touched.
5. **Updating the beta**: upload the new zip's contents over the old ones, **except `config.js` once you've filled it in** (§3) — or ask for a zip with your values already in it. The open app shows **Update ready — Reload**; its data stays.
6. Until sync is on, keep logging in the **live app** and re-import a fresh backup into the beta when you want current data. **Once sync is on (§3), Habits β is your daily app on every device**; the live app isn't synced until 1.3 goes live.
7. **At sign-off**: push the **stable build** (`habit-app-v1.3-stable.zip`) to the live repo with the same filled-in `config.js`, open it once online (it upgrades in place) and sign in — it picks up your synced data. Then delete the Habits β icon (that deletes its copy) and the beta repo.

## 3. Sync across your devices (Supabase)

The same lists, habits, history, reviews and settings on your iPhone, Mac and Windows PC. Each device keeps a full copy and works offline; changes sync when it's online, and if the same thing changed on two devices, the newer edit wins. Your Anthropic API key and backups stay on each device. Do part A on a computer.

### A. Set up Supabase (once, about 10 minutes)

1. **Account**: [supabase.com](https://supabase.com) → **Start your project** → sign up with your **personal** GitHub or email (not a work account; the project should be yours). Then turn on multi-factor authentication in your account settings (authenticator app). Supabase has no recovery codes, so add a second authenticator on another device as a backup. If you signed up with GitHub, keep GitHub's 2FA on too.
2. **Organization**: type Personal, plan **Free**. Free never bills you; going over its limits only restricts the project.
3. **New project**: name `habit-app` · **Generate a password** for the database and save it in your password manager (the app never uses it; you can reset it later) · Region **East US (North Virginia)** (it can't be changed later) · leave the **Data API** on. Create it and wait a couple of minutes.
4. **Create the table**: **SQL Editor** → **New query** → paste all of `supabase/setup.sql` → **Run**. If it warns about destructive operations, that's the `drop … if exists` lines that make the script safe to re-run; confirm. You should see "Success. No rows returned".
5. **Create your sign-in**: **Authentication → Users → Add user → Create new user** → your email and a strong password (save it in your password manager) → keep **Auto Confirm User** checked if it's shown → **Create user**.
6. **Lock the door**: **Authentication → Sign In / Providers** → turn off **Allow new users to sign up** → Save. Only users you add in step 5 can sign in.
7. **Copy two values** — click **Connect** at the top of the project (or **Project Settings → API Keys**):
   - the **Project URL**, like `https://abcd1234.supabase.co`
   - the **publishable key**, starting with `sb_publishable_` (if you only see "anon" and "service_role" keys, create the new API keys on that page first)
   
   Never copy the **secret key** (`sb_secret_…`) or the database password into the app, GitHub or a chat.

### B. Turn sync on in the app

8. Upload the 1.3 beta zip's contents to the `habit-app-beta` repo (if you haven't already).
9. In that repo on GitHub, open `config.js` → ✏️ **Edit** → paste the Project URL and publishable key between the quotes → **Commit changes**. Or send the two values to Claude and upload the zip that comes back. Wait a minute for Pages to update.

### C. Sign in on each device

10. **iPhone first** (the device with your latest data). If that data is in the live app, export a backup there and import it into Habits β (Settings → **Import backup…**). Then open **Habits β** from the Home Screen → **Settings → Sign in to sync…** → your email and password. The first sign-in uploads the phone's data; Settings shows **Synced just now**.
11. **Mac and Windows**: open `https://<you>.github.io/habit-app-beta/` in Chrome, Edge or Safari → **Sign in to sync** on the welcome screen → your data downloads. To use it like an app: Chrome or Edge → the install icon at the right end of the address bar; Safari on a Mac → **File → Add to Dock**. (Check your employer's policy before signing in on a work computer.)
12. From now on, use Habits β everywhere.

If a device already has data of its own when you sign in, it asks: **Use My Account's Data** (replaces what's on that device), **Merge This Device In** (keeps both; the account's version wins where both have the same thing), or cancel.

### Day to day

- **Settings → Sync** shows the account and the status ("Synced 2 min ago", "Offline · 3 changes waiting"). **Sync now** forces a sync; it also happens on open, after each change, every minute while the app is open, and when you leave the app.
- Offline is fine: changes wait on the device and go up when you're back online.
- Checking the same habit for the same day on two devices before they sync counts it twice; uncheck one.
- **Sign out…** → **Sign Out** keeps this device's copy (sign in again to catch up); **Sign Out and Erase This Device** is for a shared or work computer. Your account keeps everything either way.
- **Import backup** on a synced device replaces your data on every device (it asks first).
- Supabase's Free plan has no backups, so keep exporting a backup now and then (the app reminds you weekly). Free projects pause after about a week with no activity; daily use keeps it awake. If you get the pause email, open the dashboard → **Resume project** (nothing is lost).

### Sync troubleshooting

- **"Wrong email or password"**: use the user from step 5.
- **"This email isn't confirmed yet"**: Authentication → Users → open the user → confirm the email, or turn off **Confirm email** under Sign In / Providers → Email.
- **"Supabase isn't set up for sync yet"**: run `supabase/setup.sql` (step 4).
- **"Supabase rejected the publishable key"** or **Sync: Off** in Settings: check `config.js` (step 9). It must be the publishable key, not the secret key.
- **"Sync is paused — sign in again"** on the Planner: the session ended (for example, you signed out everywhere). Sign in; waiting changes go up.
- **"Update to keep syncing"**: another device runs a newer version. Reload (or reopen) to update.
- **"1 item couldn't sync"**: the cloud refused that record. Editing it retries; if it keeps happening, tell Claude.
- **Works at home, not at work**: the work network may block `supabase.co`. The app keeps working; it syncs when the device is on another network.

## 4. Install on the iPhone

1. Open the Pages URL in **Safari**.
2. **Share** → **Add to Home Screen** → **Add**. (The app shows these steps itself while it runs in a tab.)
3. Open it from the Home Screen → **Get started** → pick the daily habits that make you better (or **Skip for now**) — or **Sign in to sync** to bring your synced data.

The Home Screen app has its own storage, separate from the Safari tab, so use only the installed app (and sign in there). Removing the icon deletes that storage — export a backup first, or make sure it's synced.

**Updating from 1.1:** your data upgrades automatically. Lists named after days (Monday, Tues, Sat + Sun, Weekend, Mon-Fri) become day lists, and a toast confirms it. If the same habit was added to several day lists (say, Prayer), the Planner offers **Merge into one** so it has a single streak.

## 5. How it works

- **Planner** (the start page): one tile per list, day lists first (Monday → Sunday), today's tile ringed. Tap a circle to check off, a tile to open the list, **+** to add to that list, **Edit** to choose which lists get tiles. No day lists yet? The Planner offers to create Mon–Fri + Sat & Sun or Mon–Sun.
- **Day lists**: a habit shows up in every day list its schedule matches — a daily habit in Monday … Sunday; **Sat + Sun** shows it twice, labeled Saturday and Sunday. It's still one habit with one streak. Rename a list to a day, or pick its days in the list editor (list → **…** → Edit List → "This list is for"). A habit you kept in a day list that isn't scheduled for that day (say, weekly on Wednesday in Sat + Sun) still shows there as an ordinary row; change its days in the habit to move it.
- **Late check-offs**: checking off an earlier day this week (Monday's row on Wednesday, or Monday in a habit's week strip) counts for that day — streak and XP. Upcoming days stay locked until they arrive. Weeks run Monday → Sunday.
- **Habits** page: every habit with this week at a glance. **✚** asks how it repeats (daily, weekly, specific days) before anything else; **✨** suggests habits by skill.
- **New Reminder** (Planner and Lists): a quick sheet for a one-off task — title, notes, list, due date. Return adds it and keeps the sheet open for the next one.
- **Deleting**: swipe a row left → **Delete**. Tasks go straight away (with Undo). A habit asks first, since it disappears from every day list and its streak ends — tap **Delete Habit** to confirm or **Keep Habit** to back out. Past XP always stays.
- **Skills**: every item boosts one skill, picked for you (prayer/journaling → Clarity, lifting → Strength, stretching → Dexterity, reading → Learning), then double-checked by Claude if your API key is set. Change it under **Boosts** in the item; its past XP moves with it.
- **Review**: the Annual Review (December) and Integrity Report (June) in James Clear's formats. The year in numbers — check-ins by month, top habits, longest streaks, skills that grew — comes from your data; you answer the questions. Add core values with self-check questions and link skills as evidence. Answers save on the device (and sync, if you're signed in) and go in backups; **Share** sends the report as text (Notes, Mail, Files). A banner reminds you when one is due.
- **Settings → Pages**: hide Planner, Habits or Review. Lists and Skills are always on. Hiding a page only hides it.
- **On a computer** the app shows as a centered column, like the phone layout.

## 6. API key and spend limit (photo capture + skill checks)

1. [console.anthropic.com](https://console.anthropic.com) → **API Keys** → create a key for this app only.
2. Console → **Settings → Limits** (or Billing → Limits): set a **monthly spend limit**, e.g. $5. A card photo is a few thousand input tokens; a skill check is a few hundred tokens per batch of new items. Check current pricing in the Console; the limit is the backstop.
3. In the app: **Settings → AI → API key → Save**. Stored on-device only, sent only to `api.anthropic.com`, never exported and never synced; **Clear key** removes it. Each device (and the beta) has its own key slot — add it on each device where you want AI.
4. **Model**: `claude-sonnet-5` (default) or `claude-haiku-4-5-20251001` (cheaper, plenty for skill checks). *Custom…* accepts any model ID.
5. **Claude checks skills** (on by default) sends only item titles and your skill list — never notes. Turn it off to keep typed items fully offline; the keyword guess still works.

Photo capture: camera button (Planner, Lists, a list's New Item row, or New Reminder → *Scan a note card instead*) → **Take Photo** → review → **Add N items**.

### Capture from another device or account (Paste from Claude)

Settings → AI → **Copy Claude prompt** (it includes your lists and skills), paste it into a Claude Project's instructions or a chat with the card photo, copy the JSON block Claude returns, then in the app tap camera → **Paste from Claude**. Re-copy the prompt after adding or renaming lists or skills.

## 7. Back up and restore

- **Settings → Backup → Export backup…** opens the share sheet → **Save to Files** → iCloud Drive (`habit-tracker-backup-YYYY-MM-DD.json`, schema 3, key and sign-in excluded; the beta names its files `habit-tracker-beta-backup-…`). Desktop browsers download it.
- **Import backup…** replaces everything after a confirm — on a synced device, on every device. Older backups (1.0, 1.1) import and upgrade. A live-app backup imports into the beta any time; a beta backup imports into the live app once the live app is on 1.2 or later (1.1 safely refuses newer files).
- The start page nudges you when the last backup is older than 7 days. **Erase all data** wipes this device (and signs it out); a synced account keeps its data.

## 8. Quick entry

| token | meaning |
|---|---|
| `!1` … `!5` | difficulty tier (10 / 25 / 50 / 100 / 200 XP) |
| `#monday` | list (name prefix) |
| `+clarity` | skill (name prefix, e.g. `+clar`) — otherwise it's picked for you |
| `@today` `@tomorrow` `@fri` `@10/3` `@2026-10-03` | due date |
| `^daily` `^weekly` `^mon,wed,fri` `^weekdays` `^weekends` | habit with that schedule (`^weekly` typed in a day list means that list's day) |
| `x8` | habit target of 8 check-ins a day (implies `^daily`) |

## 9. Releasing an update

1. Bump `APP_VERSION` in `index.html` **and** the version in `CACHE_VERSION` in `sw.js` together (currently `1.3.0` / `habits-v1.3.0`).
2. Run `tests.html` in a browser — all green.
3. Push to `main` (keep your filled-in `config.js`). On the phone, opening the app with a connection loads the new code (network-first); an open app shows **Update ready — Reload**.
4. Beta builds differ from stable in exactly these lines: `CHANNEL = 'beta'` in `index.html`, the `<title>` and `apple-mobile-web-app-title` ("Habits β"), `CACHE_PREFIX = 'habits-beta-v'` in `sw.js`, the manifest `name`/`short_name`, and the orange icons. `config.js` is the same in both.
5. If a release changes `supabase/setup.sql`, run it again in the SQL Editor before deploying (it's safe to re-run).

## 10. Troubleshooting

- **A habit shows up several times in a day list**: it was added more than once. Use **Merge into one** on the Planner or Habits page.
- **Can't check off Friday's row**: upcoming days unlock on the day. Earlier days this week can be logged late; last week can't.
- **An item has no skill icon**: nothing matched the keyword guess yet. With a key set, Claude sorts it within seconds; otherwise pick one under **Boosts**.
- **The beta shows none of my data**: it has its own storage by design. Sign in to sync (§3), or import a backup from the live app (§2).
- **Items vanished**: you're probably in the Safari tab instead of the Home Screen app (separate storage). Sign in there, or import the latest backup.
- **"The app is open in another tab"** after an update: close the other copy (e.g. a Safari tab) and reopen.
- Sync problems: see **Sync troubleshooting** in §3.
