# Lead Checker — Canada MedLaser

A **daily lead count checker** that verifies whether leads are flowing correctly from their original sources into GHL and then into Zenoti.

**This app is read-only.** It imports or pulls counts from Website Leads, Meta Ads, GHL, and Zenoti — then compares them to find where the flow breaks. It does not push data to any external platform, does not replace GHL, Zenoti, Meta, WordPress, or Gravity Forms, and does not perform any CRM writeback.

---

## Daily Audit Flow

```
Website Leads + Meta Leads
        ↓
GHL Lead Inquiry Pipeline
        ↓
    Zenoti Leads
```

The checker answers these questions every day:

1. How many leads came from Website?
2. How many leads came from Meta Ads?
3. How many total source leads were expected?
4. How many leads appeared in the GHL Lead Inquiry Pipeline?
5. How many leads appeared in Zenoti?
6. Did all source leads reach GHL? (Source → GHL check)
7. Did all GHL leads reach Zenoti? (GHL → Zenoti check)
8. If there is a mismatch — where is the gap?

---

## Core Formulas

| Formula | Calculation |
|---|---|
| Total Source Leads | Website Leads + Meta Leads |
| Source vs GHL Diff | Total Source Leads − GHL Leads |
| GHL vs Zenoti Diff | GHL Leads − Zenoti Leads |
| Source → GHL Match Rate | GHL Leads ÷ Total Source Leads × 100 |
| GHL → Zenoti Match Rate | Zenoti Leads ÷ GHL Leads × 100 |

If denominator is 0, match rate shows N/A.

---

## Checker Statuses

### Check Status

| Status | Meaning |
|---|---|
| Passed | All counts match: Source = GHL = Zenoti |
| Source → GHL Issue | Source count differs from GHL |
| GHL → Zenoti Issue | GHL count differs from Zenoti |
| Both Issues | Source ≠ GHL and GHL ≠ Zenoti |
| Needs Mapping | Clinic, service, or form source is unmapped |
| Needs Review | Date is invalid, ambiguous, or missing |

### Discrepancy Location

| Value | Meaning |
|---|---|
| No Discrepancy | Total Source = GHL and GHL = Zenoti |
| Source → GHL Gap | Total Source ≠ GHL (GHL = Zenoti) |
| GHL → Zenoti Gap | GHL ≠ Zenoti (Total Source = GHL) |
| Both Gaps | Both comparisons mismatch |
| Needs Mapping | Cannot compute — unmapped data |
| Needs Review | Cannot compute — date issues |

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure database
cp .env.example .env
# Set DATABASE_URL to your PostgreSQL connection string

# 3. Apply schema and generate Prisma client
npx prisma db push
npx prisma generate

# 4. (Optional) seed sample data
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts

