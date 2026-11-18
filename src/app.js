import { DEFAULT_FAVORITE_ZONES } from './tz-data.js';
import {
  DEFAULT_HOUR_RANGES,
  formatMultiZoneCompact,
  formatMultiZoneInviteBlock,
  formatOneToOneInvite,
  getDayPeriodStatus,
  getLocalZoneId,
  getZoneShortTitle,
  getZoneSnapshot,
  getZonedParts,
  isValidZone,
  normalizeZoneId,
  resolveZoneToken,
  searchTimeZones,
  wallTimeToEpoch,
} from './tz-engine.js';
import { parseQuickQuery } from './quick-parse.js';

const STORAGE_KEY = 'zoneshift_prefs_v1';
const MODULE_KEYS = ['quick', 'oneToOne', 'multi', 'guide'];
const DEFAULT_VISIBLE_MODULES = {
  quick: true,
  oneToOne: true,
  multi: true,
  guide: false,
};
const MODULE_LABELS = {
  quick: 'Quick Parse',
  oneToOne: '1-to-1 Converter',
  multi: 'Multi-Zone Timeline',
  guide: 'Guide & FAQ',
};

function uniqueZones(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const z = normalizeZoneId(raw);
    if (!seen.has(z) && isValidZone(z)) {
      seen.add(z);
      out.push(z);
    }
  }
  return out;
}

function createDefaultState() {
  const local = getLocalZoneId();
  const defaultTarget = local === 'America/New_York' ? 'Europe/London' : 'America/New_York';
  const boardZones = uniqueZones([
    local,
    'UTC',
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
  ]);
  const favoriteZones = uniqueZones([local, ...DEFAULT_FAVORITE_ZONES]);
  const savedPairs = [
    { from: local, to: defaultTarget },
    { from: local, to: 'UTC' },
  ];
  return {
    theme: 'dark',
    use24Hour: false,
    useSystemBase: true,
    baseZone: local,
    referenceZone: local,
    sourceZone: local,
    targetZone: defaultTarget,
    boardZones,
    favoriteZones,
    savedPairs,
    hourRanges: { ...DEFAULT_HOUR_RANGES },
    visibleModules: { ...DEFAULT_VISIBLE_MODULES },
    guideDefaultClosedV1: true,
    isAppInstalled: false,
    moduleOrder: [...MODULE_KEYS],
  };
}

function normalizeHourValue(val, fallback) {
  const n = Number(val);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function normalizeHourRanges(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HOUR_RANGES };
  return {
    workStart: normalizeHourValue(raw.workStart, DEFAULT_HOUR_RANGES.workStart),
    workEnd: normalizeHourValue(raw.workEnd, DEFAULT_HOUR_RANGES.workEnd),
    nightStart: normalizeHourValue(raw.nightStart, DEFAULT_HOUR_RANGES.nightStart),
    nightEnd: normalizeHourValue(raw.nightEnd, DEFAULT_HOUR_RANGES.nightEnd),
  };
}

function normalizeModuleOrder(rawOrder) {
  if (!Array.isArray(rawOrder)) return [...MODULE_KEYS];
  const valid = [];
  for (const k of rawOrder) {
    if (MODULE_KEYS.includes(k) && !valid.includes(k)) {
      valid.push(k);
    }
  }
  for (const k of MODULE_KEYS) {
    if (!valid.includes(k)) valid.push(k);
  }
  return valid;
}

function loadPrefs() {
  const defaults = createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const loadedModules = { ...defaults.visibleModules };
    if (parsed.visibleModules && typeof parsed.visibleModules === 'object') {
      for (const k of MODULE_KEYS) {
        if (typeof parsed.visibleModules[k] === 'boolean') {
          loadedModules[k] = parsed.visibleModules[k];
        }
      }
      if (!MODULE_KEYS.some((k) => loadedModules[k])) {
        loadedModules.oneToOne = true;
      }
    }
    if (!parsed.guideDefaultClosedV1) {
      loadedModules.guide = false;
      if (!MODULE_KEYS.some((k) => loadedModules[k])) {
        loadedModules.oneToOne = true;
      }
    }
    const systemZone = getLocalZoneId();
    const useSystemBase = parsed.useSystemBase !== false;
    const baseZone = useSystemBase
      ? systemZone
      : isValidZone(parsed.baseZone)
        ? normalizeZoneId(parsed.baseZone)
        : systemZone;

    let boardZones = Array.isArray(parsed.boardZones) && parsed.boardZones.length
      ? uniqueZones(parsed.boardZones)
      : defaults.boardZones;
    if (useSystemBase && !boardZones.includes(systemZone)) {
      boardZones = [systemZone, ...boardZones];
    }

    const rawRef = isValidZone(parsed.referenceZone)
      ? normalizeZoneId(parsed.referenceZone)
      : baseZone;
    const referenceZone = boardZones.includes(rawRef) ? rawRef : boardZones[0];

    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      use24Hour: Boolean(parsed.use24Hour),
      useSystemBase,
      baseZone,
      referenceZone,
      sourceZone: isValidZone(parsed.sourceZone) ? normalizeZoneId(parsed.sourceZone) : baseZone,
      targetZone: isValidZone(parsed.targetZone) ? normalizeZoneId(parsed.targetZone) : defaults.targetZone,
      boardZones,
      favoriteZones: Array.isArray(parsed.favoriteZones)
        ? uniqueZones(parsed.favoriteZones)
        : defaults.favoriteZones,
      savedPairs: Array.isArray(parsed.savedPairs)
        ? parsed.savedPairs.filter((p) => p && isValidZone(p.from) && isValidZone(p.to))
        : defaults.savedPairs,
      hourRanges: normalizeHourRanges(parsed.hourRanges),
      visibleModules: loadedModules,
      guideDefaultClosedV1: true,
      isAppInstalled: Boolean(parsed.isAppInstalled),
      moduleOrder: normalizeModuleOrder(parsed.moduleOrder),
    };
  } catch {
    return defaults;
  }
}

const prefs = loadPrefs();

function getBoardReferenceZone() {
  if (!prefs.boardZones.length) return prefs.baseZone || getLocalZoneId();
  if (prefs.referenceZone && prefs.boardZones.includes(prefs.referenceZone)) {
    return prefs.referenceZone;
  }
  prefs.referenceZone = prefs.boardZones[0];
  return prefs.referenceZone;
}

const runtime = {
  isLive: true,
  epochMs: Date.now(),
  pickerMode: null, // 'base' | 'source' | 'target' | 'board' | 'board-replace'
  pickerReplaceIndex: null,
  pickerFilter: 'all', // 'all' | 'favorites'
  pickerFocusIndex: 0,
  pickerCurrentItems: [],
  deferredInstallPrompt: null,
  lastQuickParsed: null,
};

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota / private mode errors
  }
}

