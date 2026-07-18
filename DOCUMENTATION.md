# NTSF Seafoods — Executive Sales Performance Dashboard
### Full Solution Documentation
Pangasius (Tra Fish) Export Company · Target Architecture: SharePoint → Power Automate → JSON API → GitHub Pages

---

## 0. How This Documentation Is Organized

| # | Section | What it covers |
|---|---|---|
| 1 | Data Structure Analysis | What was found in the sample Excel |
| 2 | Data Dictionary | Field-by-field mapping, source → target schema |
| 3 | Data Quality Assessment | Issues found + cleansing actions taken |
| 4 | Business Rules | How KPIs are defined and computed |
| 5 | KPI Definitions | Full formula reference |
| 6 | Dashboard Layout & Wireframe | Zone-by-zone screen map |
| 7 | Source Code | File list (delivered separately) |
| 8 | SharePoint Design | Lists/Libraries structure to build |
| 9 | Power Automate Design | Flow design for both APIs |
| 10 | API Specifications | Exact JSON contracts the dashboard expects |
| 11 | Deployment Guide | Going from demo mode to production |
| 12 | GitHub Pages Guide | Hosting steps |
| 13 | User Guide | How each persona uses the dashboard |
| 14 | Maintenance Guide | Ongoing operations, known limits, roadmap |

---

## 1. Data Structure Analysis

The uploaded workbook (`data.xlsx`) was used **only** for schema discovery, per your instructions — it is not wired into the delivered dashboard as a production source.

**Structure found:**
- 46 worksheets: `Data`, `Dashboard` (pivot summaries), and **44 per-customer worksheets** (one tab per customer, e.g. `FASTNET`, `WM Chile`, `NỘI ĐỊA`).
- Each customer worksheet is a **contract/shipment log**, one row per shipment line, with a 2-row header (row 1 merged/blank, row 2 = real headers).
- Columns present (names vary slightly per sheet, matched by keyword, not exact string): `Khách hàng` (Customer), `Tháng xuất` (Month), `Số hợp đồng` (Contract No.), `Khối lượng` (Qty, KGS), `Giá trị` (Value — USD on 43 sheets, **VND** on the `NỘI ĐỊA` sheet only), `ETD`, `Thị Trường` (Market), `Sale Quản Lý` (Account Owner).
- No `CustomerCode`, `Product`, `ProductGroup`, `Region`, or `TargetVersion` columns exist anywhere in the source — these are **data gaps**, handled as described in §3.
- A separate photo (`DOANH SỐ CÁ TRA 2026`) supplied earlier in this project gave the **only** target-allocation figures available: one lump-sum 2026 quota per Sale (6 executives incl. a "Nội địa" domestic bucket), totalling **$112,000,000**. No version history existed in any source — a demo revision history was seeded (see §3) purely to prove out the Target Version Control module end‑to‑end.

**Dimensions identified:** Sale, Customer, Country/Market, Month/Quarter/Year.
**Measures identified:** ShipmentQty (KGS), ShipmentRevenue (USD).
**Date fields identified:** Tháng xuất (month label), ETD (actual date).

---

## 2. Data Dictionary

### Dataset 1 — Actual Sales (`actual_sales.sample.json` in demo; `ACTUAL_SALES_API` in production)

