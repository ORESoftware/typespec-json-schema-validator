import assert from 'node:assert/strict';
import test from 'node:test';
import { FORMAT_ASSERTIONS } from '../../src/format-assertions.mjs';
import { FORMAT_CASES } from '../fixtures/format-cases.mjs';

for (const [format, expected, values] of FORMAT_CASES) {
  for (const value of values) {
    test(`${format}: ${JSON.stringify(value)} is ${expected ? 'accepted' : 'rejected'}`, () => {
      assert.equal(FORMAT_ASSERTIONS[format].test(value), expected);
    });
  }
}

test('format dispatch has no prototype and cannot acquire inherited validators', () => {
  assert.equal(Object.getPrototypeOf(FORMAT_ASSERTIONS), null);
  assert.equal(Object.isFrozen(FORMAT_ASSERTIONS), true);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'unknown']) {
    assert.equal(FORMAT_ASSERTIONS[name], undefined);
  }
  for (const check of Object.values(FORMAT_ASSERTIONS)) {
    assert.equal(Object.isFrozen(check), true);
    for (const value of [null, undefined, 42, {}, [], true]) assert.equal(check.test(value), false);
  }
});

test('all four-digit Gregorian years retain the correct February boundary', () => {
  for (let year = 0; year <= 9999; year += 1) {
    const prefix = `${String(year).padStart(4, '0')}-02-`;
    // Independent built-in calendar oracle; setUTCFullYear avoids Date.UTC's
    // special handling of years 00 through 99. No date-string parsing.
    const oracle = new Date(0);
    oracle.setUTCFullYear(year, 2, 0);
    const lastDay = oracle.getUTCDate();
    for (const day of [28, 29, 30]) {
      assert.equal(FORMAT_ASSERTIONS.date.test(`${prefix}${day}`), day <= lastDay, `${year}-${day}`);
    }
  }
});

test('leap-second placement follows every RFC3339 minute offset', () => {
  for (let offset = -1439; offset <= 1439; offset += 1) {
    const local = 1439 + offset;
    const minuteOfDay = ((local % 1440) + 1440) % 1440;
    const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
    const minute = String(minuteOfDay % 60).padStart(2, '0');
    const magnitude = Math.abs(offset);
    const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(magnitude / 60)).padStart(2, '0')}:${String(magnitude % 60).padStart(2, '0')}`;
    const time = `${hour}:${minute}:60${zone}`;
    const date = local >= 1440 ? '2017-01-01' : '2016-12-31';
    const wrongDate = local >= 1440 ? '2017-01-02' : '2016-12-30';
    assert.equal(FORMAT_ASSERTIONS.time.test(time), true, time);
    assert.equal(FORMAT_ASSERTIONS['date-time'].test(`${date}T${time}`), true, time);
    assert.equal(FORMAT_ASSERTIONS['date-time'].test(`${wrongDate}T${time}`), false, time);
  }
});

test('existing regex-backed formats retain representative full-string decisions', () => {
  for (const [format, value] of [
    ['duration', 'P1DT2H'], ['email', 'person@example.com'], ['hostname', 'example.com'],
    ['uri', 'https://example.com/x'], ['uri-reference', '../x'],
    ['uuid', '123e4567-e89b-12d3-a456-426614174000'],
  ]) {
    assert.equal(FORMAT_ASSERTIONS[format].test(value), true, format);
    assert.equal(FORMAT_ASSERTIONS[format].test(`${value}\n`), false, format);
  }
  assert.equal(FORMAT_ASSERTIONS['uri-reference'].test(''), true);
});
