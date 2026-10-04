/* game.js — pure game logic for the Habit & Task Tracker.
 * No DOM, no storage, no Date.now(): `now` is always a parameter.
 * Loaded by index.html and tests.html; portable to the native app as-is.
 *
 * Vocabulary: "lists" organize items (stored as `categories` for backward compatibility);
 * "skills" are what completions level up. Every completion feeds the overall level and the
 * item's skill.
 */
'use strict';

var Game = (function () {
  // ---------- config ----------
  const XP_BY_TIER = Object.freeze({ 1: 10, 2: 25, 3: 50, 4: 100, 5: 200 });
  const DEFAULT_TIER = 2;
  const LEVEL_BASE = 100;
  const LEVEL_EXP = 1.3;
  const TIER_LADDER = Object.freeze([10, 25, 50, 100, 250, 500, 1000]);
  const DAY_START_HOUR = 4;
  const TIER_RUBRIC = Object.freeze({
    1: 'under 5 min', 2: '~15 min', 3: '30–60 min', 4: '1–2 hr or hard', 5: 'major effort or milestone'
  });
  const SCHEMA_VERSION = 3;
  const APP_ID = 'habit-tracker';
  const DEFAULT_MODEL = 'claude-sonnet-5';
  const MODEL_PRESETS = Object.freeze(['claude-sonnet-5', 'claude-haiku-4-5-20251001']);
  const WEEKDAYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  const WEEKDAYS_FULL = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  const DAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
  const WEEK_START = 1; // weeks run Monday → Sunday, like the day lists
  const WEEK_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
  const PAGES = Object.freeze(['planner', 'lists', 'habits', 'skills', 'review']);
  const OPTIONAL_PAGES = Object.freeze(['planner', 'habits', 'review']); // Lists and Skills are always on
  const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  const MONTHS_FULL = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  const COLORS = Object.freeze(['red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown']);
  const KIND_BY_METRIC = Object.freeze({ tasks: 'task', habits: 'habit', subtasks: 'subtask' });
  const SKILL_SOURCES = Object.freeze(['user', 'ai', 'auto']);
  const SCOPE_TYPES = Object.freeze(['all', 'category', 'item', 'skill', 'anySkill', 'everySkill']);

  // ---------- ids / time ----------
  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function toDate(x) { return x instanceof Date ? x : new Date(x); }
  function iso(x) { return toDate(x).toISOString(); }

  // ---------- xp / levels ----------
  function clampTier(t) {
    const n = Math.round(Number(t));
    if (!Number.isFinite(n)) return DEFAULT_TIER;
    return Math.min(5, Math.max(1, n));
  }
  function xpForTier(tier) { return XP_BY_TIER[clampTier(tier)]; }
  function xpForLevel(level) { return Math.round(LEVEL_BASE * Math.pow(level, LEVEL_EXP)); }
  function levelFromXp(totalXp) {
    let level = 1;
    let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
    for (;;) {
      const needed = xpForLevel(level);
      if (xp < needed) return { level, into: xp, needed, fraction: xp / needed };
      xp -= needed;
      level++;
    }
  }
  function xpToReachLevel(level) {
    let sum = 0;
    for (let L = 1; L < level; L++) sum += xpForLevel(L);
    return sum;
  }
  function xpTotals(completions) {
    const byCategory = {}, bySkill = {};
    let overall = 0;
    for (const c of completions) {
      const xp = Number(c.xp) || 0;
      overall += xp;
      byCategory[c.categoryId] = (byCategory[c.categoryId] || 0) + xp;
      if (c.skillId) bySkill[c.skillId] = (bySkill[c.skillId] || 0) + xp;
    }
    return { overall, byCategory, bySkill };
  }
  function levelSnapshot(totals) {
    const bySkill = {};
    for (const id of Object.keys(totals.bySkill || {})) bySkill[id] = levelFromXp(totals.bySkill[id]).level;
    return { overall: levelFromXp(totals.overall).level, bySkill };
  }
  // Level-up events between two totals (overall first, then skills). Lists don't level.
  function diffLevels(beforeTotals, afterTotals) {
    const b = levelSnapshot(beforeTotals), a = levelSnapshot(afterTotals);
    const events = [];
    if (a.overall > b.overall) events.push({ type: 'levelup', scope: 'overall', id: null, level: a.overall });
    for (const id of Object.keys(a.bySkill)) {
      if (a.bySkill[id] > (b.bySkill[id] || 1)) events.push({ type: 'levelup', scope: 'skill', id, level: a.bySkill[id] });
    }
    return events;
  }

  // ---------- logical days ----------
  const pad2 = n => String(n).padStart(2, '0');
  function fmtDay(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseDay(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d;
  }
  function isDayKey(s) { return !!parseDay(s); }
  function dayKey(date, dayStartHour) {
    const h = Number.isFinite(Number(dayStartHour)) ? Number(dayStartHour) : DAY_START_HOUR;
    const d = toDate(date);
    return fmtDay(new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() - h, d.getMinutes(), d.getSeconds()));
  }
  function addDays(key, n) { const d = parseDay(key); d.setDate(d.getDate() + n); return fmtDay(d); }
  function weekdayOf(key) { return parseDay(key).getDay(); }
  function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  function dueStatus(item, todayKey) {
    if (!item || item.type !== 'task' || !item.due) return 'none';
    if (item.due < todayKey) return 'overdue';
    if (item.due === todayKey) return 'today';
    return 'future';
  }

  // ---------- weeks (Monday → Sunday) ----------
  const weekPos = wd => ((Number(wd) - WEEK_START) % 7 + 7) % 7;
  function weekStartKey(key) { return addDays(key, -weekPos(weekdayOf(key))); }
  function weekDates(key) { const s = weekStartKey(key); return WEEK_ORDER.map((_, i) => addDays(s, i)); }
  function dateInWeek(key, weekday) { return addDays(weekStartKey(key), weekPos(weekday)); }
  function sortWeekdays(days) { return [...new Set((days || []).map(Number))].filter(d => d >= 0 && d <= 6).sort((a, b) => weekPos(a) - weekPos(b)); }
  // Late check-offs: any day from this week's Monday up to today. Upcoming days stay locked.
  function canLogOn(key, todayKey) { return isDayKey(key) && key <= todayKey && key >= weekStartKey(todayKey); }
  function dayName(weekday, short) { const n = DAY_NAMES[((Number(weekday) % 7) + 7) % 7]; return short ? n.slice(0, 3) : n; }

  // ---------- schedules ----------
  function normalizeRepeat(repeat, todayKey) {
    if (!repeat) return null;
    const kind = ['daily', 'weekly', 'custom'].includes(repeat.kind) ? repeat.kind : 'daily';
    let days;
    if (kind === 'daily') days = ALL_DAYS.slice();
    else if (kind === 'weekly') {
      const raw = Array.isArray(repeat.days) && repeat.days.length ? Number(repeat.days[0]) : (todayKey ? weekdayOf(todayKey) : 1);
      days = [((Math.round(raw) % 7) + 7) % 7];
    } else {
      days = [...new Set((Array.isArray(repeat.days) ? repeat.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
      if (!days.length) days = ALL_DAYS.slice();
    }
    return { kind, days };
  }
  function isScheduledOn(item, key) {
    if (!item || item.type !== 'habit' || !item.repeat || !Array.isArray(item.repeat.days)) return false;
    return item.repeat.days.includes(weekdayOf(key));
  }
  function prevScheduledDay(item, key) {
    for (let i = 1; i <= 7; i++) {
      const k = addDays(key, -i);
      if (isScheduledOn(item, k)) return k;
    }
    return null;
  }
  function repeatLabel(repeat) {
    if (!repeat) return 'Never';
    if (repeat.kind === 'daily' || repeat.days.length === 7) return 'Daily';
    const names = sortWeekdays(repeat.days).map(d => dayName(d, true));
    if (repeat.kind === 'weekly') return 'Weekly · ' + names[0];
    const s = repeat.days.slice().sort((a, b) => a - b).join(',');
    if (s === '1,2,3,4,5') return 'Weekdays';
    if (s === '0,6') return 'Weekends';
    return names.join(' ');
  }

  // ---------- day lists ----------
  // A list named after days ("Monday", "Tues", "Sat + Sun", "Weekend", "Mon-Fri") stands for those weekdays.
  // Every word must be a day or a connector, so "Sunday dinner ideas" stays an ordinary list.
  const DAY_WORDS = Object.freeze({
    sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
    wed: 3, weds: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
    fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6
  });
  const DAY_CONNECTORS = new Set(['and', 'n', 'plus', 'every', 'each', 'on', 'the']);
  const RANGE_WORDS = new Set(['to', 'thru', 'through', 'till', 'until']);
  function detectListDays(name) {
    const tokens = String(name || '').toLowerCase().replace(/[’']/g, '').replace(/[–—]/g, '-').match(/[a-z]+|-/g);
    if (!tokens) return null;
    const days = [];
    let range = false, last = null;
    for (const tok of tokens) {
      if (tok === '-' || RANGE_WORDS.has(tok)) { if (last !== null) range = true; continue; }
      if (DAY_CONNECTORS.has(tok)) continue;
      let add = null;
      if (Object.prototype.hasOwnProperty.call(DAY_WORDS, tok)) add = [DAY_WORDS[tok]];
      else if (tok === 'weekend' || tok === 'weekends') add = [6, 0];
      else if (tok === 'weekday' || tok === 'weekdays') add = [1, 2, 3, 4, 5];
      else return null;
      if (range && add.length === 1) {
        for (let d = (last + 1) % 7; d !== add[0]; d = (d + 1) % 7) days.push(d);
      }
      range = false;
      days.push(...add);
      last = add[add.length - 1];
    }
    const out = [...new Set(days)].sort((a, b) => a - b);
    return out.length ? out : null;
  }
  function normalizeDays(days) {
    if (!Array.isArray(days)) return null;
    const out = [...new Set(days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    return out.length ? out : null;
  }
  function isDayList(list) { return !!(list && Array.isArray(list.days) && list.days.length); }
  function listDaysLabel(days) {
    const d = normalizeDays(days);
    if (!d) return 'Not a day list';
    if (d.length === 7) return 'Every day';
    const s = d.join(',');
    if (s === '1,2,3,4,5') return 'Weekdays';
    if (s === '0,6') return 'Sat + Sun';
    if (d.length === 1) return dayName(d[0]);
    return sortWeekdays(d).map(x => dayName(x, true)).join(' + ');
  }
  function listCoversDay(list, key) { return isDayList(list) && list.days.includes(weekdayOf(key)); }

  // ---------- skills: seeds + local inference ----------
  const SEED_SKILLS = Object.freeze([
    { id: 'sk_strength', name: 'Strength', icon: '💪', color: 'red', hint: 'lifting, weights, push-ups, pull-ups, squats, core work' },
    { id: 'sk_dexterity', name: 'Dexterity', icon: '🤸', color: 'orange', hint: 'stretching, mobility, yoga, balance, foam rolling, coordination' },
    { id: 'sk_endurance', name: 'Endurance', icon: '🏃', color: 'yellow', hint: 'running, cardio, cycling, swimming, walking, hiking' },
    { id: 'sk_vitality', name: 'Vitality', icon: '❤️', color: 'pink', hint: 'sleep, water, nutrition, meal prep, vitamins, doctor and dentist visits' },
    { id: 'sk_clarity', name: 'Clarity', icon: '🧘', color: 'teal', hint: 'journaling, meditation, prayer, reflection, gratitude, planning, screen-time limits' },
    { id: 'sk_learning', name: 'Learning', icon: '📚', color: 'indigo', hint: 'reading, studying, courses, certifications, languages, tutorials' },
    { id: 'sk_career', name: 'Career', icon: '💼', color: 'blue', hint: 'work projects, email, meetings, resume, networking, professional goals' },
    { id: 'sk_wealth', name: 'Wealth', icon: '💵', color: 'green', hint: 'budgeting, saving, investing, bills, taxes, side income' },
    { id: 'sk_social', name: 'Social', icon: '🗣️', color: 'purple', hint: 'calls and texts with friends and family, hanging out, dates, events, gifts' },
    { id: 'sk_upkeep', name: 'Upkeep', icon: '🏠', color: 'brown', hint: 'chores, cleaning, laundry, errands, groceries, repairs, car, paperwork' }
  ]);
  // v1.1's Clarity hint; upgraded to the current seed hint when a v2 store is migrated (only if untouched).
  const OLD_CLARITY_HINT = 'journaling, meditation, reflection, gratitude, planning, screen-time limits';
  // Built-in keywords per seed skill (by id, so renaming a skill keeps them).
  // Plain = weight 1; "~word" = weight 0.5 (generic verbs/places); "!word" and multi-word phrases = weight 2.
  // The last word of each keyword also matches its common inflections (lift → lifts, lifted, lifting).
  const SKILL_KEYWORDS = Object.freeze({
    sk_strength: ['lift', 'weights', 'weight training', 'weightlifting', 'powerlifting', '~gym', 'bench', 'bench press', 'squat', 'deadlift',
      'push up', 'pushup', 'pull up', 'pullup', 'chin up', 'chinup', 'dips', 'plank', 'core', 'abs', 'kettlebell', 'dumbbell', 'barbell',
      'strength', 'resistance', 'calisthenics', 'chest day', 'leg day', 'back day', 'arm day', 'shoulder', 'bicep', 'tricep', 'curl',
      'lunge', 'crunch', 'situp', 'sit up', 'hypertrophy', 'crossfit', 'workout', 'work out', 'pump'],
    sk_dexterity: ['stretch', 'yoga', 'mobility', 'flexibility', 'flexible', 'foam roll', 'foam roller', 'balance', 'pilates', 'splits',
      'coordination', 'juggle', 'drill', 'footwork', 'dance', 'tai chi', 'agility', 'climb', 'bouldering', 'typing', 'dexterity', 'posture',
      'warm up', 'warmup', 'cool down', 'cooldown'],
    sk_endurance: ['run', 'jog', 'cardio', 'bike', 'biking', 'cycle', 'cycling', 'spin class', 'swim', 'laps', 'rowing', 'row machine',
      'hike', 'walk', 'steps', '5k', '10k', 'half marathon', 'marathon', 'treadmill', 'elliptical', 'stairs', 'stairmaster', 'sprint',
      'hiit', 'ruck', 'zone 2', 'endurance', 'triathlon', 'jump rope', 'miles'],
    sk_vitality: ['sleep', '~bed', 'bedtime', 'nap', 'water', 'hydrate', 'hydration', 'vitamin', 'supplement', 'creatine', 'protein',
      'meal prep', 'healthy', 'eat', 'breakfast', 'veggies', 'vegetable', 'fruit', 'salad', 'cook', 'doctor', 'dentist', 'checkup',
      'physical', 'meds', 'medication', 'pill', 'skincare', 'floss', 'brush teeth', 'sunscreen', 'no alcohol', 'sober', 'no sugar',
      'fasting', 'calorie', 'macros', 'sauna', 'cold plunge', 'cold shower', 'vitality', 'health', 'massage', 'electrolytes', 'diet'],
    sk_clarity: ['journal', 'meditate', 'meditation', 'mindful', 'mindfulness', 'reflect', 'reflection', 'gratitude', 'grateful',
      'breathe', 'breathing', 'breathwork', '~plan', 'plan day', 'plan week', 'plan tomorrow', 'weekly review', 'daily review',
      'review goals', 'goals', 'intention', 'no phone', 'phone free', 'screen time', 'digital detox', 'unplug', 'quiet time',
      'affirmation', 'clarity', 'brain dump', 'therapy', 'therapist', 'mood', 'focus',
      '!pray', '!prayer', 'devotional', 'devotion', 'worship', 'church', 'bible', 'bible study', 'scripture', 'sermon', 'faith',
      'rosary', 'quran', 'salah', 'sabbath', 'spiritual', 'mass reading'],
    sk_learning: ['~read', 'reading', 'book', 'chapter', 'pages', 'study', 'course', '~class', 'lecture', 'homework', 'assignment', 'exam',
      'quiz', 'flashcard', 'anki', 'duolingo', 'language', 'spanish', 'french', 'german', 'italian', 'japanese', 'learn', 'tutorial',
      'research', 'practice problems', 'notes', 'certification', 'cert', 'security+', 'cissp', 'comptia', 'podcast', 'documentary',
      'lesson', 'coursera', 'udemy', 'textbook', 'article', '~paper', 'thesis', 'learning'],
    sk_career: ['work', '~job', 'project', 'meeting', 'email', 'inbox', 'resume', 'linkedin', 'portfolio', 'interview', 'client', 'report',
      'presentation', 'slides', '~deck', 'deadline', 'audit', 'ticket', 'promotion', 'manager', 'one on one', '1 1', 'standup',
      'side project', 'code', 'coding', 'deploy', 'pull request', 'proposal', 'job application', 'apply', 'networking', 'conference',
      'career', 'performance review', 'soc 2', 'soc2', '~policy', 'okr', 'spreadsheet', 'read email', 'read emails', 'slack', 'jira',
      'timesheet'],
    sk_wealth: ['budget', 'invest', 'investment', 'saving', 'savings', 'save money', 'bill', '~pay', 'rent', 'mortgage', 'tax', 'bank',
      'credit', 'credit card', 'stock', '401k', 'roth', 'ira', 'expense', 'net worth', 'sell', 'ebay', 'flip', 'invoice', 'insurance',
      'refinance', 'finance', 'money', 'spending', 'balance checkbook', 'balance budget', 'wealth', 'venmo', 'paypal', 'subscription',
      'brokerage', 'dividend', 'crypto', 'debt', 'loan', 'student loan', 'emergency fund'],
    sk_social: ['~call', '~text', 'mom', 'dad', 'parents', 'family', 'grandma', 'grandpa', 'sister', 'brother', 'friend', 'date',
      'date night', 'dinner with', 'lunch with', 'drinks with', 'party', 'birthday', 'hang out', 'hangout', 'meet up', 'meetup', 'visit',
      'gift', 'wedding', 'reunion', 'catch up', 'group chat', 'volunteer', 'community', 'game night', 'social', 'facetime', 'invite',
      '~host', 'thank you note', 'thank you card'],
    sk_upkeep: ['clean', 'laundry', 'dishes', 'vacuum', 'mop', 'dust', 'trash', 'garbage', 'recycling', 'grocery', 'groceries', 'errand',
      'run errands', 'fix', 'repair', 'organize', 'declutter', 'tidy', 'renew', 'passport', 'dmv', 'license', 'registration', 'car',
      'oil change', 'car wash', 'tires', 'mow', 'lawn', 'yard', 'garden', 'mail', 'package', 'return', 'pick up', 'drop off',
      '~appointment', 'paperwork', 'admin', '~form', 'pharmacy', 'haircut', 'bathroom', 'kitchen', 'fridge', 'sheets', 'make bed', '~iron',
      'shopping', 'buy', 'order', 'amazon', 'book flight', 'book hotel', 'book appointment', 'flight', 'hotel', 'reservation',
      'toilet paper', 'paper towels', 'pack', 'unpack', 'upkeep', 'chore', 'cook dinner', 'water plants', 'vet', 'litter', 'filter',
      'replace', 'install', 'assemble', '~move', 'storage']
  });
  // v1 seed lists → skills, used once when upgrading v1 data.
  const LEGACY_LIST_SKILL = Object.freeze({
    cat_fitness: 'sk_strength', cat_learning: 'sk_learning', cat_career: 'sk_career',
    cat_finance: 'sk_wealth', cat_home: 'sk_upkeep', cat_social: 'sk_social'
  });

  function normWords(s) { return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9+]+/g, ' ').trim(); }
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function keywordForms(k) {
    const forms = new Set([k]);
    const words = k.split(' ');
    const last = words[words.length - 1];
    const head = k.slice(0, k.length - last.length);
    if (/^[a-z]{3,}$/.test(last)) {
      for (const suf of ['s', 'es', 'd', 'ed', 'ing']) forms.add(head + last + suf);
      if (last.endsWith('e')) forms.add(head + last.slice(0, -1) + 'ing');
      if (last.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(last)) {
        forms.add(head + last + last.slice(-1) + 'ing');
        forms.add(head + last + last.slice(-1) + 'ed');
      }
      if (/[^aeiou]y$/.test(last)) forms.add(head + last.slice(0, -1) + 'ies');
    }
    return [...forms];
  }
  const matcherCache = new Map();
  function compileSkillMatchers(skills) {
    const sig = skills.map(s => `${s.id}\u0001${s.name}\u0001${s.hint || ''}`).join('\u0002');
    if (matcherCache.has(sig)) return matcherCache.get(sig);
    const out = skills.map((s, order) => {
      const weights = new Map();
      const add = (raw, w) => {
        const k = normWords(raw);
        if (!k || k.length < 2) return;
        const weight = w !== undefined ? w : (k.includes(' ') ? 2 : 1);
        if (!weights.has(k) || weights.get(k) < weight) weights.set(k, weight);
      };
      for (const k of SKILL_KEYWORDS[s.id] || []) {
        if (k.startsWith('~')) add(k.slice(1), 0.5);
        else if (k.startsWith('!')) add(k.slice(1), 2);
        else add(k);
      }
      add(s.name, 1);
      for (const part of String(s.hint || '').split(/,|;|\/|\band\b|\bor\b/i)) add(part);
      const matchers = [...weights].map(([k, w]) => ({
        k, w, re: new RegExp('(?:^| )(?:' + keywordForms(k).map(escapeRe).join('|') + ')(?= |$)', 'g')
      }));
      return { id: s.id, order, matchers };
    });
    matcherCache.set(sig, out);
    if (matcherCache.size > 16) matcherCache.delete(matcherCache.keys().next().value);
    return out;
  }
  // Instant offline guess: { skillId, score } or null. Highest score wins; ties go to the match
  // that appears later in the text ("run errands" → Upkeep, "read emails" → Career).
  function inferSkill(text, skills) {
    if (!skills || !skills.length) return null;
    const t = normWords(text);
    if (!t) return null;
    let best = null;
    for (const m of compileSkillMatchers(skills)) {
      let score = 0, last = -1;
      for (const { re, w } of m.matchers) {
        re.lastIndex = 0;
        let hit = -1, mm;
        while ((mm = re.exec(t))) { hit = mm.index; if (re.lastIndex === mm.index) re.lastIndex++; }
        if (hit >= 0) { score += w; if (hit > last) last = hit; }
      }
      if (score > 0 && (!best || score > best.score || (score === best.score && last > best.last))) best = { skillId: m.id, score, last };
    }
    return best ? { skillId: best.skillId, score: best.score } : null;
  }
  function matchByName(entries, token) {
    const t = String(token || '').toLowerCase();
    if (!t) return null;
    return entries.find(c => String(c.name || '').toLowerCase().replace(/\s+/g, '').startsWith(t)) || null;
  }
  function resolveSkill(skills, ref) {
    if (!ref || !skills) return null;
    const r = String(ref).trim();
    return skills.find(s => s.id === r) || skills.find(s => String(s.name).toLowerCase() === r.toLowerCase()) ||
      matchByName(skills, r.toLowerCase().replace(/\s+/g, '')) || null;
  }

  // ---------- completions ----------
  function indexCompletions(completions) {
    const m = new Map();
    for (const c of completions) {
      let arr = m.get(c.itemId);
      if (!arr) m.set(c.itemId, arr = []);
      arr.push(c);
    }
    return m;
  }
  function completionsFor(index, itemId) { return index.get(itemId) || []; }
  function countOn(index, itemId, key) {
    let n = 0;
    for (const c of completionsFor(index, itemId)) if (c.dayKey === key) n++;
    return n;
  }
  function byId(items) { const m = new Map(); for (const it of items) m.set(it.id, it); return m; }
  function rootOf(item, itemsById) { return item.parentId ? (itemsById.get(item.parentId) || item) : item; }
  function targetOf(item) { return Math.max(1, Math.floor(Number(item.timesPerDay) || 1)); }
  function kindOf(item) { return item.parentId ? 'subtask' : (item.type === 'habit' ? 'habit' : 'task'); }

  // Done state for today. Task-family: any completion. Habit-family: today's count >= target (sub-tasks: 1).
  function doneState(item, itemsById, index, todayKey) {
    const root = rootOf(item, itemsById);
    if (root.type === 'habit') {
      const target = item.parentId ? 1 : targetOf(root);
      const count = countOn(index, item.id, todayKey);
      return { done: count >= target, count, target };
    }
    const count = completionsFor(index, item.id).length;
    return { done: count > 0, count, target: 1 };
  }
  function isDone(item, itemsById, index, todayKey) { return doneState(item, itemsById, index, todayKey).done; }

  function streak(item, index, todayKey) {
    if (!item || item.type !== 'habit' || !item.repeat || item.parentId) return { current: 0, best: 0 };
    const target = targetOf(item);
    const counts = new Map();
    for (const c of completionsFor(index, item.id)) counts.set(c.dayKey, (counts.get(c.dayKey) || 0) + 1);
    const doneOn = k => (counts.get(k) || 0) >= target;

    let current = 0;
    let k = (isScheduledOn(item, todayKey) && doneOn(todayKey)) ? todayKey : prevScheduledDay(item, todayKey);
    while (k && doneOn(k)) { current++; k = prevScheduledDay(item, k); }

    let best = 0, run = 0, prev = null;
    const keys = [...counts.keys()].filter(key => doneOn(key) && isScheduledOn(item, key)).sort();
    for (const key of keys) {
      run = (prev !== null && prevScheduledDay(item, key) === prev) ? run + 1 : 1;
      if (run > best) best = run;
      prev = key;
    }
    return { current, best: Math.max(best, current) };
  }

  function makeCompletion(item, kind, categoryId, skillId, todayKey, nowIso, idGen) {
    return {
      id: idGen(), itemId: item.id, categoryId, skillId: skillId || null, kind, dayKey: todayKey, at: nowIso,
      tier: clampTier(item.tier), xp: xpForTier(item.tier), text: String(item.text || '')
    };
  }
  function settingsOf(state) { return state.settings || {}; }
  function todayOf(state, now) {
    const s = settingsOf(state);
    return dayKey(now, s.dayStartHour === undefined ? DAY_START_HOUR : s.dayStartHour);
  }

  // Which day a habit check-off counts for: today, or (opts.date) an earlier day this week. Tasks always count today.
  // → { key, blocked: null | 'future' | 'past' }
  function creditDay(root, todayKey, date) {
    if (!date || date === todayKey || root.type !== 'habit') return { key: todayKey, blocked: null };
    if (!isDayKey(date)) return { key: todayKey, blocked: 'past' };
    if (date > todayKey) return { key: date, blocked: 'future' };
    if (!canLogOn(date, todayKey)) return { key: date, blocked: 'past' };
    return { key: date, blocked: null };
  }

  // Plan the completions a check-off produces. Pure: returns new records, mutates nothing.
  // `inferred` lists items that had no skill and got one decided now (the app persists it).
  // opts.date: log a habit for an earlier day this week (late check-off); upcoming days are blocked.
  function planComplete(state, itemId, now, opts) {
    now = now === undefined ? new Date() : now;
    const idGen = (opts && opts.idGen) || newId;
    const todayKey = todayOf(state, now);
    const nowIso = iso(now);
    const skills = state.skills || [];
    const itemsById = byId(state.items);
    const index = indexCompletions(state.completions);
    const item = itemsById.get(itemId);
    const result = { completions: [], parentAutoCompleted: false, todayKey, dayKey: todayKey, late: false, blocked: null, inferred: [] };
    if (!item) return result;
    const root = rootOf(item, itemsById);
    const credit = creditDay(root, todayKey, opts && opts.date);
    result.dayKey = credit.key;
    if (credit.blocked) { result.blocked = credit.blocked; return result; }
    result.late = credit.key < todayKey;
    const dayOf = credit.key;
    const categoryId = root.categoryId;
    const done = it => doneState(it, itemsById, index, dayOf).done;
    const decided = new Map();
    const skillFor = it => {
      if (it.skillId) return it.skillId;
      if (decided.has(it.id)) return decided.get(it.id);
      const g = inferSkill(it.text, skills);
      let sid = g ? g.skillId : null;
      if (!sid && it.parentId) { const p = itemsById.get(it.parentId); if (p) sid = p.skillId || (decided.get(p.id) || null); }
      decided.set(it.id, sid);
      if (sid) result.inferred.push({ itemId: it.id, skillId: sid });
      return sid;
    };
    const push = (it, kind) => result.completions.push(makeCompletion(it, kind, categoryId, skillFor(it), dayOf, nowIso, idGen));

    if (item.parentId) {
      if (done(item)) return result;
      push(item, 'subtask');
      const parent = itemsById.get(item.parentId);
      if (parent) {
        const siblings = state.items.filter(i => i.parentId === parent.id && i.id !== item.id);
        if (siblings.every(done) && !done(parent)) {
          push(parent, kindOf(parent));
          result.parentAutoCompleted = true;
        }
      }
      return result;
    }
    if (done(item)) return result;
    skillFor(item); // decide the parent first so sub-tasks can fall back to it
    for (const child of state.items) {
      if (child.parentId === item.id && !done(child)) push(child, 'subtask');
    }
    push(item, kindOf(item));
    return result;
  }

  // Plan an undo: tasks lose their completion; habits lose their latest check-in for today (or opts.date this week).
  function planUncomplete(state, itemId, now, opts) {
    now = now === undefined ? new Date() : now;
    const todayKey = todayOf(state, now);
    const itemsById = byId(state.items);
    const item = itemsById.get(itemId);
    const result = { removeCompletionIds: [], todayKey, dayKey: todayKey, blocked: null };
    if (!item) return result;
    const root = rootOf(item, itemsById);
    const mine = state.completions.filter(c => c.itemId === itemId);
    if (root.type === 'habit') {
      const credit = creditDay(root, todayKey, opts && opts.date);
      result.dayKey = credit.key;
      if (credit.blocked) { result.blocked = credit.blocked; return result; }
      const today = mine.filter(c => c.dayKey === credit.key).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      if (today.length) result.removeCompletionIds.push(today[today.length - 1].id);
    } else {
      result.removeCompletionIds.push(...mine.map(c => c.id));
    }
    return result;
  }
  // Completions whose skill must follow the item's current skill (all of the item's history).
  function completionsToReassign(completions, itemId, skillId) {
    return completions.filter(c => c.itemId === itemId && (c.skillId || null) !== (skillId || null));
  }

  // ---------- habits in day lists ----------
  // Habit appearances in a day list for the current week: one per (habit, list weekday it's scheduled on).
  // A habit lives once; each appearance is that habit on one date, so streaks and XP stay on one item.
  // Sorted by day (Monday first), then habit order. → [{ item, date, weekday }]
  function dayListInstances(list, items, todayKey) {
    if (!isDayList(list)) return [];
    const habits = items.filter(it => it.type === 'habit' && !it.parentId && it.repeat).sort((a, b) => a.sortOrder - b.sortOrder);
    const out = [];
    for (const wd of sortWeekdays(list.days)) {
      const date = dateInWeek(todayKey, wd);
      for (const it of habits) if (isScheduledOn(it, date)) out.push({ item: it, date, weekday: wd });
    }
    return out;
  }
  // Done state of an item on a given date, plus whether that date can be logged now.
  function dayState(item, itemsById, index, date, todayKey) {
    const st = doneState(item, itemsById, index, date);
    return Object.assign(st, { date, when: date < todayKey ? 'past' : date > todayKey ? 'future' : 'today', canLog: canLogOn(date, todayKey) });
  }
  // Monday → Sunday cells of the current week for a habit (Habits page).
  function weekStrip(item, itemsById, index, todayKey) {
    return weekDates(todayKey).map(date => Object.assign(dayState(item, itemsById, index, date, todayKey), {
      weekday: weekdayOf(date), scheduled: isScheduledOn(item, date)
    }));
  }
  // Top-level habits that share a name (e.g. "Prayer" added to several day lists). Oldest first.
  function duplicateHabitGroups(items) {
    const groups = new Map(), seen = new Set();
    for (const it of items) {
      if (it.parentId || it.type !== 'habit' || seen.has(it.id)) continue;
      seen.add(it.id);
      const k = normalizeText(it.text);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const order = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.sortOrder - b.sortOrder);
    return [...groups.values()].filter(g => g.length > 1).map(g => g.slice().sort(order));
  }
  // Merge duplicate habits into the first: schedule = union of days, all history and sub-tasks move over,
  // so the streak counts every copy's check-ins. Pure → updated copies to persist, or null.
  function planMergeHabits(state, ids) {
    const itemsById = byId(state.items);
    const group = [...new Set(ids)].map(id => itemsById.get(id)).filter(it => it && it.type === 'habit' && !it.parentId);
    if (group.length < 2) return null;
    const [first, ...rest] = group;
    const removeIds = new Set(rest.map(it => it.id).filter(id => id !== first.id));
    if (!removeIds.size) return null;
    const days = [...new Set(group.flatMap(it => (it.repeat && it.repeat.days) || []))].sort((a, b) => a - b);
    const weekly = days.length === 1 && group.every(it => it.repeat && it.repeat.kind === 'weekly');
    const src = group.find(it => it.skillSource === 'user') || (first.skillId ? first : (group.find(it => it.skillId) || first));
    const children = state.items.filter(c => c.parentId && removeIds.has(c.parentId)).map(c => Object.assign({}, c, { parentId: first.id, categoryId: first.categoryId }));
    const hasKids = children.length > 0 || state.items.some(c => c.parentId === first.id);
    const notes = [...new Set(group.map(it => String(it.notes || '').trim()).filter(Boolean))].join('\n');
    const keep = Object.assign({}, first, {
      repeat: { kind: days.length === 7 || !days.length ? 'daily' : weekly ? 'weekly' : 'custom', days: days.length ? days : ALL_DAYS.slice() },
      timesPerDay: hasKids ? 1 : Math.max(...group.map(targetOf)),
      skillId: src.skillId || null, skillSource: src.skillSource || null, aiCheckedAt: src.aiCheckedAt || null, notes
    });
    const completions = state.completions
      .filter(c => removeIds.has(c.itemId) || (c.itemId === keep.id && (c.skillId || null) !== keep.skillId))
      .map(c => Object.assign({}, c, { itemId: keep.id, skillId: keep.skillId }));
    const achievements = (state.achievements || []).filter(a => a.scope && a.scope.type === 'item' && removeIds.has(a.scope.id))
      .map(a => Object.assign({}, a, { scope: { type: 'item', id: keep.id } }));
    return { keep, removeItemIds: [...removeIds], completions, children, achievements };
  }

  // Ready-made day lists for the Planner ("set up your week").
  const DAY_LIST_PRESETS = Object.freeze({
    week7: [['Monday', [1], 'red'], ['Tuesday', [2], 'blue'], ['Wednesday', [3], 'orange'], ['Thursday', [4], 'purple'],
      ['Friday', [5], 'cyan'], ['Saturday', [6], 'green'], ['Sunday', [0], 'teal']],
    week6: [['Monday', [1], 'red'], ['Tuesday', [2], 'blue'], ['Wednesday', [3], 'orange'], ['Thursday', [4], 'purple'],
      ['Friday', [5], 'cyan'], ['Sat + Sun', [0, 6], 'green']]
  });
  function dayListPreset(kind) {
    return (DAY_LIST_PRESETS[kind] || DAY_LIST_PRESETS.week7).map(([name, days, color]) => ({ name, days: days.slice(), color, icon: '🗓️' }));
  }

  // Onboarding: daily habits that make you better, grouped by the skill they boost. [text, tier, timesPerDay?]
  const HABIT_SUGGESTIONS = Object.freeze([
    { skillId: 'sk_clarity', items: [['Pray', 1], ['Meditate 10 min', 2], ['Journal', 2], ['Gratitude list', 1], ['Plan tomorrow', 1]] },
    { skillId: 'sk_vitality', items: [['Drink water', 1, 8], ['Vitamins', 1], ['Protein shake', 1], ['In bed by 11', 2]] },
    { skillId: 'sk_strength', items: [['Lift', 3], ['Push-ups', 1]] },
    { skillId: 'sk_dexterity', items: [['Stretch', 2], ['Yoga', 3]] },
    { skillId: 'sk_endurance', items: [['Walk 10k steps', 3], ['Run', 3]] },
    { skillId: 'sk_learning', items: [['Read 10 pages', 2], ['Study 30 min', 3], ['Duolingo', 1]] },
    { skillId: 'sk_career', items: [['Deep work block', 3], ['Inbox zero', 2]] },
    { skillId: 'sk_wealth', items: [['Track spending', 1]] },
    { skillId: 'sk_social', items: [['Text a friend', 1], ['Call family', 2]] },
    { skillId: 'sk_upkeep', items: [['Make bed', 1], ['Tidy 10 min', 1]] }
  ]);
  // → [{ skillId, items: [{ text, tier, timesPerDay, skillId }] }] for the skills you still have.
  function habitSuggestions(skills) {
    const ids = new Set((skills || []).map(s => s.id));
    return HABIT_SUGGESTIONS.filter(g => ids.has(g.skillId)).map(g => ({
      skillId: g.skillId,
      items: g.items.map(([text, tier, tpd]) => ({ text, tier, timesPerDay: tpd || 1, skillId: g.skillId }))
    }));
  }

  // ---------- reviews: Annual Review + Integrity Report (James Clear's formats) ----------
  const ANNUAL_QUESTIONS = Object.freeze([
    ['wentWell', 'What went well this year?'],
    ['notWell', 'What didn’t go so well this year?'],
    ['workingToward', 'What am I working toward?']
  ]);
  const INTEGRITY_QUESTIONS = Object.freeze([
    ['values', 'What are the core values that drive my life and work?'],
    ['living', 'How am I living and working with integrity right now?'],
    ['higher', 'How can I set a higher standard in the future?']
  ]);
  // Starter core values (editable). Each value is a heading with a few self-check questions.
  const VALUE_SUGGESTIONS = Object.freeze([
    { name: 'Growth', questions: 'Am I learning new things and trying new ideas? Am I getting better at what matters to me?', skillIds: ['sk_learning'] },
    { name: 'Health', questions: 'Am I moving, sleeping and eating like my body has to last? Am I keeping my energy up?', skillIds: ['sk_vitality', 'sk_strength', 'sk_endurance'] },
    { name: 'Faith', questions: 'Am I making time for prayer and reflection? Do my actions match what I believe?', skillIds: ['sk_clarity'] },
    { name: 'Family', questions: 'Am I present with the people closest to me? Would they say I show up for them?', skillIds: ['sk_social'] },
    { name: 'Craft', questions: 'Am I doing work I’m proud of? Am I finishing things, not just planning them?', skillIds: ['sk_career'] },
    { name: 'Generosity', questions: 'Am I giving my time, attention and money freely? Am I quick to help?', skillIds: [] },
    { name: 'Courage', questions: 'Am I doing the hard thing when it matters? Am I honest when it’s uncomfortable?', skillIds: [] }
  ]);
  function reviewId(kind, year) { return `${kind === 'integrity' ? 'integrity' : 'annual'}-${year}`; }
  const strOr = v => (typeof v === 'string' ? v : '');
  function normalizeReview(r, fallbackYear) {
    const kind = r && r.kind === 'integrity' ? 'integrity' : 'annual';
    const year = Math.floor(Number(r && r.year)) || fallbackYear || 2026;
    const a = r && r.answers && typeof r.answers === 'object' ? r.answers : {};
    const vals = a.values && typeof a.values === 'object' ? a.values : {};
    const answers = kind === 'annual'
      ? { wentWell: strOr(a.wentWell), notWell: strOr(a.notWell), workingToward: strOr(a.workingToward) }
      : { living: strOr(a.living), higher: strOr(a.higher), values: Object.fromEntries(Object.entries(vals).filter(([, v]) => typeof v === 'string')) };
    return { id: reviewId(kind, year), kind, year, answers, completedAt: (r && r.completedAt) || null, updatedAt: (r && r.updatedAt) || null };
  }
  function normalizeCoreValue(v, skillIds) {
    const ids = Array.isArray(v.skillIds) ? v.skillIds.map(String) : [];
    return {
      id: String(v.id || newId()), name: Array.from(String(v.name || 'Value')).slice(0, 60).join(''), questions: String(v.questions || ''),
      skillIds: [...new Set(skillIds ? ids.filter(id => skillIds.has(id)) : ids)]
    };
  }
  // Which review to nudge about: Annual Review in December (and January for the year just ended),
  // Integrity Report in June–July. Skips ones marked complete or dismissed. → { kind, year, id } | null
  function reviewDue(todayKey, reviews, dismissed) {
    const y = +String(todayKey).slice(0, 4), m = +String(todayKey).slice(5, 7);
    const cands = [];
    if (m === 12) cands.push({ kind: 'annual', year: y });
    if (m === 1) cands.push({ kind: 'annual', year: y - 1 });
    if (m === 6 || m === 7) cands.push({ kind: 'integrity', year: y });
    for (const c of cands) {
      const id = reviewId(c.kind, c.year);
      if ((reviews || []).some(r => r.id === id && r.completedAt) || (dismissed && dismissed[id])) continue;
      return Object.assign(c, { id });
    }
    return null;
  }
  // Year in numbers, straight from the completions log. `todayKey` caps the current year's month range.
  function yearStats(state, year, todayKey) {
    const y = String(year);
    const all = state.completions || [];
    const inYear = all.filter(c => String(c.dayKey).slice(0, 4) === y);
    const before = all.filter(c => String(c.dayKey).slice(0, 4) < y);
    const sumXp = cs => cs.reduce((s, c) => s + (Number(c.xp) || 0), 0);
    const byMonth = MONTHS.map(() => 0), xpByMonth = MONTHS.map(() => 0);
    const days = new Set(), habitCount = new Map(), habitText = new Map();
    let tasks = 0, habits = 0, subtasks = 0;
    for (const c of inYear) {
      const m = +c.dayKey.slice(5, 7) - 1;
      byMonth[m]++; xpByMonth[m] += Number(c.xp) || 0; days.add(c.dayKey);
      if (c.kind === 'task') tasks++; else if (c.kind === 'habit') habits++; else subtasks++;
      if (c.kind === 'habit') { habitCount.set(c.itemId, (habitCount.get(c.itemId) || 0) + 1); if (!habitText.has(c.itemId)) habitText.set(c.itemId, c.text); }
    }
    const itemsById = byId(state.items || []);
    const nameOf = id => (itemsById.get(id) ? itemsById.get(id).text : habitText.get(id)) || 'Deleted habit';
    const topHabits = [...habitCount].map(([itemId, count]) => ({ itemId, text: nameOf(itemId), count }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, 5);
    const yearIndex = indexCompletions(inYear);
    const endKey = todayKey && todayKey.slice(0, 4) === y ? todayKey : `${y}-12-31`;
    const streaks = (state.items || []).filter(it => it.type === 'habit' && !it.parentId && it.repeat && habitCount.has(it.id))
      .map(it => ({ itemId: it.id, text: it.text, best: streak(it, yearIndex, endKey).best }))
      .filter(s => s.best > 1).sort((a, b) => b.best - a.best || a.text.localeCompare(b.text)).slice(0, 3);
    const xpBefore = sumXp(before), xp = sumXp(inYear);
    const bySkillBefore = xpTotals(before).bySkill, bySkillYear = xpTotals(inYear).bySkill;
    const skills = Object.keys(bySkillYear).map(skillId => ({
      skillId, xp: bySkillYear[skillId],
      levelStart: levelFromXp(bySkillBefore[skillId] || 0).level,
      levelEnd: levelFromXp((bySkillBefore[skillId] || 0) + bySkillYear[skillId]).level
    })).sort((a, b) => b.xp - a.xp);
    const keys = [...days].sort();
    const firstMonth = keys.length ? +keys[0].slice(5, 7) - 1 : null;
    const lastMonth = todayKey && todayKey.slice(0, 4) === y ? +todayKey.slice(5, 7) - 1 : 11;
    // Quietest month only counts finished months (this month is still in progress).
    const lastFull = todayKey && todayKey.slice(0, 4) === y ? lastMonth - 1 : 11;
    let bestMonth = null, quietMonth = null;
    if (firstMonth !== null) {
      for (let m = firstMonth; m <= Math.max(firstMonth, lastMonth); m++) {
        if (!bestMonth || byMonth[m] > bestMonth.count) bestMonth = { month: m, count: byMonth[m] };
        if (m <= lastFull && (!quietMonth || byMonth[m] < quietMonth.count)) quietMonth = { month: m, count: byMonth[m] };
      }
      if (quietMonth && bestMonth && quietMonth.month === bestMonth.month) quietMonth = null;
    }
    const achievements = (state.achievements || []).filter(a => a.unlockedAt && String(a.unlockedAt).slice(0, 4) === y)
      .sort((a, b) => (a.unlockedAt < b.unlockedAt ? -1 : 1)).map(a => ({ id: a.id, name: achievementName(a), icon: a.icon || '🏆', unlockedAt: a.unlockedAt }));
    return {
      year: +y, checkins: inYear.length, tasks, habits, subtasks, xp, activeDays: days.size, byMonth, xpByMonth,
      firstDay: keys[0] || null, lastDay: keys[keys.length - 1] || null, firstMonth, lastMonth,
      bestMonth, quietMonth, topHabits, streaks, skills,
      levelStart: levelFromXp(xpBefore).level, levelEnd: levelFromXp(xpBefore + xp).level, achievements
    };
  }
  // Years that have check-ins or a saved review (plus the current one), newest first.
  function reviewYears(completions, todayKey, reviews) {
    const ys = new Set((completions || []).map(c => +String(c.dayKey).slice(0, 4)).filter(Boolean));
    for (const r of reviews || []) if (Number.isInteger(r.year)) ys.add(r.year);
    if (todayKey) ys.add(+todayKey.slice(0, 4));
    return [...ys].sort((a, b) => b - a);
  }
  const fmtInt = n => Number(n || 0).toLocaleString('en-US');
  function yearNumbersLines(stats, skills) {
    const sk = id => (skills || []).find(s => s.id === id);
    const out = [];
    if (!stats.checkins) return ['_No check-ins recorded this year._'];
    const range = stats.firstDay ? ` (tracking since ${MONTHS_FULL[+stats.firstDay.slice(5, 7) - 1]} ${+stats.firstDay.slice(8, 10)})` : '';
    out.push(`- **${fmtInt(stats.checkins)} check-ins**: ${fmtInt(stats.habits)} habit check-ins, ${fmtInt(stats.tasks)} tasks, ${fmtInt(stats.subtasks)} sub-tasks, on ${fmtInt(stats.activeDays)} days${range}`);
    out.push(`- **${fmtInt(stats.xp)} XP** earned · overall level ${stats.levelStart} → ${stats.levelEnd}`);
    if (stats.bestMonth) out.push(`- Best month: ${MONTHS_FULL[stats.bestMonth.month]} (${fmtInt(stats.bestMonth.count)} check-ins)${stats.quietMonth ? ` · quietest: ${MONTHS_FULL[stats.quietMonth.month]} (${fmtInt(stats.quietMonth.count)})` : ''}`);
    if (stats.topHabits.length) out.push(`- Top habits: ${stats.topHabits.map(h => `${h.text} (${fmtInt(h.count)})`).join(', ')}`);
    if (stats.streaks.length) out.push(`- Longest streaks: ${stats.streaks.map(s => `${s.text} ${s.best} in a row`).join(', ')}`);
    if (stats.skills.length) out.push(`- Skills: ${stats.skills.map(s => { const k = sk(s.skillId); return `${k ? k.icon + ' ' + k.name : 'Other'} +${fmtInt(s.xp)} XP${s.levelEnd > s.levelStart ? ` (Lv ${s.levelStart} → ${s.levelEnd})` : ''}`; }).join(', ')}`);
    if (stats.achievements.length) out.push(`- Achievements: ${stats.achievements.map(a => `${a.icon} ${a.name}`).join(', ')}`);
    const months = [];
    for (let m = stats.firstMonth === null ? 0 : stats.firstMonth; m <= stats.lastMonth; m++) months.push(`${MONTHS[m]} ${fmtInt(stats.byMonth[m])}`);
    if (months.length) out.push(`- Check-ins by month: ${months.join(' · ')}`);
    return out;
  }
  function valueEvidence(value, stats, skills) {
    const parts = (value.skillIds || []).map(id => {
      const s = (skills || []).find(x => x.id === id);
      const row = stats.skills.find(x => x.skillId === id);
      return s ? `${s.icon} ${s.name} +${fmtInt(row ? row.xp : 0)} XP` : null;
    }).filter(Boolean);
    return parts.length ? `Evidence this year: ${parts.join(', ')}` : '';
  }
  // Markdown for sharing or printing. kind: 'annual' | 'integrity'.
  function reviewMarkdown(kind, year, stats, review, values, skills) {
    const ans = (review && review.answers) || {};
    const text = s => String(s || '').trim() || '_(not written yet)_';
    const oneLine = s => String(s || '').replace(/\s*\n+\s*/g, ' ').trim();
    const lines = [];
    if (kind === 'integrity') {
      lines.push(`# ${year} Integrity Report`, '', `## ${INTEGRITY_QUESTIONS[0][1]}`, '');
      if (values.length) for (const v of values) lines.push(`- **${v.name}**${v.questions ? ` — ${oneLine(v.questions)}` : ''}`);
      else lines.push('_(no core values yet)_');
      lines.push('', `## ${INTEGRITY_QUESTIONS[1][1]}`, '');
      if (String(ans.living || '').trim()) lines.push(ans.living.trim(), '');
      for (const v of values) {
        lines.push(`### ${v.name}`, '');
        if (v.questions) lines.push(`*${oneLine(v.questions)}*`, '');
        const ev = valueEvidence(v, stats, skills);
        if (ev) lines.push(ev, '');
        lines.push(text((ans.values || {})[v.id]), '');
      }
      if (!values.length && !String(ans.living || '').trim()) lines.push(text(''), '');
      lines.push(`## ${INTEGRITY_QUESTIONS[2][1]}`, '', text(ans.higher));
    } else {
      lines.push(`# ${year} Annual Review`, '', '## Year in numbers', '', ...yearNumbersLines(stats, skills));
      for (const [k, q] of ANNUAL_QUESTIONS) lines.push('', `## ${q}`, '', text(ans[k]));
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // ---------- achievements ----------
  function nextThreshold(current) {
    current = Number(current) || 0;
    for (const v of TIER_LADDER) if (v > current) return v;
    let v = TIER_LADDER[TIER_LADDER.length - 1];
    while (v <= current) v *= 2;
    return v;
  }
  function achievementContext(state, now) {
    const todayKey = todayOf(state, now);
    return {
      state, todayKey,
      skills: state.skills || [],
      itemsById: byId(state.items),
      index: indexCompletions(state.completions),
      totals: xpTotals(state.completions)
    };
  }
  function achievementProgress(a, ctx) {
    const threshold = Math.max(1, Math.floor(Number(a.threshold) || 1));
    const scope = a.scope || { type: 'all' };
    let value = 0;
    switch (a.kind) {
      case 'count': {
        const metric = a.metric || 'completions';
        const wantKind = KIND_BY_METRIC[metric] || null;
        for (const c of ctx.state.completions) {
          if (wantKind && c.kind !== wantKind) continue;
          if (scope.type === 'category' && c.categoryId !== scope.id) continue;
          if (scope.type === 'skill' && c.skillId !== scope.id) continue;
          if (scope.type === 'item' && c.itemId !== scope.id) continue;
          value++;
        }
        break;
      }
      case 'streak': {
        if (scope.type === 'item') {
          const it = ctx.itemsById.get(scope.id);
          value = it ? streak(it, ctx.index, ctx.todayKey).current : 0;
        } else {
          for (const it of ctx.state.items) {
            if (it.type !== 'habit' || it.parentId) continue;
            if (scope.type === 'category' && it.categoryId !== scope.id) continue;
            if (scope.type === 'skill' && it.skillId !== scope.id) continue;
            value = Math.max(value, streak(it, ctx.index, ctx.todayKey).current);
          }
        }
        break;
      }
      case 'level': {
        const skillLevel = id => levelFromXp(ctx.totals.bySkill[id] || 0).level;
        if (scope.type === 'skill') value = skillLevel(scope.id);
        else if (scope.type === 'anySkill') value = ctx.skills.reduce((m, s) => Math.max(m, skillLevel(s.id)), ctx.skills.length ? 1 : 0);
        else if (scope.type === 'everySkill') value = ctx.skills.length ? Math.min(...ctx.skills.map(s => skillLevel(s.id))) : 0;
        else if (scope.type === 'category') value = levelFromXp(ctx.totals.byCategory[scope.id] || 0).level;
        else value = levelFromXp(ctx.totals.overall).level;
        break;
      }
      case 'manual':
        value = a.unlockedAt ? 1 : 0;
        break;
    }
    return { value, threshold, fraction: Math.min(1, value / threshold) };
  }
  // Returns copies: `unlocked` (with unlockedAt set) and `created` (next ladder tiers). Loops until stable.
  function checkAchievements(state, now, opts) {
    now = now === undefined ? new Date() : now;
    const idGen = (opts && opts.idGen) || newId;
    const nowIso = iso(now);
    const ctx = achievementContext(state, now);
    const working = state.achievements.map(a => Object.assign({}, a));
    const unlocked = [], created = [];
    for (let i = 0; i < working.length; i++) {
      const a = working[i];
      if (a.unlockedAt || a.kind === 'manual') continue;
      const p = achievementProgress(a, ctx);
      if (p.value < p.threshold) continue;
      a.unlockedAt = nowIso;
      unlocked.push(a);
      if (a.autoTier && (a.kind === 'count' || a.kind === 'streak')) {
        const tier = (a.tier || 1) + 1;
        // The next tier's id comes from its series, so two devices that reach it before syncing make the same record.
        if (working.some(w => w.seriesId === a.seriesId && (w.tier || 1) === tier)) continue;
        const next = Object.assign({}, a, {
          id: opts && opts.idGen ? idGen() : `${a.seriesId}-t${tier}`, threshold: nextThreshold(a.threshold), unlockedAt: null, createdAt: nowIso, tier
        });
        delete next.seedKey;
        working.push(next);
        created.push(next);
      }
    }
    return { unlocked, created };
  }
  function achievementName(a) {
    const name = String(a.name || '');
    if (name.includes('{n}')) return name.replace(/\{n\}/g, String(a.threshold));
    return (a.tier || 1) > 1 ? `${name} (${a.threshold})` : name;
  }

  // ---------- quick entry ----------
  const matchCategory = matchByName;
  function validDay(y, m, d) {
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return fmtDay(dt);
  }
  function weekdayIndex(s) {
    s = String(s || '').toLowerCase();
    let i = WEEKDAYS.indexOf(s);
    if (i < 0) i = WEEKDAYS_FULL.indexOf(s);
    if (i < 0 && ['tues', 'weds', 'thur', 'thurs'].includes(s)) i = WEEKDAYS.indexOf(s.slice(0, 3));
    return i;
  }
  function parseDateToken(tok, todayKey) {
    const t = String(tok || '').toLowerCase();
    if (!todayKey) return null;
    if (t === 'today' || t === 'tod') return todayKey;
    if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return addDays(todayKey, 1);
    const wd = weekdayIndex(t);
    if (wd >= 0) return addDays(todayKey, (wd - weekdayOf(todayKey) + 7) % 7);
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return validDay(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t))) {
      if (m[3]) return validDay(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
      const y = +todayKey.slice(0, 4);
      let k = validDay(y, +m[1], +m[2]);
      if (k && k < todayKey) k = validDay(y + 1, +m[1], +m[2]);
      return k;
    }
    return null;
  }
  function parseRepeatToken(tok, todayKey, weeklyDay) {
    const t = String(tok || '').toLowerCase();
    if (['daily', 'day', 'everyday'].includes(t)) return { kind: 'daily', days: ALL_DAYS.slice() };
    if (['weekly', 'week'].includes(t)) return { kind: 'weekly', days: [Number.isInteger(weeklyDay) ? weeklyDay : (todayKey ? weekdayOf(todayKey) : 1)] };
    if (t === 'weekdays') return { kind: 'custom', days: [1, 2, 3, 4, 5] };
    if (t === 'weekends') return { kind: 'custom', days: [0, 6] };
    const parts = t.split(',').filter(Boolean);
    const days = [...new Set(parts.map(weekdayIndex))].filter(d => d >= 0).sort((a, b) => a - b);
    if (parts.length && days.length === parts.length) return { kind: days.length === 7 ? 'daily' : 'custom', days };
    return null;
  }
  // Strips !tier, #list, +skill, @date, ^repeat and xN tokens; unrecognized tokens stay in the text.
  // opts.weeklyDay: the weekday `^weekly` means (a day list's day); default today's.
  function parseQuickEntry(text, lists, todayKey, skills, opts) {
    lists = lists || [];
    skills = skills || [];
    const weeklyDay = opts && Number.isInteger(opts.weeklyDay) ? opts.weeklyDay : undefined;
    const out = { text: '', tier: null, categoryId: null, skillId: null, due: null, repeat: null, timesPerDay: null, tokens: [] };
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const keep = [];
    for (const w of words) {
      let m;
      if ((m = /^!([1-5])$/.exec(w))) { out.tier = +m[1]; out.tokens.push(w); continue; }
      if ((m = /^#(\S+)$/.exec(w))) {
        const cat = matchByName(lists, m[1]);
        if (cat) { out.categoryId = cat.id; out.tokens.push(w); continue; }
      }
      if ((m = /^\+(\S+)$/.exec(w))) {
        const sk = matchByName(skills, m[1]);
        if (sk) { out.skillId = sk.id; out.tokens.push(w); continue; }
      }
      if ((m = /^@(\S+)$/.exec(w))) {
        const d = parseDateToken(m[1], todayKey);
        if (d) { out.due = d; out.tokens.push(w); continue; }
      }
      if ((m = /^\^(\S+)$/.exec(w))) {
        const r = parseRepeatToken(m[1], todayKey, weeklyDay);
        if (r) { out.repeat = r; out.tokens.push(w); continue; }
      }
      if ((m = /^[x×](\d{1,2})$/i.exec(w)) && +m[1] >= 2) { out.timesPerDay = +m[1]; out.tokens.push(w); continue; }
      keep.push(w);
    }
    out.text = keep.join(' ').trim();
    if (out.timesPerDay && !out.repeat) out.repeat = { kind: 'daily', days: ALL_DAYS.slice() };
    if (out.repeat) out.due = null;
    return out;
  }

  // ---------- AI: skill check for typed items ----------
  const SKILL_TOOL = Object.freeze({
    name: 'assign_skills',
    description: 'Assign each item to the one skill it trains or improves most.',
    input_schema: {
      type: 'object',
      properties: {
        assignments: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, skill_id: { type: 'string' } }, required: ['id', 'skill_id'] }
        }
      },
      required: ['assignments']
    }
  });
  function skillSystemPrompt() {
    return 'You sort a person\'s to-dos and habits into the one skill each trains or improves most, like stats in a life RPG. ' +
      'Use each skill\'s name and hint. Prefer the most specific fit: lifting → strength-type skills; stretching or mobility → dexterity-type; ' +
      'cardio → endurance-type; sleep, water, food, health care → vitality-type; journaling, meditation or prayer → clarity-type; ' +
      'reading or studying → learning-type; chores, errands and admin → upkeep-type. Judge sub-tasks by their own text and use the ' +
      'parent only as context. Return every item id exactly once with a skill_id from the list.';
  }
  function skillContext(skills) { return skills.map(s => ({ id: s.id, name: s.name, hint: String(s.hint || '') })); }
  function buildSkillRequest(model, skills, items, itemsById) {
    const payload = {
      skills: skillContext(skills),
      items: items.map(it => {
        const o = { id: it.id, text: String(it.text || '').slice(0, 160), type: it.parentId ? 'subtask' : it.type };
        const p = it.parentId && itemsById ? itemsById.get(it.parentId) : null;
        if (p) o.parent = String(p.text || '').slice(0, 80);
        return o;
      })
    };
    return {
      model: model || DEFAULT_MODEL,
      max_tokens: 2048,
      system: skillSystemPrompt(),
      tools: [SKILL_TOOL],
      tool_choice: { type: 'tool', name: 'assign_skills' },
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    };
  }
  // → [{ id, skillId }] for valid pairs, or null when the response has no assign_skills tool call.
  function parseSkillResponse(resp, skills, itemIds) {
    const blocks = resp && Array.isArray(resp.content) ? resp.content : [];
    const tool = blocks.find(b => b && b.type === 'tool_use' && b.name === 'assign_skills');
    if (!tool || !tool.input || !Array.isArray(tool.input.assignments)) return null;
    const valid = new Set(itemIds), seen = new Set(), out = [];
    for (const a of tool.input.assignments) {
      if (!a || !valid.has(a.id) || seen.has(a.id)) continue;
      const sk = resolveSkill(skills, a.skill_id);
      if (!sk) continue;
      seen.add(a.id);
      out.push({ id: a.id, skillId: sk.id });
    }
    return out;
  }

  // ---------- AI: capture (photo / paste) ----------
  const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'my', 'for', 'of', 'and', 'on', 'in', 'at', 'up']);
  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w && !STOP_WORDS.has(w)).join(' ');
  }
  function findDuplicate(text, activeItems) {
    const n = normalizeText(text);
    if (!n) return null;
    return activeItems.find(it => normalizeText(it.text) === n) || null;
  }
  // First balanced {...} object in free text (tolerates code fences and prose).
  function extractJson(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, escp = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (escp) escp = false;
        else if (ch === '\\') escp = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }
  // Normalize a record_items payload (photo tool output or pasted JSON) into app items.
  // Accepts list_id/list (v1.1) and category_id/category (v1.0 prompts).
  function normalizeCapture(input, lists, skills, defaultListId, activeItems) {
    const out = { items: [], unreadable: [] };
    if (!input || typeof input !== 'object') return out;
    lists = lists || []; skills = skills || [];
    const byName = new Map(lists.map(c => [String(c.name).toLowerCase(), c.id]));
    const ids = new Set(lists.map(c => c.id));
    const activeById = byId(activeItems || []);
    for (const raw of Array.isArray(input.items) ? input.items : []) {
      if (!raw || typeof raw !== 'object') continue;
      const text = String(raw.text || '').trim();
      if (!text) continue;
      const listIdRef = raw.list_id || raw.category_id;
      const listNameRef = raw.list || raw.category;
      let categoryId = null;
      if (listIdRef && ids.has(listIdRef)) categoryId = listIdRef;
      else if (listNameRef && byName.has(String(listNameRef).toLowerCase())) categoryId = byName.get(String(listNameRef).toLowerCase());
      else if (listNameRef) { const c = matchByName(lists, String(listNameRef).replace(/\s+/g, '')); if (c) categoryId = c.id; }
      if (!categoryId) categoryId = defaultListId;
      let skillId = null, skillSource = null;
      const sk = resolveSkill(skills, raw.skill_id || raw.skill);
      if (sk) { skillId = sk.id; skillSource = 'ai'; }
      else { const g = inferSkill(text, skills); if (g) { skillId = g.skillId; skillSource = 'auto'; } }
      const type = raw.type === 'habit' ? 'habit' : 'task';
      const tpd = Math.min(99, Math.max(1, Math.floor(Number(raw.times_per_day) || 1)));
      let duplicateOfId = raw.duplicate_of_id && activeById.has(raw.duplicate_of_id) ? raw.duplicate_of_id : null;
      if (!duplicateOfId) { const d = findDuplicate(text, activeItems || []); if (d) duplicateOfId = d.id; }
      out.items.push({ text, type, categoryId, skillId, skillSource, tier: clampTier(raw.tier), timesPerDay: type === 'habit' ? tpd : 1, duplicateOfId });
    }
    for (const raw of Array.isArray(input.unreadable) ? input.unreadable : []) {
      const g = raw && typeof raw === 'object' ? String(raw.best_guess || '').trim() : String(raw || '').trim();
      if (g) out.unreadable.push({ bestGuess: g });
    }
    return out;
  }
  const CAPTURE_RULES = 'You read a photographed handwritten note card and extract the to-do items on it. One item per line on the card. ' +
    'Skip dates, headers, doodles, and crossed-out lines. Put lines you cannot read confidently into unreadable[] with your best guess. ' +
    'For each item choose: the list it belongs in from the user\'s lists (if none clearly fits, the list it was opened from, else the first list); ' +
    'the one skill it trains or improves most (use the skill hints); type "habit" only for clearly recurring routines (otherwise "task"); ' +
    'a tier from the rubric; and times_per_day only when the card states a count (e.g. "water x8").';
  const CAPTURE_TOOL = Object.freeze({
    name: 'record_items',
    description: 'Record the items read from the card.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['task', 'habit'] },
              list_id: { type: 'string' },
              skill_id: { type: 'string' },
              tier: { type: 'integer', minimum: 1, maximum: 5 },
              times_per_day: { type: 'integer', minimum: 1, description: 'Only when the card says a count, e.g. "water x8"' },
              duplicate_of_id: { type: ['string', 'null'] }
            },
            required: ['text', 'type', 'list_id', 'skill_id', 'tier', 'duplicate_of_id']
          }
        },
        unreadable: {
          type: 'array',
          items: { type: 'object', properties: { best_guess: { type: 'string' } }, required: ['best_guess'] }
        }
      },
      required: ['items', 'unreadable']
    }
  });
  function captureSystemPrompt() {
    return CAPTURE_RULES + ' Set duplicate_of_id when an item matches an existing active item (same intent, not just a shared word), otherwise null.';
  }
  function captureContext(lists, skills, activeItems, openedFromListId) {
    const active = (activeItems || []).slice(-300).map(it => ({
      id: it.id, text: String(it.text || '').slice(0, 80), list_id: it.categoryId, type: it.type
    }));
    return {
      lists: (lists || []).map(c => ({ id: c.id, name: c.name })),
      skills: skillContext(skills || []),
      active_items: active,
      tier_rubric: TIER_RUBRIC,
      opened_from_list_id: openedFromListId || null
    };
  }
  function buildCaptureRequest(model, imageBase64, mediaType, lists, skills, activeItems, openedFromListId) {
    return {
      model: model || DEFAULT_MODEL,
      max_tokens: 4096,
      system: captureSystemPrompt(),
      tools: [CAPTURE_TOOL],
      tool_choice: { type: 'tool', name: 'record_items' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: JSON.stringify(captureContext(lists, skills, activeItems, openedFromListId)) }
        ]
      }]
    };
  }
  function parseCaptureResponse(resp) {
    const blocks = resp && Array.isArray(resp.content) ? resp.content : [];
    const tool = blocks.find(b => b.type === 'tool_use' && b.name === 'record_items');
    if (!tool || !tool.input || typeof tool.input !== 'object') return null;
    return tool.input;
  }
  // Prompt for the paste flow: any Claude chat turns a photo into the JSON contract.
  function buildPastePrompt(lists, skills) {
    const listNames = (lists || []).map(c => c.name).join(', ');
    const skillLines = (skills || []).map(s => `${s.name}${s.hint ? ` (${s.hint})` : ''}`).join('; ');
    const rubric = Object.keys(TIER_RUBRIC).map(k => `${k} = ${TIER_RUBRIC[k]}`).join('; ');
    const exList = (lists && lists[0] && lists[0].name) || 'Reminders';
    const exSkill = ((skills || []).find(s => s.id === 'sk_upkeep') || (skills || [])[0] || { name: 'Upkeep' }).name;
    return [
      'When I send a photo of a handwritten note card, extract the to-do items and reply with ONE fenced JSON block and nothing else.',
      CAPTURE_RULES,
      `My lists (use the name exactly): ${listNames}.`,
      `My skills (use the name exactly; what counts in parentheses): ${skillLines}.`,
      `Tier rubric: ${rubric}.`,
      'Format:',
      '```json',
      `{"items":[{"text":"Renew passport","type":"task","list":"${exList}","skill":"${exSkill}","tier":3,"times_per_day":1}],"unreadable":[{"best_guess":"Call d…tist?"}]}`,
      '```'
    ].join('\n');
  }

  // ---------- seeds / defaults / backup ----------
  const SEED_LISTS = Object.freeze([{ id: 'list_reminders', name: 'Reminders', color: 'blue', icon: '📋' }]);
  function seedLists(nowIso) { return SEED_LISTS.map((c, i) => Object.assign({}, c, { days: null, showOnPlanner: true, sortOrder: i, createdAt: nowIso || null })); }
  function defaultPages() { return { planner: true, habits: true, review: true }; }
  function normalizePages(p) {
    const out = defaultPages();
    if (p && typeof p === 'object') for (const k of OPTIONAL_PAGES) if (typeof p[k] === 'boolean') out[k] = p[k];
    return out;
  }
  // The tabs to show, in order. Lists and Skills are always on.
  function enabledPages(settings) {
    const p = normalizePages(settings && settings.pages);
    return PAGES.filter(k => !OPTIONAL_PAGES.includes(k) || p[k]);
  }
  function startPage(settings) { return normalizePages(settings && settings.pages).planner ? 'planner' : 'lists'; }
  function seedSkills(nowIso) { return SEED_SKILLS.map((s, i) => Object.assign({}, s, { sortOrder: i, createdAt: nowIso || null })); }
  function mkAchievement(idGen, nowIso, seedKey, name, icon, kind, extra) {
    return Object.assign({
      id: idGen(), seedKey, name, icon, kind, scope: { type: 'all' }, threshold: 10, autoTier: kind === 'count' || kind === 'streak',
      seriesId: idGen(), tier: 1, unlockedAt: null, createdAt: nowIso || null
    }, extra);
  }
  function seedSkillAchievements(nowIso, idGen) {
    idGen = idGen || newId;
    return [
      mkAchievement(idGen, nowIso, 'specialist', 'Specialist · a skill at Level {n}', '⚡', 'level', { scope: { type: 'anySkill' }, threshold: 5 }),
      mkAchievement(idGen, nowIso, 'well-rounded', 'Well-Rounded · every skill at Level {n}', '🧭', 'level', { scope: { type: 'everySkill' }, threshold: 3 })
    ];
  }
  function seedAchievements(nowIso, idGen) {
    idGen = idGen || newId;
    return [
      mkAchievement(idGen, nowIso, 'getting-started', 'Getting Started · {n} items done', '✅', 'count', { metric: 'completions' }),
      mkAchievement(idGen, nowIso, 'detail-oriented', 'Detail Oriented · {n} sub-tasks done', '🧩', 'count', { metric: 'subtasks' }),
      mkAchievement(idGen, nowIso, 'habit-builder', 'Habit Builder · {n} habit check-ins', '🔁', 'count', { metric: 'habits' }),
      mkAchievement(idGen, nowIso, 'task-slayer', 'Task Slayer · {n} tasks done', '⚔️', 'count', { metric: 'tasks' }),
      mkAchievement(idGen, nowIso, 'on-a-roll', 'On a Roll · {n}-day streak', '🔥', 'streak', { threshold: 7 }),
      mkAchievement(idGen, nowIso, 'level-5', 'Level {n} overall', '⭐', 'level', { threshold: 5 }),
      mkAchievement(idGen, nowIso, 'level-10', 'Level {n} overall', '🌟', 'level', { threshold: 10 })
    ].concat(seedSkillAchievements(nowIso, idGen));
  }
  function defaultSettings(nowIso) {
    return {
      id: 'settings', dayStartHour: DAY_START_HOUR, defaultCategoryId: SEED_LISTS[0].id, model: DEFAULT_MODEL,
      aiSkillCheck: true, lastBackupAt: null, firstLaunchAt: nowIso || null, onboarded: false,
      pages: defaultPages(), coreValues: [], reviewDismissed: {}, schemaVersion: SCHEMA_VERSION
    };
  }
  function normalizeItem(raw, todayKey) {
    const type = raw.type === 'habit' ? 'habit' : 'task';
    return {
      id: String(raw.id || newId()),
      text: String(raw.text || ''),
      notes: String(raw.notes || ''),
      type,
      categoryId: raw.categoryId ? String(raw.categoryId) : null,
      skillId: raw.skillId ? String(raw.skillId) : null,
      skillSource: SKILL_SOURCES.includes(raw.skillSource) ? raw.skillSource : null,
      aiCheckedAt: raw.aiCheckedAt ? String(raw.aiCheckedAt) : null,
      tier: clampTier(raw.tier),
      parentId: raw.parentId ? String(raw.parentId) : null,
      due: type === 'task' && isDayKey(raw.due) ? raw.due : null,
      repeat: type === 'habit' ? normalizeRepeat(raw.repeat || { kind: 'daily' }, todayKey) : null,
      timesPerDay: type === 'habit' ? Math.min(99, targetOf(raw)) : 1,
      sortOrder: Number(raw.sortOrder) || 0,
      createdAt: raw.createdAt || null
    };
  }
  function stateVersion(d) {
    return Number((d && (d.schemaVersion || (d.settings && d.settings.schemaVersion))) || 1);
  }
  // v1 → v2: seed skills, give every item and past completion a skill, retarget list-level achievements.
  function upgradeToV2(state, nowIso, idGen) {
    if (!state.skills.length) state.skills = seedSkills(nowIso);
    const itemsById = byId(state.items);
    const assign = it => {
      if (it.skillId) return;
      const g = inferSkill(it.text, state.skills);
      let sid = g ? g.skillId : null;
      if (!sid && it.parentId) { const p = itemsById.get(it.parentId); sid = p ? p.skillId || null : null; }
      if (!sid && !it.parentId) sid = LEGACY_LIST_SKILL[it.categoryId] || null;
      it.skillId = sid;
      it.skillSource = sid ? 'auto' : null;
      it.aiCheckedAt = null;
    };
    state.items.filter(i => !i.parentId).forEach(assign);
    state.items.filter(i => i.parentId).forEach(assign);
    const skillIds = new Set(state.skills.map(s => s.id));
    for (const c of state.completions) {
      if (c.skillId) continue;
      const it = itemsById.get(c.itemId);
      if (it) c.skillId = it.skillId;
      else { const g = inferSkill(c.text, state.skills); c.skillId = g ? g.skillId : (LEGACY_LIST_SKILL[c.categoryId] || null); }
      if (c.skillId && !skillIds.has(c.skillId)) c.skillId = null;
    }
    for (const a of state.achievements) {
      if (a.kind === 'level' && a.scope && a.scope.type === 'category') {
        const sid = LEGACY_LIST_SKILL[a.scope.id];
        a.scope = sid && skillIds.has(sid) ? { type: 'skill', id: sid } : { type: 'all' };
      }
    }
    for (const a of seedSkillAchievements(nowIso, idGen)) {
      if (!state.achievements.some(x => x.seedKey === a.seedKey)) state.achievements.push(a);
    }
    if (typeof state.settings.aiSkillCheck !== 'boolean') state.settings.aiSkillCheck = true;
  }
  // One record of each kind, cleaned up the same way whether it comes from storage, a backup or another device.
  function normalizeCategory(c, i, fromVersion) {
    return {
      id: String(c.id || newId()), name: String(c.name || 'Untitled'), color: COLORS.includes(c.color) ? c.color : 'blue',
      icon: String(c.icon || '📋'),
      // v3: day lists. Older data gets its days from the list name ("Monday", "Sat + Sun").
      days: (fromVersion || SCHEMA_VERSION) < 3 && c.days === undefined ? detectListDays(c.name) : normalizeDays(c.days),
      showOnPlanner: c.showOnPlanner !== false,
      sortOrder: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : (i || 0), createdAt: c.createdAt || null
    };
  }
  function normalizeSkill(s, i) {
    return {
      id: String(s.id || newId()), name: String(s.name || 'Skill'), icon: String(s.icon || '⭐'),
      color: COLORS.includes(s.color) ? s.color : 'blue', hint: String(s.hint || ''),
      sortOrder: Number.isFinite(Number(s.sortOrder)) ? Number(s.sortOrder) : (i || 0), createdAt: s.createdAt || null
    };
  }
  function normalizeCompletion(c) {
    return {
      id: String(c.id || newId()), itemId: String(c.itemId), categoryId: c.categoryId ? String(c.categoryId) : null,
      skillId: c.skillId ? String(c.skillId) : null,
      kind: ['task', 'habit', 'subtask'].includes(c.kind) ? c.kind : 'task', dayKey: c.dayKey, at: c.at || null,
      tier: clampTier(c.tier), xp: Number.isFinite(Number(c.xp)) ? Number(c.xp) : xpForTier(c.tier), text: String(c.text || '')
    };
  }
  function normalizeAchievement(a) {
    const out = {
      id: String(a.id || newId()), name: String(a.name || 'Achievement'), icon: String(a.icon || '🏆'),
      kind: ['count', 'streak', 'level', 'manual'].includes(a.kind) ? a.kind : 'manual',
      metric: ['completions', 'tasks', 'habits', 'subtasks'].includes(a.metric) ? a.metric : (a.kind === 'count' ? 'completions' : undefined),
      scope: a.scope && SCOPE_TYPES.includes(a.scope.type) ? { type: a.scope.type, id: a.scope.id ? String(a.scope.id) : undefined } : { type: 'all' },
      threshold: Math.max(1, Math.floor(Number(a.threshold) || 1)), autoTier: !!a.autoTier,
      seriesId: String(a.seriesId || a.id || newId()), tier: Math.max(1, Math.floor(Number(a.tier) || 1)),
      unlockedAt: a.unlockedAt || null, createdAt: a.createdAt || null
    };
    if (a.seedKey) out.seedKey = String(a.seedKey);
    return out;
  }
  function normalizeState(data, todayKey, nowIso, opts) {
    const d = data || {};
    const fromVersion = stateVersion(d);
    const idGen = (opts && opts.idGen) || newId;
    const settings = Object.assign(defaultSettings(null), d.settings || {}, { id: 'settings' });
    const categories = (Array.isArray(d.categories) ? d.categories : []).filter(c => c && typeof c === 'object').map((c, i) => normalizeCategory(c, i, fromVersion));
    const skills = (Array.isArray(d.skills) ? d.skills : []).filter(s => s && typeof s === 'object').map((s, i) => normalizeSkill(s, i));
    // Records with the same id (only possible in a hand-edited backup) keep the first copy.
    const uniqueById = arr => { const seen = new Set(); return arr.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true))); };
    const items = uniqueById((Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x === 'object').map(x => normalizeItem(x, todayKey)));
    const itemIds = new Set(items.map(i => i.id));
    for (const it of items) if (it.parentId && !itemIds.has(it.parentId)) it.parentId = null;
    const completions = (Array.isArray(d.completions) ? d.completions : []).filter(c => c && c.itemId && isDayKey(c.dayKey)).map(normalizeCompletion);
    const achievements = (Array.isArray(d.achievements) ? d.achievements : []).filter(a => a && typeof a === 'object').map(normalizeAchievement);
    const reviewMap = new Map();
    for (const r of Array.isArray(d.reviews) ? d.reviews : []) {
      if (!r || typeof r !== 'object') continue;
      const n = normalizeReview(r, todayKey ? +String(todayKey).slice(0, 4) : null);
      reviewMap.set(n.id, n);
    }
    const reviews = [...reviewMap.values()];
    const state = { settings, categories: uniqueById(categories), skills: uniqueById(skills), items, completions: uniqueById(completions), achievements: uniqueById(achievements), reviews };
    if (fromVersion < 2) upgradeToV2(state, nowIso || null, idGen);
    if (fromVersion < 3) {
      // v2 → v3: prayer joined Clarity's hint (only if you hadn't edited it).
      const clarity = state.skills.find(s => s.id === 'sk_clarity');
      if (clarity && clarity.hint === OLD_CLARITY_HINT) clarity.hint = SEED_SKILLS.find(s => s.id === 'sk_clarity').hint;
    }
    const skillIds = new Set(state.skills.map(s => s.id));
    for (const it of state.items) {
      if (it.skillId && !skillIds.has(it.skillId)) { it.skillId = null; it.skillSource = null; it.aiCheckedAt = null; }
    }
    if (!state.categories.some(c => c.id === settings.defaultCategoryId)) settings.defaultCategoryId = state.categories.length ? state.categories[0].id : null;
    if (typeof settings.aiSkillCheck !== 'boolean') settings.aiSkillCheck = true;
    settings.pages = normalizePages(settings.pages);
    settings.coreValues = (Array.isArray(settings.coreValues) ? settings.coreValues : []).filter(v => v && typeof v === 'object' && String(v.name || '').trim())
      .map(v => normalizeCoreValue(v, skillIds));
    settings.reviewDismissed = settings.reviewDismissed && typeof settings.reviewDismissed === 'object' && !Array.isArray(settings.reviewDismissed)
      ? Object.fromEntries(Object.entries(settings.reviewDismissed).filter(([, v]) => v)) : {};
    settings.schemaVersion = SCHEMA_VERSION;
    Object.defineProperty(state, 'migratedFrom', { value: fromVersion < SCHEMA_VERSION ? fromVersion : null, enumerable: false });
    return state;
  }
  function buildBackup(state, appVersion, nowIso) {
    const settings = Object.assign({}, state.settings || {});
    delete settings.apiKey; // belt and braces: secrets live in their own store, but never leak them
    return {
      app: APP_ID, schemaVersion: SCHEMA_VERSION, appVersion: appVersion || null, exportedAt: nowIso,
      settings, categories: state.categories, skills: state.skills || [], items: state.items,
      completions: state.completions, achievements: state.achievements, reviews: state.reviews || []
    };
  }
  function validateBackup(obj, todayKey, nowIso) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a JSON object.' };
    if (obj.app !== APP_ID) return { ok: false, error: 'Not a Habit Tracker backup.' };
    const v = Number(obj.schemaVersion) || 1;
    if (v > SCHEMA_VERSION) return { ok: false, error: `Backup schema v${v} is newer than this app (v${SCHEMA_VERSION}). Update the app first.` };
    if (!Array.isArray(obj.categories) || !Array.isArray(obj.items)) return { ok: false, error: 'Backup is missing lists or items.' };
    const data = normalizeState(obj, todayKey, nowIso);
    return { ok: true, data, fromVersion: v };
  }


  // ---------- sync (accounts + a cloud copy, app 1.3) ----------
  // Every list, item, check-in, skill, achievement and review syncs as its own record. Settings sync as one record
  // that holds only the shared preferences: never the API key, and not device-only fields (backup date, first launch).
  // Conflicts: the newest edit wins (ms timestamps); exact ties go to the higher device id. The server uses the same rule.
  const SYNC_STORES = Object.freeze(['categories', 'items', 'completions', 'achievements', 'skills', 'reviews', 'settings']);
  const SYNCED_SETTINGS = Object.freeze(['dayStartHour', 'defaultCategoryId', 'model', 'aiSkillCheck', 'pages', 'coreValues', 'reviewDismissed', 'plannerSetupDismissed']);
  function syncKey(store, id) { return store + ':' + id; }
  function splitSyncKey(k) {
    const s = String(k), i = s.indexOf(':');
    return i <= 0 ? null : { store: s.slice(0, i), id: s.slice(i + 1) };
  }
  function syncedSettings(settings) {
    const out = {};
    for (const k of SYNCED_SETTINGS) if (settings && settings[k] !== undefined) out[k] = JSON.parse(JSON.stringify(settings[k]));
    return out;
  }
  // Settings from another device: keep only known, well-formed fields (skill links in values are kept as-is,
  // since the skill may arrive later in the same sync).
  function normalizeSyncedSettings(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    if (Number.isInteger(r.dayStartHour) && r.dayStartHour >= 0 && r.dayStartHour <= 23) out.dayStartHour = r.dayStartHour;
    if (typeof r.defaultCategoryId === 'string' || r.defaultCategoryId === null) out.defaultCategoryId = r.defaultCategoryId;
    if (typeof r.model === 'string' && r.model.trim()) out.model = r.model.trim();
    if (typeof r.aiSkillCheck === 'boolean') out.aiSkillCheck = r.aiSkillCheck;
    if (r.pages && typeof r.pages === 'object') out.pages = normalizePages(r.pages);
    if (Array.isArray(r.coreValues)) out.coreValues = r.coreValues.filter(v => v && typeof v === 'object' && String(v.name || '').trim()).map(v => normalizeCoreValue(v, null));
    if (r.reviewDismissed && typeof r.reviewDismissed === 'object' && !Array.isArray(r.reviewDismissed)) out.reviewDismissed = Object.fromEntries(Object.entries(r.reviewDismissed).filter(([, v]) => v === true));
    if (typeof r.plannerSetupDismissed === 'boolean') out.plannerSetupDismissed = r.plannerSetupDismissed;
    return out;
  }
  // A record from another device, cleaned up for this one. The row's id always wins. → record | null (unusable)
  function normalizeRecord(store, data, id, todayKey) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || id === undefined || id === null || id === '') return null;
    const d = Object.assign({}, data, { id: String(id) });
    switch (store) {
      case 'items': return normalizeItem(d, todayKey);
      case 'categories': return normalizeCategory(d, 0, SCHEMA_VERSION);
      case 'skills': return normalizeSkill(d, 0);
      case 'completions': return d.itemId && isDayKey(d.dayKey) ? normalizeCompletion(d) : null;
      case 'achievements': return normalizeAchievement(d);
      case 'reviews': { const r = normalizeReview(d, todayKey ? +String(todayKey).slice(0, 4) : null); return r.id === d.id ? r : null; }
      default: return null;
    }
  }
  // Edit time for a record: now, but always after the version this device last saw (so a local edit beats it
  // even if this clock runs behind).
  function syncStamp(prevU, nowMs) { return Math.max(Math.floor(Number(nowMs) || 0), (Number(prevU) || 0) + 1); }
  // Does version a ({u, v}) beat version b? u = edit time (ms), v = device id.
  function syncNewer(a, b) {
    if (!a) return false;
    if (!b) return true;
    const au = Number(a.u) || 0, bu = Number(b.u) || 0;
    if (au !== bu) return au > bu;
    return String(a.v || '') > String(b.v || '');
  }
  function decodeJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    try {
      let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const bin = atob(b);
      const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  // config.js → { url, key } when sync is set up, null when it isn't, { error } when it's set up wrong.
  // The publishable key is safe in a public repo (it only reaches what Row Level Security allows); a secret key is not.
  function syncConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const url = String(raw.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(raw.supabasePublishableKey || '').trim();
    if (!url && !key) return null;
    if (/^sb_secret_/i.test(key) || (decodeJwt(key) || {}).role === 'service_role') {
      return { error: 'config.js holds a secret key. Use the publishable key (sb_publishable_…) and rotate the secret key in Supabase.' };
    }
    if (!/^https:\/\/[^\s/?#]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
      return { error: 'The Supabase URL in config.js should look like https://abcd1234.supabase.co' };
    }
    if (!key) return { error: 'config.js is missing the publishable key (sb_publishable_…).' };
    return { url, key };
  }
  // Anything you made yourself (beyond the starter list, skills and achievements)?
  function hasUserData(state) {
    const s = state || {};
    const seedLists = new Set(SEED_LISTS.map(c => c.id)), seedSkills = new Set(SEED_SKILLS.map(x => x.id));
    const seedSeries = new Set((s.achievements || []).filter(a => a.seedKey).map(a => a.seriesId));
    return (s.items || []).length > 0 || (s.completions || []).length > 0 || (s.reviews || []).length > 0
      || (s.categories || []).some(c => !seedLists.has(c.id)) || (s.skills || []).some(x => !seedSkills.has(x.id))
      || (s.achievements || []).some(a => !a.seedKey && !seedSeries.has(a.seriesId))
      || ((s.settings && s.settings.coreValues) || []).length > 0;
  }
  // First sign-in on a device: empty account → upload this device; empty device → download the account;
  // both have data → ask.
  function firstSyncPlan(cloudHasData, localHasData) { return cloudHasData ? (localHasData ? 'choose' : 'download') : 'upload'; }
  // "Merge" on first sign-in: the account's copy wins for anything both have; this device's other records are added.
  // Starter achievements the account already has (same seedKey, different id) are dropped instead of doubled.
  // A review written more recently on this device than the account's copy (by updatedAt) is kept and uploaded.
  function mergePlan(state, cloudKeys, cloudSeedKeys, cloudReviewTimes) {
    const upload = [], drop = [], keepLocal = [];
    const ach = (state && state.achievements) || [];
    const droppedSeries = new Set(ach.filter(a => a.seedKey && cloudSeedKeys.has(a.seedKey) && !cloudKeys.has(syncKey('achievements', a.id))).map(a => a.seriesId));
    for (const store of SYNC_STORES) {
      if (store === 'settings') continue;
      for (const r of (state && state[store]) || []) {
        const k = syncKey(store, r.id);
        if (cloudKeys.has(k)) {
          if (store === 'reviews' && cloudReviewTimes && cloudReviewTimes.has(r.id) && String(r.updatedAt || '') > String(cloudReviewTimes.get(r.id) || '')) keepLocal.push(k);
          continue;
        }
        if (store === 'achievements' && droppedSeries.has(r.seriesId)) { drop.push({ store, id: r.id }); continue; }
        upload.push(k);
      }
    }
    return { upload, drop, keepLocal };
  }
  // Core values after a merge: the account's list, plus this device's values it doesn't have (by id or name).
  function mergeCoreValues(cloudValues, localValues) {
    const out = (cloudValues || []).slice();
    const ids = new Set(out.map(v => v.id)), names = new Set(out.map(v => String(v.name || '').trim().toLowerCase()));
    for (const v of localValues || []) if (!ids.has(v.id) && !names.has(String(v.name || '').trim().toLowerCase())) out.push(v);
    return out;
  }
  // Text bound for the cloud: Postgres refuses lone UTF-16 surrogates and \u0000 in JSON, so fix those first.
  function wellFormed(str) {
    if (typeof str.toWellFormed === 'function') return str.toWellFormed();
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { const d = str.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { out += str[i] + str[i + 1]; i++; } else out += '\uFFFD'; }
      else if (c >= 0xDC00 && c <= 0xDFFF) out += '\uFFFD';
      else out += str[i];
    }
    return out;
  }
  function cleanForSync(v) {
    if (typeof v === 'string') return wellFormed(v).replace(/\u0000/g, '');
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.map(x => (x === undefined ? null : cleanForSync(x)));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) if (v[k] !== undefined && typeof v[k] !== 'function') o[cleanForSync(k)] = cleanForSync(v[k]);
      return o;
    }
    return v;
  }

  return {
    // config
    XP_BY_TIER, DEFAULT_TIER, LEVEL_BASE, LEVEL_EXP, TIER_LADDER, DAY_START_HOUR, TIER_RUBRIC, SCHEMA_VERSION, APP_ID,
    DEFAULT_MODEL, MODEL_PRESETS, WEEKDAYS, DAY_NAMES, ALL_DAYS, WEEK_START, WEEK_ORDER, PAGES, OPTIONAL_PAGES, MONTHS, MONTHS_FULL,
    COLORS, SEED_LISTS, SEED_SKILLS, SKILL_KEYWORDS, LEGACY_LIST_SKILL,
    // ids
    newId,
    // xp / levels
    clampTier, xpForTier, xpForLevel, levelFromXp, xpToReachLevel, xpTotals, levelSnapshot, diffLevels,
    // days and weeks
    dayKey, parseDay, isDayKey, addDays, weekdayOf, daysBetween, dueStatus,
    weekStartKey, weekDates, dateInWeek, sortWeekdays, canLogOn, dayName,
    // schedules
    normalizeRepeat, isScheduledOn, prevScheduledDay, repeatLabel,
    // day lists
    detectListDays, normalizeDays, isDayList, listDaysLabel, listCoversDay, dayListInstances, dayState, weekStrip,
    DAY_LIST_PRESETS, dayListPreset,
    // habits
    duplicateHabitGroups, planMergeHabits, HABIT_SUGGESTIONS, habitSuggestions,
    // skills
    inferSkill, resolveSkill, matchByName, normWords, keywordForms,
    // completions
    indexCompletions, completionsFor, countOn, byId, rootOf, targetOf, kindOf, doneState, isDone, streak,
    planComplete, planUncomplete, completionsToReassign,
    // reviews
    ANNUAL_QUESTIONS, INTEGRITY_QUESTIONS, VALUE_SUGGESTIONS, reviewId, normalizeReview, normalizeCoreValue, reviewDue,
    yearStats, reviewYears, reviewMarkdown,
    // pages
    defaultPages, normalizePages, enabledPages, startPage,
    // achievements
    nextThreshold, achievementContext, achievementProgress, checkAchievements, achievementName,
    // quick entry
    parseQuickEntry, matchCategory, parseDateToken, parseRepeatToken,
    // AI
    SKILL_TOOL, skillSystemPrompt, buildSkillRequest, parseSkillResponse,
    normalizeText, findDuplicate, extractJson, normalizeCapture, CAPTURE_TOOL, captureSystemPrompt, captureContext,
    buildCaptureRequest, parseCaptureResponse, buildPastePrompt,
    // seeds / backup
    seedLists, seedCategories: seedLists, seedSkills, seedAchievements, seedSkillAchievements, defaultSettings,
    normalizeItem, normalizeCategory, normalizeSkill, normalizeCompletion, normalizeAchievement,
    normalizeState, upgradeToV2, stateVersion, buildBackup, validateBackup,
    // sync
    SYNC_STORES, SYNCED_SETTINGS, syncKey, splitSyncKey, syncedSettings, normalizeSyncedSettings, normalizeRecord,
    syncStamp, syncNewer, decodeJwt, syncConfig, hasUserData, firstSyncPlan, mergePlan, mergeCoreValues, cleanForSync
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Game;