| Target Field | Type | Source in Excel | Notes |
|---|---|---|---|
| `ShipmentId` | string | *generated* | `SHP-{year}-{seq}` — Excel has no unique row ID |
| `Year` | int | Derived from ETD / month label | Defaults to 2026 if missing |
| `Quarter` | int (1–4) | Derived from Month | `ceil(Month/3)` |
| `Month` | int (1–12) | `Tháng xuất` | Parsed from Vietnamese "Tháng N" label |
| `ShipmentDate` | date `YYYY-MM-DD` | `ETD` | Blank if not a valid date |
| `Sale` | string | `Sale Quản Lý` | Normalized casing (`HUY`→`Huy`, etc.) |
| `Customer` | string | Worksheet name / `Khách hàng` cell | Worksheet name used as canonical customer id |
| `CustomerCode` | string | *generated* | `{3-letter prefix}-{hash6}`, ASCII-safe — **recommend SharePoint assign real customer codes** |
| `Country` / `Market` | string | `Thị Trường` | Same value in both fields today (no separate Country vs Market distinction in source) |
| `Region` | string | *derived* | Rule-mapped from Market (e.g. USA/Canada → North America) — see §3 |
| `Product` / `ProductGroup` | string | *not in source* | Placeholder `"Pangasius Fillet"` / `"Seafood - Pangasius"` — **data gap, see recommendation** |
| `ContractNo` | string | `Số hợp đồng` | |
| `ShipmentQty` | float | `Khối lượng` | KGS |
| `ShipmentRevenue` | float | `Giá trị` | **USD**; `NỘI ĐỊA` sheet values converted from VND at a reference rate of **26,250 VND/USD** (mid-July 2026) — flag for Finance to confirm/replace with actual booked rate |

### Dataset 2 — Sales Targets (`sales_targets.sample.json` in demo; `SALES_TARGET_API` in production)

| Target Field | Type | Source | Notes |
|---|---|---|---|
| `TargetId` | string | *generated* | `TGT-{year}-{seq}` |
| `Year` | int | manual | 2026 |
| `Sale` | string | manual (from target image) | Must match `Sale` values in Dataset 1 exactly |
| `OriginalAllocation` | float | manual | Fixed baseline, constant across all revisions for that Sale/Year |
| `CurrentAllocation` | float | manual | Changes with each revision |
| `Version` | int | manual | 0 = Original Plan, 1, 2, … |
| `VersionLabel` | string | manual | "Original Plan" / "Revision N" |
| `EffectiveDate` | date | manual | Date the revision took effect |
| `AdjustmentReason` | string | manual | Free text |
| `UpdatedBy` | string | manual | Who approved the change |

---

## 3. Data Quality Assessment & Cleansing Actions Taken

| Issue Found | Where | Action Taken |
|---|---|---|
| Grand-total rows mixed into data rows (no contract number, but numeric totals) | All 43 export sheets | Filtered out — a real shipment row always has a `Số hợp đồng`; rows without one are dropped |
| Currency mismatch: `NỘI ĐỊA` sheet in VND, all others in USD | `NỘI ĐỊA` | Detected via the column header text (`Giá Trị (VND)`) and divided by 26,250 |
| 2 rows (GOUDA, GHOSN) had a blank `Thị Trường` cell | Export sheets | Inferred from other rows for the same customer (both → "Ai Cập") — documented, not silently guessed |
| Inconsistent Sale-name casing/spelling (`HUY`, `Huy `, `HUYÊN`) | Sale column | Normalized to a canonical 5-name set + `Nội địa` |
| No `CustomerCode` | All sheets | Generated a deterministic ASCII code per customer — **recommend replacing with real ERP/SharePoint customer IDs** |
| No `Product` / `ProductGroup` breakdown | All sheets | Placeholder single value used — **recommend adding a Product column to the SharePoint list** so Pareto/heatmap can eventually be sliced by product too |
| No target version history in source | N/A | Only one plan (Original) existed; **two demo revisions were seeded** (Tuyên +2.5M, Phong −2M) purely so the Target Version Control / Revision History / Revision Impact modules have something real to render. **Replace with actual revision records before go-live** — see §9 Target Maintenance List. |
| Duplicate/blank customer name cells (merge-down pattern in Excel) | All sheets | Handled by forward-filling the last seen customer name down each sheet |

**Data quality is otherwise good**: no duplicate contract numbers detected, no invalid dates, 765 clean shipment rows across 44 customers and 5+1 Sales.

---

## 4. Business Rules

