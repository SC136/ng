import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { claimRows, decodeJwt, signJwt, timeStatus, verifyJwt } from './jwt.js';

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const SAMPLE_SECRET = 'your-256-bit-secret';

const tokenInput = $('#token');
const decodeStatus = $('#decode-status');
const decodedBox = $('#decoded');
const secretInput = $('#secret');
const secretB64 = $('#secret-b64');
const publicKey = $('#public-key');
const verifyStatus = $('#verify-status');

let current = null;
let verifyRun = 0;

// ---------- Mode ----------
const mode = segmented($('#mode'), (value) => {
  save('jwt.mode', value);
  showMode(value);
});
function showMode(value) {
  $('#decode-mode').hidden = value !== 'decode';
  $('#sign-mode').hidden = value !== 'sign';
  if (value === 'sign') sign();
}
mode.value = load('jwt.mode', 'decode') === 'sign' ? 'sign' : 'decode';

// ---------- Decode ----------
const BADGE = {
  valid: 'ok', 'no-expiry': 'info', expired: 'err', 'not-yet-valid': 'warn',
};

function renderTokenView(parts) {
  const classes = ['jwt-h', 'jwt-p', 'jwt-s'];
  const names = ['header', 'payload', 'signature'];
  const pieces = [];
  parts.forEach((part, i) => {
    if (i) pieces.push(h('span', { class: 'jwt-dot', text: '.' }));
    pieces.push(h('span', { class: classes[i], title: names[i], text: part }));
  });
  $('#token-view').replaceChildren(...pieces);
}

function renderClaims(payload) {
  const rows = claimRows(payload, Date.now());
  $('#claims-body').replaceChildren(...rows.map((row) => h('tr', {},
    h('td', { text: row.claim }),
    h('td', { text: row.label }),
    h('td', {},
      h('div', { class: 'mono', text: row.value }),
      row.date ? h('div', { text: `${row.date} · ${row.relative}` }) : null,
      row.problem ? h('div', { class: 'warn-text', text: row.problem }) : null,
    ),
  )));
  $('#claims').hidden = !rows.length;
  $('#claims-empty').hidden = rows.length > 0;
}

function renderBadges(decoded) {
  const { header, payload } = decoded;
  const badges = [];
  const alg = typeof header.alg === 'string' ? header.alg : '(no alg)';
  badges.push(h('span', { class: alg === 'none' ? 'badge err' : 'badge info', text: `alg ${alg}` }));
  if (header.typ) badges.push(h('span', { class: 'badge info', text: `typ ${header.typ}` }));
  const time = timeStatus(payload, Date.now());
  badges.push(h('span', { class: `badge ${BADGE[time.state]}`, text: time.label }));
  $('#badges').replaceChildren(...badges);
}

function decode() {
  tokenInput.classList.remove('invalid');
  setMsg(decodeStatus);
  current = null;
  if (!tokenInput.value.trim()) {
    decodedBox.hidden = true;
    return;
  }
  try {
    current = decodeJwt(tokenInput.value);
  } catch (error) {
    tokenInput.classList.add('invalid');
    setMsg(decodeStatus, error.message, 'err');
    decodedBox.hidden = true;
    return;
  }
  renderTokenView(current.parts);
  $('#header-json').textContent = current.headerJson;
  $('#payload-json').textContent = current.payloadJson;
  renderBadges(current);
  renderClaims(current.payload);
  if (current.header.alg === 'none') {
    setMsg(decodeStatus, 'This token uses alg "none", so it has no signature. Anyone could have made it; never trust one.', 'warn');
  }
  decodedBox.hidden = false;
  syncVerifyFields();
  verify();
}

function syncVerifyFields() {
  const alg = String(current?.header.alg ?? '');
  const isHmac = /^HS/.test(alg);
  const isNone = alg === 'none';
  $('#verify-alg').textContent = alg || 'no alg';
  $('#secret-field').hidden = !isHmac;
  $('#key-field').hidden = isHmac || isNone;
}

