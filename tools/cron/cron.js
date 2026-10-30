// Cron expression parsing, descriptions and next-run search. No DOM access, so Node tests can import it.
// Semantics follow Vixie cron / cronie: 5 fields, names, 0 or 7 for Sunday, and when both
// day-of-month and day-of-week are restricted, a day matching either one runs.

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const FIELDS = [
  { key: 'minute', label: 'Minute', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', min: 0, max: 23 },
  { key: 'dom', label: 'Day of month', min: 1, max: 31 },
  { key: 'month', label: 'Month', min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  { key: 'dow', label: 'Day of week', min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
];

export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export const PRESETS = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily at midnight', expr: '0 0 * * *' },
  { label: 'Weekdays at 9:00', expr: '0 9 * * 1-5' },
  { label: 'Sundays at 3:30', expr: '30 3 * * SUN' },
  { label: 'First of the month', expr: '0 0 1 * *' },
  { label: 'Every 6 hours', expr: '0 */6 * * *' },
  { label: 'Yearly', expr: '@yearly' },
];

class CronError extends Error {}

function parseNumber(text, field) {
  const upper = text.toUpperCase();
  if (field.names) {
    const index = field.names.indexOf(upper);
    if (index !== -1) return index + field.nameBase;
  }
  if (!/^\d+$/.test(text)) {
    const kind = field.key === 'month' ? 'a month name or number' : field.key === 'dow' ? 'a day name or number' : 'a number';
    throw new CronError(`${field.label}: "${text}" isn't ${kind}.`);
  }
  const value = Number(text);
  if (value < field.min || value > field.max) {
    throw new CronError(`${field.label}: ${value} is out of range (${field.min}–${field.max}).`);
  }
  return value;
}

/** Parses one comma-separated item of a field into a sorted list of values. */
function parseItem(item, field) {
  if (!item) throw new CronError(`${field.label}: empty item in the list. Check for a stray comma.`);
  const [rangePart, stepPart, extra] = item.split('/');
  if (extra !== undefined) throw new CronError(`${field.label}: "${item}" has more than one "/".`);
  let step = 1;
  if (stepPart !== undefined) {
    if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) {
      throw new CronError(`${field.label}: step "${stepPart}" in "${item}" must be a whole number above 0.`);
    }
    step = Number(stepPart);
  }
  let start;
  let end;
  if (rangePart === '*') {
    start = field.min;
    end = field.max;
  } else if (rangePart.includes('-')) {
    const bits = rangePart.split('-');
    if (bits.length !== 2 || !bits[0] || !bits[1]) throw new CronError(`${field.label}: "${item}" isn't a valid range.`);
    start = parseNumber(bits[0], field);
    end = parseNumber(bits[1], field);
    if (start > end) throw new CronError(`${field.label}: range "${rangePart}" goes backwards. Write it as two ranges instead.`);
  } else {
    start = parseNumber(rangePart, field);
    // "5/15" means "from 5 to the end, every 15", as in Vixie cron.
    end = stepPart !== undefined ? field.max : start;
  }
  const values = [];
  for (let v = start; v <= end; v += step) values.push(v);
  return values;
}

/**
 * Parses a cron expression (5 fields or a macro). Returns
 * { source, expanded, macro, fields: { minute, hour, dom, month, dow } } where each field is
 * { text, values (sorted, unique), restricted }. Day of week 7 becomes 0.
 * Throws an Error whose message names the field and token.
 */
export function parseCron(expression) {
  const source = String(expression).trim();
  if (!source) throw new CronError('Enter a cron expression, like */15 * * * *.');
  let expanded = source;
  let macro = null;
  if (source.startsWith('@')) {
    const key = source.toLowerCase();
    if (key === '@reboot') throw new CronError('@reboot runs once at startup, not on a schedule, so there are no times to show.');
    if (!MACROS[key]) throw new CronError(`"${source}" isn't a known macro. Try @hourly, @daily, @weekly, @monthly or @yearly.`);
    macro = key;
    expanded = MACROS[key];
  }
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    const hint = parts.length === 6 ? ' Six fields usually means a seconds or year field, which standard cron does not have.' : '';
    throw new CronError(`Expected 5 fields (minute, hour, day of month, month, day of week) but found ${parts.length}.${hint}`);
  }
  const fields = {};
  FIELDS.forEach((field, i) => {
    const text = parts[i];
    const set = new Set();
    for (const item of text.split(',')) for (const v of parseItem(item, field)) set.add(field.key === 'dow' && v === 7 ? 0 : v);
    // Vixie cron treats a field starting with "*" (including "*/2") as unrestricted for the day rule.
    fields[field.key] = { text, values: [...set].sort((a, b) => a - b), restricted: !text.startsWith('*') };
  });
  return { source, expanded, macro, fields };
}