// DOM References
const el = {
  baseZoneBtn: document.getElementById('baseZoneBtn'),
  baseZoneLabel: document.getElementById('baseZoneLabel'),
  clockModeText: document.getElementById('clockModeText'),
  liveDot: document.getElementById('liveDot'),
  resetNowBtn: document.getElementById('resetNowBtn'),
  fmt12Btn: document.getElementById('fmt12Btn'),
  fmt24Btn: document.getElementById('fmt24Btn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  installAppBtn: document.getElementById('installAppBtn'),

  quickInput: document.getElementById('quickInput'),
  quickClearBtn: document.getElementById('quickClearBtn'),
  quickResultPanel: document.getElementById('quickResultPanel'),

  savePairBtn: document.getElementById('savePairBtn'),
  copyPairInviteBtn: document.getElementById('copyPairInviteBtn'),
  savedPairsBar: document.getElementById('savedPairsBar'),

  sourceBadges: document.getElementById('sourceBadges'),
  sourceZoneBtn: document.getElementById('sourceZoneBtn'),
  sourceZoneTitle: document.getElementById('sourceZoneTitle'),
  sourceZoneMeta: document.getElementById('sourceZoneMeta'),
  sourceStarBtn: document.getElementById('sourceStarBtn'),
  sourceReadout: document.getElementById('sourceReadout'),
  sourceDateReadout: document.getElementById('sourceDateReadout'),
  sourceTimeInput: document.getElementById('sourceTimeInput'),
  sourceDateInput: document.getElementById('sourceDateInput'),

  swapZonesBtn: document.getElementById('swapZonesBtn'),
  pairDeltaPill: document.getElementById('pairDeltaPill'),

  targetBadges: document.getElementById('targetBadges'),
  targetZoneBtn: document.getElementById('targetZoneBtn'),
  targetZoneTitle: document.getElementById('targetZoneTitle'),
  targetZoneMeta: document.getElementById('targetZoneMeta'),
  targetStarBtn: document.getElementById('targetStarBtn'),
  targetReadout: document.getElementById('targetReadout'),
  targetDateReadout: document.getElementById('targetDateReadout'),
  targetTimeInput: document.getElementById('targetTimeInput'),
  targetDateInput: document.getElementById('targetDateInput'),

  copyCompactBtn: document.getElementById('copyCompactBtn'),
  copyMeetingBlockBtn: document.getElementById('copyMeetingBlockBtn'),
  addBoardZoneBtn: document.getElementById('addBoardZoneBtn'),
  scrubberRefName: document.getElementById('scrubberRefName'),
  scrubberTimePill: document.getElementById('scrubberTimePill'),
  scrubberNowBtn: document.getElementById('scrubberNowBtn'),
  timelineSlider: document.getElementById('timelineSlider'),
  legendWorkText: document.getElementById('legendWorkText'),
  legendNightText: document.getElementById('legendNightText'),
  toggleHoursConfigBtn: document.getElementById('toggleHoursConfigBtn'),
  hoursConfigPanel: document.getElementById('hoursConfigPanel'),
  workStartSelect: document.getElementById('workStartSelect'),
  workEndSelect: document.getElementById('workEndSelect'),
  nightStartSelect: document.getElementById('nightStartSelect'),
  nightEndSelect: document.getElementById('nightEndSelect'),
  resetHoursBtn: document.getElementById('resetHoursBtn'),
  boardList: document.getElementById('boardList'),

  zonePickerModal: document.getElementById('zonePickerModal'),
  pickerModalTitle: document.getElementById('pickerModalTitle'),
  closePickerBtn: document.getElementById('closePickerBtn'),
  pickerSearchInput: document.getElementById('pickerSearchInput'),
  filterAllBtn: document.getElementById('filterAllBtn'),
  filterFavBtn: document.getElementById('filterFavBtn'),
  useSystemLocalBtn: document.getElementById('useSystemLocalBtn'),
  pickerResultsList: document.getElementById('pickerResultsList'),

  installHelpModal: document.getElementById('installHelpModal'),
  closeInstallHelpBtn: document.getElementById('closeInstallHelpBtn'),
  markInstalledBtn: document.getElementById('markInstalledBtn'),

  uninstallHelpModal: document.getElementById('uninstallHelpModal'),
  closeUninstallHelpBtn: document.getElementById('closeUninstallHelpBtn'),
  unregisterPwaBtn: document.getElementById('unregisterPwaBtn'),

  headerPrivacyBtn: document.getElementById('headerPrivacyBtn'),
  openDataPolicyBtn: document.getElementById('openDataPolicyBtn'),
  dataPolicyModal: document.getElementById('dataPolicyModal'),
  closeDataPolicyBtn: document.getElementById('closeDataPolicyBtn'),
  clearLocalDataBtn: document.getElementById('clearLocalDataBtn'),

  toast: document.getElementById('toast'),
};

let toastTimer = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, 2400);
}

async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✓ ${label}`);
  } catch {
    // Fallback textarea copy
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`✓ ${label}`);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  el.themeIcon.textContent = prefs.theme === 'dark' ? '☀' : '☾';
}

function toggleFavoriteZone(zoneId) {
  const norm = normalizeZoneId(zoneId);
  const idx = prefs.favoriteZones.indexOf(norm);
  if (idx >= 0) {
    prefs.favoriteZones.splice(idx, 1);
    showToast(`Removed ${getZoneShortTitle(norm)} from favorites`);
  } else {
    prefs.favoriteZones.unshift(norm);
    showToast(`★ Added ${getZoneShortTitle(norm)} to favorites`);
  }
  savePrefs();
  renderAll();
  if (!el.zonePickerModal.classList.contains('hidden')) {
    renderPickerList();
  }
}

function setCustomEpoch(epochMs) {
  runtime.isLive = false;
  runtime.epochMs = epochMs;
  renderAll();
}

function resetToNow() {
  runtime.isLive = true;
  runtime.epochMs = Date.now();
  renderAll();
}

function isRunningInstalled() {
  const inAppWindow =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true;
  if (inAppWindow && !prefs.isAppInstalled) {
    prefs.isAppInstalled = true;
    savePrefs();
  }
  return Boolean(inAppWindow || prefs.isAppInstalled);
}

function renderHeaderState() {
  el.fmt12Btn.classList.toggle('active', !prefs.use24Hour);
  el.fmt24Btn.classList.toggle('active', prefs.use24Hour);
  el.resetNowBtn.classList.toggle('btn-now-highlight', !runtime.isLive);

  if (el.installAppBtn) {
    const installed = isRunningInstalled();
    el.installAppBtn.textContent = installed ? '🗑 Uninstall App' : '⬇ Install App';
    el.installAppBtn.title = installed
      ? 'Uninstall desktop app or clear offline cache'
      : 'Install as standalone desktop window';
    el.installAppBtn.classList.toggle('btn-primary', !installed);
    el.installAppBtn.classList.toggle('btn-subtle', installed);
  }

  if (prefs.useSystemBase) {
    prefs.baseZone = getLocalZoneId();
  }

  if (el.baseZoneLabel) {
    const baseSnap = getZoneSnapshot(runtime.epochMs, prefs.baseZone, prefs.baseZone, prefs.use24Hour);
    el.baseZoneLabel.textContent = prefs.useSystemBase
      ? `System · ${baseSnap.cityName} (${baseSnap.abbrev})`
      : `${baseSnap.cityName} (${baseSnap.abbrev})`;
  }

  if (runtime.isLive) {
    el.clockModeText.textContent = 'Live · Now';
    el.liveDot.classList.remove('paused');
  } else {
    el.clockModeText.textContent = 'Custom Time';
    el.liveDot.classList.add('paused');
  }
}

function renderSavedPairs() {
  if (!prefs.savedPairs.length) {
    el.savedPairsBar.innerHTML = '';
    return;
  }
  const pillsHtml = prefs.savedPairs
    .map((pair, idx) => {
      const fromTitle = escapeHtml(getZoneShortTitle(pair.from));
      const toTitle = escapeHtml(getZoneShortTitle(pair.to));
      const isActive = pair.from === prefs.sourceZone && pair.to === prefs.targetZone;
      return `
        <span class="pair-pill ${isActive ? 'active' : ''}">
          <button type="button" class="pair-pill-select" data-pair-index="${idx}" title="Switch to ${fromTitle} → ${toTitle}">
            ${fromTitle} → ${toTitle}
          </button>
          <button type="button" class="pair-pill-remove" data-remove-pair="${idx}" aria-label="Remove saved pair" title="Remove">✕</button>
        </span>
      `;
    })
    .join('');

  el.savedPairsBar.innerHTML = `<span class="pairs-label">★ Saved Pairs:</span>${pillsHtml}`;
}

function renderBadges(snapshot, showDayShift = false) {
  const statusClass = `badge-${snapshot.status.key}`;
  let html = `<span class="badge ${statusClass}">${snapshot.status.icon} ${escapeHtml(snapshot.status.label)}</span>`;
  if (showDayShift && snapshot.dayDelta !== 0) {
    html += `<span class="badge badge-dayshift">${escapeHtml(snapshot.dayBadge)}</span>`;
  }
  return html;
}

function formatHourShort(hour, use24Hour) {
  if (use24Hour) return `${String(hour).padStart(2, '0')}:00`;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return `${h12}${suffix}`;
}

function formatHourOptionLabel(hour, use24Hour) {
  if (use24Hour) return `${String(hour).padStart(2, '0')}:00`;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:00 ${suffix}`;
}

