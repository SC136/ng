import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOfYear, describeInstant, detectUnit, discordCode, discordPreview, formatOffset, isValidZone, isoWeek, isoWithOffset,
  parseInput, relativeTime, rfc2822, toMillis, wallClock, zoneOffsetMinutes, zoneRow,
} from '../tools/time/time.js';

const at = (iso) => new Date(iso);

test('unit detection boundaries', () => {
  assert.equal(detectUnit(0), 's');
  assert.equal(detectUnit(1700000000), 's');
  assert.equal(detectUnit(99999999999), 's');
  assert.equal(detectUnit(1e11), 'ms');
  assert.equal(detectUnit(1700000000000), 'ms');
  assert.equal(detectUnit(99999999999999), 'ms');
  assert.equal(detectUnit(1e14), 'us');
  assert.equal(detectUnit(1700000000000000), 'us');
  assert.equal(detectUnit(1e17), 'ns');
  assert.equal(detectUnit('1700000000000000000'), 'ns');
  assert.equal(detectUnit(-1700000000000), 'ms');
});

test('numeric input in every unit lands on the same instant', () => {
  const expected = 1700000000000;
  assert.equal(parseInput('1700000000').ms, expected);
  assert.equal(parseInput('1700000000000').ms, expected);
  assert.equal(parseInput('1700000000000000').ms, expected);
  assert.equal(parseInput('1700000000000000000').ms, expected);
  assert.equal(parseInput('1700000000.5').ms, expected + 500);
  assert.deepEqual(parseInput(' 1700000000 '), { ms: expected, unit: 's', kind: 'number' });
  // Manual override beats the guess.
  assert.equal(parseInput('1700000000', 'ms').ms, 1700000000);
  assert.equal(parseInput('1700000000', 'ms').unit, 'ms');
});

test('negative timestamps are before 1970', () => {
  assert.equal(parseInput('-1').ms, -1000);
  assert.equal(new Date(parseInput('-86400').ms).toISOString(), '1969-12-31T00:00:00.000Z');
  assert.equal(toMillis('-1500000', 'us'), -1500);
  assert.equal(toMillis('-1', 'ns'), -1);
  const info = describeInstant(-1500, { timeZone: 'UTC', nowMs: 0 });
  assert.equal(info.unixSeconds, '-2');
  assert.equal(info.isoUtc, '1969-12-31T23:59:58.500Z');
  assert.equal(discordCode(-1500, 'R'), '<t:-2:R>');
});

test('text dates: ISO 8601 and RFC 2822', () => {
  assert.equal(parseInput('2024-05-01T12:00:00Z').ms, Date.UTC(2024, 4, 1, 12));
  assert.equal(parseInput('2024-05-01T17:30:00+05:30').ms, Date.UTC(2024, 4, 1, 12));
  assert.equal(parseInput('Wed, 01 May 2024 12:00:00 +0000').ms, Date.UTC(2024, 4, 1, 12));
  assert.equal(parseInput('Wed, 01 May 2024 12:00:00 GMT').kind, 'text');
});

