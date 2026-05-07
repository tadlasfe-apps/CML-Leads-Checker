# Lead Count Audit — Canada MedLaser

A lead number discrepancy audit dashboard that compares lead counts across four sources:
**Website Leads → Meta Ads → GHL (Lead Inquiry Pipeline) → Zenoti**.

The goal is to identify *where* leads are being lost or over-counted at each handoff, not to
match individual leads end-to-end.

---

## Architecture

- **Framework:** Next.js 15 (App Router) + TypeScript
- **Database:** PostgreSQL via Prisma ORM (Supabase-compatible)
- **UI:** Tailwind CSS + shadcn/ui + Recharts
- **Date handling:** date-fns + native `Intl` for timezone conversion

---

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database (local or Supabase)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy the example env file and fill in your database URL:

```bash
cp .env.example .env
```

`.env` must contain:

```
DATABASE_URL="postgresql://user:pass@host:5432/leads_checker"
```

### 4. Set up the database

```bash
npx prisma db push        # push schema to database
npx prisma generate       # generate Prisma client
```

### 5. (Optional) Seed with sample data

```bash
npx ts-node --project tsconfig.json prisma/seed.ts
```

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to `/dashboard/overview`.

---

## Pages

| Page | Path | Description |
|------|------|-------------|
| Overview | `/dashboard/overview` | KPI cards, timeline charts, funnel bar chart |
| Source Comparison | `/dashboard/source-comparison` | Date-grouped table with click-to-drilldown by clinic |
| Website Leads | `/dashboard/website-leads` | Form-level breakdown: submissions, unique, duplicates, GHL/Zenoti counts |
| Meta Leads | `/dashboard/meta-leads` | Aggregate Meta Ads rows filtered to lead result types only |
| Clinic Breakdown | `/dashboard/clinic-breakdown` | Lead counts per clinic with discrepancy indicators |
| Service Breakdown | `/dashboard/service-breakdown` | Lead counts per service with discrepancy indicators |
| Imports | `/dashboard/imports` | Upload CSVs for any source; view import history |
| API Syncs | `/dashboard/api-syncs` | View API sync run history (future integrations) |
| Mapping Settings | `/dashboard/settings` | Manage clinic, service, form source, and form name mappings |

---

## Data Sources and CSV Formats

### Website Leads (`WEBSITE`)

Individual form submissions from website forms (Gravity Forms, WPForms, etc.).

Key fields: `Form Name`, `Date`, `Full Name`, `Email`, `Phone`, `Service`, `Clinic / Location`,
`Page URL`, `UTM Source`, `UTM Campaign`

- `websiteFormSource` is inferred from form name / page URL keywords if not explicitly present
  (e.g., "popup" → Popup, "quiz" → Website Quiz, "/lp/" → Landing Page Form)
- Duplicate detection: within 7 days, same phone/email + clinic + service + form is flagged as duplicate

### Meta Ads (`META`) — Aggregate Only

Aggregate Meta Ads Manager export. Each row is one result type per ad per day.

Key fields: `Day`, `Campaign name`, `Ad Set Name`, `Ad Name`, `Result Type / Reporting Results`,
`Results`, `Spend`, `Cost per result`, `Impressions`

- **Only rows where `Result Type` matches a lead type** (Leads, On-Facebook Leads, Website Leads,
  Messaging Leads, etc.) contribute to `metaLeadCount`.
- Rows with result types like ThruPlays, Impressions, Link Clicks get `metaLeadCount = 0`.
- Dedup key: `META_AGG|date|campaignId|adSetId|adId|resultType`

### GHL — GoHighLevel (`GHL`)

Contact or opportunity export filtered to the **Lead Inquiry pipeline only**.

Key fields: `Contact Id`, `Opportunity Id`, `Created`, `First Name`, `Last Name`, `Email`, `Phone`,
`Location`, `Service`, `Pipeline Name`, `Stage Name`

### Zenoti (`ZENOTI`)

Lead or inquiry export from Zenoti CRM. Rows are classified as appointment-based when they have
no lead/inquiry/guest creation date — only an appointment date.

Date priority: `leadCreatedDate > inquiryDate > guestCreatedDate > createdDate > appointmentDate`

- Rows with only `appointmentDate` are flagged `isAppointmentBased = true` and excluded from
  lead counts (they are not leads, they are existing clients booking services).

---

## Lead Count Formulas