function renderHoursConfig() {
  const hr = normalizeHourRanges(prefs.hourRanges);
  prefs.hourRanges = hr;

  if (el.legendWorkText) {
    el.legendWorkText.textContent = `Work (${formatHourShort(hr.workStart, prefs.use24Hour)}–${formatHourShort(hr.workEnd, prefs.use24Hour)})`;
  }
  if (el.legendNightText) {
    el.legendNightText.textContent = `Night (${formatHourShort(hr.nightStart, prefs.use24Hour)}–${formatHourShort(hr.nightEnd, prefs.use24Hour)})`;
  }

  const selects = [
    [el.workStartSelect, hr.workStart],
    [el.workEndSelect, hr.workEnd],
    [el.nightStartSelect, hr.nightStart],
    [el.nightEndSelect, hr.nightEnd],
  ];

  let optionsHtml = '';
  for (let h = 0; h < 24; h++) {
    optionsHtml += `<option value="${h}">${formatHourOptionLabel(h, prefs.use24Hour)}</option>`;
  }

  for (const [sel, val] of selects) {
    if (!sel) continue;
    if (sel.dataset.fmt !== String(prefs.use24Hour)) {
      sel.innerHTML = optionsHtml;
      sel.dataset.fmt = String(prefs.use24Hour);
    }
    if (document.activeElement !== sel) {
      sel.value = String(val);
    }
  }
}

function renderOneToOne() {
  const epoch = runtime.epochMs;
  const src = getZoneSnapshot(
    epoch,
    prefs.sourceZone,
    prefs.sourceZone,
    prefs.use24Hour,
    prefs.hourRanges
  );
  const tgt = getZoneSnapshot(
    epoch,
    prefs.targetZone,
    prefs.sourceZone,
    prefs.use24Hour,
    prefs.hourRanges
  );

  el.sourceZoneTitle.textContent = src.displayName;
  el.sourceZoneMeta.textContent = `${src.abbrev} · ${src.utcOffsetLabel}`;
  el.sourceBadges.innerHTML = renderBadges(src, false);
  el.sourceReadout.textContent = src.timeFormatted.full;
  el.sourceDateReadout.textContent = src.dateFormatted;

  if (document.activeElement !== el.sourceTimeInput) {
    el.sourceTimeInput.value = src.timeInput;
  }
  if (document.activeElement !== el.sourceDateInput) {
    el.sourceDateInput.value = src.dateInput;
  }

  const srcFav = prefs.favoriteZones.includes(prefs.sourceZone);
  el.sourceStarBtn.textContent = srcFav ? '★' : '☆';
  el.sourceStarBtn.classList.toggle('starred', srcFav);

  el.targetZoneTitle.textContent = tgt.displayName;
  el.targetZoneMeta.textContent = `${tgt.abbrev} · ${tgt.utcOffsetLabel}`;
  el.targetBadges.innerHTML = renderBadges(tgt, true);
  el.targetReadout.textContent = tgt.timeFormatted.full;
  el.targetDateReadout.textContent = tgt.dateFormatted;

  if (document.activeElement !== el.targetTimeInput) {
    el.targetTimeInput.value = tgt.timeInput;
  }
  if (document.activeElement !== el.targetDateInput) {
    el.targetDateInput.value = tgt.dateInput;
  }

  const tgtFav = prefs.favoriteZones.includes(prefs.targetZone);
  el.targetStarBtn.textContent = tgtFav ? '★' : '☆';
  el.targetStarBtn.classList.toggle('starred', tgtFav);

  el.pairDeltaPill.textContent =
    tgt.dayDelta !== 0 ? `${tgt.diffFromRefLabel} · ${tgt.dayBadge}` : tgt.diffFromRefLabel;

  renderSavedPairs();
}

function renderMultiBoard() {
  if (!prefs.boardZones.length) {
    prefs.boardZones = [prefs.baseZone || getLocalZoneId(), 'UTC'];
  }
  renderHoursConfig();

  const refZone = getBoardReferenceZone();
  const epoch = runtime.epochMs;
  const refSnap = getZoneSnapshot(
    epoch,
    refZone,
    refZone,
    prefs.use24Hour,
    prefs.hourRanges
  );

  el.scrubberRefName.textContent = `${refSnap.cityName} (${refSnap.abbrev})`;
  el.scrubberTimePill.textContent = refSnap.timeFormatted.full;

  const totalMinutes = refSnap.parts.hour * 60 + refSnap.parts.minute;
  const snappedMinutes = Math.min(1425, Math.round(totalMinutes / 15) * 15);
  if (document.activeElement !== el.timelineSlider) {
    el.timelineSlider.value = String(snappedMinutes);
  }

  // Anchor midnight of reference zone's current calendar day so all rows show synchronized 24h columns!
  const refDayStartEpoch = wallTimeToEpoch(
    {
      year: refSnap.parts.year,
      month: refSnap.parts.month,
      day: refSnap.parts.day,
      hour: 0,
      minute: 0,
    },
    refZone
  );
  const activeSlotIndex = refSnap.parts.hour;

  const rowsHtml = prefs.boardZones
    .map((zoneId, rowIdx) => {
      const snap = getZoneSnapshot(
        epoch,
        zoneId,
        refZone,
        prefs.use24Hour,
        prefs.hourRanges
      );
      const isRef = zoneId === refZone;
      const isFav = prefs.favoriteZones.includes(zoneId);

      // Build 24 synchronized 1-hour columns aligned to reference zone's day
      let cellsHtml = '';
      for (let slot = 0; slot < 24; slot++) {
        const slotEpoch = refDayStartEpoch + slot * 3600000;
        const slotParts = getZonedParts(slotEpoch, zoneId);
        const period = getDayPeriodStatus(slotParts.hour, prefs.hourRanges);
        const label = prefs.use24Hour
          ? String(slotParts.hour).padStart(2, '0')
          : `${slotParts.hour % 12 || 12}${slotParts.hour >= 12 ? 'p' : 'a'}`;
        const isActive = slot === activeSlotIndex;
        cellsHtml += `<button type="button" class="hour-cell ${period.key} ${isActive ? 'active' : ''}" data-slot-epoch="${slotEpoch}" title="Jump to ${label} (${escapeHtml(snap.cityName)})">${label}</button>`;
      }

      const shiftBadge =
        !isRef && snap.dayDelta !== 0
          ? `<span class="badge badge-dayshift">${escapeHtml(snap.dayBadge)}</span>`
          : '';

      const refActionBtnHtml = !isRef
        ? `<button type="button" class="row-btn row-ref-btn" data-action="make-ref" data-zone="${escapeHtml(zoneId)}" title="Use this zone as the Reference Zone">Set Reference</button>`
        : `<button type="button" class="row-btn row-ref-btn ${rowIdx > 0 ? 'row-ref-top-btn' : ''}" data-action="move-top" data-zone="${escapeHtml(zoneId)}" ${rowIdx === 0 ? 'disabled' : ''} title="${rowIdx === 0 ? 'Reference zone is already at the top' : 'Move Reference zone to the top of the list'}">${rowIdx === 0 ? '✓ At Top' : '⤒ Move to Top'}</button>`;

      return `
        <div class="board-row ${isRef ? 'is-ref' : ''}" data-zone="${escapeHtml(zoneId)}">
          <div class="board-row-top">
            <div class="board-zone-info">
              <span class="row-drag-handle" title="Drag to reorder time zone" aria-hidden="true">⋮⋮</span>
              <div>
                <div class="board-zone-title">
                  <button type="button" class="board-zone-trigger" data-action="change-zone" data-row-index="${rowIdx}" data-zone="${escapeHtml(zoneId)}" title="Click to change this time zone">
                    <span>${escapeHtml(snap.displayName)}</span>
                    <span class="zp-chevron">▾</span>
                  </button>
                  ${isRef ? '<span class="ref-pill">Reference</span>' : ''}
                </div>
                <div class="board-zone-sub">
                  ${escapeHtml(snap.abbrev)} · ${escapeHtml(snap.utcOffsetLabel)}
                  ${!isRef ? ` · ${escapeHtml(snap.diffFromRefLabel)}` : ''}
                </div>
              </div>
              <span class="badge badge-${snap.status.key}">${snap.status.icon} ${escapeHtml(snap.status.label)}</span>
              ${shiftBadge}
            </div>

            <div class="board-right">
              <div class="board-clock">
                <div class="board-time">${escapeHtml(snap.timeFormatted.full)}</div>
                <div class="board-date">${escapeHtml(snap.dateFormatted)}</div>
              </div>
              <div class="row-actions">
                ${refActionBtnHtml}
                <button type="button" class="row-btn row-change-btn" data-action="change-zone" data-row-index="${rowIdx}" data-zone="${escapeHtml(zoneId)}" title="Change this row's time zone">Change</button>
                <button type="button" class="row-btn row-icon-btn" data-action="move-up" data-zone="${escapeHtml(zoneId)}" ${rowIdx === 0 ? 'disabled' : ''} title="Move zone up" aria-label="Move ${escapeHtml(snap.cityName)} up">↑</button>
                <button type="button" class="row-btn row-icon-btn" data-action="move-down" data-zone="${escapeHtml(zoneId)}" ${rowIdx === prefs.boardZones.length - 1 ? 'disabled' : ''} title="Move zone down" aria-label="Move ${escapeHtml(snap.cityName)} down">↓</button>
                <button type="button" class="row-btn row-icon-btn ${isFav ? 'starred' : ''}" data-action="fav" data-zone="${escapeHtml(zoneId)}" title="Toggle Favorite">${isFav ? '★' : '☆'}</button>
                <button type="button" class="row-btn row-icon-btn remove" data-action="remove" data-zone="${escapeHtml(zoneId)}" ${prefs.boardZones.length <= 1 ? 'disabled' : ''} title="Remove from board">✕</button>
              </div>
            </div>
          </div>
          <div class="hour-strip">
            ${cellsHtml}
          </div>
        </div>
      `;
    })
    .join('');

  el.boardList.innerHTML = rowsHtml;
}