1. **Customer → Sale is many-to-one.** Each customer belongs to exactly one Sale at a time (per worksheet/record); a customer does not appear under two Sales in the source.
2. **Target is allocated at Sale level, per Year** — not per customer, not per month. This is why:
   - Filtering by Customer/Market/Month **narrows the Actual side only**; the Target side always reflects the full-year quota for whichever Sale(s) are in scope.
   - Customer-level "gap" is therefore a **derived proxy** (even split of the Sale's Current Allocation across that Sale's active customers), not a true customer target. This is clearly labeled in the UI.
3. **Original vs Current Allocation must both always be visible** — Original never changes once set; Current reflects the latest approved revision. Completion % is calculated against both, every time.
4. **A target revision does not delete history** — every version is retained (`Version`, `EffectiveDate`, `AdjustmentReason`, `UpdatedBy`), enabling the Revision History and Revision Impact modules.
5. **Multi-year is structural, not hardcoded** — `CONFIG.AVAILABLE_YEARS` drives the Year Selector; a year with no data yet renders a graceful empty state rather than an error.
6. **No production data is ever hardcoded in the dashboard** — every number rendered traces back to one of the two JSON API responses, refreshed automatically every 5 minutes.

---

## 5. KPI Definitions

| KPI | Formula |
|---|---|
| Completion Rate (Current Plan) — **primary** | `ShipmentRevenue / CurrentAllocation × 100` |
| Completion Rate (Original Plan) — **secondary** | `ShipmentRevenue / OriginalAllocation × 100` |
| Revenue Gap | `CurrentAllocation − ShipmentRevenue` |
| Customer Gap (proxy) | `(CurrentAllocation / active customers of that Sale) − Customer Revenue` |
| Run Rate | `ShipmentRevenue / Months Elapsed` |
| Forecast Year-End Revenue | `Run Rate × 12` |
| Forecast Completion % | `Forecast Year-End Revenue / CurrentAllocation × 100` |
| Revenue Needed to Hit Target | `max(0, CurrentAllocation − ShipmentRevenue)` |
| Required Monthly Run (remaining) | `Revenue Needed / Months Remaining` |
| Avg Revenue / Customer | `Total Revenue / Distinct Customers` |
| Target Adjustment % | `(CurrentAllocation − OriginalAllocation) / OriginalAllocation × 100` |
| What-If Scenario Target | Current Plan / `Current × 1.10` / `Current × 0.90` / user-entered custom value |

Color thresholds (used on every completion %, gauge, and table cell): **Red < 80% · Amber 80–99% · Green ≥ 100%.**

---

## 6. Dashboard Layout & Wireframe

```
┌───────────────────────────────────────────────────────────────────────────┐
│ HEADER  Logo/Title | Refresh status + 🔄 + 🌙 dark-mode toggle            │
│         ⚠ Error banner (only shown on fetch failure)                      │
│         [2026] [2027]  Year Selector          <n> shipments matched       │
│         Sale▾ Customer▾ Market▾ Region▾ ProductGroup▾ Quarter▾ Month▾ ✕⬇⬇ │
├───────────────────────────────────────────────────────────────────────────┤
│ ℹ Data-source / architecture note banner                                  │
├───────────────────────────────────────────────────────────────────────────┤
│ 12 Executive KPI Cards (responsive 2 / 3 / 6 columns)                     │
├───────────────────────────────────────────────────────────────────────────┤
│ Gauge (Completion, Current Plan) │ Forecast Module │ What-If Scenario     │
├───────────────────────────────────────────────────────────────────────────┤
│ Sales Ranking bar          │ Target vs Actual (Original/Current/Actual)  │
│ Sales Ranking table (sortable, color-coded)                              │
├───────────────────────────────────────────────────────────────────────────┤
│ Target Maintenance table   │ Target Change Trend (line, per Sale)        │
│ Target Revision Impact — company-wide 4 cards                            │
│ Target Revision History table (filter: Sale / Date range)                │
├───────────────────────────────────────────────────────────────────────────┤
│ Top 20 Customers (h-bar)   │ Customer Gap Analysis (ranked list)         │
├───────────────────────────────────────────────────────────────────────────┤
│ Market doughnut            │ Market detail table (Market/Region/%)      │
├───────────────────────────────────────────────────────────────────────────┤
│ Pareto (80/20)              │ Monthly Trend (bars + cumulative + pace)   │
├───────────────────────────────────────────────────────────────────────────┤
│ Sale × Customer Heatmap (top 15 customers)                                │
├───────────────────────────────────────────────────────────────────────────┤
│ Executive Insight Engine — auto-generated narrative cards                 │
├───────────────────────────────────────────────────────────────────────────┤
│ Detail Table — search, sortable sticky header, pagination, CSV/Excel      │
└───────────────────────────────────────────────────────────────────────────┘
```

