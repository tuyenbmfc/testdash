/* ============================================================
   DATA SERVICE LAYER — NTSF Executive Sales Dashboard
   ------------------------------------------------------------
   Single responsibility: talk to the two JSON API endpoints
   (Actual Sales + Sales Targets) defined in CONFIG, normalize
   every record defensively, derive Original-vs-Current target
   allocations from the version history, detect real changes,
   and push a clean payload to every subscriber (app.js).
   app.js never calls fetch() directly — only this file does.
   ============================================================ */
const DataService = (function () {
  let subscribers = [];
  let lastHash = null;
  let refreshTimer = null;
  let inFlight = false;
  let localOverlay = []; // target revisions added by the user in this browser session (Target Maintenance edit form)
  let lastFetchedTargetHistory = [];

  let current = {
    shipments: [],        // normalized Actual Sales rows
    targetHistory: [],    // every target version row, normalized
    targetsBySale: {},    // { sale: { original, current, versionCount, lastEffectiveDate, lastReason, lastUpdatedBy } }
    monthlySummary: [],   // [{year, month, qty, revenue}] — for years with only aggregate data (e.g. 2025)
    lastRefresh: null,
    lastSuccess: null,
    error: null,
    changed: false,
    isFirstLoad: true,
  };

  /* ---------- graceful-missing-value helpers ---------- */
  function safeStr(v, fallback) {
    if (v === undefined || v === null) return fallback;
    const s = String(v).trim();
    return s.length ? s : fallback;
  }
  function safeInt(v, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  function safeFloat(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function safeDate(v) {
    const s = safeStr(v, '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Power Automate's "List rows present in a table" sometimes returns Excel's
    // internal date serial number (days since 1899-12-30) as plain text instead
    // of an ISO date string — detect and convert that case too.
    if (/^\d{4,6}$/.test(s)) {
      const serial = parseInt(s, 10);
      if (serial > 20000 && serial < 80000) { // roughly year 1954–2119, sanity bound
        const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
        return new Date(ms).toISOString().slice(0, 10);
      }
    }
    return '';
  }

  function stripAccents(s){
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').replace(/đ/g,'d');
  }
  function generateCustomerCode(name){
    const clean = stripAccents(name).toUpperCase().replace(/[^A-Z]/g,'');
    const prefix = (clean.slice(0,3) || 'CUS');
    let h = 0;
    for (let i=0;i<name.length;i++) h = (Math.imul(31,h) + name.charCodeAt(i)) | 0;
    return prefix + '-' + (h>>>0).toString(16).toUpperCase().padStart(6,'0').slice(0,6);
  }

  function normalizeShipment(raw) {
    const customer = safeStr(raw.Customer, '');
    const revenue = safeFloat(raw.ShipmentRevenue, 0);
    const qty = safeFloat(raw.ShipmentQty, 0);
    if (!customer && revenue === 0 && qty === 0) return null; // blank noise row
    const year = safeInt(raw.Year, 2026);
    const month = raw.Month === null || raw.Month === undefined || raw.Month === '' ? null : safeInt(raw.Month, null);
    const quarter = raw.Quarter ? safeInt(raw.Quarter, null) : (month ? Math.ceil(month / 3) : null);
    const customerFinal = customer || 'Không xác định';
    return {
      shipmentId:  safeStr(raw.ShipmentId, ''),
      year,
      quarter,
      month,
      shipmentDate: safeDate(raw.ShipmentDate),
      sale:        safeStr(raw.Sale, 'Chưa gán'),
      customer:    customerFinal,
      // Auto-generate a stable code if Sale Admin leaves the Excel column blank for a new customer —
      // deterministic (same name always produces the same code), so it stays consistent across refreshes.
      customerCode: safeStr(raw.CustomerCode, '') || generateCustomerCode(customerFinal),
      country:     safeStr(raw.Country, 'Chưa xác định'),
      region:      safeStr(raw.Region, 'Other'),
      market:      safeStr(raw.Market, safeStr(raw.Country, 'Chưa xác định')),
      product:     safeStr(raw.Product, 'Không xác định'),
      productGroup: safeStr(raw.ProductGroup, 'Không xác định'),
      contract:    safeStr(raw.ContractNo, ''),
      qty,
      revenue,
    };
  }

  function normalizeTargetRow(raw) {
    const sale = safeStr(raw.Sale, '');
    if (!sale) return null;
    return {
      targetId:    safeStr(raw.TargetId, ''),
      year:        safeInt(raw.Year, 2026),
      sale,
      originalAllocation: safeFloat(raw.OriginalAllocation, 0),
      currentAllocation:  safeFloat(raw.CurrentAllocation, safeFloat(raw.OriginalAllocation, 0)),
      version:     safeInt(raw.Version, 0),
      versionLabel: safeStr(raw.VersionLabel, raw.Version ? ('Revision ' + raw.Version) : 'Original Plan'),
      effectiveDate: safeDate(raw.EffectiveDate) || '2026-01-01',
      adjustmentReason: safeStr(raw.AdjustmentReason, ''),
      updatedBy:   safeStr(raw.UpdatedBy, 'Không xác định'),
    };
  }

  /* Derive "current state per Sale/Year" from the full version history:
     Current Allocation = the most recent version's CurrentAllocation.
     Original Allocation = that same lineage's OriginalAllocation (fixed baseline). */
  function deriveTargetsBySale(history) {
    const bySaleYear = new Map();
    history.forEach(row => {
      const key = row.sale + '||' + row.year;
      if (!bySaleYear.has(key)) bySaleYear.set(key, []);
      bySaleYear.get(key).push(row);
    });
    const result = {}; // keyed "sale||year" -> summary
    bySaleYear.forEach((rows, key) => {
      rows.sort((a, b) => (a.version - b.version) || a.effectiveDate.localeCompare(b.effectiveDate));
      const latest = rows[rows.length - 1];
      const first = rows[0];
      result[key] = {
        sale: latest.sale,
        year: latest.year,
        original: first.originalAllocation || latest.originalAllocation,
        current: latest.currentAllocation,
        versionCount: rows.length,
        lastEffectiveDate: latest.effectiveDate,
        lastReason: latest.adjustmentReason,
        lastUpdatedBy: latest.updatedBy,
      };
    });
    return result;
  }

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h;
  }

  function fetchJSON(url) {
    const bust = url.includes('?') ? '&_=' : '?_=';
    return fetch(url + bust + Date.now(), { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' khi gọi ' + url);
        return res.json();
      });
  }

  function resolveUrls() {
    if (CONFIG.DEMO_MODE) {
      return { salesUrl: CONFIG.DEMO_ACTUAL_SALES_FILE, targetsUrl: CONFIG.DEMO_SALES_TARGET_FILE, summaryUrl: CONFIG.DEMO_MONTHLY_SUMMARY_FILE };
    }
    return { salesUrl: CONFIG.ACTUAL_SALES_API, targetsUrl: CONFIG.SALES_TARGET_API, summaryUrl: CONFIG.MONTHLY_SUMMARY_API };
  }
  function isMonthlySummaryConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.MONTHLY_SUMMARY_API && CONFIG.MONTHLY_SUMMARY_API !== 'POWER_AUTOMATE_MONTHLY_SUMMARY_ENDPOINT'));
  }
  function normalizeMonthlySummaryRow(raw){
    const year = safeInt(raw.Year, null);
    const month = safeInt(raw.Month, null);
    if(!year || !month) return null;
    return { year, month, market: safeStr(raw.Market, 'Khác'), qty: safeFloat(raw.ShipmentQty, 0), revenue: safeFloat(raw.ShipmentRevenue, 0), containers: safeFloat(raw.ShipmentContainers, 0) };
  }

  async function refresh() {
    if (inFlight) return current;
    inFlight = true;
    const now = new Date();
    try {
      const { salesUrl, targetsUrl, summaryUrl } = resolveUrls();
      const [salesRaw, targetsRaw, summaryRaw] = await Promise.all([
        fetchJSON(salesUrl),
        fetchJSON(targetsUrl),
        isMonthlySummaryConfigured() ? fetchJSON(summaryUrl).catch(() => []) : Promise.resolve([]),
      ]);

      const shipments = (Array.isArray(salesRaw) ? salesRaw : (salesRaw.value || [])).map(normalizeShipment).filter(Boolean);
      lastFetchedTargetHistory = (Array.isArray(targetsRaw) ? targetsRaw : (targetsRaw.value || [])).map(normalizeTargetRow).filter(Boolean);
      const targetHistory = [...lastFetchedTargetHistory, ...localOverlay];
      const targetsBySale = deriveTargetsBySale(targetHistory);
      const monthlySummary = (Array.isArray(summaryRaw) ? summaryRaw : (summaryRaw.value || [])).map(normalizeMonthlySummaryRow).filter(Boolean);

      const hash = simpleHash(JSON.stringify(shipments) + '|' + JSON.stringify(targetHistory) + '|' + JSON.stringify(monthlySummary));
      const changed = hash !== lastHash;
      lastHash = hash;

      current = {
        shipments, targetHistory, targetsBySale, monthlySummary,
        lastRefresh: now, lastSuccess: now,
        error: null, changed,
        isFirstLoad: false,
      };
    } catch (err) {
      current = {
        ...current,
        lastRefresh: now,
        error: (err && err.message) ? err.message : String(err),
        changed: false,
        isFirstLoad: false,
      };
    } finally {
      inFlight = false;
      subscribers.forEach(cb => { try { cb(current); } catch (e) { console.error('subscriber error', e); } });
    }
    return current;
  }

  /* Called by the Target Maintenance "Sửa" form. This simulates what the future
     SubmitTargetRevision Power Automate flow (see DOCUMENTATION.md §9) will do:
     append a new version row, never mutate history. Applied instantly, and re-applied
     after every auto-refresh (via localOverlay) so it survives the 5-minute polling
     cycle for the rest of this browser session. */
  function computeNextRevision(rawRow){
    const normalized = normalizeTargetRow(rawRow);
    if(!normalized) return null;
    // auto-increment version + carry forward the fixed OriginalAllocation for this Sale/Year
    const lineage = [...lastFetchedTargetHistory, ...localOverlay].filter(h=>h.sale===normalized.sale && h.year===normalized.year);
    const maxVersion = lineage.reduce((m,h)=>Math.max(m,h.version), -1);
    const original = lineage.length ? lineage[0].originalAllocation : normalized.currentAllocation;
    normalized.version = maxVersion + 1;
    normalized.originalAllocation = original;
    normalized.targetId = normalized.targetId || ('TGT-' + normalized.year + '-WEB-' + Date.now());
    // computeNextRevision always represents a NEW revision (never "Original Plan"),
    // so the label is always recomputed here — a `||` fallback would wrongly keep
    // whatever default normalizeTargetRow() guessed (e.g. "Original Plan") since
    // that default is a non-empty, truthy string.
    normalized.versionLabel = 'Revision ' + normalized.version;
    return normalized;
  }

  function applyRevisionLocally(normalized){
    localOverlay.push(normalized);
    const targetHistory = [...lastFetchedTargetHistory, ...localOverlay];
    const targetsBySale = deriveTargetsBySale(targetHistory);
    current = { ...current, targetHistory, targetsBySale, changed: true, lastRefresh: new Date() };
    subscribers.forEach(cb => { try { cb(current); } catch (e) { console.error('subscriber error', e); } });
    return normalized;
  }

  // Used when no write-back API is configured — purely simulates the change in this browser session.
  function addLocalTargetRevision(rawRow){
    const normalized = computeNextRevision(rawRow);
    if(!normalized) return null;
    return applyRevisionLocally(normalized);
  }

  function isWriteBackConfigured(){
    return !!(CONFIG.SUBMIT_TARGET_REVISION_API && CONFIG.SUBMIT_TARGET_REVISION_API !== 'POWER_AUTOMATE_SUBMIT_REVISION_ENDPOINT' && !CONFIG.DEMO_MODE);
  }

  // Used when Flow C (see DOCUMENTATION.md §9) is configured — POSTs the new revision
  // to SharePoint/OneDrive via Power Automate ("Add a row into a table"), and only
  // reflects it in the UI once the write is confirmed successful.
  async function submitTargetRevision(rawRow){
    const normalized = computeNextRevision(rawRow);
    if(!normalized) throw new Error('Dữ liệu điều chỉnh không hợp lệ.');

    if(!isWriteBackConfigured()){
      return { ...applyRevisionLocally(normalized), persisted:false };
    }

    const body = {
      TargetId: normalized.targetId, Year: normalized.year, Sale: normalized.sale,
      OriginalAllocation: normalized.originalAllocation, CurrentAllocation: normalized.currentAllocation,
      Version: normalized.version, VersionLabel: normalized.versionLabel,
      EffectiveDate: normalized.effectiveDate, AdjustmentReason: normalized.adjustmentReason,
      UpdatedBy: normalized.updatedBy,
    };
    const res = await fetch(CONFIG.SUBMIT_TARGET_REVISION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if(!res.ok) throw new Error('Ghi dữ liệu thất bại (HTTP ' + res.status + '). Điều chỉnh CHƯA được lưu.');
    applyRevisionLocally(normalized);
    return { ...normalized, persisted:true };
  }

  function subscribe(cb) { subscribers.push(cb); }
  function getCurrent() { return current; }
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, CONFIG.REFRESH_INTERVAL);
  }
  function stopAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); }
  function init() { return refresh().then(() => { startAutoRefresh(); return current; }); }
  function forceRefresh() { return refresh(); }

  return { init, subscribe, getCurrent, forceRefresh, startAutoRefresh, stopAutoRefresh, addLocalTargetRevision, submitTargetRevision, isWriteBackConfigured, isMonthlySummaryConfigured };
})();
