import { ABBREVIATION_MAP, CITY_ALIASES } from './tz-data.js';

const LEGACY_IANA_NORMALIZATION = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
};

const dtfCache = new Map();
const abbrevDtfCache = new Map();

function getPartsFormatter(timeZone) {
  let fmt = dtfCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, fmt);
  }
  return fmt;
}

function getAbbrevFormatter(timeZone) {
  let fmt = abbrevDtfCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    });
    abbrevDtfCache.set(timeZone, fmt);
  }
  return fmt;
}

export function normalizeZoneId(zoneId) {
  if (!zoneId) return 'UTC';
  if (LEGACY_IANA_NORMALIZATION[zoneId]) {
    return LEGACY_IANA_NORMALIZATION[zoneId];
  }
  return zoneId;
}

export function getLocalZoneId() {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return normalizeZoneId(raw);
  } catch {
    return 'UTC';
  }
}

export function isValidZone(zoneId) {
  if (!zoneId) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zoneId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract numeric wall-clock parts for a given epoch ms in a target IANA timeZone.
 */
export function getZonedParts(epochMs, timeZone) {
  const fmt = getPartsFormatter(timeZone);
  const parts = fmt.formatToParts(new Date(epochMs));
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
  };
}

/**
 * Compute UTC offset in minutes for a zone at a specific epoch ms.
 * Positive for east of UTC (e.g. Asia/Kolkata -> +330), negative for west (e.g. America/New_York -> -300).
 */
