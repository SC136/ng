// Timestamp conversion, time zones and Discord timestamps. No DOM access, so Node tests can import it.

export const UNITS = ['s', 'ms', 'us', 'ns'];
export const UNIT_LABELS = { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' };
const PER_MS = { s: 1e-3, ms: 1, us: 1e3, ns: 1e6 };
// JavaScript dates cover ±100,000,000 days around 1970.
export const MAX_MS = 8.64e15;

export const DEFAULT_ZONES = ['local', 'UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

/**
 * Guesses the unit of a numeric timestamp from its size: below 1e11 is seconds (up to the year 5138),
 * below 1e14 milliseconds, below 1e17 microseconds, otherwise nanoseconds. Sign is ignored.
 */
export function detectUnit(value) {
  const size = Math.abs(Number(value));
  if (size < 1e11) return 's';
  if (size < 1e14) return 'ms';
  if (size < 1e17) return 'us';
  return 'ns';
}

const NUMERIC = /^[-+]?\d+(?:\.\d+)?$/;

/** Converts a numeric string in `unit` to milliseconds. Large integers go through BigInt so nanoseconds stay exact to the ms. */
export function toMillis(text, unit) {
  const clean = String(text).trim();
  if (unit === 's' || unit === 'ms' || clean.includes('.')) return Number(clean) / PER_MS[unit];
  const big = BigInt(clean);
  const per = BigInt(PER_MS[unit]);
  // Floor division so negative values round toward the past, like the other units.
  let ms = big / per;
  if (big % per !== 0n && big < 0n) ms -= 1n;
  return Number(ms);
}

/**
 * Parses what someone typed: a Unix timestamp (unit 'auto' guesses), ISO 8601, RFC 2822 or any text
 * Date can read. Returns { ms, unit, kind: 'number' | 'text' }. Throws an Error with a plain message.
 */
export function parseInput(text, unit = 'auto') {
  const clean = String(text).trim();
  if (!clean) throw new Error('Enter a timestamp or a date.');
  let ms;
  let used = null;
  if (NUMERIC.test(clean)) {
    used = unit === 'auto' ? detectUnit(clean) : unit;
    if (!PER_MS[used]) throw new Error(`Unknown unit "${unit}".`);
    ms = toMillis(clean, used);
  } else {
    ms = Date.parse(clean);
    if (Number.isNaN(ms)) throw new Error(`Couldn't read "${clean.slice(0, 60)}" as a date. Try a Unix timestamp or ISO 8601 like 2024-05-01T12:00:00Z.`);
  }
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) {
    throw new Error('That is outside the range JavaScript dates support (about 270,000 years either side of 1970).');
  }
  return { ms, unit: used, kind: used ? 'number' : 'text' };
}

const offsetFormatters = new Map();
function offsetFormatter(timeZone) {
  const key = timeZone || '';
  if (!offsetFormatters.has(key)) {
    offsetFormatters.set(key, new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset', year: 'numeric' }));
  }
  return offsetFormatters.get(key);
}

/** The offset from UTC in minutes for a zone at an instant (east is positive). timeZone undefined = local. */
export function zoneOffsetMinutes(date, timeZone) {
  const part = offsetFormatter(timeZone).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** Formats an offset in minutes as +05:30 / -04:00. */
export function formatOffset(minutes, separator = ':') {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${separator}${String(abs % 60).padStart(2, '0')}`;
}

/** Wall-clock fields of an instant in a zone: { year, month (1–12), day, hour, minute, second, ms, weekday (1 = Monday … 7 = Sunday) }. */
export function wallClock(date, timeZone) {
  const offset = zoneOffsetMinutes(date, timeZone);
  const shifted = new Date(date.getTime() + offset * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
    weekday: shifted.getUTCDay() || 7,
    offset,
  };
}

/** ISO 8601 with the zone's offset, e.g. 2024-05-01T17:30:00.000+05:30. */
export function isoWithOffset(date, timeZone) {
  const offset = zoneOffsetMinutes(date, timeZone);
  const shifted = new Date(date.getTime() + offset * 60000).toISOString();
  return shifted.slice(0, -1) + formatOffset(offset);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 2822 date, e.g. "Wed, 01 May 2024 17:30:00 +0530", in the given zone (default UTC). */
export function rfc2822(date, timeZone = 'UTC') {
  const offset = zoneOffsetMinutes(date, timeZone);
  const s = new Date(date.getTime() + offset * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${DAYS[s.getUTCDay()]}, ${pad(s.getUTCDate())} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()} `
    + `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())} ${formatOffset(offset, '')}`;
}

/** ISO 8601 week for a calendar date: { year, week }. The week-year can differ from the calendar year. */
export function isoWeek(year, month, day) {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides which year the week belongs to.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(2000, 0, 1));
  jan1.setUTCFullYear(weekYear);
  return { year: weekYear, week: Math.floor((date - jan1) / 86400000 / 7) + 1 };
}

/** Day of the year, 1–366. */
export function dayOfYear(year, month, day) {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  const jan1 = new Date(Date.UTC(2000, 0, 1));
  jan1.setUTCFullYear(year);
  return Math.round((date - jan1) / 86400000) + 1;
}

const RELATIVE_STEPS = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348],
  ['month', 12],
  ['year', Infinity],
];

