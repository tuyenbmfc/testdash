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
