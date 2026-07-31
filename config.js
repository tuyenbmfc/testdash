/* ============================================================
   CENTRAL CONFIGURATION — NTSF Executive Sales Dashboard
   ------------------------------------------------------------
   This is the ONLY file you need to edit when moving from demo
   mode (sample JSON shipped alongside the dashboard) to the real
   production pipeline:

       SharePoint Excel/Lists → Power Automate → JSON API → this dashboard

   HOW TO GO LIVE
   ---------------
   1. Build the two Power Automate "When an HTTP request is received"
      flows described in POWER_AUTOMATE_DESIGN.md (one for Actual
      Sales, one for Sales Targets).
   2. Copy each flow's HTTP POST URL below into ACTUAL_SALES_API /
      SALES_TARGET_API.
   3. Set DEMO_MODE to false.
   4. Redeploy (git push) — GitHub Pages needs no other change.
   ============================================================ */
const CONFIG = {
  // Demo mode reads the two sample JSON files shipped next to index.html.
  // Flip to false once the Power Automate HTTP endpoints below are live.
  DEMO_MODE: false,

  // Production endpoints (Power Automate "HTTP request" trigger URLs).
  ACTUAL_SALES_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/08/workflows/15db9cd6b36144a5b52d623549df7f99/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=VOhAuFylaVm56zfPvyiG9kE1MFkIKycrdzgBFfsVat0",
  SALES_TARGET_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/29/workflows/4b18ce596ebe43d499151d7f53cd2c76/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=dvR_7k55mB0geJ5nTqJOurSS_nAkSFAcLjTqAfSSFEQ",

  // OPTIONAL — Flow C (see DOCUMENTATION.md §9). When set to a real Power Automate
  // URL, the "✏️ Sửa" button in Target Maintenance writes the new revision straight
  // into the TargetPlan table (via "Add a row into a table") instead of only
  // simulating the change in the browser. Leave as the placeholder to keep the
  // current browser-only simulation behavior.
  SUBMIT_TARGET_REVISION_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/03/workflows/3a8aef0872f8438ca70a9e21a873dc96/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=uQYaj7vWThHctLD0ZoCaX2vv0PCou9C2f3us5T1dGEs",

  // OPTIONAL — Flow D (see DOCUMENTATION.md §9). For years where only month-level
  // totals exist (no per-customer/per-Sale breakdown), e.g. 2025. When configured,
  // this powers the "Năm 2025 — Tổng Quan" section and lets Year-over-Year growth
  // comparisons work even for years without detailed data. Leave as the placeholder
  // to hide that section entirely.
  MONTHLY_SUMMARY_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/24/workflows/85ecdb5eef004f429be84a4cca2682d0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=JTv7M5W6oAr0nnYTFahfU4WV7y9ypDEQ_aI16R5_yOc",

  // OPTIONAL — Flow E (see DOCUMENTATION.md §9). Actual Shipment Revenue totals PER
  // SALE for years with only aggregate data (e.g. 2025) — reads the "SaleSummary"
  // table. Combined with Year=2025 rows added directly to the existing TargetPlan
  // table, this powers a per-Sale Target vs Actual comparison for 2025, and lets
  // the 2026 Sales Ranking table show a "so với 2025" growth column.
  SALE_SUMMARY_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/29/workflows/17c2a0a5531f48c5918750082277369e/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=coFaFWc408ubyZHhO8wbDBT0ulfh6qbCx52nLWNbuRY",

  // OPTIONAL — Flow I (GetWeeklyNewContracts). Đọc bảng "WeeklyNewContracts" — Sale Admin cập
  // nhật thủ công mỗi tuần 1 dòng (WeekEndingDate, NewContractCount, NewContractQty,
  // NewContractValue). Khi cấu hình, các chỉ số "Hợp đồng mới ký / Khối lượng HĐ mới ký / Giá
  // trị HĐ mới ký" ở mục Tin Nổi Bật Tuần Này sẽ lấy TRỰC TIẾP từ bảng này (dòng mới nhất =
  // tuần này, dòng ngay trước đó = tuần trước, để so sánh) thay vì tự suy ra từ ActualSales.
  // Để nguyên placeholder thì dashboard tự dùng lại cách tính cũ (suy ra từ ContractNo trong
  // ActualSales) — không lỗi, không cần đổi gì thêm.
  NEW_CONTRACTS_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/14/workflows/f1507b787a7a406c8d263411bbd60de7/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=w39FWIriTinmgyRSrFWZXqEvMjIC2hKcqGrDVAISVcw",

  // OPTIONAL — Flow J (GetProductAliasRules). Đọc bảng "ProductAliasRules" — nơi tự thêm/sửa quy
  // tắc gộp các tên sản phẩm khác nhau (VD "PANGASIUS FILLET"/"BASA FILLET"/"SWAI FILLET" đều
  // gộp thành "Cá tra fillet") ngay trong Excel, không cần sửa code. Mỗi dòng gồm: Keywords
  // (các từ khoá cách nhau bằng dấu phẩy — TẤT CẢ phải xuất hiện trong tên gốc mới khớp),
  // CanonicalName (tên gộp hiển thị trên dashboard), Priority (số càng nhỏ càng ưu tiên kiểm tra
  // trước — quan trọng khi 1 tên hàng có thể khớp nhiều quy tắc). Để nguyên placeholder thì
  // dashboard tự dùng lại danh sách quy tắc mặc định có sẵn trong code — không lỗi.
  PRODUCT_ALIAS_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/28/workflows/1eeb32aad22d47938c4312dfa3438fe0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8U1p7YZMZ2xVbCF0op80TzeQyR8oepLhX26QGrK28EQ",

  // OPTIONAL — Flow K (GetChemicalThresholdRules). Đọc bảng "ChemicalThresholdRules" — nơi tự chỉnh
  // ngưỡng giá (USD/kg) để phân loại fillet cá tra "có/không hoá chất" theo từng thị trường, ngay
  // trong Excel, không cần sửa code. Mỗi dòng gồm: MarketKeywords (từ khoá thị trường cách nhau bằng
  // dấu phẩy), ThresholdUSDPerKg (ngưỡng giá — lô nào giá > ngưỡng thì "không hoá chất"), IsDefault
  // (TRUE cho đúng 1 dòng ngưỡng mặc định áp cho thị trường không khớp từ khoá nào, để trống
  // MarketKeywords ở dòng đó). Để nguyên placeholder thì dashboard tự dùng ngưỡng mặc định trong
  // code — không lỗi.
  CHEMICAL_THRESHOLD_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/31/workflows/6bc7bed915a8475caa260b07cfa11996/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=wwMbZ3MFiPgoTyjZrF8GDQ6nHWd_uxHsldCAutsuPu0",

  // OPTIONAL — Flow H (GetIndustryNews). Đọc bảng "IndustryNews" (do Flow G tự động thu
  // thập tin RSS mỗi sáng). Dùng cho khu "Tin Ngành Cá Tra" trên Trang chính. Để nguyên
  // placeholder này thì mục Tin Ngành sẽ tự ẩn, không lỗi.
  INDUSTRY_NEWS_API: "https://defaultb8d21e4f3f864367b6afe47d812e19.72.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/29/workflows/6e3ee3b46c664ebf953a97268e006585/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=krPhbXcIK04LqFkPaRLs4E2mkZxgndbBydWepbHR-zc",
  DEMO_INDUSTRY_NEWS_FILE: "industry_news.sample.json",

  // Demo-mode fallback files (used only while DEMO_MODE === true)
  DEMO_ACTUAL_SALES_FILE: "actual_sales.sample.json",
  DEMO_SALES_TARGET_FILE: "sales_targets.sample.json",
  DEMO_MONTHLY_SUMMARY_FILE: "monthly_summary.sample.json",
  DEMO_SALE_SUMMARY_FILE: "sale_summary.sample.json",
  DEMO_NEW_CONTRACTS_FILE: "new_contracts.sample.json",
  DEMO_PRODUCT_ALIAS_FILE: "product_alias_rules.sample.json",
  DEMO_CHEMICAL_THRESHOLD_FILE: "chemical_threshold_rules.sample.json",

  REFRESH_INTERVAL: 300000, // 5 minutes, per spec
  CURRENCY: "USD",
  LOCALE: "en-US",

  // Years the Year Selector should offer. Extend this array as new years begin —
  // no other code change is required; the dashboard adapts automatically,
  // including showing a graceful empty state for years with no data yet.
  AVAILABLE_YEARS: [2026, 2027],
  DEFAULT_YEAR: 2026,

  // ============================================================
  // ACCESS PASSWORD (lightweight screen-lock, not real authentication)
  // ------------------------------------------------------------
  // Set to false to remove the lock screen entirely.
  ACCESS_ENABLED: true,

  // The password is never stored as plain text — only its SHA-256 hash is
  // kept here, so opening this file doesn't reveal the password itself.
  // TO CHANGE THE PASSWORD (admin task, no coding needed):
  //   1. Open this dashboard's URL, append this to the address bar's page
  //      and press Enter in the browser console (F12 → Console tab):
  //         crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_NEW_PASSWORD'))
  //           .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
  //   2. Copy the printed hash and paste it below, replacing ACCESS_PASSWORD_HASH.
  //   3. Commit + push config.js. New password takes effect on next page load.
  // Default password is: ntsf2026  — please change it before real use.
  ACCESS_PASSWORD_HASH: "3e3095daa47cc24ba42dd02805c0ed9d86da7dd045c65cf78dfbbfb92b51ed60",

  // Fallback hash used only when crypto.subtle is unavailable (insecure context —
  // e.g. opened via file://, or plain HTTP on a non-localhost domain). GitHub
  // Pages is always HTTPS, so production always uses the real SHA-256 above.
  // To regenerate after changing the password, run in the browser console:
  //   (function(t){let h=0;for(let i=0;i<t.length;i++)h=(Math.imul(31,h)+t.charCodeAt(i))|0;return 'fallback-'+(h>>>0).toString(16);})('YOUR_NEW_PASSWORD')
  ACCESS_PASSWORD_HASH_FALLBACK: "fallback-6506431b",

  // How long an unlocked session stays unlocked without re-entering the password.
  // Stored in sessionStorage, so it also clears automatically when the browser tab is closed.
  ACCESS_SESSION_ONLY: true,
};