test('bad input says what is wrong', () => {
  assert.throws(() => parseInput('   '), /Enter a timestamp/);
  assert.throws(() => parseInput('next tuesday-ish'), /Couldn't read/);
  assert.throws(() => parseInput('9e99'), /Couldn't read/);
  assert.throws(() => parseInput('99999999999999999', 's'), /outside the range/);
});

test('ISO week edge cases', () => {
  assert.deepEqual(isoWeek(2020, 12, 31), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek(2021, 1, 3), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek(2021, 1, 4), { year: 2021, week: 1 });
  assert.deepEqual(isoWeek(2024, 12, 30), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek(2026, 1, 1), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(2027, 1, 1), { year: 2026, week: 53 });
  assert.equal(describeInstant(Date.UTC(2021, 0, 3, 12), { timeZone: 'UTC' }).isoWeek, '2020-W53');
});

test('day of year', () => {
  assert.equal(dayOfYear(2024, 1, 1), 1);
  assert.equal(dayOfYear(2024, 12, 31), 366);
  assert.equal(dayOfYear(2023, 12, 31), 365);
  assert.equal(dayOfYear(2024, 3, 1), 61);
});

test('time zone offsets', () => {
  assert.equal(zoneOffsetMinutes(at('2024-05-01T00:00:00Z'), 'Asia/Kolkata'), 330);
  assert.equal(zoneOffsetMinutes(at('2024-05-01T00:00:00Z'), 'UTC'), 0);
  assert.equal(zoneOffsetMinutes(at('2024-05-01T00:00:00Z'), 'Asia/Kathmandu'), 345);
  // New York switches to EDT at 2024-03-10 07:00 UTC and back at 2024-11-03 06:00 UTC.
  assert.equal(zoneOffsetMinutes(at('2024-03-10T06:59:59Z'), 'America/New_York'), -300);
  assert.equal(zoneOffsetMinutes(at('2024-03-10T07:00:00Z'), 'America/New_York'), -240);
  assert.equal(zoneOffsetMinutes(at('2024-11-03T05:59:59Z'), 'America/New_York'), -240);
  assert.equal(zoneOffsetMinutes(at('2024-11-03T06:00:00Z'), 'America/New_York'), -300);
  assert.equal(formatOffset(330), '+05:30');
  assert.equal(formatOffset(-240, ''), '-0400');
  assert.equal(formatOffset(0), '+00:00');
});

test('formatting in a zone', () => {
  const noon = at('2024-05-01T12:00:00Z');
  assert.equal(isoWithOffset(noon, 'Asia/Kolkata'), '2024-05-01T17:30:00.000+05:30');
  assert.equal(isoWithOffset(noon, 'America/New_York'), '2024-05-01T08:00:00.000-04:00');
  assert.equal(rfc2822(noon), 'Wed, 01 May 2024 12:00:00 +0000');
  assert.equal(rfc2822(noon, 'Asia/Kolkata'), 'Wed, 01 May 2024 17:30:00 +0530');
  assert.equal(wallClock(at('2024-05-01T20:00:00Z'), 'Asia/Tokyo').day, 2);
  assert.equal(zoneRow(noon.getTime(), 'Asia/Kolkata').offset, 'UTC+05:30');
  assert.match(zoneRow(noon.getTime(), 'local').label, /^Local \(/);
  assert.ok(isValidZone('Europe/London'));
  assert.ok(!isValidZone('Mars/Olympus'));
});

test('full description of an instant', () => {
  const info = describeInstant(Date.UTC(2024, 4, 1, 12), { timeZone: 'UTC', nowMs: Date.UTC(2024, 4, 1, 15), locale: 'en-US' });
  assert.equal(info.unixSeconds, '1714564800');
  assert.equal(info.unixMillis, '1714564800000');
  assert.equal(info.isoLocal, '2024-05-01T12:00:00.000+00:00');
  assert.equal(info.relative, '3 hours ago');
  assert.equal(info.weekday, 'Wednesday');
  assert.equal(info.isoWeek, '2024-W18');
  assert.equal(info.dayOfYear, 122);
});

test('relative time picks a sensible unit', () => {
  const now = Date.UTC(2024, 0, 1);
  assert.equal(relativeTime(now, now), 'now');
  assert.equal(relativeTime(now + 30_000, now), 'in 30 seconds');
  assert.equal(relativeTime(now - 90_000, now), '2 minutes ago');
  assert.equal(relativeTime(now + 86_400_000, now), 'tomorrow');
  assert.equal(relativeTime(now - 3 * 365 * 86_400_000, now), '3 years ago');
});

test('Discord codes and previews', () => {
  const ms = 1700000000000;
  for (const style of ['t', 'T', 'd', 'D', 'f', 'F', 'R']) assert.equal(discordCode(ms, style), `<t:1700000000:${style}>`);
  assert.equal(discordCode(ms + 999, 'f'), '<t:1700000000:f>');
  assert.throws(() => discordCode(ms, 'x'), /Unknown Discord style/);
  const opts = { locale: 'en-US', timeZone: 'UTC', nowMs: ms + 3_600_000 };
  assert.equal(discordPreview(ms, 't', opts), '10:13 PM');
  assert.equal(discordPreview(ms, 'T', opts), '10:13:20 PM');
  assert.equal(discordPreview(ms, 'd', opts), '11/14/2023');
  assert.equal(discordPreview(ms, 'D', opts), 'November 14, 2023');
  assert.match(discordPreview(ms, 'f', opts), /^November 14, 2023,? (at )?10:13 PM$/);
  assert.match(discordPreview(ms, 'F', opts), /^Tuesday, November 14, 2023,? (at )?10:13 PM$/);
  assert.equal(discordPreview(ms, 'R', opts), '1 hour ago');
});
