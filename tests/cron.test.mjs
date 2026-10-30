import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, describeCron, dayMatches, fieldBreakdown, nextRuns, parseCron } from '../tools/cron/cron.js';

const utcRuns = (expr, fromIso, count = 10) => nextRuns(expr, new Date(fromIso), { count, utc: true }).map((d) => d.toISOString());

test('parses stars, lists, ranges and steps', () => {
  const { fields } = parseCron('*/15 0,12 1-5 */3 1-5/2');
  assert.deepEqual(fields.minute.values, [0, 15, 30, 45]);
  assert.deepEqual(fields.hour.values, [0, 12]);
  assert.deepEqual(fields.dom.values, [1, 2, 3, 4, 5]);
  assert.deepEqual(fields.month.values, [1, 4, 7, 10]);
  assert.deepEqual(fields.dow.values, [1, 3, 5]);
  assert.equal(fields.minute.restricted, false);
  assert.equal(fields.dom.restricted, true);
  assert.deepEqual(parseCron('5/20 * * * *').fields.minute.values, [5, 25, 45]);
  assert.deepEqual(parseCron('  0   9 * * *  ').fields.hour.values, [9]);
});

test('names and Sunday as 0 or 7', () => {
  const { fields } = parseCron('0 0 * jan-mar,DEC sun,Sat');
  assert.deepEqual(fields.month.values, [1, 2, 3, 12]);
  assert.deepEqual(fields.dow.values, [0, 6]);
  assert.deepEqual(parseCron('0 0 * * 7').fields.dow.values, [0]);
  assert.deepEqual(parseCron('0 0 * * 0,7').fields.dow.values, [0]);
  assert.deepEqual(parseCron('0 0 * * 5-7').fields.dow.values, [0, 5, 6]);
  assert.deepEqual(parseCron('0 0 * * MON-FRI').fields.dow.values, [1, 2, 3, 4, 5]);
});

test('macros expand', () => {
  assert.equal(parseCron('@yearly').expanded, '0 0 1 1 *');
  assert.equal(parseCron('@annually').expanded, '0 0 1 1 *');
  assert.equal(parseCron('@monthly').expanded, '0 0 1 * *');
  assert.equal(parseCron('@weekly').expanded, '0 0 * * 0');
  assert.equal(parseCron('@daily').expanded, '0 0 * * *');
  assert.equal(parseCron('@MIDNIGHT').expanded, '0 0 * * *');
  assert.equal(parseCron('@hourly').expanded, '0 * * * *');
  assert.equal(parseCron('@hourly').macro, '@hourly');
});