# 5. Start dev server
npm run dev
```

---

## Dashboard Pages

| Page | Purpose |
|---|---|
| **Source Comparison** ⭐ | Primary view. Date-by-date comparison of all 4 sources with diff and match rate columns. Default: last 30 days. |
| Overview | Summary KPIs + trend charts for the selected date range |
| Website Leads | Form-level breakdown — which forms are submitting leads and how many reached GHL/Zenoti |
| Meta Leads | Campaign-level Meta Ads lead result counts |
| Clinic Breakdown | Per-clinic comparison across all 4 sources |
| Service Breakdown | Per-service comparison across all 4 sources |
| Imports | Upload CSVs from any of the 4 sources |
| Data Pulls | Status of CSV imports and optional API reads (read-only) |
| Mapping Settings | Normalize clinic names, service names, and form sources |

---

## Data Sources

### Website Leads
Counted as submitted website form entries. Imported via:
- Gravity Forms CSV export
- Gravity Forms API read (optional)

Breakdown by: form source, form name, clinic, service, date.

### Meta Leads
Counted as Meta Ads Manager lead-type result actions only.

**Lead result types counted:** Lead, Leads, On-Facebook Leads, Website Leads, Messaging Leads, Conversion Leads, Instant Form Leads.

**Not counted:** link clicks, impressions, reach, engagement, page likes, purchases, add to cart, view content.

Imported via Meta Ads Manager aggregate CSV export or Meta Ads Insights API (optional).

### GHL Lead Inquiry Pipeline
Counted as contacts or opportunities in the **Lead Inquiry pipeline only**.

GHL is **read-only**. No contacts, opportunities, or pipeline stages are created or modified.

Imported via GHL pipeline export CSV or GHL API read (optional).

### Zenoti Leads
Counted as unique lead/opportunity records. Appointment-only records are excluded from counts.

**Zenoti Opportunities CSV column mapping:**

| CSV Column | Field | Notes |
|---|---|---|
| NO | Unique lead ID | Used for deduplication. Required. |
| GUEST | Lead name | — |
| GUEST CODE | Guest identifier | Fallback dedup key |
| NAME | Service / lead type | — |
| CENTER | Clinic location | — |
| MOBILE | Phone number | — |
| SALES STAGE | Status | — |
| CREATION DATE | Lead created date | Primary date field |

**Deduplication fallback** (if NO is missing):
1. GUEST CODE + CREATION DATE
2. MOBILE + CREATION DATE + CENTER

Zenoti API read is optional. CSV export is the preferred method.

---

## CSV Format Reference

### Website Leads CSV
Required: `Form Name`, `Date`  
Optional: `Full Name`, `Email`, `Phone`, `Service`, `Clinic / Location`, `Form ID`, `Page URL`, `UTM Source`, `UTM Campaign`

### Meta Ads CSV
Required: `Day` (or `Date`), `Results`  
Recommended: `Campaign Name`, `Ad Set Name`, `Result Type`, `Spend`, `Cost per Result`, `Impressions`, `Campaign ID`

### GHL Pipeline CSV
Required: `Created` (or `Contact Created Date`), one of `Contact Id` / `Opportunity Id`  
Recommended: `First Name`, `Last Name`, `Email`, `Phone`, `Location`, `Service`, `Pipeline Name`, `Stage Name`

### Zenoti Opportunities CSV
Required: `NO`, `CREATION DATE`  
Recommended: `GUEST`, `GUEST CODE`, `NAME`, `CENTER`, `MOBILE`, `SALES STAGE`

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/source-comparison` | GET | Date-grouped comparison table (primary) |
| `/api/overview` | GET | KPI summary + timeline |
| `/api/website-leads` | GET | Website form breakdown |
| `/api/meta-leads` | GET | Meta aggregate rows + campaign totals |
| `/api/clinic-breakdown` | GET | Per-clinic comparison |
| `/api/service-breakdown` | GET | Per-service comparison |
| `/api/import` | POST/GET | Upload CSV / import history |
| `/api/filters` | GET | Available clinic/service filter values |
| `/api/mappings` | GET/POST | Manage normalization mappings |
| `/api/export` | GET | Download CSV export |
| `/api/reconcile` | POST | Re-apply normalizations + detect duplicates |

---

## How to Check Leads

### Check yesterday's leads
Go to **Source Comparison** → set date range to yesterday (or use "Yesterday" preset).  
Review the single row: Website + Meta → GHL → Zenoti, with diff and match rate.

### Check the last 7 days
Go to **Source Comparison** → select "Last 7 days" preset → grouping: Daily.  
Each row is one day. Red diff values indicate a gap.

### Check the last 30 days
Go to **Source Comparison** → select "Last 30 days" preset.  
Sort by `Src↔GHL` descending to see the worst days first.

### Verify Website + Meta vs GHL
Look at the `Src↔GHL` column. If positive, source leads > GHL leads (leads are not making it into GHL). If negative, extra leads appear in GHL.

### Verify GHL vs Zenoti
Look at the `GHL↔Zenoti` column. If positive, GHL leads > Zenoti (leads are not making it into Zenoti). If negative, extra leads appear in Zenoti.

### Drill down by clinic
Click any row in Source Comparison to expand a per-clinic breakdown for that period.

---

## Language Notes

This app uses:
- **Import** — uploading a CSV file
- **Pull** — fetching data via API read
- **Check** — comparing counts
- **Audit** — reviewing discrepancies

This app does **not**:
- Sync data to GHL, Zenoti, Meta, or Gravity Forms
- Perform CRM writeback
- Replicate or replace any source system
- Push, update, or move records in any external platform