const pad = (n) => String(n).padStart(2, '0');

function joinWords(list, word = 'and') {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} ${word} ${list[list.length - 1]}`;
}

const NAME = {
  minute: (v) => String(v),
  hour: (v) => `${pad(v)}:00`,
  dom: (v) => String(v),
  month: (v) => MONTH_LONG[v - 1],
  dow: (v) => DAY_LONG[v % 7],
};

// Describes one comma item in words, e.g. "1-5" → "Monday through Friday".
function describeItem(item, field) {
  const name = NAME[field.key];
  const [rangePart, stepPart] = item.split('/');
  const value = (text) => name(parseNumber(text, field) % (field.key === 'dow' ? 7 : 100));
  let range = '';
  if (rangePart !== '*') {
    if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      range = `${stepPart ? 'from ' : ''}${value(a)} through ${value(b)}`;
    } else {
      range = stepPart ? `starting at ${value(rangePart)}` : value(rangePart);
    }
  }
  if (!stepPart) return range;
  const unit = { minute: 'minutes', hour: 'hours', dom: 'days', month: 'months', dow: 'days' }[field.key];
  const every = stepPart === '1' ? `every ${unit.slice(0, -1)}` : `every ${stepPart} ${unit}`;
  return range ? `${every} ${range}` : every;
}

const describeField = (field, text) => joinWords(text.split(',').map((item) => describeItem(item, field)));

const fieldDef = (key) => FIELDS.find((field) => field.key === key);

/** A plain-English description of a parsed (or raw) cron expression. */
export function describeCron(input) {
  const cron = typeof input === 'string' ? parseCron(input) : input;
  const { minute, hour, dom, month, dow } = cron.fields;
  const parts = [];

  // Time of day.
  const fixedMinute = minute.values.length === 1 && !minute.text.includes('/') && !minute.text.includes('-');
  const fixedHours = !hour.text.startsWith('*') && !hour.text.includes('/') && !hour.text.includes('-');
  if (fixedMinute && fixedHours && hour.values.length <= 6) {
    parts.push(`At ${joinWords(hour.values.map((h) => `${pad(h)}:${pad(minute.values[0])}`))}`);
  } else {
    let minutePart;
    const plainMinutes = !minute.text.includes('/') && !minute.text.includes('-');
    if (minute.text === '*' || minute.text === '*/1') minutePart = 'Every minute';
    else if (/^\*\/\d+$/.test(minute.text)) minutePart = `Every ${minute.text.slice(2)} minutes`;
    else if (fixedMinute) minutePart = minute.values[0] === 0 ? 'At the start of the hour' : `At minute ${minute.values[0]} past the hour`;
    else if (plainMinutes) minutePart = `At minutes ${joinWords(minute.values.map(String))} past the hour`;
    else {
      const text = describeField(fieldDef('minute'), minute.text);
      minutePart = text[0].toUpperCase() + text.slice(1);
    }

    let hourPart;
    if (hour.text === '*') hourPart = '';
    else if (/^\d+-\d+$/.test(hour.text)) hourPart = `from ${pad(hour.values[0])}:00 through ${pad(hour.values[hour.values.length - 1])}:59`;
    else if (fixedHours) hourPart = `during hour ${joinWords(hour.values.map(String))}`;
    else hourPart = describeField(fieldDef('hour'), hour.text);

    if (!hourPart) parts.push(minutePart.endsWith('past the hour') || minutePart === 'At the start of the hour' ? minutePart.replace(/the hour$/, 'every hour') : minutePart);
    else parts.push(`${minutePart}, ${hourPart}`);
  }

  // Days.
  const domText = `on day ${describeField(fieldDef('dom'), dom.text)} of the month`;
  const dowText = `on ${describeField(fieldDef('dow'), dow.text)}`;
  if (dom.restricted && dow.restricted) parts.push(`${domText} or ${dowText}`);
  else if (dom.restricted) parts.push(domText);
  else if (dow.restricted) parts.push(dowText);
  else if (dom.text !== '*') parts.push(`${describeField(fieldDef('dom'), dom.text)} of the month`);
  else if (dow.text !== '*') parts.push(describeField(fieldDef('dow'), dow.text));
  else if (/^At \d/.test(parts[0])) parts.push('every day');

  if (month.text !== '*') {
    const text = describeField(fieldDef('month'), month.text);
    parts.push(/^every/.test(text) ? text : `in ${text}`);
  }
  return parts.join(', ');
}

/** Rows for the field breakdown table: { label, text, values } with values as readable text. */
export function fieldBreakdown(input) {
  const cron = typeof input === 'string' ? parseCron(input) : input;
  return FIELDS.map((field) => {
    const { text, values } = cron.fields[field.key];
    const max = field.key === 'dow' ? 6 : field.max;
    const all = values.length === max - field.min + 1;
    const shown = field.key === 'month' ? values.map((v) => MONTH_NAMES[v - 1]) : field.key === 'dow' ? values.map((v) => DAY_NAMES[v]) : values;
    return { label: field.label, text, values: all ? `every value (${field.min}–${max})` : shown.join(', ') };
  });
}

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether a calendar day matches the day fields, applying the OR rule when both are restricted. */
export function dayMatches(cron, year, month, day, weekday) {
  const { dom, dow } = cron.fields;
  const domOk = dom.values.includes(day);
  const dowOk = dow.values.includes(weekday);
  if (dom.restricted && dow.restricted) return domOk || dowOk;
  return domOk && dowOk;
}

// How far ahead to look. 28 years covers the full weekday/leap-year cycle (2100 not being a leap year aside).
export const SEARCH_YEARS = 28;

/**
 * The next `count` run times strictly after `from`, as Date objects, in UTC or local time.
 * Walks day by day only over matching months, so even impossible schedules finish quickly;
 * returns fewer (or none) when nothing matches within SEARCH_YEARS.
 */
export function nextRuns(input, from = new Date(), { count = 10, utc = false } = {}) {
  const cron = typeof input === 'string' ? parseCron(input) : input;
  const { minute, hour, month } = cron.fields;
  const get = utc
    ? { y: 'getUTCFullYear', m: 'getUTCMonth', d: 'getUTCDate' }
    : { y: 'getFullYear', m: 'getMonth', d: 'getDate' };
  const make = utc
    ? (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi))
    : (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
  const fromMs = from.getTime();
  const startYear = from[get.y]();
  const runs = [];
  const seen = new Set();
  for (let year = startYear; year <= startYear + SEARCH_YEARS && runs.length < count; year++) {
    for (const mo of month.values) {
      if (year === startYear && mo < from[get.m]() + 1) continue;
      const last = daysInMonth(year, mo);
      const firstDay = year === startYear && mo === from[get.m]() + 1 ? from[get.d]() : 1;
      for (let d = firstDay; d <= last && runs.length < count; d++) {
        const weekday = new Date(Date.UTC(year, mo - 1, d)).getUTCDay();
        if (!dayMatches(cron, year, mo, d, weekday)) continue;
        for (const h of hour.values) {
          for (const mi of minute.values) {
            const date = make(year, mo, d, h, mi);
            const ms = date.getTime();
            if (ms <= fromMs || seen.has(ms)) continue;
            // In local time, skip wall-clock times that don't exist (spring-forward gaps).
            if (!utc && (date.getHours() !== h || date.getMinutes() !== mi)) continue;
            seen.add(ms);
            runs.push(date);
            if (runs.length >= count) break;
          }
          if (runs.length >= count) break;
        }
      }
      if (runs.length >= count) break;
    }
  }
  return runs.sort((a, b) => a - b);
}
