import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { PRESETS, SEARCH_YEARS, describeCron, fieldBreakdown, nextRuns, parseCron } from './cron.js';

const exprInput = $('#expr');
const status = $('#status');
const description = $('#description');
const fieldsBody = $('#fields');
const runsList = $('#runs');
const MAX_LENGTH = 300;

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatRun(date, utc) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: utc ? 'UTC' : undefined, timeZoneName: 'short',
  }).format(date);
}

function render() {
  exprInput.classList.remove('invalid');
  setMsg(status);
  const utc = zone.value === 'utc';
  $('#zone-hint').textContent = utc
    ? 'Times in UTC. GitHub Actions schedules always run in UTC.'
    : `Times in your zone, ${localZone}. GitHub Actions schedules run in UTC, so switch to UTC to check those.`;

  if (exprInput.value.length > MAX_LENGTH) {
    showError(`That is ${exprInput.value.length} characters. Cron expressions here are limited to ${MAX_LENGTH}.`);
    return;
  }
  let cron;
  try {
    cron = parseCron(exprInput.value);
  } catch (error) {
    showError(error.message);
    return;
  }
  description.textContent = describeCron(cron);
  if (cron.macro) setMsg(status, `${cron.macro} is short for ${cron.expanded}.`, 'ok');
  fieldsBody.replaceChildren(
    ...fieldBreakdown(cron).map((row) => h('tr', {}, h('td', { text: row.label }), h('td', { text: row.text }), h('td', { text: row.values }))),
  );
  const runs = nextRuns(cron, new Date(), { count: 10, utc });
  if (!runs.length) {
    runsList.replaceChildren(h('li', { class: 'muted', text: `Never. No date matches in the next ${SEARCH_YEARS} years.` }));
    setMsg(status, 'This schedule never runs. Check for dates that don\'t exist, like 30 February or 31 April.', 'warn');
    return;
  }
  runsList.replaceChildren(...runs.map((date) => h('li', {}, h('time', { datetime: date.toISOString(), text: formatRun(date, utc) }))));
  if (runs.length < 10) setMsg(status, `Only ${runs.length} run${runs.length === 1 ? '' : 's'} in the next ${SEARCH_YEARS} years.`, 'warn');
}

function showError(message) {
  exprInput.classList.add('invalid');
  setMsg(status, message, 'err');
  description.textContent = '';
  fieldsBody.replaceChildren();
  runsList.replaceChildren();
}

const zone = segmented($('#zone'), (value) => {
  save('cron.zone', value);
  render();
});
zone.value = load('cron.zone', 'local') === 'utc' ? 'utc' : 'local';

$('#presets').replaceChildren(
  ...PRESETS.map((preset) => h('button', {
    class: 'chip', type: 'button', title: preset.expr,
    onclick: () => {
      exprInput.value = preset.expr;
      render();
      exprInput.focus();
    },
  }, preset.label)),
);

exprInput.addEventListener('input', debounce(render, 150));
render();