test('errors name the field and the token', () => {
  assert.throws(() => parseCron(''), /Enter a cron expression/);
  assert.throws(() => parseCron('* * * *'), /Expected 5 fields .* found 4/);
  assert.throws(() => parseCron('0 * * * * *'), /found 6\. Six fields/);
  assert.throws(() => parseCron('60 * * * *'), /^Error: Minute: 60 is out of range \(0–59\)/);
  assert.throws(() => parseCron('0 24 * * *'), /Hour: 24 is out of range \(0–23\)/);
  assert.throws(() => parseCron('0 0 0 * *'), /Day of month: 0 is out of range \(1–31\)/);
  assert.throws(() => parseCron('0 0 * 13 *'), /Month: 13 is out of range/);
  assert.throws(() => parseCron('0 0 * * 8'), /Day of week: 8 is out of range \(0–7\)/);
  assert.throws(() => parseCron('0 0 * FOO *'), /Month: "FOO" isn't a month name or number/);
  assert.throws(() => parseCron('0 0 * * FUN'), /Day of week: "FUN" isn't a day name/);
  assert.throws(() => parseCron('x * * * *'), /Minute: "x" isn't a number/);
  assert.throws(() => parseCron('*/0 * * * *'), /Minute: step "0" in "\*\/0"/);
  assert.throws(() => parseCron('0 17-9 * * *'), /Hour: range "17-9" goes backwards/);
  assert.throws(() => parseCron('0,,5 * * * *'), /Minute: empty item/);
  assert.throws(() => parseCron('0 1-2-3 * * *'), /Hour: "1-2-3" isn't a valid range/);
  assert.throws(() => parseCron('@reboot'), /once at startup/);
  assert.throws(() => parseCron('@sometimes'), /isn't a known macro/);
});

test('descriptions of common schedules', () => {
  assert.equal(describeCron('* * * * *'), 'Every minute');
  assert.equal(describeCron('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(describeCron('0 * * * *'), 'At the start of every hour');
  assert.equal(describeCron('5 * * * *'), 'At minute 5 past every hour');
  assert.equal(describeCron('0 0 * * *'), 'At 00:00, every day');
  assert.equal(describeCron('0 9 * * 1-5'), 'At 09:00, on Monday through Friday');
  assert.equal(describeCron('0 0 1 * *'), 'At 00:00, on day 1 of the month');
  assert.equal(describeCron('0 0 29 2 *'), 'At 00:00, on day 29 of the month, in February');
  assert.equal(describeCron('0 0 1 * 1'), 'At 00:00, on day 1 of the month or on Monday');
  assert.equal(describeCron('0 8,12,18 * * *'), 'At 08:00, 12:00 and 18:00, every day');
  assert.equal(describeCron('30 9-17 * * 1-5'), 'At minute 30 past the hour, from 09:00 through 17:59, on Monday through Friday');
  assert.equal(describeCron('0 */6 * * *'), 'At the start of the hour, every 6 hours');
  assert.equal(describeCron('@weekly'), 'At 00:00, on Sunday');
  assert.equal(describeCron('0 12 * */3 *'), 'At 12:00, every day, every 3 months');
  for (const preset of PRESETS) assert.ok(describeCron(preset.expr).length > 5, preset.expr);
});

test('field breakdown', () => {
  const rows = fieldBreakdown('*/20 9 * JAN,JUL 0,7');
  assert.deepEqual(rows.map((r) => r.label), ['Minute', 'Hour', 'Day of month', 'Month', 'Day of week']);
  assert.equal(rows[0].values, '0, 20, 40');
  assert.equal(rows[2].values, 'every value (1–31)');
  assert.equal(rows[3].values, 'JAN, JUL');
  assert.equal(rows[4].values, 'SUN');
  assert.equal(fieldBreakdown('* * * * *')[4].values, 'every value (0–6)');
});

test('next runs: */15', () => {
  assert.deepEqual(utcRuns('*/15 * * * *', '2024-01-01T10:07:30Z', 4), [
    '2024-01-01T10:15:00.000Z', '2024-01-01T10:30:00.000Z', '2024-01-01T10:45:00.000Z', '2024-01-01T11:00:00.000Z',
  ]);
  // Strictly after the start time, and across a year boundary.
  assert.deepEqual(utcRuns('*/15 * * * *', '2024-12-31T23:45:00Z', 2), ['2025-01-01T00:00:00.000Z', '2025-01-01T00:15:00.000Z']);
});

test('next runs: weekdays at 09:00', () => {
  // 2024-01-05 is a Friday.
  assert.deepEqual(utcRuns('0 9 * * 1-5', '2024-01-05T09:00:00Z', 4), [
    '2024-01-08T09:00:00.000Z', '2024-01-09T09:00:00.000Z', '2024-01-10T09:00:00.000Z', '2024-01-11T09:00:00.000Z',
  ]);
  assert.equal(utcRuns('0 9 * * 1-5', '2024-01-05T08:59:00Z', 10).length, 10);
});

test('next runs: 29 February waits for the next leap day', () => {
  assert.deepEqual(utcRuns('0 0 29 2 *', '2024-03-01T00:00:00Z', 3), [
    '2028-02-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z', '2036-02-29T00:00:00.000Z',
  ]);
  // 2100 is not a leap year.
  assert.deepEqual(utcRuns('0 0 29 2 *', '2097-01-01T00:00:00Z', 1), ['2104-02-29T00:00:00.000Z']);
});

test('impossible dates never run, and the search is bounded', () => {
  const started = Date.now();
  assert.deepEqual(utcRuns('0 0 30 2 *', '2024-01-01T00:00:00Z'), []);
  assert.deepEqual(utcRuns('0 0 31 4,6,9,11 *', '2024-01-01T00:00:00Z'), []);
  assert.ok(Date.now() - started < 1000);
});

test('day-of-month OR day-of-week when both are restricted', () => {
  // 0 0 1 * 1: the 1st of the month, or any Monday. 2024-04-01 is a Monday.
  assert.deepEqual(utcRuns('0 0 1 * 1', '2024-04-01T00:00:00Z', 6), [
    '2024-04-08T00:00:00.000Z', '2024-04-15T00:00:00.000Z', '2024-04-22T00:00:00.000Z', '2024-04-29T00:00:00.000Z',
    '2024-05-01T00:00:00.000Z', '2024-05-06T00:00:00.000Z',
  ]);
  const cron = parseCron('0 0 1 * 1');
  assert.ok(dayMatches(cron, 2024, 5, 1, 3));
  assert.ok(dayMatches(cron, 2024, 5, 6, 1));
  assert.ok(!dayMatches(cron, 2024, 5, 7, 2));
  // With a star in one day field, both must match (the star matches everything).
  const andCron = parseCron('0 0 */2 * 1');
  assert.ok(!dayMatches(andCron, 2024, 5, 6, 1));
  assert.ok(dayMatches(andCron, 2024, 5, 13, 1));
});

test('next runs in local time are ordered and in the future', () => {
  const from = new Date('2024-03-09T12:00:00Z');
  const runs = nextRuns('30 * * * *', from, { count: 30 });
  assert.equal(runs.length, 30);
  for (let i = 0; i < runs.length; i++) {
    assert.ok(runs[i] > from);
    assert.equal(runs[i].getMinutes(), 30);
    if (i) assert.ok(runs[i] > runs[i - 1]);
  }
});
