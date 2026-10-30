import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { formatSI } from '/assets/units.js';
import { CHEMISTRIES, charge, flightTime, flightTimeFromWeight, packInfo, stateOfCharge } from './lipo.js';

const cellsSelect = $('#cells');
cellsSelect.replaceChildren(...Array.from({ length: 14 }, (_, i) => h('option', { value: String(i + 1), text: `${i + 1}S` })));
cellsSelect.value = '4';

const savedChem = load('lipo.chemistry', 'lipo');
const chem = segmented($('#chem'), (value) => {
  save('lipo.chemistry', value);
  update();
});
if (CHEMISTRIES[savedChem]) chem.value = savedChem;

// Empty → null; anything that isn't a number → NaN.
function num(el) {
  const text = el.value.trim();
  if (!text) return null;
  return Number(text);
}

const stat = (value, label) => h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));
const kv = (rows) => rows.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]);
const volts = (value) => `${Number(value.toFixed(2))} V`;
const minutes = (value) => {
  const total = Math.round(value * 60);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
};

let pack = null;

function updatePack() {
  pack = null;
  setMsg($('#pack-msg'));
  $('#pack-stats').replaceChildren();
  $('#voltages').replaceChildren();
  const cells = Number(cellsSelect.value);
  const parallel = num($('#parallel'));
  const chemistry = chem.value;
  $('#pack-title').textContent = `${cells}S${parallel ?? 1}P ${CHEMISTRIES[chemistry].name}`;
  try {
    const cellMah = num($('#capacity'));
    if (cellMah == null) throw new Error('Enter the capacity in mAh.');
    pack = packInfo({
      cells, parallel: parallel ?? 1, cellMah, cRating: num($('#crating')), chemistry, weightG: num($('#weight')),
    });
  } catch (error) {
    setMsg($('#pack-msg'), error.message, 'err');
    return;
  }
  pack.cells = cells;
  pack.chemistry = chemistry;
  $('#pack-stats').replaceChildren(
    stat(volts(pack.voltages.nominal), 'Nominal'),
    stat(`${pack.capacityMah} mAh`, 'Capacity'),
    stat(pack.maxCurrent == null ? '—' : formatSI(pack.maxCurrent, 'A'), 'Max continuous'),
    stat(`${Number(pack.energyWh.toFixed(1))} Wh`, 'Energy'),
    ...(pack.whPerKg == null ? [] : [stat(`${Math.round(pack.whPerKg)} Wh/kg`, 'Energy density')]),
  );
  const chemData = CHEMISTRIES[chemistry];
  $('#voltages').replaceChildren(
    ...[['Full', 'full'], ['Storage', 'storage'], ['Nominal', 'nominal'], ['Land (minimum)', 'land']].map(([label, key]) => h('tr', {},
      h('td', { text: label }),
      h('td', { class: 'mono', text: volts(chemData[key]) }),
      h('td', { class: 'mono', text: volts(pack.voltages[key]) }),
    )),
  );
}

function updateFlight() {
  setMsg($('#flight-msg'));
  $('#flight-current-out').replaceChildren();
  $('#flight-weight-out').replaceChildren();
  if (!pack) return;
  const usable = num($('#usable')) ?? 80;
  const current = num($('#avg-current'));
  const problems = [];
  if (current != null) {
    try {
      $('#flight-current-out').replaceChildren(...kv([
        ['Flight time', minutes(flightTime(pack.capacityMah, current, usable))],
        ['Uses', `${Math.round(pack.capacityMah * usable / 100)} of ${pack.capacityMah} mAh`],
      ]));
      if (pack.maxCurrent != null && current > pack.maxCurrent) problems.push(`${current} A is more than the pack's ${formatSI(pack.maxCurrent, 'A')} continuous rating.`);
    } catch (error) {
      problems.push(error.message);
    }
  }
  const auwG = num($('#auw'));
  const gPerW = num($('#gpw'));
  if (auwG != null && gPerW != null) {
    try {
      const result = flightTimeFromWeight({ energyWh: pack.energyWh, nominalV: pack.voltages.nominal, auwG, gPerW, usablePct: usable });
      $('#flight-weight-out').replaceChildren(...kv([
        ['Hover time', minutes(result.minutes)],
        ['Hover power', `${Number(result.power.toFixed(1))} W`],
        ['Hover current', `${formatSI(result.current, 'A', { digits: 3 })} at ${volts(pack.voltages.nominal)}`],
      ]));
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) setMsg($('#flight-msg'), problems.join(' '), problems.some((p) => /continuous rating/.test(p)) && problems.length === 1 ? 'warn' : 'err');
}

function updateCharge() {
  setMsg($('#charge-msg'));
  $('#charge-out').replaceChildren();
  if (!pack) return;
  const rate = num($('#charge-c'));
  if (rate == null) return;
  try {
    const result = charge(pack.capacityMah, rate, pack.voltages.full);
    $('#charge-out').replaceChildren(...kv([
      ['Charge current', formatSI(result.current, 'A', { digits: 3 })],
      ['Time from empty', `about ${Math.round(result.minutes)} min`],
      ['Charger power', `${Number(result.power.toFixed(1))} W`],
      ['Charge to', `${volts(CHEMISTRIES[pack.chemistry].full)} per cell`],
    ]));
  } catch (error) {
    setMsg($('#charge-msg'), error.message, 'err');
  }
}

function updateSoc() {
  setMsg($('#soc-msg'));
  $('#soc-out').replaceChildren();
  let voltage = num($('#rest-v'));
  if (voltage == null) return;
  const cells = Number(cellsSelect.value);
  const whole = $('#whole-pack').checked;
  if (whole) voltage /= cells;
  try {
    const result = stateOfCharge(voltage, chem.value);
    $('#soc-out').replaceChildren(
      stat(`~${result.percent}%`, 'Approx. charge'),
      stat(volts(voltage), whole ? `Per cell (${cells}S)` : 'Per cell'),
    );
    if (result.note) setMsg($('#soc-msg'), result.note, 'warn');
  } catch (error) {
    setMsg($('#soc-msg'), error.message, 'err');
  }
}

function update() {
  updatePack();
  updateFlight();
  updateCharge();
  updateSoc();
}

const later = debounce(update, 150);
for (const id of ['#parallel', '#capacity', '#crating', '#weight', '#avg-current', '#usable', '#auw', '#gpw', '#charge-c', '#rest-v']) {
  $(id).addEventListener('input', later);
}
cellsSelect.addEventListener('change', update);
$('#whole-pack').addEventListener('change', update);

update();