function renderQuickParse() {
  const val = el.quickInput.value;
  el.quickClearBtn.classList.toggle('hidden', !val.length);

  if (!val.trim()) {
    runtime.lastQuickParsed = null;
    el.quickResultPanel.classList.add('hidden');
    el.quickResultPanel.innerHTML = '';
    return;
  }

  const parsed = parseQuickQuery(val, {
    nowEpoch: Date.now(),
    defaultZone: prefs.baseZone,
  });
  runtime.lastQuickParsed = parsed;
  el.quickResultPanel.classList.remove('hidden');

  if (!parsed) {
    el.quickResultPanel.innerHTML = `
      <span class="qr-hint-error">
        Keep typing… e.g. <strong>"3pm EST to IST"</strong>, <strong>"14:30 London in Tokyo"</strong>, or <strong>"tomorrow 9am PST to UTC"</strong>
      </span>
    `;
    return;
  }

  const srcSnap = getZoneSnapshot(parsed.epochMs, parsed.sourceZone, parsed.sourceZone, prefs.use24Hour);
  const targetsHtml = parsed.targetZones
    .map((tz) => {
      const tSnap = getZoneSnapshot(parsed.epochMs, tz, parsed.sourceZone, prefs.use24Hour);
      const dayNote = tSnap.dayDelta !== 0 ? `<span class="qr-day-shift">${escapeHtml(tSnap.dayBadge)}</span>` : '';
      return `
        <span class="qr-target-pill">
          <span class="qr-target-time">${escapeHtml(tSnap.timeFormatted.full)}</span>
          <span class="qr-target-zone">${escapeHtml(tSnap.abbrev)} (${escapeHtml(tSnap.cityName)})</span>
          ${dayNote}
        </span>
      `;
    })
    .join('');

  el.quickResultPanel.innerHTML = `
    <div class="qr-conversions">
      <span class="qr-source">${escapeHtml(srcSnap.timeFormatted.full)} ${escapeHtml(srcSnap.abbrev)} (${escapeHtml(srcSnap.cityName)}) · ${escapeHtml(srcSnap.dateFormatted)}</span>
      <span class="qr-arrow">→</span>
      ${targetsHtml}
    </div>
    <div class="header-actions">
      <button type="button" class="btn btn-subtle btn-sm" id="applyQuickBtn">Sync Below ↵</button>
      <button type="button" class="btn btn-accent btn-sm" id="copyQuickBtn">📋 Copy</button>
    </div>
  `;
}

function applyQuickResultToApp() {
  const parsed = runtime.lastQuickParsed;
  if (!parsed) return;
  prefs.sourceZone = parsed.sourceZone;
  prefs.targetZone = parsed.primaryTargetZone;

  // Also ensure source + all parsed targets appear on the Multi-Zone board
  for (const tz of [parsed.sourceZone, ...parsed.targetZones]) {
    if (!prefs.boardZones.includes(tz)) {
      prefs.boardZones.push(tz);
    }
  }
  savePrefs();

  if (parsed.isNow) {
    resetToNow();
  } else {
    setCustomEpoch(parsed.epochMs);
  }
  showToast('Synced quick query to converter & timeline');
}

function renderModulesVisibility() {
  const order = normalizeModuleOrder(prefs.moduleOrder);
  prefs.moduleOrder = order;

  // Sync section order inside #mainGrid only when changed
  const mainGrid = document.getElementById('mainGrid');
  if (mainGrid) {
    const currentDomOrder = Array.from(mainGrid.children)
      .map((node) => node.id.replace(/^module-/, ''))
      .filter((k) => MODULE_KEYS.includes(k));
    if (currentDomOrder.join(',') !== order.join(',')) {
      for (const key of order) {
        const sec = document.getElementById(`module-${key}`);
        if (sec) mainGrid.appendChild(sec);
      }
    }
  }

  // Sync pill order inside #modulePills only when changed
  const pillsWrap = document.getElementById('modulePills');
  if (pillsWrap) {
    const currentPillOrder = Array.from(pillsWrap.children)
      .map((node) => node.getAttribute('data-toggle-module'))
      .filter(Boolean);
    if (currentPillOrder.join(',') !== order.join(',')) {
      for (const key of order) {
        const pill = pillsWrap.querySelector(`[data-toggle-module="${key}"]`);
        if (pill) pillsWrap.appendChild(pill);
      }
    }
  }

  let hiddenCount = 0;
  for (const key of order) {
    const isVisible = Boolean(prefs.visibleModules[key]);
    if (!isVisible) hiddenCount++;
    const sec = document.getElementById(`module-${key}`);
    if (sec) sec.classList.toggle('hidden', !isVisible);
  }

  document.querySelectorAll('[data-toggle-module]').forEach((pill) => {
    const key = pill.getAttribute('data-toggle-module');
    const isVisible = Boolean(prefs.visibleModules[key]);
    pill.classList.toggle('active', isVisible);
    pill.setAttribute('aria-pressed', String(isVisible));
  });

  // Update ↑ / ↓ disabled states relative to currently visible modules
  const visibleOrder = order.filter((k) => prefs.visibleModules[k]);
  document.querySelectorAll('[data-move-module]').forEach((btn) => {
    const key = btn.getAttribute('data-move-module');
    const dir = Number(btn.getAttribute('data-dir'));
    const visIdx = visibleOrder.indexOf(key);
    btn.disabled =
      visIdx === -1 ||
      (dir < 0 && visIdx === 0) ||
      (dir > 0 && visIdx === visibleOrder.length - 1);
  });

  const showAllBtn = document.getElementById('showAllModulesBtn');
  if (showAllBtn) {
    showAllBtn.classList.toggle('hidden', hiddenCount === 0);
  }

  const isCustomOrder = order.join(',') !== MODULE_KEYS.join(',');
  const isCustomVisibility = MODULE_KEYS.some(
    (k) => Boolean(prefs.visibleModules[k]) !== Boolean(DEFAULT_VISIBLE_MODULES[k])
  );
  const resetLayoutBtn = document.getElementById('resetLayoutBtn');
  if (resetLayoutBtn) {
    resetLayoutBtn.classList.toggle('hidden', !isCustomVisibility && !isCustomOrder);
  }
}

