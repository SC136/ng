import { $, debounce, download, h, load, save, setMsg, toast } from '/assets/ui.js';
import { ALPHABETS, checkAlphabet, generate, inspect, MAX_COUNT, nanoidBits } from './uuid.js';

const typeSelect = $('#type');
const countInput = $('#count');
const uppercase = $('#uppercase');
const noHyphens = $('#nohyphens');
const sizeInput = $('#size');
const alphabetSelect = $('#alphabet');
const customInput = $('#custom-alphabet');
const ids = $('#ids');
const status = $('#status');
const inspectInput = $('#inspect-input');

const HINTS = {
  v4: '122 random bits. The usual choice when order does not matter.',
  v7: 'Starts with the Unix time in milliseconds, so IDs sort by creation time. Within a batch they always sort in the order made.',
  ulid: '26 characters of Crockford Base32: 48 bits of time, then 80 random bits. Sorts by time; monotonic within a millisecond.',
  nanoid: 'Short random IDs from an alphabet of your choice. Every character is equally likely.',
};

for (const [value, { label }] of Object.entries(ALPHABETS)) alphabetSelect.append(h('option', { value }, label));
alphabetSelect.append(h('option', { value: 'custom' }, 'Custom'));

function alphabet() {
  return alphabetSelect.value === 'custom' ? customInput.value : ALPHABETS[alphabetSelect.value].chars;
}

function showOptions() {
  const type = typeSelect.value;
  const isUuid = type === 'v4' || type === 'v7';
  $('#uuid-options').disabled = !isUuid;
  $('#nanoid-options').hidden = type !== 'nanoid';
  $('#custom-field').hidden = alphabetSelect.value !== 'custom';
  $('#type-hint').textContent = HINTS[type];
}

function readCount() {
  const count = Number(countInput.value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new Error(`How many must be a whole number from 1 to ${MAX_COUNT}.`);
  }
  return count;
}

function regenerate() {
  setMsg(status);
  countInput.classList.remove('invalid');
  customInput.classList.remove('invalid');
  sizeInput.classList.remove('invalid');
  $('#nanoid-bits').textContent = '';
  let list;
  try {
    const count = readCount();
    const type = typeSelect.value;
    const options = { type, count, uppercase: uppercase.checked, hyphens: !noHyphens.checked };
    if (type === 'nanoid') {
      try {
        options.alphabet = alphabet();
        const chars = checkAlphabet(options.alphabet);
        options.size = Number(sizeInput.value);
        if (!Number.isInteger(options.size) || options.size < 1 || options.size > 256) {
          sizeInput.classList.add('invalid');
          throw new Error('Size must be a whole number from 1 to 256.');
        }
        $('#nanoid-bits').textContent = `${Math.floor(nanoidBits(options.size, chars.length))} bits of randomness per ID (UUID v4 has 122).`;
      } catch (error) {
        if (!sizeInput.classList.contains('invalid')) customInput.classList.add('invalid');
        throw error;
      }
    }
    list = generate(options);
  } catch (error) {
    if (/How many/.test(error.message)) countInput.classList.add('invalid');
    setMsg(status, error.message, 'err');
    return;
  }
  ids.value = list.join('\n');
  $('#ids-info').textContent = `${list.length.toLocaleString()} ${list.length === 1 ? 'ID' : 'IDs'}`;
}

function saveOptions() {
  save('uuid.options', {
    type: typeSelect.value,
    count: countInput.value,
    uppercase: uppercase.checked,
    noHyphens: noHyphens.checked,
    size: sizeInput.value,
    alphabet: alphabetSelect.value,
  });
}

function restoreOptions() {
  const saved = load('uuid.options', {}) || {};
  if (['v4', 'v7', 'ulid', 'nanoid'].includes(saved.type)) typeSelect.value = saved.type;
  if (saved.count) countInput.value = saved.count;
  uppercase.checked = Boolean(saved.uppercase);
  noHyphens.checked = Boolean(saved.noHyphens);
  if (saved.size) sizeInput.value = saved.size;
  if (saved.alphabet && (saved.alphabet === 'custom' || ALPHABETS[saved.alphabet])) alphabetSelect.value = saved.alphabet;
}

function onOptionChange() {
  showOptions();
  saveOptions();
  regenerate();
}

for (const el of [typeSelect, uppercase, noHyphens, alphabetSelect]) el.addEventListener('change', onOptionChange);
for (const el of [countInput, sizeInput, customInput]) el.addEventListener('input', debounce(onOptionChange, 250));

$('#regenerate').addEventListener('click', regenerate);

$('#download').addEventListener('click', () => {
  if (!ids.value) {
    toast('Nothing to download yet');
    return;
  }
  download(`${ids.value}\n`, `${typeSelect.value === 'ulid' || typeSelect.value === 'nanoid' ? typeSelect.value : `uuid-${typeSelect.value}`}.txt`, 'text/plain;charset=utf-8');
});

function formatTime(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return `${ms} ms (outside the date range)`;
  return `${date.toISOString()} (${date.toLocaleString()})`;
}

function showInspection() {
  const result = $('#inspect-result');
  const badge = $('#inspect-badge');
  const msg = $('#inspect-msg');
  result.replaceChildren();
  setMsg(msg);
  inspectInput.classList.remove('invalid');
  badge.hidden = true;
  if (!inspectInput.value.trim()) return;
  const info = inspect(inspectInput.value);
  badge.hidden = false;
  if (!info.valid) {
    inspectInput.classList.add('invalid');
    badge.textContent = 'Not valid';
    badge.className = 'badge err';
    setMsg(msg, info.error, 'err');
    return;
  }
  badge.textContent = info.kind === 'ulid' ? 'Valid ULID' : 'Valid UUID';
  badge.className = 'badge ok';
  const rows = [['Canonical', info.canonical]];
  if (info.kind === 'uuid') {
    rows.push(['Version', info.versionLabel || 'Unknown']);
    rows.push(['Variant', info.variant]);
  }
  if (info.nil) rows.push(['Special', info.kind === 'ulid' ? 'All zeros' : 'Nil UUID']);
  if (info.max) rows.push(['Special', info.kind === 'ulid' ? 'Largest possible ULID' : 'Max UUID']);
  if (info.time != null) {
    rows.push(['Timestamp', formatTime(info.time)]);
    rows.push(['Unix ms', String(info.time)]);
  }
  if (info.node) rows.push(['Node', info.node]);
  if (info.clockSeq != null) rows.push(['Clock sequence', String(info.clockSeq)]);
  for (const note of info.notes) rows.push(['Note', note]);
  result.replaceChildren(...rows.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]));
}

inspectInput.addEventListener('input', debounce(showInspection, 150));

restoreOptions();
showOptions();
regenerate();
