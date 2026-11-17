import {
  getLocalZoneId,
  getZonedParts,
  resolveZoneToken,
  wallTimeToEpoch,
} from './tz-engine.js';

/**
 * Parse natural quick-convert queries such as:
 * - "3pm EST to IST"
 * - "14:30 London in Tokyo"
 * - "tomorrow 9:15am PST to UTC, IST"
 * - "2026-12-01 16:00 CET -> New York"
 * - "now in Tokyo"
 * - "5pm EST" (converts 5pm EST to user's local timezone)
 */
export function parseQuickQuery(rawInput, { nowEpoch = Date.now(), defaultZone = getLocalZoneId() } = {}) {
  if (!rawInput || !rawInput.trim()) return null;

  let text = rawInput.trim().replace(/\s+/g, ' ');

  // Split on connector (" to ", " in ", " -> ", " => ", " into ", " as ")
  const connectorRegex = /\s+(?:to|in|into|as|->|=>|→)\s+/i;
  let leftPart = text;
  let rightPart = '';

  const connMatch = connectorRegex.exec(text);
  if (connMatch) {
    leftPart = text.slice(0, connMatch.index).trim();
    rightPart = text.slice(connMatch.index + connMatch[0].length).trim();
  }

  // Extract optional relative date ("today", "tomorrow", "yesterday") or ISO date ("YYYY-MM-DD") from leftPart
  let dayOffset = 0;
  let explicitDate = null;

  const isoDateMatch = leftPart.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDateMatch) {
    explicitDate = {
      year: Number(isoDateMatch[1]),
      month: Number(isoDateMatch[2]),
      day: Number(isoDateMatch[3]),
    };
    leftPart = leftPart.replace(isoDateMatch[0], ' ').trim();
  } else if (/\btomorrow\b/i.test(leftPart)) {
    dayOffset = 1;
    leftPart = leftPart.replace(/\btomorrow\b/i, ' ').trim();
  } else if (/\byesterday\b/i.test(leftPart)) {
    dayOffset = -1;
    leftPart = leftPart.replace(/\byesterday\b/i, ' ').trim();
  } else if (/\btoday\b/i.test(leftPart)) {
    leftPart = leftPart.replace(/\btoday\b/i, ' ').trim();
  }

  // Extract time or "now" from leftPart
  let isNow = false;
  let parsedTime = null;

  if (/\bnow\b/i.test(leftPart)) {
    isNow = true;
    leftPart = leftPart.replace(/\bnow\b/i, ' ').trim();
  } else if (/\bnoon\b/i.test(leftPart)) {
    parsedTime = { hour: 12, minute: 0 };
    leftPart = leftPart.replace(/\bnoon\b/i, ' ').trim();
  } else if (/\bmidnight\b/i.test(leftPart)) {
    parsedTime = { hour: 0, minute: 0 };
    leftPart = leftPart.replace(/\bmidnight\b/i, ' ').trim();
  } else {
    // Match 12h or 24h time: e.g. "3pm", "3:30 pm", "14:30", "9.30am"
    const timeRegex = /(?:^|\s)(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/i;
    const m = leftPart.match(timeRegex);
    if (m) {
      const rawHour = Number(m[1]);
      const rawMin = m[2] !== undefined ? Number(m[2]) : 0;
      const meridiem = m[3] ? m[3].toLowerCase().replace(/\./g, '') : null;

      // Require either meridiem OR minutes (e.g. "14:00") OR unambiguous 0..23 when followed by zone/connector
      if (rawMin >= 0 && rawMin <= 59) {
        let hour = rawHour;
        let valid = true;
        if (meridiem) {
          if (rawHour < 1 || rawHour > 12) valid = false;
          else if (meridiem === 'pm' && rawHour !== 12) hour = rawHour + 12;
          else if (meridiem === 'am' && rawHour === 12) hour = 0;
        } else if (rawHour > 23) {
          valid = false;
        }
        if (valid) {
          parsedTime = { hour, minute: rawMin };
          leftPart = (
            leftPart.slice(0, m.index) +
            ' ' +
            leftPart.slice(m.index + m[0].length)
          ).trim();
        }
      }
    }
  }

  // Remaining text in leftPart is the optional source zone (strip leading "at", "from")
  const sourceToken = leftPart.replace(/^(?:at|from|in)\s+/i, '').replace(/\s+(?:time)$/i, '').trim();

  let sourceZone = defaultZone;
  if (sourceToken) {
    const resolvedSrc = resolveZoneToken(sourceToken, nowEpoch);
    if (!resolvedSrc) return null;
    sourceZone = resolvedSrc;
  }

  // Parse target zone(s)
  let targetZones = [];
  if (rightPart) {
    const rawTargets = rightPart
      .split(/\s*(?:,|\/|\band\b|&)\s*/i)
      .map((s) => s.replace(/\s+time$/i, '').trim())
      .filter(Boolean);

    for (const tok of rawTargets) {
      const resolved = resolveZoneToken(tok, nowEpoch);
      if (resolved && !targetZones.includes(resolved)) {
        targetZones.push(resolved);
      }
    }
    if (targetZones.length === 0) return null;
  } else {
    // No explicit target side: e.g. "5pm EST" -> convert to user's defaultZone (or UTC if already defaultZone)
    if (!sourceToken || (!parsedTime && !isNow)) return null;
    const fallbackTarget = sourceZone === defaultZone ? 'UTC' : defaultZone;
    targetZones = [fallbackTarget];
  }

  if (!isNow && !parsedTime) {
    // e.g. user typed "EST to IST" -> assume "now"
    isNow = true;
  }

  let epochMs = nowEpoch;
  if (!isNow && parsedTime) {
    const baseParts = getZonedParts(nowEpoch + dayOffset * 86400000, sourceZone);
    const dateParts = explicitDate || {
      year: baseParts.year,
      month: baseParts.month,
      day: baseParts.day,
    };
    epochMs = wallTimeToEpoch(
      {
        ...dateParts,
        hour: parsedTime.hour,
        minute: parsedTime.minute,
        second: 0,
      },
      sourceZone
    );
  }

  return {
    epochMs,
    isNow,
    sourceZone,
    targetZones,
    primaryTargetZone: targetZones[0],
  };
}