function moveModuleByStep(key, dir) {
  const order = normalizeModuleOrder(prefs.moduleOrder);
  const visibleOrder = order.filter((k) => prefs.visibleModules[k]);
  const visIdx = visibleOrder.indexOf(key);
  const neighborKey = visibleOrder[visIdx + dir];
  if (visIdx === -1 || !neighborKey) return;

  const idxA = order.indexOf(key);
  const idxB = order.indexOf(neighborKey);
  order[idxA] = neighborKey;
  order[idxB] = key;
  prefs.moduleOrder = order;
  savePrefs();
  renderModulesVisibility();
}

function reorderModuleToTarget(draggedKey, targetKey) {
  if (!draggedKey || !targetKey || draggedKey === targetKey) return;
  const order = normalizeModuleOrder(prefs.moduleOrder);
  const fromIdx = order.indexOf(draggedKey);
  const toIdx = order.indexOf(targetKey);
  if (fromIdx === -1 || toIdx === -1) return;

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedKey);
  prefs.moduleOrder = order;
  savePrefs();
  renderModulesVisibility();
  showToast(`Moved ${MODULE_LABELS[draggedKey] || draggedKey}`);
}

function setModuleVisible(key, shouldShow, { silent = false } = {}) {
  if (!MODULE_KEYS.includes(key)) return false;
  if (!shouldShow) {
    const openCount = MODULE_KEYS.filter((k) => prefs.visibleModules[k]).length;
    if (openCount <= 1 && prefs.visibleModules[key]) {
      showToast('Keep at least one module open');
      return false;
    }
  }
  prefs.visibleModules[key] = shouldShow;
  savePrefs();
  renderModulesVisibility();
  if (!silent) {
    const label = MODULE_LABELS[key] || key;
    showToast(
      shouldShow
        ? `Opened ${label}`
        : `Closed ${label} — click its pill above to reopen`
    );
  }
  return true;
}

function renderAll() {
  renderHeaderState();
  renderModulesVisibility();
  renderOneToOne();
  renderMultiBoard();
  renderQuickParse();
}

// Searchable Time Zone Picker Modal
function openZonePicker(mode, replaceIndex = null) {
  runtime.pickerMode = mode;
  runtime.pickerReplaceIndex = replaceIndex;
  runtime.pickerFocusIndex = 0;

  const replacingZone =
    mode === 'board-replace' && replaceIndex !== null
      ? prefs.boardZones[replaceIndex]
      : null;

  const titles = {
    base: 'Select Default Base / Home Time Zone',
    source: 'Select Source ("From") Time Zone',
    target: 'Select Target ("To") Time Zone',
    board: 'Add Time Zone to Multi-Zone Board',
    'board-replace': replacingZone
      ? `Change Time Zone (${getZoneShortTitle(replacingZone)})`
      : 'Change Row Time Zone',
  };
  el.pickerModalTitle.textContent = titles[mode] || 'Select Time Zone';

  if (el.useSystemLocalBtn) {
    const sysLocal = getLocalZoneId();
    const showLocalReset = mode === 'base';
    el.useSystemLocalBtn.classList.toggle('hidden', !showLocalReset);
    el.useSystemLocalBtn.classList.toggle('active', Boolean(prefs.useSystemBase));
    if (showLocalReset) {
      el.useSystemLocalBtn.textContent = `📍 Device System Time (${getZoneShortTitle(sysLocal)})`;
    }
  }

  el.pickerSearchInput.value = '';
  el.zonePickerModal.classList.remove('hidden');
  renderPickerList();
  requestAnimationFrame(() => el.pickerSearchInput.focus());
}

function closeZonePicker() {
  el.zonePickerModal.classList.add('hidden');
  runtime.pickerMode = null;
  runtime.pickerReplaceIndex = null;
}

function renderPickerList() {
  const q = el.pickerSearchInput.value;
  let items = searchTimeZones(q, prefs.favoriteZones, runtime.epochMs, 80);
  if (runtime.pickerFilter === 'favorites') {
    const favSet = new Set(prefs.favoriteZones);
    items = items.filter((item) => favSet.has(item.id));
  }
  runtime.pickerCurrentItems = items;
  if (runtime.pickerFocusIndex >= items.length) {
    runtime.pickerFocusIndex = 0;
  }

  el.filterAllBtn.classList.toggle('active', runtime.pickerFilter === 'all');
  el.filterFavBtn.classList.toggle('active', runtime.pickerFilter === 'favorites');

  if (!items.length) {
    el.pickerResultsList.innerHTML = `<li style="padding:16px;color:var(--text-muted);font-size:0.85rem;">No matching time zones found.</li>`;
    return;
  }

  const favSet = new Set(prefs.favoriteZones);
  el.pickerResultsList.innerHTML = items
    .map((item, idx) => {
      const starred = favSet.has(item.id);
      return `
        <li class="picker-item ${idx === runtime.pickerFocusIndex ? 'focused' : ''}" role="option" data-pick-zone="${escapeHtml(item.id)}">
          <div class="pi-left">
            <div class="pi-name">${escapeHtml(item.displayName)}</div>
            <div class="pi-iana">${escapeHtml(item.id)} · ${escapeHtml(item.abbrev)}</div>
          </div>
          <div class="pi-right">
            <span class="pi-offset">${escapeHtml(item.utcOffset)}</span>
            <button type="button" class="pi-star ${starred ? 'starred' : ''}" data-star-zone="${escapeHtml(item.id)}" title="Toggle favorite">
              ${starred ? '★' : '☆'}
            </button>
          </div>
        </li>
      `;
    })
    .join('');
}

function selectZoneFromPicker(zoneId, { isSystemReset = false } = {}) {
  const norm = normalizeZoneId(zoneId);
  if (runtime.pickerMode === 'base') {
    const prevBase = prefs.baseZone;
    prefs.useSystemBase = Boolean(isSystemReset);
    prefs.baseZone = norm;
    prefs.referenceZone = norm;
    prefs.sourceZone = norm;
    if (prefs.targetZone === norm) {
      prefs.targetZone =
        prevBase && prevBase !== norm
          ? prevBase
          : norm === 'UTC'
            ? 'America/New_York'
            : 'UTC';
    }
    if (!prefs.boardZones.includes(norm)) {
      prefs.boardZones.unshift(norm);
    }
    showToast(
      isSystemReset
        ? `📍 Using device system time zone (${getZoneShortTitle(norm)})`
        : `🏠 Set default base zone to ${getZoneShortTitle(norm)}`
    );
  } else if (runtime.pickerMode === 'source') {
    // Preserve wall-clock time in the newly chosen source zone if user already picked a custom time
    if (!runtime.isLive) {
      const oldParts = getZonedParts(runtime.epochMs, prefs.sourceZone);
      prefs.sourceZone = norm;
      runtime.epochMs = wallTimeToEpoch(oldParts, norm);
    } else {
      prefs.sourceZone = norm;
    }
  } else if (runtime.pickerMode === 'target') {
    prefs.targetZone = norm;
  } else if (runtime.pickerMode === 'board') {
    if (!prefs.boardZones.includes(norm)) {
      prefs.boardZones.push(norm);
      showToast(`Added ${getZoneShortTitle(norm)} to timeline`);
    } else {
      showToast(`${getZoneShortTitle(norm)} is already on the timeline`);
    }
  } else if (runtime.pickerMode === 'board-replace') {
    const idx = runtime.pickerReplaceIndex;
    if (idx !== null && idx >= 0 && idx < prefs.boardZones.length) {
      const oldZone = prefs.boardZones[idx];
      if (oldZone !== norm) {
        if (prefs.boardZones.includes(norm)) {
          const otherIdx = prefs.boardZones.indexOf(norm);
          prefs.boardZones[otherIdx] = oldZone;
          prefs.boardZones[idx] = norm;
          if (prefs.referenceZone === oldZone) prefs.referenceZone = norm;
          showToast(`Swapped ${getZoneShortTitle(oldZone)} with ${getZoneShortTitle(norm)}`);
        } else {
          prefs.boardZones[idx] = norm;
          if (prefs.referenceZone === oldZone) prefs.referenceZone = norm;
          showToast(`Changed ${getZoneShortTitle(oldZone)} to ${getZoneShortTitle(norm)}`);
        }
      }
    }
  }
  savePrefs();
  closeZonePicker();
  renderAll();
}