Responsive breakpoints: 1-col stack on mobile, 2-col on tablet/laptop, up to 6-col KPI row and wide charts on TV/meeting-room displays. Dark mode is a single toggle (`data-theme="dark"` on `<html>`), re-themes cards, tables, filters, and chart grid lines.

---

## 7. Source Code — Files Delivered

| File | Purpose |
|---|---|
| `index.html` | Single-file dashboard shell + all CSS + all UI logic (`app.js` inlined) |
| `config.js` | **The only file you edit to go live** — API URLs, refresh interval, currency, available years |
| `data-service.js` | Data access layer — fetch, validate, normalize, version-resolve, change-detect, auto-refresh |
| `actual_sales.sample.json` | Demo-mode sample for Dataset 1 (765 records, generated from your Excel) |
| `sales_targets.sample.json` | Demo-mode sample for Dataset 2 (8 version rows across 6 Sales, incl. 2 demo revisions) |

All four non-HTML files must sit **next to** `index.html` (same folder) — the dashboard is not truly "single file" once real API/version-history/export-Excel features are included, per your own architecture requirement of `index.html` + `config.js` as an acceptable structure.

---

## 8. SharePoint Design

Recommended **SharePoint site**: `NTSF-Sales-Performance` (Team or Communication site).

**List 1 — `ActualSales`** (or keep as an Excel table in a document library if preferred — Power Automate can read either):
| Column | Type |
|---|---|
| ShipmentId | Single line text (or auto Title) |
| Year, Quarter, Month | Number |
| ShipmentDate | Date |
| Sale | Choice (keep in sync with `TargetPlan.Sale`) |
| Customer, CustomerCode | Single line text |
| Country, Region, Market | Choice / Single line text |
| Product, ProductGroup | Choice — **new columns to add**, not present in current Excel |
| ContractNo | Single line text |
| ShipmentQty, ShipmentRevenue | Number (2 decimals) |

**List 2 — `TargetPlan`** (this is what makes version control real):
| Column | Type |
|---|---|
| TargetId | Auto |
| Year | Number |
| Sale | Choice |
| OriginalAllocation | Number |
| CurrentAllocation | Number |
| Version | Number |
| VersionLabel | Single line text |
| EffectiveDate | Date |
| AdjustmentReason | Multi-line text |
| UpdatedBy | Person field |

**Row-level versioning approach:** every revision is a **new row** (never edit `OriginalAllocation` of an existing row). This is exactly what `data-service.js` expects — it groups by `Sale+Year`, sorts by `Version`/`EffectiveDate`, and treats the latest row's `CurrentAllocation` as current.

**Security:** restrict `TargetPlan` write access to Sales Director + Commercial Director (Edit permission group); everyone else Read-only. `ActualSales` should be written only by the system account used by the Power Automate flow that imports shipment data (e.g., from your ERP/export system), not manually edited.

---

## 9. Power Automate Design

Two flows, each triggered by **"When an HTTP request is received"** (this gives you the JSON API URL to paste into `config.js`):

