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
    tilapiaTarget: {},    // { [year]: { target, original, effectiveDate, reason, updatedBy } } — chỉ tiêu rô phi (USD)
    monthlySummary: [],   // [{year, month, qty, revenue}] — for years with only aggregate data (e.g. 2025)
    saleSummary: [],      // [{year, sale, revenue, qty}] — Actual per Sale for aggregate-only years
    weeklyNewContracts: [], // [{weekEndingDate, contractCount, contractQty, contractRevenue, note}] — Sale Admin cập nhật tay mỗi tuần
    productAliasRules: [], // [{canonical, all: [...keywords], priority}] — quy tắc gộp tên sản phẩm, tự cấu hình qua Excel
    chemicalThresholdRules: [], // [{marketKeywords, threshold, isDefault}] — ngưỡng giá phân loại fillet có/không hoá chất
    industryNews: [],     // [{title, source, publishDate, link}] — auto-collected via Flow G/H
    contractProgress: [], // [{ContractNo, Customer, SignedCartons, SignedContainers, ...}] — hợp đồng đã ký, từ file THHD qua Flow K
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

  function stripAccents(s){
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').replace(/đ/g,'d');
  }
  // Maps any spelling/accent/case variation of a Sale name to the canonical form used
  // throughout the app (matching TargetPlan/ActualSales). Prevents the same person
  // appearing as two different rows just because a sheet was typed without accents.
  const SALE_NAME_CANONICAL = {};
  function registerCanonicalSaleName(name){
    const key = stripAccents(name).toLowerCase().replace(/\s+/g,' ').trim();
    SALE_NAME_CANONICAL[key] = name;
  }
  ['Tuyên','Huy','Ái','Phong','Huyên','Nội địa'].forEach(registerCanonicalSaleName);
  function canonicalSaleName(raw){
    const name = safeStr(raw, '');
    if(!name) return name;
    const key = stripAccents(name).toLowerCase().replace(/\s+/g,' ').trim();
    if(!SALE_NAME_CANONICAL[key]) registerCanonicalSaleName(name); // first time seeing this sale — adopt its spelling as-is
    return SALE_NAME_CANONICAL[key];
  }

  // Bảng tỷ giá VNĐ→USD theo tháng (từ sheet ExchangeRate). Map "YYYY-MM" -> Rate (VNĐ/USD).
  let fxRateByMonth = {};
  function isExchangeRateConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.EXCHANGE_RATE_API && CONFIG.EXCHANGE_RATE_API !== 'POWER_AUTOMATE_EXCHANGE_RATE_ENDPOINT'));
  }
  function buildFxRateMap(rows){
    const map = {};
    (rows || []).forEach(r => {
      // Month có thể là "2026-01", "2026/01", số serial, hay Date ISO — chuẩn hoá về "YYYY-MM"
      let m = safeStr(r.Month, r.month || '');
      let key = '';
      const iso = m.match(/(\d{4})[-/.](\d{1,2})/);
      if (iso) key = iso[1] + '-' + String(+iso[2]).padStart(2, '0');
      else {
        const d = safeDate(m);
        if (d) key = d.slice(0, 7);
      }
      const rate = safeFloat(r.Rate, safeFloat(r.rate, 0));
      if (key && rate > 0) map[key] = rate;
    });
    return map;
  }
  function fxRateFor(year, month, rowFallback){
    if (month) {
      const key = year + '-' + String(month).padStart(2, '0');
      if (fxRateByMonth[key]) return fxRateByMonth[key];
      // lùi về tháng gần nhất có tỷ giá trong cùng năm (tỷ giá tháng ổn định, chấp nhận xấp xỉ)
      for (let m = month - 1; m >= 1; m--) {
        const k = year + '-' + String(m).padStart(2, '0');
        if (fxRateByMonth[k]) return fxRateByMonth[k];
      }
    }
    return rowFallback > 0 ? rowFallback : 0; // fallback: cột FxRate trên dòng (nếu Flow có ghi)
  }

  function normalizeShipment(raw) {
    const customer = safeStr(raw.Customer, '');
    let revenue = safeFloat(raw.ShipmentRevenue, 0);
    const qty = safeFloat(raw.ShipmentQty, 0);
    if (!customer && revenue === 0 && qty === 0) return null; // blank noise row
    const year = safeInt(raw.Year, 2026);
    const month = raw.Month === null || raw.Month === undefined || raw.Month === '' ? null : safeInt(raw.Month, null);
    const quarter = raw.Quarter ? safeInt(raw.Quarter, null) : (month ? Math.ceil(month / 3) : null);
    // Tiền tệ & quy đổi: lô xuất đường bộ ghi bằng VNĐ. Quy VNĐ→USD theo bảng tỷ giá THÁNG
    // (sheet ExchangeRate, VCB chuyển khoản) để mọi số liệu gộp chung một đơn vị USD.
    const currency = safeStr(raw.Currency, 'USD').toUpperCase().indexOf('VN') >= 0 ? 'VND' : 'USD';
    let revenueVnd = 0;
    let fxRate = 0;
    if (currency === 'VND') {
      revenueVnd = revenue;
      fxRate = fxRateFor(year, month, safeFloat(raw.FxRate, 0)); // ưu tiên bảng tháng, fallback cột FxRate
      revenue = fxRate > 0 ? Math.round((revenue / fxRate) * 100) / 100 : 0; // -> USD
    }
    const transportMode = safeStr(raw.TransportMode, 'Đường biển') || 'Đường biển';
    const customerFinal = customer || 'Không xác định';
    // Lô NỘI ĐỊA không có Sale phụ trách riêng (giống rô phi: theo dõi theo thị trường, không
    // theo cá nhân). Nếu cột Sale để trống mà lô này là hàng nội địa (Market ghi 'Nội địa',
    // hoặc bán trong nước bằng VNĐ), gán 'Nội địa' thay vì rơi vào rổ 'Chưa gán' — để bảng
    // xếp hạng hiển thị rõ đây là thị trường Nội địa và ghép đúng với chỉ tiêu Nội địa.
    const marketRaw = safeStr(raw.Market, safeStr(raw.Country, 'Chưa xác định'));
    const isDomestic = stripAccents(marketRaw).toUpperCase().indexOf('NOI DIA') >= 0
      || stripAccents(safeStr(raw.Country, '')).toUpperCase().indexOf('VIET NAM') >= 0;
    const saleFinal = canonicalSaleName(raw.Sale) || (isDomestic ? 'Nội địa' : 'Chưa gán');
    return {
      shipmentId:  safeStr(raw.ShipmentId, ''),
      year,
      quarter,
      month,
      shipmentDate: safeDate(raw.ShipmentDate),
      sale:        saleFinal,
      customer:    customerFinal,
      // Auto-generate a stable code if Sale Admin leaves the Excel column blank for a new customer —
      // deterministic (same name always produces the same code), so it stays consistent across refreshes.
      customerCode: safeStr(raw.CustomerCode, '') || generateCustomerCode(customerFinal),
      country:     safeStr(raw.Country, 'Chưa xác định'),
      market:      safeStr(raw.Market, safeStr(raw.Country, 'Chưa xác định')),
      product:     safeStr(raw.Product, 'Không xác định'),
      productGroup: safeStr(raw.ProductGroup, 'Không xác định'),
      productClassification: safeStr(raw.ProductClassification, 'Không xác định'), // "Thô" hoặc "GTGT"
      ascLabel:    (safeStr(raw.ASClabel, 'no') || 'no').trim().toLowerCase() === 'yes' ? 'yes' : 'no',
      contract:    safeStr(raw.ContractNo, ''),
      containerNo: safeStr(raw.ContainerNo, ''),
      billNo:      safeStr(raw.BillNo, ''),
      qty,
      revenue,
      currency,                 // 'USD' | 'VND'
      revenueVnd,               // doanh thu gốc VNĐ (0 nếu là USD) — để tham chiếu khi cần
      fxRate,                   // tỷ giá VCB đã dùng để quy đổi (0 nếu USD)
      transportMode,            // 'Đường biển' | 'Đường bộ' — cờ lọc loại hình xuất khẩu
      containers: safeFloat(raw.ShipmentContainers, 0), // optional — 0 until Sale Admin adds this column to ActualSales
    };
  }

  function normalizeTargetRow(raw) {
    // Loại chỉ tiêu: 'ropi' (rô phi — tổng chung/năm, đo bằng doanh thu USD) hoặc 'sale'
    // (chỉ tiêu theo từng Sale cho cá tra, đo bằng kg). Mặc định 'sale'.
    // Đọc cột linh hoạt (Power Automate/Excel có thể đặt tên hơi khác) + BỎ DẤU tiếng Việt
    // trước khi so — tránh lỗi Unicode tổ hợp (NFD) khi Excel ghi "Rô Phi" dạng 'o'+dấu rời.
    const ttSource = raw.TargetType != null ? raw.TargetType
      : (raw.targetType != null ? raw.targetType
      : (raw['Target Type'] != null ? raw['Target Type']
      : (raw.Loai != null ? raw.Loai : (raw['Loại'] != null ? raw['Loại'] : ''))));
    const ttRaw = stripAccents(safeStr(ttSource, '')).toUpperCase().replace(/\s+/g, '');
    const targetType = (ttRaw.indexOf('ROPHI') >= 0 || ttRaw.indexOf('TILAPIA') >= 0 || ttRaw === 'ROPI') ? 'ropi' : 'sale';
    const sale = canonicalSaleName(raw.Sale);
    // Chỉ tiêu rô phi là TỔNG CHUNG, không gắn Sale — cho phép dòng không có Sale khi là rô phi.
    if (!sale && targetType !== 'ropi') return null;
    return {
      targetId:    safeStr(raw.TargetId, ''),
      year:        safeInt(raw.Year, 2026),
      sale:        sale || (targetType === 'ropi' ? '(Rô Phi)' : ''),
      targetType,
      originalAllocation: safeFloat(raw.OriginalAllocation, 0),
      currentAllocation:  safeFloat(raw.CurrentAllocation, safeFloat(raw.OriginalAllocation, 0)),
      version:     safeInt(raw.Version, 0),
      versionLabel: safeStr(raw.VersionLabel, raw.Version ? ('Revision ' + raw.Version) : 'Original Plan'),
      effectiveDate: safeDate(raw.EffectiveDate) || '2026-01-01',
      adjustmentReason: safeStr(raw.AdjustmentReason, ''),
      updatedBy:   safeStr(raw.UpdatedBy, 'Không xác định'),
    };
  }

  /* Chỉ tiêu rô phi (tổng chung/năm, doanh thu USD) — lấy phiên bản mới nhất theo năm.
     Trả về { [year]: { target, effectiveDate, reason, updatedBy } }. */
  function deriveTilapiaTarget(history) {
    const byYear = {};
    history.filter(r => r.targetType === 'ropi').forEach(r => {
      if (!byYear[r.year]) byYear[r.year] = [];
      byYear[r.year].push(r);
    });
    const out = {};
    Object.keys(byYear).forEach(y => {
      const rows = byYear[y].sort((a, b) => (a.version - b.version) || a.effectiveDate.localeCompare(b.effectiveDate));
      const latest = rows[rows.length - 1];
      out[y] = {
        target: latest.currentAllocation,
        original: rows[0].originalAllocation || latest.originalAllocation,
        effectiveDate: latest.effectiveDate,
        reason: latest.adjustmentReason,
        updatedBy: latest.updatedBy,
      };
    });
    return out;
  }

  /* Derive "current state per Sale/Year" from the full version history:
     Current Allocation = the most recent version's CurrentAllocation.
     Original Allocation = that same lineage's OriginalAllocation (fixed baseline). */
  function deriveTargetsBySale(history) {
    const bySaleYear = new Map();
    history.forEach(row => {
      if (row.targetType === 'ropi') return; // chỉ tiêu rô phi không phải của 1 Sale
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
      return { salesUrl: CONFIG.DEMO_ACTUAL_SALES_FILE, targetsUrl: CONFIG.DEMO_SALES_TARGET_FILE, summaryUrl: CONFIG.DEMO_MONTHLY_SUMMARY_FILE, saleSummaryUrl: CONFIG.DEMO_SALE_SUMMARY_FILE, newContractsUrl: CONFIG.DEMO_NEW_CONTRACTS_FILE, productAliasUrl: CONFIG.DEMO_PRODUCT_ALIAS_FILE, chemicalThresholdUrl: CONFIG.DEMO_CHEMICAL_THRESHOLD_FILE, newsUrl: CONFIG.DEMO_INDUSTRY_NEWS_FILE, contractUrl: CONFIG.DEMO_CONTRACT_PROGRESS_FILE };
    }
    return { salesUrl: CONFIG.ACTUAL_SALES_API, targetsUrl: CONFIG.SALES_TARGET_API, summaryUrl: CONFIG.MONTHLY_SUMMARY_API, saleSummaryUrl: CONFIG.SALE_SUMMARY_API, newContractsUrl: CONFIG.NEW_CONTRACTS_API, productAliasUrl: CONFIG.PRODUCT_ALIAS_API, chemicalThresholdUrl: CONFIG.CHEMICAL_THRESHOLD_API, newsUrl: CONFIG.INDUSTRY_NEWS_API, contractUrl: CONFIG.CONTRACT_PROGRESS_API };
  }
  function isMonthlySummaryConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.MONTHLY_SUMMARY_API && CONFIG.MONTHLY_SUMMARY_API !== 'POWER_AUTOMATE_MONTHLY_SUMMARY_ENDPOINT'));
  }
  function isSaleSummaryConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.SALE_SUMMARY_API && CONFIG.SALE_SUMMARY_API !== 'POWER_AUTOMATE_SALE_SUMMARY_ENDPOINT'));
  }
  function isNewContractsConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.NEW_CONTRACTS_API && CONFIG.NEW_CONTRACTS_API !== 'POWER_AUTOMATE_NEW_CONTRACTS_ENDPOINT'));
  }
  function isProductAliasConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.PRODUCT_ALIAS_API && CONFIG.PRODUCT_ALIAS_API !== 'POWER_AUTOMATE_PRODUCT_ALIAS_ENDPOINT'));
  }
  function isChemicalThresholdConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.CHEMICAL_THRESHOLD_API && CONFIG.CHEMICAL_THRESHOLD_API !== 'POWER_AUTOMATE_CHEMICAL_THRESHOLD_ENDPOINT'));
  }
  function isIndustryNewsConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.INDUSTRY_NEWS_API && CONFIG.INDUSTRY_NEWS_API !== 'POWER_AUTOMATE_INDUSTRY_NEWS_ENDPOINT'));
  }
  function isContractProgressConfigured(){
    return !!(CONFIG.DEMO_MODE || (CONFIG.CONTRACT_PROGRESS_API && CONFIG.CONTRACT_PROGRESS_API !== 'POWER_AUTOMATE_CONTRACT_PROGRESS_ENDPOINT'));
  }
  // Bảng "ContractProgress": mỗi dòng = 1 hợp đồng đã ký, do Flow K bóc từ file THHD
  // (qua ParseContractProgress.ts) — cấu trúc đã được chuẩn hoá sẵn.
  function normalizeContractRow(raw){
    const contractNo = safeStr(raw.ContractNo, '');
    const customer = safeStr(raw.Customer, '');
    if(!contractNo && !customer) return null;
    return {
      ContractNo: contractNo,
      ContractKeys: safeStr(raw.ContractKeys, ''),
      Customer: customer || '(không rõ)',
      ProductKind: safeStr(raw.ProductKind, ''),
      Year: safeInt(raw.Year, null),
      Market: safeStr(raw.Market, ''),
      SignDate: safeStr(raw.SignDate, ''),
      SignedCartons: safeFloat(raw.SignedCartons, 0),
      SignedContainers: safeFloat(raw.SignedContainers, 0),
      ETD: safeStr(raw.ETD, ''),
      Port: safeStr(raw.Port, ''),
      Trader: safeStr(raw.Trader, ''),
      NeedsReview: safeStr(raw.NeedsReview, 'no'),
    };
  }
  function normalizeNewsRow(raw){
    const title = safeStr(raw.Title, '');
    if(!title) return null;
    return { title, source: safeStr(raw.Source, ''), publishDate: safeDate(raw.PublishDate) || safeStr(raw.PublishDate, ''), link: safeStr(raw.Link, ''), description: safeStr(raw.Description, ''), imageUrl: safeStr(raw.ImageUrl, '') };
  }
  function normalizeMonthlySummaryRow(raw){
    const year = safeInt(raw.Year, null);
    const month = safeInt(raw.Month, null);
    if(!year || !month) return null;
    return { year, month, market: safeStr(raw.Market, 'Khác'), qty: safeFloat(raw.ShipmentQty, 0), revenue: safeFloat(raw.ShipmentRevenue, 0), containers: safeFloat(raw.ShipmentContainers, 0) };
  }
  function normalizeSaleSummaryRow(raw){
    const year = safeInt(raw.Year, null);
    const sale = canonicalSaleName(raw.Sale);
    if(!year || !sale) return null;
    return { year, sale, revenue: safeFloat(raw.ShipmentRevenue, 0), qty: safeFloat(raw.ShipmentQty, 0) };
  }
  // Bảng "ChemicalThresholdRules": mỗi dòng là ngưỡng giá (USD/kg) cho 1 nhóm thị trường, dùng để
  // phân loại fillet cá tra "có/không hoá chất". MarketKeywords: các từ khoá thị trường cách nhau
  // bằng dấu phẩy (khớp nếu Market của lô hàng CHỨA bất kỳ từ khoá nào). ThresholdUSDPerKg: ngưỡng
  // giá — lô nào giá > ngưỡng thì "không hoá chất", ngược lại "có hoá chất". IsDefault = TRUE/1 đánh
  // dấu dòng ngưỡng MẶC ĐỊNH áp cho các thị trường không khớp từ khoá nào (VD EU/còn lại) — dòng này
  // để trống MarketKeywords. Chỉ nên có đúng 1 dòng IsDefault.
  function normalizeChemicalThresholdRow(raw){
    const threshold = safeFloat(raw.ThresholdUSDPerKg, null);
    if(threshold === null) return null;
    const kwRaw = safeStr(raw.MarketKeywords, '');
    const marketKeywords = kwRaw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
    const isDefaultRaw = safeStr(raw.IsDefault, '').trim().toLowerCase();
    const isDefault = (isDefaultRaw === 'true' || isDefaultRaw === '1' || isDefaultRaw === 'yes' || isDefaultRaw === 'x');
    // Dòng không phải mặc định mà lại không có từ khoá thị trường nào thì bỏ (vô nghĩa).
    if(!isDefault && marketKeywords.length === 0) return null;
    return { marketKeywords, threshold, isDefault };
  }
  // khoá cách nhau bằng dấu phẩy, TẤT CẢ phải xuất hiện trong tên gốc (không phân biệt hoa
  // thường) thì mới gộp vào CanonicalName. Priority càng nhỏ càng được kiểm tra trước (để xử lý
  // trường hợp 1 tên hàng có thể khớp nhiều quy tắc, VD "BUTTERFLY" cần được ưu tiên trước
  // "FILLET"). Để trống Priority thì mặc định xếp cuối.
  function normalizeProductAliasRow(raw){
    const canonical = safeStr(raw.CanonicalName, '');
    const keywordsRaw = safeStr(raw.Keywords, '');
    if(!canonical || !keywordsRaw) return null;
    const all = keywordsRaw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
    if(all.length===0) return null;
    return { canonical, all, priority: safeInt(raw.Priority, 999) };
  }
  // Bảng "WeeklyNewContracts": Sale Admin thêm 1 dòng mới mỗi tuần với số liệu hợp đồng mới
  // ký trong tuần đó. WeekEndingDate dùng để sắp xếp — dòng có ngày mới nhất = tuần hiện tại,
  // dòng ngay trước đó (theo thời gian) = tuần trước, dùng để so sánh tăng/giảm.
  function normalizeNewContractsRow(raw){
    const weekEndingDate = safeDate(raw.WeekEndingDate) || safeStr(raw.WeekEndingDate, '');
    if(!weekEndingDate) return null;
    return {
      weekEndingDate,
      contractCount: safeInt(raw.NewContractCount, 0),
      contractQty: safeFloat(raw.NewContractQty, 0),
      contractRevenue: safeFloat(raw.NewContractValue, 0),
      note: safeStr(raw.Note, ''),
    };
  }

  async function refresh() {
    if (inFlight) return current;
    inFlight = true;
    const now = new Date();
    try {
      const { salesUrl, targetsUrl, summaryUrl, saleSummaryUrl, newContractsUrl, productAliasUrl, chemicalThresholdUrl, newsUrl, contractUrl } = resolveUrls();
      const [salesRaw, targetsRaw, summaryRaw, saleSummaryRaw, newContractsRaw, productAliasRaw, chemicalThresholdRaw, newsRaw, contractRaw, exchangeRaw] = await Promise.all([
        fetchJSON(salesUrl),
        fetchJSON(targetsUrl),
        isMonthlySummaryConfigured() ? fetchJSON(summaryUrl).catch(() => []) : Promise.resolve([]),
        isSaleSummaryConfigured() ? fetchJSON(saleSummaryUrl).catch(() => []) : Promise.resolve([]),
        isNewContractsConfigured() ? fetchJSON(newContractsUrl).catch(() => []) : Promise.resolve([]),
        isProductAliasConfigured() ? fetchJSON(productAliasUrl).catch(() => []) : Promise.resolve([]),
        isChemicalThresholdConfigured() ? fetchJSON(chemicalThresholdUrl).catch(() => []) : Promise.resolve([]),
        isIndustryNewsConfigured() ? fetchJSON(newsUrl).catch(() => []) : Promise.resolve([]),
        isContractProgressConfigured() ? fetchJSON(contractUrl).catch(() => []) : Promise.resolve([]),
        isExchangeRateConfigured() ? fetchJSON(CONFIG.EXCHANGE_RATE_API).catch(() => []) : Promise.resolve([]),
      ]);

      // Bảng tỷ giá tháng phải nạp TRƯỚC khi chuẩn hoá lô hàng (để quy VNĐ→USD theo tháng xuất)
      fxRateByMonth = buildFxRateMap(Array.isArray(exchangeRaw) ? exchangeRaw : (exchangeRaw.value || []));

      const shipments = (Array.isArray(salesRaw) ? salesRaw : (salesRaw.value || [])).map(normalizeShipment).filter(Boolean);
      lastFetchedTargetHistory = (Array.isArray(targetsRaw) ? targetsRaw : (targetsRaw.value || [])).map(normalizeTargetRow).filter(Boolean);
      const targetHistory = [...lastFetchedTargetHistory, ...localOverlay];
      const targetsBySale = deriveTargetsBySale(targetHistory);
      const tilapiaTarget = deriveTilapiaTarget(targetHistory);
      const monthlySummary = (Array.isArray(summaryRaw) ? summaryRaw : (summaryRaw.value || [])).map(normalizeMonthlySummaryRow).filter(Boolean);
      const saleSummary = (Array.isArray(saleSummaryRaw) ? saleSummaryRaw : (saleSummaryRaw.value || [])).map(normalizeSaleSummaryRow).filter(Boolean);
      const weeklyNewContracts = (Array.isArray(newContractsRaw) ? newContractsRaw : (newContractsRaw.value || [])).map(normalizeNewContractsRow).filter(Boolean)
        .sort((a,b)=>a.weekEndingDate.localeCompare(b.weekEndingDate));
      const productAliasRules = (Array.isArray(productAliasRaw) ? productAliasRaw : (productAliasRaw.value || [])).map(normalizeProductAliasRow).filter(Boolean)
        .sort((a,b)=>a.priority-b.priority);
      const chemicalThresholdRules = (Array.isArray(chemicalThresholdRaw) ? chemicalThresholdRaw : (chemicalThresholdRaw.value || [])).map(normalizeChemicalThresholdRow).filter(Boolean);
      const industryNews = (Array.isArray(newsRaw) ? newsRaw : (newsRaw.value || [])).map(normalizeNewsRow).filter(Boolean);
      const contractProgress = (Array.isArray(contractRaw) ? contractRaw : (contractRaw.value || [])).map(normalizeContractRow).filter(Boolean);

      const hash = simpleHash(JSON.stringify(shipments) + '|' + JSON.stringify(targetHistory) + '|' + JSON.stringify(monthlySummary) + '|' + JSON.stringify(saleSummary) + '|' + JSON.stringify(weeklyNewContracts) + '|' + JSON.stringify(productAliasRules) + '|' + JSON.stringify(chemicalThresholdRules) + '|' + JSON.stringify(industryNews) + '|' + JSON.stringify(contractProgress));
      const changed = hash !== lastHash;
      lastHash = hash;

      current = {
        shipments, targetHistory, targetsBySale, tilapiaTarget, monthlySummary, saleSummary, weeklyNewContracts, productAliasRules, chemicalThresholdRules, industryNews, contractProgress,
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
    const tilapiaTarget = deriveTilapiaTarget(targetHistory);
    current = { ...current, targetHistory, targetsBySale, tilapiaTarget, changed: true, lastRefresh: new Date() };
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

  return { init, subscribe, getCurrent, forceRefresh, startAutoRefresh, stopAutoRefresh, addLocalTargetRevision, submitTargetRevision, isWriteBackConfigured, isMonthlySummaryConfigured, isSaleSummaryConfigured };
})();