// Event Listeners
function bindEvents() {
  el.resetNowBtn.addEventListener('click', resetToNow);
  el.scrubberNowBtn.addEventListener('click', resetToNow);

  el.fmt12Btn.addEventListener('click', () => {
    prefs.use24Hour = false;
    savePrefs();
    renderAll();
  });
  el.fmt24Btn.addEventListener('click', () => {
    prefs.use24Hour = true;
    savePrefs();
    renderAll();
  });

  el.themeToggleBtn.addEventListener('click', () => {
    prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyTheme();
  });

  // Quick Parse events
  el.quickInput.addEventListener('input', renderQuickParse);
  el.quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && runtime.lastQuickParsed) {
      e.preventDefault();
      applyQuickResultToApp();
    } else if (e.key === 'Escape') {
      el.quickInput.blur();
    }
  });

  el.quickClearBtn.addEventListener('click', () => {
    el.quickInput.value = '';
    renderQuickParse();
    el.quickInput.focus();
  });

  document.querySelectorAll('[data-example]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.quickInput.value = btn.getAttribute('data-example');
      renderQuickParse();
      applyQuickResultToApp();
    });
  });

  el.quickResultPanel.addEventListener('click', (e) => {
    const applyBtn = e.target.closest('#applyQuickBtn');
    const copyBtn = e.target.closest('#copyQuickBtn');
    if (applyBtn) {
      applyQuickResultToApp();
    } else if (copyBtn && runtime.lastQuickParsed) {
      const p = runtime.lastQuickParsed;
      const text =
        p.targetZones.length === 1
          ? formatOneToOneInvite(p.epochMs, p.sourceZone, p.primaryTargetZone, prefs.use24Hour)
          : formatMultiZoneCompact(p.epochMs, [p.sourceZone, ...p.targetZones], prefs.use24Hour);
      copyText(text, 'Copied quick conversion');
    }
  });

  // Base & 1-to-1 Zone Pickers + Favorites
  el.baseZoneBtn?.addEventListener('click', () => openZonePicker('base'));
  el.useSystemLocalBtn?.addEventListener('click', () =>
    selectZoneFromPicker(getLocalZoneId(), { isSystemReset: true })
  );
  el.sourceZoneBtn.addEventListener('click', () => openZonePicker('source'));
  el.targetZoneBtn.addEventListener('click', () => openZonePicker('target'));
  el.addBoardZoneBtn.addEventListener('click', () => openZonePicker('board'));

  el.sourceStarBtn.addEventListener('click', () => toggleFavoriteZone(prefs.sourceZone));
  el.targetStarBtn.addEventListener('click', () => toggleFavoriteZone(prefs.targetZone));

  el.swapZonesBtn.addEventListener('click', () => {
    const tmp = prefs.sourceZone;
    prefs.sourceZone = prefs.targetZone;
    prefs.targetZone = tmp;
    savePrefs();
    renderAll();
  });

  // Bidirectional Time & Date Inputs
  const handlePaneInputChange = (timeEl, dateEl, zoneId) => {
    if (!timeEl.value || !dateEl.value) return;
    const [year, month, day] = dateEl.value.split('-').map(Number);
    const [hour, minute] = timeEl.value.split(':').map(Number);
    if ([year, month, day, hour, minute].some(Number.isNaN)) return;
    const nextEpoch = wallTimeToEpoch({ year, month, day, hour, minute }, zoneId);
    setCustomEpoch(nextEpoch);
  };

  el.sourceTimeInput.addEventListener('input', () =>
    handlePaneInputChange(el.sourceTimeInput, el.sourceDateInput, prefs.sourceZone)
  );
  el.sourceDateInput.addEventListener('input', () =>
    handlePaneInputChange(el.sourceTimeInput, el.sourceDateInput, prefs.sourceZone)
  );
  el.targetTimeInput.addEventListener('input', () =>
    handlePaneInputChange(el.targetTimeInput, el.targetDateInput, prefs.targetZone)
  );
  el.targetDateInput.addEventListener('input', () =>
    handlePaneInputChange(el.targetTimeInput, el.targetDateInput, prefs.targetZone)
  );

  // Save & Select Favorite Pairs
  el.savePairBtn.addEventListener('click', () => {
    const exists = prefs.savedPairs.some(
      (p) => p.from === prefs.sourceZone && p.to === prefs.targetZone
    );
    if (exists) {
      showToast('This pair is already saved');
      return;
    }
    prefs.savedPairs.unshift({ from: prefs.sourceZone, to: prefs.targetZone });
    savePrefs();
    renderSavedPairs();
    showToast('★ Saved favorite pair');
  });

  el.savedPairsBar.addEventListener('click', (e) => {
    const selectBtn = e.target.closest('[data-pair-index]');
    const removeBtn = e.target.closest('[data-remove-pair]');
    if (selectBtn) {
      const pair = prefs.savedPairs[Number(selectBtn.getAttribute('data-pair-index'))];
      if (pair) {
        prefs.sourceZone = pair.from;
        prefs.targetZone = pair.to;
        savePrefs();
        renderAll();
      }
    } else if (removeBtn) {
      const idx = Number(removeBtn.getAttribute('data-remove-pair'));
      prefs.savedPairs.splice(idx, 1);
      savePrefs();
      renderSavedPairs();
    }
  });

  // Copy Invite Buttons
  el.copyPairInviteBtn.addEventListener('click', () => {
    const text = formatOneToOneInvite(
      runtime.epochMs,
      prefs.sourceZone,
      prefs.targetZone,
      prefs.use24Hour
    );
    copyText(text, 'Copied 1-to-1 conversion');
  });

  el.copyCompactBtn.addEventListener('click', () => {
    const text = formatMultiZoneCompact(
      runtime.epochMs,
      prefs.boardZones,
      prefs.use24Hour,
      getBoardReferenceZone()
    );
    copyText(text, 'Copied compact timeline summary');
  });

  el.copyMeetingBlockBtn.addEventListener('click', () => {
    const text = formatMultiZoneInviteBlock(
      runtime.epochMs,
      prefs.boardZones,
      prefs.use24Hour,
      getBoardReferenceZone()
    );
    copyText(text, 'Copied meeting invite block');
  });

  // Timeline Scrubber & Nudge buttons
  el.timelineSlider.addEventListener('input', () => {
    const mins = Number(el.timelineSlider.value);
    const refZone = getBoardReferenceZone();
    const refParts = getZonedParts(runtime.epochMs, refZone);
    const nextEpoch = wallTimeToEpoch(
      {
        year: refParts.year,
        month: refParts.month,
        day: refParts.day,
        hour: Math.floor(mins / 60),
        minute: mins % 60,
      },
      refZone
    );
    setCustomEpoch(nextEpoch);
  });

  // Work & Night Hours Configurator
  el.toggleHoursConfigBtn?.addEventListener('click', () => {
    const isHidden = el.hoursConfigPanel.classList.toggle('hidden');
    el.toggleHoursConfigBtn.setAttribute('aria-expanded', String(!isHidden));
  });

  const handleHourRangeChange = () => {
    prefs.hourRanges = normalizeHourRanges({
      workStart: Number(el.workStartSelect.value),
      workEnd: Number(el.workEndSelect.value),
      nightStart: Number(el.nightStartSelect.value),
      nightEnd: Number(el.nightEndSelect.value),
    });
    savePrefs();
    renderAll();
  };

  [el.workStartSelect, el.workEndSelect, el.nightStartSelect, el.nightEndSelect].forEach((sel) => {
    sel?.addEventListener('change', handleHourRangeChange);
  });

  el.resetHoursBtn?.addEventListener('click', () => {
    prefs.hourRanges = { ...DEFAULT_HOUR_RANGES };
    savePrefs();
    renderAll();
    showToast('Restored default work & night hours');
  });

  document.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepMin = Number(btn.getAttribute('data-step'));
      // Snap to nearest 15-min boundary first if stepping by 15m
      const base =
        Math.abs(stepMin) === 15
          ? Math.round(runtime.epochMs / 900000) * 900000
          : runtime.epochMs;
      setCustomEpoch(base + stepMin * 60000);
    });
  });

  // Multi-Zone Board delegation (click hour cell, set ref, move up/down, fav, remove)
  el.boardList.addEventListener('click', (e) => {
    const hourBtn = e.target.closest('[data-slot-epoch]');
    if (hourBtn) {
      setCustomEpoch(Number(hourBtn.getAttribute('data-slot-epoch')));
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn || actionBtn.disabled) return;
    const action = actionBtn.getAttribute('data-action');
    const zone = actionBtn.getAttribute('data-zone');

    if (action === 'make-ref') {
      prefs.referenceZone = zone;
      savePrefs();
      renderAll();
      showToast(`Set ${getZoneShortTitle(zone)} as Reference Zone`);
    } else if (action === 'move-top') {
      prefs.boardZones = [zone, ...prefs.boardZones.filter((z) => z !== zone)];
      savePrefs();
      renderMultiBoard();
      showToast(`Moved ${getZoneShortTitle(zone)} to top`);
    } else if (action === 'change-zone') {
      const rowIdx = Number(actionBtn.getAttribute('data-row-index'));
      if (!Number.isNaN(rowIdx)) {
        openZonePicker('board-replace', rowIdx);
      }
    } else if (action === 'move-up' || action === 'move-down') {
      const idx = prefs.boardZones.indexOf(zone);
      const targetIdx = action === 'move-up' ? idx - 1 : idx + 1;
      if (idx >= 0 && targetIdx >= 0 && targetIdx < prefs.boardZones.length) {
        const copy = [...prefs.boardZones];
        copy[idx] = copy[targetIdx];
        copy[targetIdx] = zone;
        prefs.boardZones = copy;
        savePrefs();
        renderMultiBoard();
      }
    } else if (action === 'fav') {
      toggleFavoriteZone(zone);
    } else if (action === 'remove') {
      prefs.boardZones = prefs.boardZones.filter((z) => z !== zone);
      if (prefs.referenceZone === zone) {
        prefs.referenceZone = prefs.boardZones[0] || prefs.baseZone;
      }
      savePrefs();
      renderAll();
    }
  });

  // Multi-Zone Row Drag-and-Drop (via .row-drag-handle)
  let draggedZoneId = null;

  el.boardList.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.row-drag-handle');
    if (!handle) return;
    const row = handle.closest('.board-row');
    if (row) row.setAttribute('draggable', 'true');
  });

  el.boardList.addEventListener('mouseup', () => {
    el.boardList.querySelectorAll('.board-row[draggable="true"]').forEach((r) => {
      r.removeAttribute('draggable');
    });
  });

  el.boardList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.board-row');
    if (!row || row.getAttribute('draggable') !== 'true') {
      e.preventDefault();
      return;
    }
    draggedZoneId = row.getAttribute('data-zone');
    row.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedZoneId);
    }
  });

  el.boardList.addEventListener('dragover', (e) => {
    if (!draggedZoneId) return;
    const overRow = e.target.closest('.board-row');
    if (!overRow) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const overZone = overRow.getAttribute('data-zone');
    el.boardList.querySelectorAll('.board-row.drag-over').forEach((r) => {
      if (r !== overRow) r.classList.remove('drag-over');
    });
    if (overZone !== draggedZoneId) {
      overRow.classList.add('drag-over');
    }
  });

  el.boardList.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.board-row');
    if (row && !row.contains(e.relatedTarget)) {
      row.classList.remove('drag-over');
    }
  });

  el.boardList.addEventListener('drop', (e) => {
    const targetRow = e.target.closest('.board-row');
    if (!targetRow) return;
    e.preventDefault();
    targetRow.classList.remove('drag-over');
    const targetZone = targetRow.getAttribute('data-zone');
    const sourceZone = draggedZoneId || e.dataTransfer?.getData('text/plain');
    draggedZoneId = null;

    if (!sourceZone || !targetZone || sourceZone === targetZone) return;
    const fromIdx = prefs.boardZones.indexOf(sourceZone);
    const toIdx = prefs.boardZones.indexOf(targetZone);
    if (fromIdx === -1 || toIdx === -1) return;

    const next = [...prefs.boardZones];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, sourceZone);
    prefs.boardZones = next;
    savePrefs();
    renderMultiBoard();
  });

  el.boardList.addEventListener('dragend', () => {
    draggedZoneId = null;
    el.boardList.querySelectorAll('.board-row').forEach((r) => {
      r.removeAttribute('draggable');
      r.classList.remove('dragging', 'drag-over');
    });
  });

  // Picker Modal events
  el.closePickerBtn.addEventListener('click', closeZonePicker);
  el.zonePickerModal.addEventListener('click', (e) => {
    if (e.target === el.zonePickerModal) closeZonePicker();
  });

  el.filterAllBtn.addEventListener('click', () => {
    runtime.pickerFilter = 'all';
    renderPickerList();
  });
  el.filterFavBtn.addEventListener('click', () => {
    runtime.pickerFilter = 'favorites';
    renderPickerList();
  });

  el.pickerSearchInput.addEventListener('input', () => {
    runtime.pickerFocusIndex = 0;
    renderPickerList();
  });

  el.pickerSearchInput.addEventListener('keydown', (e) => {
    const len = runtime.pickerCurrentItems.length;
    if (e.key === 'ArrowDown' && len) {
      e.preventDefault();
      runtime.pickerFocusIndex = (runtime.pickerFocusIndex + 1) % len;
      renderPickerList();
    } else if (e.key === 'ArrowUp' && len) {
      e.preventDefault();
      runtime.pickerFocusIndex = (runtime.pickerFocusIndex - 1 + len) % len;
      renderPickerList();
    } else if (e.key === 'Enter' && len) {
      e.preventDefault();
      const chosen = runtime.pickerCurrentItems[runtime.pickerFocusIndex];
      if (chosen) selectZoneFromPicker(chosen.id);
    } else if (e.key === 'Escape') {
      closeZonePicker();
    }
  });

  el.pickerResultsList.addEventListener('click', (e) => {
    const starBtn = e.target.closest('[data-star-zone]');
    if (starBtn) {
      e.stopPropagation();
      toggleFavoriteZone(starBtn.getAttribute('data-star-zone'));
      return;
    }
    const item = e.target.closest('[data-pick-zone]');
    if (item) {
      selectZoneFromPicker(item.getAttribute('data-pick-zone'));
    }
  });

  // Desktop PWA Install & Uninstall Handling
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    runtime.deferredInstallPrompt = e;
    if (!window.matchMedia?.('(display-mode: standalone)').matches && prefs.isAppInstalled) {
      prefs.isAppInstalled = false;
      savePrefs();
      renderHeaderState();
    }
  });

  window.addEventListener('appinstalled', () => {
    runtime.deferredInstallPrompt = null;
    prefs.isAppInstalled = true;
    savePrefs();
    renderHeaderState();
    el.installHelpModal.classList.add('hidden');
    showToast('✓ ZoneShift installed as desktop app!');
  });

  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => {
    renderHeaderState();
  });

  el.installAppBtn.addEventListener('click', async () => {
    if (isRunningInstalled()) {
      el.uninstallHelpModal.classList.remove('hidden');
      return;
    }
    if (runtime.deferredInstallPrompt) {
      runtime.deferredInstallPrompt.prompt();
      const choice = await runtime.deferredInstallPrompt.userChoice;
      runtime.deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        prefs.isAppInstalled = true;
        savePrefs();
        renderHeaderState();
      }
    } else {
      el.installHelpModal.classList.remove('hidden');
    }
  });

  el.markInstalledBtn?.addEventListener('click', () => {
    prefs.isAppInstalled = true;
    savePrefs();
    renderHeaderState();
    el.installHelpModal.classList.add('hidden');
    showToast('Switched button to Uninstall App');
  });

  el.closeInstallHelpBtn.addEventListener('click', () => {
    el.installHelpModal.classList.add('hidden');
  });
  el.installHelpModal.addEventListener('click', (e) => {
    if (e.target === el.installHelpModal) el.installHelpModal.classList.add('hidden');
  });

  const closeUninstallHelp = () => el.uninstallHelpModal?.classList.add('hidden');
  el.closeUninstallHelpBtn?.addEventListener('click', closeUninstallHelp);
  el.uninstallHelpModal?.addEventListener('click', (e) => {
    if (e.target === el.uninstallHelpModal) closeUninstallHelp();
  });

  el.unregisterPwaBtn?.addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Ignore cache/SW cleanup errors
    }
    prefs.isAppInstalled = false;
    savePrefs();
    renderHeaderState();
    closeUninstallHelp();
    showToast('✓ Cleared offline app cache & reset install state');
  });

  // Data & Privacy Policy Modal Handling
  const openDataPolicy = () => el.dataPolicyModal.classList.remove('hidden');
  const closeDataPolicy = () => el.dataPolicyModal.classList.add('hidden');

  el.headerPrivacyBtn.addEventListener('click', openDataPolicy);
  el.openDataPolicyBtn.addEventListener('click', openDataPolicy);
  el.closeDataPolicyBtn.addEventListener('click', closeDataPolicy);
  el.dataPolicyModal.addEventListener('click', (e) => {
    if (e.target === el.dataPolicyModal) closeDataPolicy();
  });

  el.clearLocalDataBtn.addEventListener('click', () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore private mode errors
    }
    Object.assign(prefs, createDefaultState());
    applyTheme();
    resetToNow();
    closeDataPolicy();
    showToast('✓ Cleared saved local data & reset to defaults');
  });

  // Module Visibility & Rearrange Controls (click to toggle, drag or ↑/↓ to reorder)
  let draggedModuleKey = null;

  document.querySelectorAll('[data-toggle-module]').forEach((pill) => {
    pill.addEventListener('click', () => {
      const key = pill.getAttribute('data-toggle-module');
      setModuleVisible(key, !prefs.visibleModules[key]);
    });

    pill.addEventListener('dragstart', (e) => {
      draggedModuleKey = pill.getAttribute('data-toggle-module');
      pill.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedModuleKey);
      }
    });

    pill.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const overKey = pill.getAttribute('data-toggle-module');
      if (draggedModuleKey && overKey !== draggedModuleKey) {
        pill.classList.add('drag-over');
      }
    });

    pill.addEventListener('dragleave', () => {
      pill.classList.remove('drag-over');
    });

    pill.addEventListener('drop', (e) => {
      e.preventDefault();
      pill.classList.remove('drag-over');
      const targetKey = pill.getAttribute('data-toggle-module');
      const sourceKey = draggedModuleKey || e.dataTransfer?.getData('text/plain');
      reorderModuleToTarget(sourceKey, targetKey);
      draggedModuleKey = null;
    });

    pill.addEventListener('dragend', () => {
      draggedModuleKey = null;
      document.querySelectorAll('[data-toggle-module]').forEach((p) => {
        p.classList.remove('dragging', 'drag-over');
      });
    });
  });

  document.querySelectorAll('[data-move-module]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-move-module');
      const dir = Number(btn.getAttribute('data-dir'));
      moveModuleByStep(key, dir);
    });
  });

  document.querySelectorAll('[data-close-module]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-close-module');
      setModuleVisible(key, false);
    });
  });

  document.getElementById('showAllModulesBtn')?.addEventListener('click', () => {
    for (const k of MODULE_KEYS) {
      prefs.visibleModules[k] = true;
    }
    savePrefs();
    renderModulesVisibility();
    showToast('Opened all modules');
  });

  document.getElementById('resetLayoutBtn')?.addEventListener('click', () => {
    prefs.visibleModules = { ...DEFAULT_VISIBLE_MODULES };
    prefs.moduleOrder = [...MODULE_KEYS];
    savePrefs();
    renderModulesVisibility();
    showToast('Restored default module layout');
  });

  // Popular SEO Conversion Links (smooth SPA navigation + shareable URL)
  document.querySelectorAll('[data-seo-from]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const fromId = normalizeZoneId(link.getAttribute('data-seo-from'));
      const toId = normalizeZoneId(link.getAttribute('data-seo-to'));
      if (isValidZone(fromId) && isValidZone(toId)) {
        prefs.sourceZone = fromId;
        prefs.targetZone = toId;
        prefs.visibleModules.oneToOne = true;
        savePrefs();
        renderAll();
        updatePairDocumentTitle();
        if (history.replaceState) {
          history.replaceState(
            null,
            '',
            `?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`
          );
        }
        document.getElementById('oneToOneHeading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      closeZonePicker();
      el.installHelpModal.classList.add('hidden');
      closeUninstallHelp();
      closeDataPolicy();
      return;
    }
    if ((e.key === '/' && !isTyping) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      if (!prefs.visibleModules.quick) {
        setModuleVisible('quick', true, { silent: true });
      }
      el.quickInput.focus();
      el.quickInput.select();
    } else if (!isTyping && e.key.toLowerCase() === 'n') {
      resetToNow();
      showToast('Snapped to current live time');
    } else if (!isTyping && e.key.toLowerCase() === 's') {
      el.swapZonesBtn.click();
    }
  });
}