**Flow A — `GetActualSales`**
1. Trigger: HTTP Request (GET, no body required)
2. Action: `Get items` from SharePoint list `ActualSales` (or `List rows` if source is Excel in a library) — use pagination (`Top Count` + `Skip`) in a `Do until` loop if you expect >5,000 rows, to avoid the 5,000-item list view threshold
3. Action: `Select` — map SharePoint columns to the exact JSON field names in §10 (case-sensitive — the dashboard expects `ShipmentRevenue`, not `Shipment_Revenue`)
4. Action: `Response` — 200, `Content-Type: application/json`, body = array from step 3

**Flow B — `GetSalesTargets`** — identical pattern against the `TargetPlan` list.

**Flow C — `SubmitTargetRevision` (recommended, optional):** a Power Automate flow triggered from a Power Apps form or a simple SharePoint list "New item" form, so the Sales Director can submit a new revision (new row in `TargetPlan`) without touching Excel or code — this operationalizes the "Target Maintenance Screen" as a real write path later.

**Refresh cadence:** SharePoint list reads are live on every HTTP call, so no separate scheduled sync is required — the dashboard's own 5-minute polling is what determines effective data freshness.

---

## 10. API Specifications

### `GET {ACTUAL_SALES_API}`
Returns a JSON **array** (or `{ "value": [...] }`, both accepted) of objects:
```json
[
  {
    "ShipmentId": "SHP-2026-00001",
    "Year": 2026, "Quarter": 1, "Month": 1,
    "ShipmentDate": "2026-01-14",
    "Sale": "Tuyên",
    "Customer": "Đường Long", "CustomerCode": "DUO-A78953",
    "Country": "China", "Region": "Asia", "Market": "China",
    "Product": "Pangasius Fillet", "ProductGroup": "Seafood - Pangasius",
    "ContractNo": "NTSF-CTF 26002 - 26003 (CTF 002)",
    "ShipmentQty": 25338.0, "ShipmentRevenue": 47888.82
  }
]
```

### `GET {SALES_TARGET_API}`
```json
[
  {
    "TargetId": "TGT-2026-001", "Year": 2026, "Sale": "Tuyên",
    "OriginalAllocation": 34000000.0, "CurrentAllocation": 34000000.0,
    "Version": 0, "VersionLabel": "Original Plan",
    "EffectiveDate": "2026-01-01",
    "AdjustmentReason": "Kế hoạch doanh số đầu năm 2026",
    "UpdatedBy": "Ban Giám Đốc Kinh Doanh"
  },
  {
    "TargetId": "TGT-2026-101", "Year": 2026, "Sale": "Tuyên",
    "OriginalAllocation": 34000000.0, "CurrentAllocation": 36500000.0,
    "Version": 1, "VersionLabel": "Revision 1",
    "EffectiveDate": "2026-07-01",
    "AdjustmentReason": "Điều chỉnh tăng do nhu cầu thị trường Mỹ & EU tăng mạnh",
    "UpdatedBy": "Giám Đốc Kinh Doanh"
  }
]
```

**Contract rules the dashboard relies on:**
- Field names are case-sensitive and must match exactly.
- Missing/blank fields are handled gracefully (defaults applied — see `data-service.js` `safeStr/safeInt/safeFloat/safeDate`), so partial data will not crash the dashboard, but will show as "Không xác định" / 0.
- `ShipmentDate`/`EffectiveDate` must be `YYYY-MM-DD` (or start with it); anything else is treated as blank.
- CORS: the endpoint must return `Access-Control-Allow-Origin` permitting your GitHub Pages domain (Power Automate HTTP-trigger responses allow this to be set via the `Response` action headers).

---

## 11. Deployment Guide (Demo → Production)

1. Confirm `DEMO_MODE: true` currently works for you locally/on GitHub Pages (see §12).
2. Build SharePoint lists per §8; import your real `ActualSales` history and enter the **real** `TargetPlan` rows (replace the 2 demo revisions!).
3. Build Flow A and Flow B per §9. Test each with a browser — hitting the URL directly should return the JSON array shape in §10.
4. Open `config.js`, set:
   ```js
   DEMO_MODE: false,
   ACTUAL_SALES_API: "<Flow A URL>",
   SALES_TARGET_API: "<Flow B URL>",
   ```
