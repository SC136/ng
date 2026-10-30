// Lithium battery pack logic. No DOM access, so Node tests can import it.

/**
 * Per-cell voltages. full = charged, storage = long-term storage, land = lowest you should fly or
 * discharge to under load. soc = approximate resting voltage → state of charge (%), high to low.
 */
export const CHEMISTRIES = {
  lipo: {
    name: 'LiPo', full: 4.2, nominal: 3.7, storage: 3.8, land: 3.5,
    soc: [[4.2, 100], [4.15, 95], [4.11, 90], [4.08, 85], [4.02, 80], [3.98, 75], [3.95, 70], [3.91, 65], [3.87, 60],
      [3.85, 55], [3.84, 50], [3.82, 45], [3.8, 40], [3.79, 35], [3.77, 30], [3.75, 25], [3.73, 20], [3.71, 15],
      [3.69, 10], [3.61, 5], [3.27, 0]],
  },
  lihv: {
    name: 'LiHV', full: 4.35, nominal: 3.8, storage: 3.85, land: 3.5,
    soc: [[4.35, 100], [4.3, 95], [4.25, 90], [4.2, 85], [4.15, 80], [4.1, 75], [4.06, 70], [4.02, 65], [3.98, 60],
      [3.95, 55], [3.92, 50], [3.9, 45], [3.87, 40], [3.85, 35], [3.82, 30], [3.8, 25], [3.78, 20], [3.76, 15],
      [3.73, 10], [3.65, 5], [3.4, 0]],
  },
  liion: {
    name: 'Li-ion', full: 4.2, nominal: 3.6, storage: 3.7, land: 3.0,
    soc: [[4.2, 100], [4.15, 95], [4.1, 90], [4.05, 85], [4.0, 80], [3.95, 75], [3.9, 70], [3.85, 65], [3.8, 60],
      [3.76, 55], [3.72, 50], [3.68, 45], [3.65, 40], [3.62, 35], [3.58, 30], [3.54, 25], [3.5, 20], [3.45, 15],
      [3.4, 10], [3.3, 5], [3.0, 0]],
  },
};

const tidy = (value) => Number(value.toPrecision(12));

function chemistry(id) {
  const chem = CHEMISTRIES[id];
  if (!chem) throw new Error(`Unknown chemistry "${id}".`);
  return chem;
}

function checkCells(cells, parallel = 1) {
  if (!Number.isInteger(cells) || cells < 1 || cells > 14) throw new Error('Cells in series must be a whole number from 1 to 14.');
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 20) throw new Error('Parallel count must be a whole number from 1 to 20.');
}

/** Pack voltages for cells in series: { full, nominal, storage, land }. */
export function packVoltages(cells, chemistryId = 'lipo') {
  checkCells(cells);
  const chem = chemistry(chemistryId);
  return {
    full: tidy(chem.full * cells),
    nominal: tidy(chem.nominal * cells),
    storage: tidy(chem.storage * cells),
    land: tidy(chem.land * cells),
  };
}

/**
 * Pack figures. cellMah is the capacity of one cell; the pack has `parallel` of them per group.
 * cRating is the continuous discharge rating. weightG (optional) gives Wh/kg.
 * Returns { capacityMah, capacityAh, maxCurrent, energyWh, whPerKg, voltages }.
 */
export function packInfo({ cells, parallel = 1, cellMah, cRating = null, chemistry: chemistryId = 'lipo', weightG = null }) {
  checkCells(cells, parallel);
  if (!(cellMah > 0)) throw new Error('Capacity must be more than 0 mAh.');
  if (cRating != null && !(cRating > 0)) throw new Error('C rating must be more than 0.');
  if (weightG != null && !(weightG > 0)) throw new Error('Weight must be more than 0 g.');
  const voltages = packVoltages(cells, chemistryId);
  const capacityMah = tidy(cellMah * parallel);
  const capacityAh = tidy(capacityMah / 1000);
  const energyWh = tidy(voltages.nominal * capacityAh);
  return {
    capacityMah,
    capacityAh,
    maxCurrent: cRating == null ? null : tidy(cRating * capacityAh),
    energyWh,
    whPerKg: weightG == null ? null : tidy(energyWh / (weightG / 1000)),
    voltages,
  };
}

