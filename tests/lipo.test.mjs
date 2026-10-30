import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHEMISTRIES, charge, flightTime, flightTimeFromWeight, packInfo, packVoltages, stateOfCharge } from '../tools/lipo/lipo.js';

test('pack voltages per chemistry', () => {
  assert.deepEqual(packVoltages(4, 'lipo'), { full: 16.8, nominal: 14.8, storage: 15.2, land: 14 });
  assert.deepEqual(packVoltages(6, 'lihv'), { full: 26.1, nominal: 22.8, storage: 23.1, land: 21 });
  assert.deepEqual(packVoltages(3, 'liion'), { full: 12.6, nominal: 10.8, storage: 11.1, land: 9 });
  assert.deepEqual(packVoltages(1), { full: 4.2, nominal: 3.7, storage: 3.8, land: 3.5 });
  assert.equal(packVoltages(14).full, 58.8);
});

test('cell counts are checked', () => {
  assert.throws(() => packVoltages(0), /1 to 14/);
  assert.throws(() => packVoltages(15), /1 to 14/);
  assert.throws(() => packVoltages(2.5), /1 to 14/);
  assert.throws(() => packInfo({ cells: 4, parallel: 0, cellMah: 1500 }), /Parallel count/);
  assert.throws(() => packVoltages(4, 'nicd'), /Unknown chemistry/);
});

test('capacity, max current, energy and Wh/kg', () => {
  const pack = packInfo({ cells: 4, parallel: 1, cellMah: 1500, cRating: 100, weightG: 180 });
  assert.equal(pack.capacityMah, 1500);
  assert.equal(pack.maxCurrent, 150);
  assert.equal(pack.energyWh, 22.2);
  assert.equal(pack.whPerKg, 123.333333333);

  const liion = packInfo({ cells: 4, parallel: 2, cellMah: 3000, cRating: 3, chemistry: 'liion' });
  assert.equal(liion.capacityMah, 6000);
  assert.equal(liion.maxCurrent, 18);
  assert.equal(liion.energyWh, 86.4);
  assert.equal(liion.whPerKg, null);
  assert.equal(packInfo({ cells: 1, cellMah: 450 }).maxCurrent, null);
  assert.throws(() => packInfo({ cells: 4, cellMah: 0 }), /Capacity/);
});

test('flight time from average current', () => {
  assert.equal(flightTime(1500, 18), 4);
  assert.equal(flightTime(1500, 18, 100), 5);
  assert.equal(flightTime(5000, 10, 80), 24);
  assert.throws(() => flightTime(1500, 0), /Average current/);
  assert.throws(() => flightTime(1500, 10, 120), /between 1 and 100/);
});

test('flight time from all-up weight and efficiency', () => {
  // 22.2 Wh pack, 600 g at 4 g/W → 150 W hover. 80% of 22.2 Wh at 150 W = 7.104 min.
  const result = flightTimeFromWeight({ energyWh: 22.2, nominalV: 14.8, auwG: 600, gPerW: 4 });
  assert.equal(result.power, 150);
  assert.equal(result.current, 10.1351351351);
  assert.equal(result.minutes, 7.104);
  assert.throws(() => flightTimeFromWeight({ energyWh: 22.2, nominalV: 14.8, auwG: 600, gPerW: 0 }), /Efficiency/);
});

test('charge current and time', () => {
  assert.deepEqual(charge(1500, 1, 16.8), { current: 1.5, minutes: 66, power: 25.2 });
  assert.equal(charge(2200, 2, 12.6).current, 4.4);
  assert.equal(charge(2200, 2, 12.6).minutes, 33);
  assert.throws(() => charge(1500, 0, 16.8), /Charge rate/);
});

test('state of charge interpolates the table', () => {
  assert.equal(stateOfCharge(4.2).percent, 100);
  assert.equal(stateOfCharge(3.84).percent, 50);
  assert.equal(stateOfCharge(3.85).percent, 55);
  assert.equal(stateOfCharge(3.845).percent, 53);
  assert.equal(stateOfCharge(3.27).percent, 0);
  assert.equal(stateOfCharge(3.72, 'liion').percent, 50);
  assert.equal(stateOfCharge(4.35, 'lihv').percent, 100);
  assert.equal(stateOfCharge(4.2, 'lihv').percent, 85);
});

test('state of charge flags out-of-range voltages', () => {
  assert.match(stateOfCharge(4.3).note, /overcharged/);
  assert.equal(stateOfCharge(4.21).note, '');
  assert.match(stateOfCharge(3.1).note, /over-discharged/);
  assert.match(stateOfCharge(3.4).note, /charge it soon/);
  assert.throws(() => stateOfCharge(16.8), /whole pack/);
  assert.throws(() => stateOfCharge(NaN), /Enter a cell voltage/);
});

test('state of charge tables run from full to empty', () => {
  for (const chem of Object.values(CHEMISTRIES)) {
    assert.equal(chem.soc[0][0], chem.full);
    assert.equal(chem.soc[0][1], 100);
    assert.equal(chem.soc.at(-1)[1], 0);
    for (let i = 1; i < chem.soc.length; i++) {
      assert.ok(chem.soc[i][0] < chem.soc[i - 1][0] && chem.soc[i][1] < chem.soc[i - 1][1], `${chem.name} row ${i}`);
    }
  }
});