function updatePairDocumentTitle() {
  const srcSnap = getZoneSnapshot(runtime.epochMs, prefs.sourceZone, prefs.sourceZone, prefs.use24Hour);
  const tgtSnap = getZoneSnapshot(runtime.epochMs, prefs.targetZone, prefs.sourceZone, prefs.use24Hour);
  document.title = `${srcSnap.cityName} (${srcSnap.abbrev}) to ${tgtSnap.cityName} (${tgtSnap.abbrev}) Time Converter — ZoneShift`;
}

function applyUrlParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const fromParam = params.get('from');
    const toParam = params.get('to');

    if (q) {
      el.quickInput.value = q;
      renderQuickParse();
      applyQuickResultToApp();
      updatePairDocumentTitle();
      return;
    }

    let updated = false;
    if (fromParam) {
      const resolvedFrom = resolveZoneToken(fromParam, runtime.epochMs);
      if (resolvedFrom) {
        prefs.sourceZone = resolvedFrom;
        updated = true;
      }
    }
    if (toParam) {
      const resolvedTo = resolveZoneToken(toParam, runtime.epochMs);
      if (resolvedTo) {
        prefs.targetZone = resolvedTo;
        updated = true;
      }
    }
    if (updated) {
      renderAll();
      updatePairDocumentTitle();
    }
  } catch {
    // Ignore malformed query strings
  }
}

// Live Ticker + Service Worker Init
function init() {
  applyTheme();
  bindEvents();
  renderAll();
  applyUrlParams();

  setInterval(() => {
    if (runtime.isLive) {
      runtime.epochMs = Date.now();
      renderOneToOne();
      renderMultiBoard();
      renderHeaderState();
    }
  }, 15000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Ignore registration failure on restricted origins
    });
  }
}

init();