function checkUsable(usablePct) {
  if (!(usablePct > 0) || usablePct > 100) throw new Error('Usable capacity must be between 1 and 100%.');
}

/** Minutes of flight from pack capacity (mAh), average current (A) and usable % (default 80). */
export function flightTime(capacityMah, averageCurrent, usablePct = 80) {
  if (!(capacityMah > 0)) throw new Error('Capacity must be more than 0 mAh.');
  if (!(averageCurrent > 0)) throw new Error('Average current must be more than 0 A.');
  checkUsable(usablePct);
  return tidy((capacityMah / 1000) * (usablePct / 100) / averageCurrent * 60);
}

/**
 * Hover estimate from all-up weight (g) and efficiency (g/W): power = weight / efficiency.
 * Returns { power (W), current (A at nominal voltage), minutes }.
 */
export function flightTimeFromWeight({ energyWh, nominalV, auwG, gPerW, usablePct = 80 }) {
  if (!(energyWh > 0)) throw new Error('Pack energy must be more than 0 Wh.');
  if (!(auwG > 0)) throw new Error('All-up weight must be more than 0 g.');
  if (!(gPerW > 0)) throw new Error('Efficiency must be more than 0 g/W.');
  checkUsable(usablePct);
  const power = auwG / gPerW;
  return {
    power: tidy(power),
    current: tidy(power / nominalV),
    minutes: tidy(energyWh * (usablePct / 100) / power * 60),
  };
}

/**
 * Charging at `rate` C. Returns { current (A), minutes, power (W at full voltage) }.
 * minutes is the constant-current time (60 / C) plus about 10% for the constant-voltage finish.
 */
export function charge(capacityMah, rate, fullV) {
  if (!(capacityMah > 0)) throw new Error('Capacity must be more than 0 mAh.');
  if (!(rate > 0) || rate > 10) throw new Error('Charge rate must be more than 0 C and at most 10 C.');
  const current = tidy((capacityMah / 1000) * rate);
  return { current, minutes: tidy((60 / rate) * 1.1), power: tidy(current * fullV) };
}

/**
 * Approximate state of charge (0–100 %) from a resting cell voltage, interpolated in the
 * chemistry's table. Returns { percent, note } where note flags voltages outside the table.
 */
export function stateOfCharge(cellVoltage, chemistryId = 'lipo') {
  const chem = chemistry(chemistryId);
  if (!Number.isFinite(cellVoltage) || cellVoltage <= 0) throw new Error('Enter a cell voltage, like 3.85.');
  if (cellVoltage > 5) throw new Error('That is more than 5 V for one cell. For a whole pack, divide by the cell count.');
  const table = chem.soc;
  if (cellVoltage >= table[0][0]) {
    return { percent: 100, note: cellVoltage > chem.full + 0.02 ? `Above ${chem.full} V: overcharged. Discharge to storage voltage.` : '' };
  }
  const last = table[table.length - 1];
  if (cellVoltage <= last[0]) return { percent: 0, note: `At or below ${last[0]} V: over-discharged. The cell may be damaged.` };
  for (let i = 1; i < table.length; i++) {
    const [vHigh, pHigh] = table[i - 1];
    const [vLow, pLow] = table[i];
    if (cellVoltage >= vLow) {
      const percent = pLow + ((cellVoltage - vLow) / (vHigh - vLow)) * (pHigh - pLow);
      return { percent: Math.round(percent), note: cellVoltage < chem.land ? `Below ${chem.land} V: charge it soon.` : '' };
    }
  }
  return { percent: 0, note: '' };
}