5. Commit + push. GitHub Pages redeploys automatically (usually <1 minute).
6. Hard-refresh the live URL and confirm the refresh-status badge shows "LIVE API" data and a current timestamp.
7. Leave the two sample JSON files in the repo (harmless, unused once `DEMO_MODE` is false) or delete them — your choice.

---

## 12. GitHub Pages Guide

1. Create a new GitHub repository (e.g. `ntsf-sales-dashboard`), public or private (private requires GitHub Pages on a paid plan).
2. Upload `index.html`, `config.js`, `data-service.js`, and (for demo mode) the two sample `.json` files to the repo root.
3. Repo → **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / folder `/ (root)` → Save.
4. Your dashboard is live at `https://<your-org>.github.io/ntsf-sales-dashboard/`.
5. Every future `git push` to `main` auto-redeploys — no build step needed since this is plain HTML/JS.
6. **Custom domain (optional):** add a `CNAME` file with your domain, configure a DNS `CNAME` record pointing to `<your-org>.github.io`.

---

## 13. User Guide

- **Year Selector** (top): switch between 2026/2027 (and any future year added to `config.js` → `AVAILABLE_YEARS`) — everything on the page recalculates instantly.
- **Filters**: click any of the Sale/Customer/Market/Region/Product Group pills to open a searchable checklist; check as many as you like. Quarter/Month are single-select. **✕ Xoá tất cả bộ lọc** resets everything.
- **What-If panel**: click a scenario button (or type a custom target) to instantly see simulated Completion %/Gap/Forecast — this never changes real data, it's a client-side simulation only.
- **Detail Table**: type in the search box to filter by Sale/Customer/Country/Contract; click any column header to sort; use the CSV/Excel buttons top-right to export exactly what's currently filtered.
- **Dark mode**: 🌙 icon top-right, toggles instantly, persists only for the current browser session.
- **Target Maintenance / Revision History**: read-only in this version — see §9 Flow C for how to wire up a real submission form later.
- If you ever see a red error banner, it means the dashboard could not reach its data source — see the message text for the specific cause (usually either DEMO_MODE + opened via double-click instead of a server, or a live API/CORS issue).

---

## 14. Maintenance Guide

**Routine:**
- No routine maintenance is required — data refreshes itself every 5 minutes from the live API once in production.
- To change the refresh interval, edit `CONFIG.REFRESH_INTERVAL` (milliseconds) in `config.js`.
- To add a new year, add it to `CONFIG.AVAILABLE_YEARS` — no other code change needed.

**Known limitations / recommended next iterations:**
1. `Product`/`ProductGroup` are placeholders — add a real column in SharePoint and the filters/heatmap will automatically pick up real values (no code change required, since option lists are derived dynamically from the data).
2. Customer-level gap analysis is a proxy (even split of Sale target) because no customer-level target exists yet — if/when SharePoint gains a customer-level allocation, this can be swapped for a true target-vs-actual per customer.
3. Target Maintenance / Revision History tables are **read-only** in the dashboard; Flow C (§9) is the recommended path to make target revisions submittable without editing SharePoint directly.
4. `CustomerCode` is a generated hash, not a real ERP code — replace once available.
5. For very large datasets (10,000+ rows), the detail table already paginates client-side (25 rows/page) which keeps rendering fast; if the Actual Sales list grows into the tens of thousands, consider having Flow A pre-filter to the last 2 fiscal years server-side rather than returning full history on every call.
6. This dashboard is deliberately Chart.js + vanilla JS (per your stack requirement) so it can be migrated to Power BI later by pointing Power BI's own connector at the same two SharePoint lists — the KPI formulas in §5 translate directly into DAX measures.

---
*Generated as part of the NTSF Seafoods Executive Sales Performance Dashboard project. All figures in the shipped demo data are derived from the sample Excel provided for schema discovery and are not production numbers.*
