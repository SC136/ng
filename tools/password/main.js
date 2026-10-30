import { $, copyText, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import {
  DEFAULT_SYMBOLS, MAX_COUNT, MAX_LENGTH, MIN_LENGTH, buildPools, crackSeconds, entropyBits, formatDuration,
  generateMany, strengthLabel,
} from './password.js';

const lengthInput = $('#length');
const lengthRange = $('#length-range');
const countInput = $('#count');
const symbolSet = $('#symbol-set');
const excludeInput = $('#exclude');
const boxes = { lower: $('#lower'), upper: $('#upper'), digits: $('#digits'), symbols: $('#symbols'), ambiguous: $('#ambiguous'), require: $('#require') };
const status = $('#status');
const results = $('#results');

let current = [];

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const options = () => ({
  length: clampInt(lengthInput.value, MIN_LENGTH, MAX_LENGTH, 20),
  lower: boxes.lower.checked,
  upper: boxes.upper.checked,
  digits: boxes.digits.checked,
  symbols: boxes.symbols.checked,
  symbolSet: symbolSet.value,
  excludeAmbiguous: boxes.ambiguous.checked,
  exclude: excludeInput.value,
  requireEach: boxes.require.checked,
});

function persist() {
  save('password.mode', mode.value);
  save('password.length', options().length);
  save('password.count', clampInt(countInput.value, 1, MAX_COUNT, 5));
  save('password.symbolSet', symbolSet.value);
  for (const [key, box] of Object.entries(boxes)) save(`password.${key}`, box.checked);
}

function showStrength() {
  const opts = options();
  const bits = entropyBits(mode.value, opts);
  const poolSize = mode.value === 'pin' ? 10 : buildPools(opts).reduce((sum, pool) => sum + pool.chars.length, 0);
  const strength = strengthLabel(bits);
  $('#bits').textContent = bits.toFixed(1);
  $('#pool').textContent = String(poolSize);
  const badge = $('#strength');
  badge.textContent = poolSize ? strength.label : '';
  badge.className = `badge ${strength.tone}`;
  badge.hidden = !poolSize;
  $('#crack').textContent = poolSize
    ? `An offline attacker making 10 billion guesses a second would need ${formatDuration(crackSeconds(bits))} on average to find one of these.`
    : '';
}

function generate() {
  const opts = options();
  const count = clampInt(countInput.value, 1, MAX_COUNT, 5);
  setMsg(status);
  showStrength();
  try {
    current = generateMany(mode.value, opts, count);
  } catch (error) {
    current = [];
    results.replaceChildren();
    setMsg(status, error.message, 'err');
    return;
  }
  results.replaceChildren(
    ...current.map((secret, i) =>
      h('li', {},
        h('code', { text: secret }),
        h('button', { class: 'btn sm', type: 'button', 'data-copy-text': secret, 'aria-label': `Copy result ${i + 1}` }, 'Copy'),
      ),
    ),
  );
  if (mode.value === 'pin' && opts.length < 6) setMsg(status, 'Short PINs are only safe where the number of tries is limited.', 'warn');
}

const mode = segmented($('#mode'), () => {
  $('#password-options').hidden = mode.value !== 'password';
  persist();
  generate();
});

// Restore saved options.
mode.value = load('password.mode', 'password') === 'pin' ? 'pin' : 'password';
$('#password-options').hidden = mode.value !== 'password';
const savedLength = clampInt(load('password.length', 20), MIN_LENGTH, MAX_LENGTH, 20);
lengthInput.value = lengthRange.value = String(savedLength);
countInput.value = String(clampInt(load('password.count', 5), 1, MAX_COUNT, 5));
symbolSet.value = load('password.symbolSet', DEFAULT_SYMBOLS);
for (const [key, box] of Object.entries(boxes)) box.checked = load(`password.${key}`, box.checked);

const regenerate = () => {
  persist();
  generate();
};
const regenerateSoon = debounce(regenerate, 150);

lengthRange.addEventListener('input', () => {
  lengthInput.value = lengthRange.value;
  regenerateSoon();
});
lengthInput.addEventListener('input', () => {
  const n = clampInt(lengthInput.value, MIN_LENGTH, MAX_LENGTH, null);
  if (n !== null && String(n) === lengthInput.value.trim()) lengthRange.value = String(n);
  regenerateSoon();
});
lengthInput.addEventListener('change', () => {
  lengthInput.value = lengthRange.value = String(options().length);
});
countInput.addEventListener('input', regenerateSoon);
countInput.addEventListener('change', () => {
  countInput.value = String(clampInt(countInput.value, 1, MAX_COUNT, 5));
});
for (const box of Object.values(boxes)) box.addEventListener('change', regenerate);
symbolSet.addEventListener('input', regenerateSoon);
excludeInput.addEventListener('input', regenerateSoon);

$('#generate').addEventListener('click', generate);
$('#copy-all').addEventListener('click', () => {
  if (current.length) copyText(current.join('\n'));
  else setMsg(status, 'Nothing to copy yet.', 'warn');
});

generate();