async function verify() {
  const run = ++verifyRun;
  if (!current) return;
  const alg = String(current.header.alg ?? '');
  const isHmac = /^HS/.test(alg);
  if (alg !== 'none' && !(isHmac ? secretInput.value : publicKey.value.trim())) {
    setMsg(verifyStatus, isHmac ? 'Enter the secret to check the signature.' : 'Paste the public key to check the signature.');
    return;
  }
  const result = await verifyJwt(current.token, { secret: secretInput.value, secretIsBase64: secretB64.checked, publicKey: publicKey.value });
  if (run !== verifyRun) return;
  setMsg(verifyStatus, result.message, result.ok ? 'ok' : alg === 'none' ? 'warn' : 'err');
}

const debouncedVerify = debounce(verify, 200);
tokenInput.addEventListener('input', debounce(decode, 150));
secretInput.addEventListener('input', debouncedVerify);
publicKey.addEventListener('input', debouncedVerify);
secretB64.addEventListener('change', verify);

$('#sample').addEventListener('click', () => {
  tokenInput.value = SAMPLE;
  secretInput.value = SAMPLE_SECRET;
  secretB64.checked = false;
  decode();
  tokenInput.focus();
});

$('#clear').addEventListener('click', () => {
  tokenInput.value = '';
  secretInput.value = '';
  publicKey.value = '';
  decode();
  tokenInput.focus();
});

// ---------- Sign ----------
const signHeader = $('#sign-header');
const signPayload = $('#sign-payload');
const signSecret = $('#sign-secret');
const signB64 = $('#sign-b64');
const signStatus = $('#sign-status');
const signed = $('#signed');
let signRun = 0;

const signAlg = segmented($('#sign-alg'), (value) => {
  save('jwt.signAlg', value);
  syncHeaderAlg(value);
  sign();
});
signAlg.value = ['HS256', 'HS384', 'HS512'].includes(load('jwt.signAlg', 'HS256')) ? load('jwt.signAlg', 'HS256') : 'HS256';

function syncHeaderAlg(alg) {
  try {
    const header = JSON.parse(signHeader.value || '{}');
    if (header && typeof header === 'object' && !Array.isArray(header)) {
      header.alg = alg;
      signHeader.value = JSON.stringify(header, null, 2);
    }
  } catch {}
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
signHeader.value = JSON.stringify({ alg: signAlg.value, typ: 'JWT' }, null, 2);
signPayload.value = JSON.stringify({ sub: '1234567890', name: 'Jane Doe', iat: nowSeconds() }, null, 2);

async function sign() {
  const run = ++signRun;
  setMsg(signStatus);
  if (!signSecret.value) {
    signed.value = '';
    setMsg(signStatus, 'Enter a secret to sign the token.', '');
    return;
  }
  try {
    const token = await signJwt(signHeader.value, signPayload.value, signSecret.value, { alg: signAlg.value, secretIsBase64: signB64.checked });
    if (run !== signRun) return;
    signed.value = token;
    setMsg(signStatus, `Signed with ${signAlg.value}.`, 'ok');
  } catch (error) {
    if (run !== signRun) return;
    signed.value = '';
    setMsg(signStatus, error.message, 'err');
  }
}

const debouncedSign = debounce(sign, 200);
for (const el of [signHeader, signPayload, signSecret]) el.addEventListener('input', debouncedSign);
signB64.addEventListener('change', sign);

function editPayload(change) {
  try {
    const payload = JSON.parse(signPayload.value || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    change(payload);
    signPayload.value = JSON.stringify(payload, null, 2);
    sign();
  } catch {
    setMsg(signStatus, 'Fix the payload JSON first.', 'err');
  }
}
$('#add-iat').addEventListener('click', () => editPayload((payload) => { payload.iat = nowSeconds(); }));
$('#add-exp').addEventListener('click', () => editPayload((payload) => { payload.exp = nowSeconds() + 3600; }));

$('#open-signed').addEventListener('click', () => {
  if (!signed.value) {
    setMsg(signStatus, 'There is no signed token yet.', 'warn');
    return;
  }
  tokenInput.value = signed.value;
  secretInput.value = signSecret.value;
  secretB64.checked = signB64.checked;
  mode.value = 'decode';
  save('jwt.mode', 'decode');
  showMode('decode');
  decode();
  tokenInput.focus();
});

showMode(mode.value);