```
Total Source Leads = Website Leads (unique, non-duplicate) + Meta Lead Count
Source → GHL Diff  = Total Source - GHL Leads
GHL → Zenoti Diff  = GHL Leads - Zenoti Leads (isAppointmentBased = false)

Source → GHL Match Rate  = (GHL / Total Source) × 100
GHL → Zenoti Match Rate  = (Zenoti / GHL) × 100
```

### Discrepancy Location

| Value | Meaning |
|-------|---------|
| `NONE` | All three counts match |
| `SOURCE_TO_GHL` | Source ≠ GHL, GHL = Zenoti |
| `GHL_TO_ZENOTI` | Source = GHL, GHL ≠ Zenoti |
| `BOTH` | Source ≠ GHL and GHL ≠ Zenoti |

### Audit Status

| Status | Meaning |
|--------|---------|
| `MATCHED` | All counts equal |
| `MINOR_MISMATCH` | ≤5% or ≤3 leads difference |
| `MAJOR_MISMATCH` | >5% or >3 leads difference |
| `MISSING_IN_GHL` | Source > 0, GHL = 0 |
| `EXTRA_IN_GHL` | GHL > Source |
| `MISSING_IN_ZENOTI` | GHL > 0, Zenoti = 0 |
| `EXTRA_IN_ZENOTI` | Zenoti > GHL |

---

## Mapping System

Mappings normalize raw CSV values to canonical names used in reporting.

| Type | Model | Examples |
|------|-------|---------|
| Clinic | `ClinicMapping` | "CML Midtown" → "Toronto" |
| Service | `ServiceMapping` | "LHR" → "Laser Hair Removal" |
| Website Form Source | `WebsiteFormSourceMapping` | "popup" → "Popup" |
| Website Form Name | `WebsiteFormNameMapping` | "Free Consult Form v2" → "Free Consultation Popup" |

After adding or editing mappings, trigger **Reconciliation** from the top bar to re-apply all
mappings to existing records retroactively.

---

## URL Filter Persistence

All pages persist their filters in the URL query string:

```
/dashboard/source-comparison?preset=last30&from=2025-04-08&to=2025-05-08&groupBy=daily&timezone=America/Toronto
```

Filters: `from`, `to`, `preset`, `groupBy`, `timezone`, `clinic`, `service`, `status`, `q`

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/overview` | KPIs + timeline. Params: `from`, `to`, `groupBy`, `timezone`, `clinic`, `service` |
| GET | `/api/source-comparison` | Date-grouped rows. Same params + `drilldown=true&by=clinic` |
| GET | `/api/website-leads` | Website form breakdown |
| GET | `/api/meta-leads` | Meta aggregate breakdown |
| GET | `/api/clinic-breakdown` | Per-clinic counts |
| GET | `/api/service-breakdown` | Per-service counts |
| POST | `/api/import` | Upload CSV (`multipart/form-data`: `file`, `source`) |
| GET | `/api/import` | Import history |
| GET | `/api/export` | CSV export. Param `type`: `source-comparison`, `website-leads`, `meta-leads`, `duplicates` |
| GET/POST | `/api/mappings` | Get/create mappings |
| DELETE | `/api/mappings/[id]` | Delete mapping (param `?type=clinic\|service\|websiteFormSource\|websiteFormName`) |
| POST | `/api/reconcile` | Trigger reconciliation engine |
| GET | `/api/filters` | Distinct clinic/service values for filter dropdowns |
| GET | `/api/api-syncs` | Sync run history |

---

## Database Models

- `LeadSourceRecord` — one row per individual lead (WEBSITE / GHL / ZENOTI) or per Meta aggregate row
- `ImportBatch` — metadata for each CSV upload
- `SyncRun` — API sync run history
- `IntegrationSettings` — per-source integration config (for future API integrations)
- `ClinicMapping`, `ServiceMapping`, `WebsiteFormSourceMapping`, `WebsiteFormNameMapping` — normalization tables

---

## Reconciliation Engine

`POST /api/reconcile` runs three steps:

1. **Re-normalize** — reapplies clinic, service, and form source mappings to all records
2. **Detect duplicates** — within 7-day windows per clinic × service × form (Website only)
3. **Flag appointment-based Zenoti** — marks status on records with only appointment dates

---

## Development Notes

- `date-fns-tz` is replaced by native `Intl.DateTimeFormat` for timezone conversion (no extra dep)
- Meta `metaLeadCount` is computed at parse time — rows without lead result types get `0`
- Zenoti `isAppointmentBased` is set at import time and persisted; reconciliation does not clear it
- `@@unique([sourceSystem, externalId])` prevents duplicate imports on re-upload