export function getOffsetMinutes(epochMs, timeZone) {
  const parts = getZonedParts(epochMs, timeZone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  // Truncate epochMs to whole seconds for exact minute calculation
  const truncatedEpoch = Math.floor(epochMs / 1000) * 1000;
  return Math.round((asUTC - truncatedEpoch) / 60000);
}

export function formatUtcOffset(offsetMinutes) {
  if (offsetMinutes === 0) return 'UTC±0';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0
    ? `UTC${sign}${h}`
    : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

export function getShortZoneAbbrev(epochMs, timeZone) {
  if (timeZone === 'UTC') return 'UTC';
  try {
    const parts = getAbbrevFormatter(timeZone).formatToParts(new Date(epochMs));
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : formatUtcOffset(getOffsetMinutes(epochMs, timeZone));
  } catch {
    return formatUtcOffset(getOffsetMinutes(epochMs, timeZone));
  }
}

/**
 * Convert wall-clock date/time components in `sourceZone` into an exact UTC epoch timestamp (ms).
 * Uses two-pass offset refinement to handle DST transitions accurately.
 */
export function wallTimeToEpoch(
  { year, month, day, hour, minute = 0, second = 0 },
  sourceZone
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getOffsetMinutes(guess, sourceZone) * 60000;
  const candidate1 = guess - offset1;
  const offset2 = getOffsetMinutes(candidate1, sourceZone) * 60000;
  return guess - offset2;
}

export const DEFAULT_HOUR_RANGES = {
  workStart: 9,
  workEnd: 18,
  nightStart: 22,
  nightEnd: 7,
};

export function isHourInRange(hour, start, end) {
  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

/**
 * Categorize local hour (0..23) for visual status badges and timeline coloring.
 */
export function getDayPeriodStatus(hour, hourRanges = DEFAULT_HOUR_RANGES) {
  const {
    workStart = 9,
    workEnd = 18,
    nightStart = 22,
    nightEnd = 7,
  } = hourRanges || DEFAULT_HOUR_RANGES;

  if (isHourInRange(hour, workStart, workEnd)) {
    return { key: 'work', label: 'Work hours', icon: '☀' };
  }
  if (isHourInRange(hour, nightStart, nightEnd)) {
    return { key: 'night', label: 'Night / Quiet', icon: '☾' };
  }
  return { key: 'awake', label: 'Flex / Awake', icon: '◐' };
}

export function formatTimeFromParts({ hour, minute }, use24Hour = false) {
  const mm = String(minute).padStart(2, '0');
  if (use24Hour) {
    return {
      main: `${String(hour).padStart(2, '0')}:${mm}`,
      period: '',
      full: `${String(hour).padStart(2, '0')}:${mm}`,
    };
  }
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return {
    main: `${h12}:${mm}`,
    period,
    full: `${h12}:${mm} ${period}`,
  };
}

export function formatDateShort(epochMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(epochMs));
}

export function formatDateInputValue(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatTimeInputValue(parts) {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/**
 * Compute calendar day difference (e.g. -1, 0, +1) of targetZone relative to referenceZone at epochMs.
 */
export function getDayDelta(epochMs, referenceZone, targetZone) {
  const ref = getZonedParts(epochMs, referenceZone);
  const tgt = getZonedParts(epochMs, targetZone);
  const refDayUtc = Date.UTC(ref.year, ref.month - 1, ref.day);
  const tgtDayUtc = Date.UTC(tgt.year, tgt.month - 1, tgt.day);
  return Math.round((tgtDayUtc - refDayUtc) / 86400000);
}

export function formatOffsetDifference(sourceOffsetMin, targetOffsetMin) {
  const diff = targetOffsetMin - sourceOffsetMin;
  if (diff === 0) return 'Same time';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const dur = m === 0 ? `${h}h` : h === 0 ? `${m}m` : `${h}h ${m}m`;
  return diff > 0 ? `${dur} ahead` : `${dur} behind`;
}

/**
 * Build full snapshot of a zone at epochMs relative to a referenceZone.
 */
export function getZoneSnapshot(
  epochMs,
  timeZone,
  referenceZone = timeZone,
  use24Hour = false,
  hourRanges = DEFAULT_HOUR_RANGES
) {
  const parts = getZonedParts(epochMs, timeZone);
  const offsetMin = getOffsetMinutes(epochMs, timeZone);
  const refOffsetMin = getOffsetMinutes(epochMs, referenceZone);
  const timeFormatted = formatTimeFromParts(parts, use24Hour);
  const dayDelta = getDayDelta(epochMs, referenceZone, timeZone);
  const status = getDayPeriodStatus(parts.hour, hourRanges);
  const abbrev = getShortZoneAbbrev(epochMs, timeZone);

  let dayBadge = 'Same day';
  if (dayDelta === 1) dayBadge = '+1 day';
  else if (dayDelta === -1) dayBadge = '-1 day';
  else if (dayDelta > 1) dayBadge = `+${dayDelta} days`;
  else if (dayDelta < -1) dayBadge = `${dayDelta} days`;

  return {
    id: timeZone,
    displayName: getZoneDisplayName(timeZone),
    cityName: getZoneShortTitle(timeZone),
    parts,
    timeFormatted,
    dateFormatted: formatDateShort(epochMs, timeZone),
    dateInput: formatDateInputValue(parts),
    timeInput: formatTimeInputValue(parts),
    offsetMin,
    utcOffsetLabel: formatUtcOffset(offsetMin),
    diffFromRefLabel: formatOffsetDifference(refOffsetMin, offsetMin),
    abbrev,
    dayDelta,
    dayBadge,
    status,
  };
}

let cachedCatalog = null;
let cachedEnrichedBucket = null;
let cachedEnrichedList = null;
const aliasByZoneId = new Map(CITY_ALIASES.map((item) => [item.id, item]));

export function getZoneDisplayName(zoneId) {
  const norm = normalizeZoneId(zoneId);
  const alias = aliasByZoneId.get(norm);
  if (alias) return alias.label;
  const segments = norm.split('/');
  const city = segments[segments.length - 1].replace(/_/g, ' ');
  const region = segments.length > 1 ? segments[0].replace(/_/g, ' ') : '';
  return region ? `${city} (${region})` : city;
}

export function getZoneShortTitle(zoneId) {
  const norm = normalizeZoneId(zoneId);
  if (norm === 'UTC') return 'UTC';
  const alias = aliasByZoneId.get(norm);
  if (alias) {
    // Strip parenthetical suffix for compact card titles
    return alias.label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }
  const segments = norm.split('/');
  return segments[segments.length - 1].replace(/_/g, ' ');
}

/**
 * Build searchable catalog of all supported IANA time zones + UTC + curated aliases.
 */
export function getTimeZoneCatalog(referenceEpoch = Date.now()) {
  if (!cachedCatalog) {
    const rawZones =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : CITY_ALIASES.map((c) => c.id);

    const seen = new Set();
    const list = [];

    const addZone = (rawId, priority = false) => {
      const id = normalizeZoneId(rawId);
      if (seen.has(id) || !isValidZone(id)) return;
      seen.add(id);
      const alias = aliasByZoneId.get(id);
      const displayName = getZoneDisplayName(id);
      const cityTitle = getZoneShortTitle(id);
      const searchTokens = [
        id.toLowerCase().replace(/_/g, ' '),
        id.toLowerCase(),
        displayName.toLowerCase(),
        cityTitle.toLowerCase(),
        ...(alias ? alias.keywords : []),
      ].join(' ');
      list.push({
        id,
        displayName,
        cityTitle,
        priority,
        searchTokens,
      });
    };

    // Add curated cities first for high relevance
    for (const item of CITY_ALIASES) {
      addZone(item.id, true);
    }
    for (const z of rawZones) {
      addZone(z, false);
    }

    cachedCatalog = list;
  }

  const bucket = Math.floor(referenceEpoch / 900000);
  if (cachedEnrichedBucket === bucket && cachedEnrichedList) {
    return cachedEnrichedList;
  }

  // Enrich with live offset & short abbrev for referenceEpoch
  cachedEnrichedList = cachedCatalog.map((entry) => {
    const offsetMin = getOffsetMinutes(referenceEpoch, entry.id);
    const abbrev = getShortZoneAbbrev(referenceEpoch, entry.id);
    const utcOffset = formatUtcOffset(offsetMin);
    return {
      ...entry,
      offsetMin,
      abbrev,
      utcOffset,
    };
  });
  cachedEnrichedBucket = bucket;
  return cachedEnrichedList;
}

/**
 * Search time zones by free-text query (city, country, abbreviation, IANA id, or UTC offset).
 */
export function searchTimeZones(query, favoriteIds = [], referenceEpoch = Date.now(), limit = 60) {
  const catalog = getTimeZoneCatalog(referenceEpoch);
  const favSet = new Set(favoriteIds);
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    // Favorites first, then curated priority zones sorted by offset, then rest
    return [...catalog]
      .sort((a, b) => {
        const aFav = favSet.has(a.id) ? 1 : 0;
        const bFav = favSet.has(b.id) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return a.offsetMin - b.offsetMin || a.displayName.localeCompare(b.displayName);
      })
      .slice(0, limit);
  }

  const upperQ = q.toUpperCase();
  const exactAbbrevTarget = ABBREVIATION_MAP[upperQ] || null;

  const scored = [];
  for (const item of catalog) {
    let score = 0;
    const abbrevLower = item.abbrev.toLowerCase();
    const offsetLower = item.utcOffset.toLowerCase();

    if (exactAbbrevTarget === item.id) score += 1000;
    if (item.id.toLowerCase() === q) score += 950;
    if (abbrevLower === q) score += 700;
    if (item.cityTitle.toLowerCase() === q) score += 850;
    if (item.cityTitle.toLowerCase().startsWith(q)) score += 500;
    if (item.displayName.toLowerCase().includes(q)) score += 300;
    if (item.searchTokens.includes(q)) score += 200;
    if (offsetLower.includes(q)) score += 220;

    if (score > 0) {
      if (favSet.has(item.id)) score += 50;
      if (item.priority) score += 25;
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName));
  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * Resolve a single free-text token (e.g. "EST", "IST", "Tokyo", "London", "America/New_York") to a zone ID.
 */
export function resolveZoneToken(token, referenceEpoch = Date.now()) {
  if (!token) return null;
  const cleaned = token.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  if (ABBREVIATION_MAP[upper]) {
    return ABBREVIATION_MAP[upper];
  }
  if (upper === 'LOCAL' || upper === 'HERE' || upper === 'MY TIME') {
    return getLocalZoneId();
  }

  // Direct valid IANA check (case-insensitive match via catalog)
  const matches = searchTimeZones(cleaned, [], referenceEpoch, 5);
  if (matches.length > 0) {
    return matches[0].id;
  }
  if (isValidZone(cleaned)) {
    return normalizeZoneId(cleaned);
  }
  return null;
}

/**
 * Build formatted text snippets for Slack, Email, or Calendar invites.
 */
export function formatOneToOneInvite(epochMs, sourceZone, targetZone, use24Hour = false) {
  const src = getZoneSnapshot(epochMs, sourceZone, sourceZone, use24Hour);
  const tgt = getZoneSnapshot(epochMs, targetZone, sourceZone, use24Hour);
  const dayNote = tgt.dayDelta !== 0 ? ` (${tgt.dateFormatted})` : '';
  return `${src.dateFormatted} · ${src.timeFormatted.full} ${src.abbrev} (${src.cityName}) → ${tgt.timeFormatted.full} ${tgt.abbrev} (${tgt.cityName})${dayNote}`;
}

export function formatMultiZoneCompact(
  epochMs,
  zoneIds,
  use24Hour = false,
  referenceZone = null
) {
  if (!zoneIds.length) return '';
  const refZone = referenceZone || zoneIds[0];
  const refSnap = getZoneSnapshot(epochMs, refZone, refZone, use24Hour);
  const segments = zoneIds.map((id) => {
    const snap = getZoneSnapshot(epochMs, id, refZone, use24Hour);
    const shift = snap.dayDelta !== 0 ? ` (${snap.dayBadge})` : '';
    return `${snap.timeFormatted.full} ${snap.abbrev}${shift}`;
  });
  return `${refSnap.dateFormatted}: ${segments.join(' / ')}`;
}

export function formatMultiZoneInviteBlock(
  epochMs,
  zoneIds,
  use24Hour = false,
  referenceZone = null
) {
  if (!zoneIds.length) return '';
  const refZone = referenceZone || zoneIds[0];
  const lines = ['Proposed Time Across Time Zones:'];
  for (const id of zoneIds) {
    const snap = getZoneSnapshot(epochMs, id, refZone, use24Hour);
    lines.push(
      `• ${snap.cityName} (${snap.abbrev}, ${snap.utcOffsetLabel}): ${snap.timeFormatted.full} — ${snap.dateFormatted}`
    );
  }
  return lines.join('\n');
}
