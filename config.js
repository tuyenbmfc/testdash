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
  DEMO_MODE: true,

  // Production endpoints (Power Automate "HTTP request" trigger URLs).
  // Placeholders below are intentionally non-functional until you replace them.
  ACTUAL_SALES_API: "POWER_AUTOMATE_ACTUAL_SALES_ENDPOINT",
  SALES_TARGET_API: "POWER_AUTOMATE_TARGET_ENDPOINT",

  // Demo-mode fallback files (used only while DEMO_MODE === true)
  DEMO_ACTUAL_SALES_FILE: "actual_sales.sample.json",
  DEMO_SALES_TARGET_FILE: "sales_targets.sample.json",

  REFRESH_INTERVAL: 300000, // 5 minutes, per spec
  CURRENCY: "USD",
  LOCALE: "en-US",

  // Years the Year Selector should offer. Extend this array as new years begin —
  // no other code change is required; the dashboard adapts automatically,
  // including showing a graceful empty state for years with no data yet.
  AVAILABLE_YEARS: [2026, 2027],
  DEFAULT_YEAR: 2026,
};
