import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import {
  DEFAULT_ZONES, DISCORD_STYLES, UNIT_LABELS, describeInstant, discordCode, discordPreview, isValidZone, parseInput,
  relativeTime, toDatetimeLocal, zoneRow,
} from './time.js';

const input = $('#input');
const picker = $('#picker');
const status = $('#status');
const result = $('#result');
const zoneInput = $('#zone-input');
const zoneMsg = $('#zone-msg');

// The instant being converted, in ms, or null when the input is invalid.
let currentMs = Date.now();
let relativeEl = null;
let zones = [];

// ---------- Now ----------
function tickNow() {
  const now = Date.now();
  $('#now-s').textContent = String(Math.floor(now / 1000));
  $('#now-ms').textContent = String(now);
  $('#now-iso').textContent = new Date(now).toISOString();
  if (relativeEl && currentMs !== null) relativeEl.textContent = relativeTime(currentMs, now);
}

// ---------- Converter ----------
const ROWS = [
  ['unixSeconds', 'Unix seconds'],
  ['unixMillis', 'Unix ms'],
  ['isoUtc', 'ISO UTC'],
  ['isoLocal', 'ISO local'],
  ['rfc2822', 'RFC 2822'],
  ['long', 'Local'],
  ['relative', 'Relative'],
  ['weekday', 'Weekday'],
  ['isoWeek', 'ISO week'],
  ['dayOfYear', 'Day of year'],
];

function showResult() {
  if (currentMs === null) {
    result.replaceChildren();
    relativeEl = null;
    return;
  }
  const info = describeInstant(currentMs);
  relativeEl = null;
  result.replaceChildren(
    ...ROWS.flatMap(([key, label]) => {
      const value = String(info[key]);
      const text = h('span', { text: value });
      if (key === 'relative') relativeEl = text;
      return [
        h('dt', { text: label }),
        h('dd', {}, text, h('button', { class: 'btn sm', type: 'button', 'data-copy-text': value, 'aria-label': `Copy ${label}` }, 'Copy')),
      ];
    }),
  );
}

function convert() {
  input.classList.remove('invalid');
  setMsg(status);
  if (!input.value.trim()) {
    currentMs = Date.now();
    setMsg(status, 'Showing the current time. Type a timestamp or date to convert it.');
  } else {
    try {
      const parsed = parseInput(input.value, unit.value);
      currentMs = parsed.ms;
      if (parsed.kind === 'number') {
        const how = unit.value === 'auto' ? 'guessed from its size' : 'chosen above';
        setMsg(status, `Read as Unix ${UNIT_LABELS[parsed.unit]} (${how}).`, 'ok');
      }
    } catch (error) {
      currentMs = null;
      input.classList.add('invalid');
      setMsg(status, error.message, 'err');
    }
  }
  if (currentMs !== null && document.activeElement !== picker) {
    const local = toDatetimeLocal(currentMs);
    picker.value = /^\d{4}-/.test(local) ? local : '';
  }
  showResult();
  showZones();
  showDiscord();
}

// ---------- Time zones ----------
function showZones() {
  const tbody = $('#zones');
  if (currentMs === null) {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: 'Enter a valid time to compare zones.' })));
    return;
  }
  tbody.replaceChildren(
    ...zones.map((zone) => {
      const row = zoneRow(currentMs, zone);
      return h('tr', {},
        h('td', { text: row.label }),
        h('td', { text: row.time }),
        h('td', { text: row.offset }),
        h('td', {}, h('button', {
          class: 'btn sm ghost', type: 'button', 'aria-label': `Remove ${row.label}`,
          onclick: () => {
            zones = zones.filter((item) => item !== zone);
            save('time.zones', zones);
            setMsg(zoneMsg);
            showZones();
          },
        }, 'Remove')),
      );
    }),
  );
  if (!zones.length) tbody.replaceChildren(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: 'No zones. Add one below.' })));
}

function addZone() {
  const name = zoneInput.value.trim();
  setMsg(zoneMsg);
  if (!name) return;
  const lower = name.toLowerCase();
  const zone = lower === 'local' ? 'local' : isValidZone(name) ? new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone : null;
  if (!zone) {
    setMsg(zoneMsg, `"${name}" isn't a time zone this browser knows. Use a name like Europe/Berlin.`, 'err');
    return;
  }
  if (zones.includes(zone)) {
    setMsg(zoneMsg, `${zone} is already in the list.`, 'warn');
    return;
  }
  zones.push(zone);
  save('time.zones', zones);
  zoneInput.value = '';
  showZones();
}

// ---------- Discord ----------
function showDiscord() {
  const tbody = $('#discord');
  if (currentMs === null) {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '3', class: 'muted', text: 'Enter a valid time to build codes.' })));
    return;
  }
  tbody.replaceChildren(
    ...DISCORD_STYLES.map(({ style, name }) => {
      const code = discordCode(currentMs, style);
      return h('tr', {},
        h('td', { text: code }),
        h('td', {}, h('span', { text: discordPreview(currentMs, style) }), h('br'), h('span', { class: 'muted', text: name })),
        h('td', {}, h('button', { class: 'btn sm', type: 'button', 'data-copy-text': code, 'aria-label': `Copy ${name} code` }, 'Copy')),
      );
    }),
  );
}

// ---------- Wiring ----------
const unit = segmented($('#unit'), (value) => {
  save('time.unit', value);
  convert();
});
const savedUnit = load('time.unit', 'auto');
unit.value = ['auto', 's', 'ms', 'us', 'ns'].includes(savedUnit) ? savedUnit : 'auto';

const savedZones = load('time.zones', DEFAULT_ZONES);
zones = (Array.isArray(savedZones) ? savedZones : DEFAULT_ZONES).filter((zone) => zone === 'local' || (typeof zone === 'string' && isValidZone(zone)));

const zoneNames = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
$('#zone-list').replaceChildren(...['UTC', ...zoneNames.filter((zone) => zone !== 'UTC')].map((zone) => h('option', { value: zone })));

input.addEventListener('input', debounce(convert, 150));
picker.addEventListener('change', () => {
  if (!picker.value) return;
  // datetime-local values have no offset, so they parse as local time.
  input.value = picker.value;
  convert();
});
$('#use-now').addEventListener('click', () => {
  input.value = String(Math.floor(Date.now() / 1000));
  convert();
});
$('#add-zone').addEventListener('click', addZone);
zoneInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addZone();
  }
});
$('#reset-zones').addEventListener('click', () => {
  zones = DEFAULT_ZONES.slice();
  save('time.zones', zones);
  setMsg(zoneMsg);
  showZones();
});

input.value = String(Math.floor(Date.now() / 1000));
convert();
tickNow();
setInterval(tickNow, 1000);
