import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wallTimeToEpoch,
  getZoneSnapshot,
  getOffsetMinutes,
  resolveZoneToken,
  formatOneToOneInvite,
  formatMultiZoneCompact,
} from '../src/tz-engine.js';
import { parseQuickQuery } from '../src/quick-parse.js';

test('wallTimeToEpoch & getZoneSnapshot convert EST to IST accurately (non-DST Nov)', () => {
  // Nov 17, 2026 15:00 EST (UTC-5) -> 20:00 UTC -> Nov 18, 2026 01:30 IST (UTC+5:30)
  const epoch = wallTimeToEpoch(
    { year: 2026, month: 11, day: 17, hour: 15, minute: 0 },
    'America/New_York'
  );
  const ist = getZoneSnapshot(epoch, 'Asia/Kolkata', 'America/New_York', false);
  assert.equal(ist.parts.year, 2026);
  assert.equal(ist.parts.month, 11);
  assert.equal(ist.parts.day, 18);
  assert.equal(ist.parts.hour, 1);
  assert.equal(ist.parts.minute, 30);
  assert.equal(ist.dayDelta, 1);
  assert.equal(ist.dayBadge, '+1 day');
  assert.equal(ist.timeFormatted.full, '1:30 AM');
});

test('wallTimeToEpoch handles EDT (summer DST) to IST accurately', () => {
  // July 15, 2026 15:00 EDT (UTC-4) -> 19:00 UTC -> July 16, 2026 00:30 IST (UTC+5:30)
  const epoch = wallTimeToEpoch(
    { year: 2026, month: 7, day: 15, hour: 15, minute: 0 },
    'America/New_York'
  );
  assert.equal(getOffsetMinutes(epoch, 'America/New_York'), -240);
  const ist = getZoneSnapshot(epoch, 'Asia/Kolkata', 'America/New_York', true);
  assert.equal(ist.timeFormatted.full, '00:30');
  assert.equal(ist.dayDelta, 1);
});

test('handles 45-minute offset zones like Kathmandu (UTC+5:45)', () => {
  const epoch = wallTimeToEpoch(
    { year: 2026, month: 11, day: 17, hour: 12, minute: 0 },
    'UTC'
  );
  const npt = getZoneSnapshot(epoch, 'Asia/Kathmandu', 'UTC', true);
  assert.equal(npt.offsetMin, 345);
  assert.equal(npt.timeFormatted.full, '17:45');
  assert.equal(npt.utcOffsetLabel, 'UTC+5:45');
});

test('resolveZoneToken resolves abbreviations, cities, and IANA IDs', () => {
  assert.equal(resolveZoneToken('IST'), 'Asia/Kolkata');
  assert.equal(resolveZoneToken('EST'), 'America/New_York');
  assert.equal(resolveZoneToken('PST'), 'America/Los_Angeles');
  assert.equal(resolveZoneToken('Tokyo'), 'Asia/Tokyo');
  assert.equal(resolveZoneToken('London'), 'Europe/London');
  assert.equal(resolveZoneToken('Bengaluru'), 'Asia/Kolkata');
});

test('parseQuickQuery parses natural queries accurately', () => {
  const fixedNow = Date.UTC(2026, 10, 17, 6, 0, 0); // 2026-11-17T06:00:00Z

  const q1 = parseQuickQuery('3pm EST to IST', { nowEpoch: fixedNow, defaultZone: 'Asia/Kolkata' });
  assert.ok(q1);
  assert.equal(q1.sourceZone, 'America/New_York');
  assert.deepEqual(q1.targetZones, ['Asia/Kolkata']);
  const snap1 = getZoneSnapshot(q1.epochMs, 'Asia/Kolkata', q1.sourceZone, false);
  assert.equal(snap1.timeFormatted.full, '1:30 AM');
  assert.equal(snap1.dayDelta, 1);

  const q2 = parseQuickQuery('14:30 London in Tokyo, New York', { nowEpoch: fixedNow, defaultZone: 'UTC' });
  assert.ok(q2);
  assert.equal(q2.sourceZone, 'Europe/London');
  assert.deepEqual(q2.targetZones, ['Asia/Tokyo', 'America/New_York']);

  const q3 = parseQuickQuery('5pm PST', { nowEpoch: fixedNow, defaultZone: 'Asia/Kolkata' });
  assert.ok(q3);
  assert.equal(q3.sourceZone, 'America/Los_Angeles');
  assert.deepEqual(q3.targetZones, ['Asia/Kolkata']);
});

test('invite formatters produce clean readable strings', () => {
  const epoch = Date.UTC(2026, 10, 17, 14, 0, 0);
  const oneToOne = formatOneToOneInvite(epoch, 'Europe/London', 'Asia/Kolkata', false);
  assert.match(oneToOne, /2:00 PM/);
  assert.match(oneToOne, /7:30 PM/);

  const multi = formatMultiZoneCompact(epoch, ['UTC', 'Asia/Kolkata', 'America/New_York'], true);
  assert.match(multi, /14:00 UTC/);
  assert.match(multi, /19:30/);
  assert.match(multi, /09:00/);
});