// Rounds 1.5 and -1.5 the same way, so "in 2 minutes" and "2 minutes ago" are symmetric.
const roundHalfAway = (value) => Math.sign(value) * Math.round(Math.abs(value)) || 0;

/** "3 hours ago", "in 2 days" etc. via Intl.RelativeTimeFormat. */
export function relativeTime(ms, nowMs, locale = 'en') {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = (ms - nowMs) / 1000;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(value) < size) return format.format(roundHalfAway(value), unit);
    value /= size;
  }
  return format.format(roundHalfAway(value), 'year');
}

/** Every conversion the page shows, for one instant. timeZone undefined means the viewer's zone. */
export function describeInstant(ms, { nowMs = Date.now(), timeZone, locale } = {}) {
  const date = new Date(ms);
  const wall = wallClock(date, timeZone);
  const week = isoWeek(wall.year, wall.month, wall.day);
  return {
    unixSeconds: String(Math.floor(ms / 1000)),
    unixMillis: String(Math.floor(ms)),
    isoUtc: date.toISOString(),
    isoLocal: isoWithOffset(date, timeZone),
    rfc2822: rfc2822(date, timeZone),
    long: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long', timeZone }).format(date),
    relative: relativeTime(ms, nowMs, locale),
    weekday: new Intl.DateTimeFormat(locale || 'en', { weekday: 'long', timeZone }).format(date),
    isoWeek: `${week.year}-W${String(week.week).padStart(2, '0')}`,
    dayOfYear: dayOfYear(wall.year, wall.month, wall.day),
  };
}

/** True when Intl knows the zone name. */
export function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** One row of the zone table: { zone, label, time, offset }. 'local' maps to the viewer's zone. */
export function zoneRow(ms, zone, locale) {
  const timeZone = zone === 'local' ? undefined : zone;
  const date = new Date(ms);
  const resolved = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  return {
    zone,
    label: zone === 'local' ? `Local (${resolved})` : zone,
    time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone }).format(date),
    offset: `UTC${formatOffset(zoneOffsetMinutes(date, timeZone))}`,
  };
}

export const DISCORD_STYLES = [
  { style: 't', name: 'Short time' },
  { style: 'T', name: 'Long time' },
  { style: 'd', name: 'Short date' },
  { style: 'D', name: 'Long date' },
  { style: 'f', name: 'Short date and time' },
  { style: 'F', name: 'Long date and time' },
  { style: 'R', name: 'Relative' },
];

/** Discord's markdown for a timestamp, e.g. <t:1700000000:R>. */
export function discordCode(ms, style) {
  if (!DISCORD_STYLES.some((entry) => entry.style === style)) throw new Error(`Unknown Discord style "${style}".`);
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

const DISCORD_FORMATS = {
  t: { hour: 'numeric', minute: '2-digit' },
  T: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  d: { day: '2-digit', month: '2-digit', year: 'numeric' },
  D: { day: 'numeric', month: 'long', year: 'numeric' },
  f: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  F: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
};

/** Roughly how Discord shows a timestamp style to someone in `timeZone` with `locale`. */
export function discordPreview(ms, style, { nowMs = Date.now(), locale, timeZone } = {}) {
  if (style === 'R') return relativeTime(ms, nowMs, locale);
  const format = DISCORD_FORMATS[style];
  if (!format) throw new Error(`Unknown Discord style "${style}".`);
  return new Intl.DateTimeFormat(locale, { ...format, timeZone }).format(new Date(ms));
}

/** Value for an <input type="datetime-local"> showing this instant in the viewer's zone. */
export function toDatetimeLocal(ms, timeZone) {
  return isoWithOffset(new Date(ms), timeZone).slice(0, 19);
}
