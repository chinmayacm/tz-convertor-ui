import { DEFAULT_FAVORITE_ZONES } from './tz-data.js';
import {
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
    sourceZone: local,
    targetZone: defaultTarget,
    boardZones,
    favoriteZones,
    savedPairs,
  };
}

function loadPrefs() {
  const defaults = createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      use24Hour: Boolean(parsed.use24Hour),
      sourceZone: isValidZone(parsed.sourceZone) ? normalizeZoneId(parsed.sourceZone) : defaults.sourceZone,
      targetZone: isValidZone(parsed.targetZone) ? normalizeZoneId(parsed.targetZone) : defaults.targetZone,
      boardZones: Array.isArray(parsed.boardZones) && parsed.boardZones.length
        ? uniqueZones(parsed.boardZones)
        : defaults.boardZones,
      favoriteZones: Array.isArray(parsed.favoriteZones)
        ? uniqueZones(parsed.favoriteZones)
        : defaults.favoriteZones,
      savedPairs: Array.isArray(parsed.savedPairs)
        ? parsed.savedPairs.filter((p) => p && isValidZone(p.from) && isValidZone(p.to))
        : defaults.savedPairs,
    };
  } catch {
    return defaults;
  }
}

const prefs = loadPrefs();

const runtime = {
  isLive: true,
  epochMs: Date.now(),
  pickerMode: null, // 'source' | 'target' | 'board'
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
  boardList: document.getElementById('boardList'),

  zonePickerModal: document.getElementById('zonePickerModal'),
  pickerModalTitle: document.getElementById('pickerModalTitle'),
  closePickerBtn: document.getElementById('closePickerBtn'),
  pickerSearchInput: document.getElementById('pickerSearchInput'),
  filterAllBtn: document.getElementById('filterAllBtn'),
  filterFavBtn: document.getElementById('filterFavBtn'),
  pickerResultsList: document.getElementById('pickerResultsList'),

  installHelpModal: document.getElementById('installHelpModal'),
  closeInstallHelpBtn: document.getElementById('closeInstallHelpBtn'),

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

function renderHeaderState() {
  el.fmt12Btn.classList.toggle('active', !prefs.use24Hour);
  el.fmt24Btn.classList.toggle('active', prefs.use24Hour);
  el.resetNowBtn.classList.toggle('btn-now-highlight', !runtime.isLive);

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

function renderOneToOne() {
  const epoch = runtime.epochMs;
  const src = getZoneSnapshot(epoch, prefs.sourceZone, prefs.sourceZone, prefs.use24Hour);
  const tgt = getZoneSnapshot(epoch, prefs.targetZone, prefs.sourceZone, prefs.use24Hour);

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
    prefs.boardZones = [getLocalZoneId(), 'UTC'];
  }
  const refZone = prefs.boardZones[0];
  const epoch = runtime.epochMs;
  const refSnap = getZoneSnapshot(epoch, refZone, refZone, prefs.use24Hour);

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
      const snap = getZoneSnapshot(epoch, zoneId, refZone, prefs.use24Hour);
      const isRef = rowIdx === 0;
      const isFav = prefs.favoriteZones.includes(zoneId);

      // Build 24 synchronized 1-hour columns aligned to reference zone's day
      let cellsHtml = '';
      for (let slot = 0; slot < 24; slot++) {
        const slotEpoch = refDayStartEpoch + slot * 3600000;
        const slotParts = getZonedParts(slotEpoch, zoneId);
        const period = getDayPeriodStatus(slotParts.hour);
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

      return `
        <div class="board-row ${isRef ? 'is-ref' : ''}" data-zone="${escapeHtml(zoneId)}">
          <div class="board-row-top">
            <div class="board-zone-info">
              <div>
                <div class="board-zone-title">
                  ${escapeHtml(snap.displayName)}
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
                ${
                  !isRef
                    ? `<button type="button" class="row-btn" data-action="make-ref" data-zone="${escapeHtml(zoneId)}" title="Set as Reference Zone">Pin Top</button>`
                    : ''
                }
                <button type="button" class="row-btn ${isFav ? 'starred' : ''}" data-action="fav" data-zone="${escapeHtml(zoneId)}" title="Toggle Favorite">${isFav ? '★' : '☆'}</button>
                ${
                  prefs.boardZones.length > 1
                    ? `<button type="button" class="row-btn remove" data-action="remove" data-zone="${escapeHtml(zoneId)}" title="Remove from board">✕</button>`
                    : ''
                }
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
    defaultZone: prefs.sourceZone,
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

function renderAll() {
  renderHeaderState();
  renderOneToOne();
  renderMultiBoard();
  renderQuickParse();
}

// Searchable Time Zone Picker Modal
function openZonePicker(mode) {
  runtime.pickerMode = mode;
  runtime.pickerFocusIndex = 0;
  const titles = {
    source: 'Select Source ("From") Time Zone',
    target: 'Select Target ("To") Time Zone',
    board: 'Add Time Zone to Multi-Zone Board',
  };
  el.pickerModalTitle.textContent = titles[mode] || 'Select Time Zone';
  el.pickerSearchInput.value = '';
  el.zonePickerModal.classList.remove('hidden');
  renderPickerList();
  requestAnimationFrame(() => el.pickerSearchInput.focus());
}

function closeZonePicker() {
  el.zonePickerModal.classList.add('hidden');
  runtime.pickerMode = null;
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

function selectZoneFromPicker(zoneId) {
  const norm = normalizeZoneId(zoneId);
  if (runtime.pickerMode === 'source') {
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

  // 1-to-1 Zone Pickers & Favorites
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
    const text = formatMultiZoneCompact(runtime.epochMs, prefs.boardZones, prefs.use24Hour);
    copyText(text, 'Copied compact timeline summary');
  });

  el.copyMeetingBlockBtn.addEventListener('click', () => {
    const text = formatMultiZoneInviteBlock(runtime.epochMs, prefs.boardZones, prefs.use24Hour);
    copyText(text, 'Copied meeting invite block');
  });

  // Timeline Scrubber & Nudge buttons
  el.timelineSlider.addEventListener('input', () => {
    const mins = Number(el.timelineSlider.value);
    const refZone = prefs.boardZones[0] || getLocalZoneId();
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

  // Multi-Zone Board delegation (click hour cell, pin ref, fav, remove)
  el.boardList.addEventListener('click', (e) => {
    const hourBtn = e.target.closest('[data-slot-epoch]');
    if (hourBtn) {
      setCustomEpoch(Number(hourBtn.getAttribute('data-slot-epoch')));
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');
    const zone = actionBtn.getAttribute('data-zone');

    if (action === 'make-ref') {
      prefs.boardZones = [zone, ...prefs.boardZones.filter((z) => z !== zone)];
      savePrefs();
      renderAll();
      showToast(`Pinned ${getZoneShortTitle(zone)} as reference zone`);
    } else if (action === 'fav') {
      toggleFavoriteZone(zone);
    } else if (action === 'remove') {
      prefs.boardZones = prefs.boardZones.filter((z) => z !== zone);
      savePrefs();
      renderAll();
    }
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

  // Desktop PWA Install Handling
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    runtime.deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    runtime.deferredInstallPrompt = null;
    el.installAppBtn.classList.add('hidden');
    showToast('✓ ZoneShift installed as desktop app!');
  });

  // Hide install button if already running inside standalone desktop PWA window
  if (window.matchMedia('(display-mode: standalone)').matches) {
    el.installAppBtn.classList.add('hidden');
  }

  el.installAppBtn.addEventListener('click', async () => {
    if (runtime.deferredInstallPrompt) {
      runtime.deferredInstallPrompt.prompt();
      await runtime.deferredInstallPrompt.userChoice;
      runtime.deferredInstallPrompt = null;
    } else {
      el.installHelpModal.classList.remove('hidden');
    }
  });

  el.closeInstallHelpBtn.addEventListener('click', () => {
    el.installHelpModal.classList.add('hidden');
  });
  el.installHelpModal.addEventListener('click', (e) => {
    if (e.target === el.installHelpModal) el.installHelpModal.classList.add('hidden');
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

  // Popular SEO Conversion Links (smooth SPA navigation + shareable URL)
  document.querySelectorAll('[data-seo-from]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const fromId = normalizeZoneId(link.getAttribute('data-seo-from'));
      const toId = normalizeZoneId(link.getAttribute('data-seo-to'));
      if (isValidZone(fromId) && isValidZone(toId)) {
        prefs.sourceZone = fromId;
        prefs.targetZone = toId;
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
      closeDataPolicy();
      return;
    }
    if ((e.key === '/' && !isTyping) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
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
