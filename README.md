# Leads Checker — Canada MedLaser

A production-ready multi-source lead reconciliation dashboard.

## What It Does

Cross-checks lead counts from WordPress forms, Meta Ads, GoHighLevel (GHL), and Zenoti CRM.
Identifies missing leads, duplicates, and mismatches by clinic location, service, and campaign.

## Tech Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Prisma** + **PostgreSQL**
- **Recharts** for charts
- **PapaParse** for CSV parsing

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Database

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string:

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/leads_checker"
```

### 3. Create the Database Schema

```bash
npm run db:push
```

or with migrations:

```bash
npm run db:migrate
```

### 4. Seed the Database

```bash
npm run db:seed
```

This creates:
- Clinic, service, and source mappings
- ~400 sample leads across WordPress, Meta, GHL, and Zenoti
- 10 WordPress form scenarios with intentional discrepancies
- Runs the initial reconciliation engine

### 5. Start the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/dashboard/overview`.

---

## Dashboard Pages

| Page | URL | Description |
|------|-----|-------------|
| Overview | `/dashboard/overview` | KPI summary + timeline charts |
| Source Comparison | `/dashboard/source-comparison` | Side-by-side lead counts by clinic × service |
| Clinic Breakdown | `/dashboard/clinic-breakdown` | Leads per clinic location |
| Service Breakdown | `/dashboard/service-breakdown` | Leads per service |
| Lead Reconciliation | `/dashboard/reconciliation` | Individual lead match scores and statuses |
| WordPress Forms | `/dashboard/wordpress-forms` | Per-form lead metrics, reconciliation, and detail view |
| Imports | `/dashboard/imports` | CSV upload for each source |
| Mapping Settings | `/dashboard/settings` | Manage clinic, service, and source name normalizations |

---

## Uploading CSVs

1. Go to **Imports**
2. Select the data source (WordPress, Meta, GHL, or Zenoti)
3. Upload your CSV file
4. After upload, click **Run Reconciliation** in the top bar

### Supported CSV Headers

**WordPress:**
`Form Name`, `Date`, `Name`, `Email`, `Phone`, `Service`, `Location`, `Clinic`, `Page URL`, `UTM Source`, `UTM Campaign`, `Submission ID`

**Meta:**
`created_time`, `full_name`, `email`, `phone_number`, `campaign_name`, `form_name`, `clinic_location`, `service`

**GHL:**
`Contact Id`, `Opportunity Id`, `Created`, `First Name`, `Last Name`, `Email`, `Phone`, `Location`, `Service`, `Stage`

**Zenoti:**
`Guest Id`, `Appointment Id`, `Created Date`, `Guest Name`, `Email`, `Phone`, `Center`, `Service`, `Status`

---

## Reconciliation Engine

Run manually:

```bash
npm run reconcile
```

Or click **Run Reconciliation** in the top bar of any dashboard page.

### How It Works

1. Normalizes all leads (phone → last 10 digits, email → lowercase, names → lowercase no-punct)
2. Compares each WordPress/Meta lead to all GHL leads using a confidence score
3. Compares each GHL lead to all Zenoti leads
4. Stores match results in the `LeadMatch` table
5. Detects duplicates within the same source (same phone+email within 7 days)
6. Rebuilds `WordPressFormSummary` for the WordPress Forms page

### Match Confidence Score (0–100)

| Signal | Points |
|--------|--------|
| Phone match | +40 |
| Email match | +30 |
| Name match | +15 |
| Same clinic | +10 |
| Same service | +10 |
| Created within 48 hours | +10 |
| Conflicting clinic | -20 |
| Conflicting service | -20 |

**Threshold:** Score ≥ 70 → Matched, 40–69 → Possible Match, < 40 → Unmatched

---

## Mapping Settings

The dashboard normalizes raw values from CSVs to canonical names:

- **Clinic**: "CML Midtown" → "Toronto Midtown"
- **Service**: "LHR" → "Laser Hair Removal"
- **Source**: "FB Instant Form" → "Meta"

Built-in keyword rules handle common variations. Add custom overrides in **Mapping Settings**.

---

## WordPress Form Status Logic

| Status | Condition |
|--------|-----------|
| Healthy | Reconciliation rate ≥ 95% |
| Minor Discrepancy | Rate 85–94.99% |
| Major Discrepancy | Rate < 85% |
| Missing GHL | One or more unique leads not in GHL |
| Missing Zenoti | One or more GHL leads not in Zenoti |
| Duplicate Issue | Duplicate rate > 10% |
| Needs Review | Missing required fields |

---

## Seed Data Scenarios

The seed script intentionally creates these scenarios for testing:

1. **Laser Hair Removal Form** — Perfect GHL + Zenoti matching
2. **Morpheus8 Form** — Leads missing in GHL (8 of 18)
3. **Hair Restoration Form** — GHL matched but missing in Zenoti
4. **Microneedling Form** — Duplicate submissions (~30%)
5. **Salmon DNA Form** — Inconsistent clinic naming
6. **Express Facial Form** — Inconsistent service naming
7. **General Contact Form** — Missing UTM values
8. **Free Consultation Form** — High volume, low reconciliation (~30%)
9. **Landing Page Form** — Mixed UTM data
10. **Clinic Inquiry Form** — Baseline clean data

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/overview` | KPI cards + timeline data |
| GET | `/api/source-comparison` | Comparison table data |
| GET | `/api/clinic-breakdown` | Clinic-level aggregates |
| GET | `/api/service-breakdown` | Service-level aggregates |
| GET | `/api/reconciliation` | Paginated lead records |
| GET | `/api/wordpress-forms` | WordPress form summaries |
| GET | `/api/wordpress-forms/[formName]` | Individual form leads |
| POST | `/api/reconcile` | Run reconciliation engine |
| POST | `/api/import` | Upload CSV |
| GET | `/api/import/history` | Import batch history |
| GET | `/api/mappings` | All mapping tables |
| POST | `/api/mappings` | Add/update mapping |
| DELETE | `/api/mappings/[id]` | Delete mapping |
| GET | `/api/export?type=...` | CSV export |
| GET | `/api/filters` | Available clinic/service filter values |

---

## Export Types

Append `?type=X` to `/api/export`:

- `source-comparison` — Comparison table
- `unmatched` — Leads not matched in GHL
- `missing-ghl` — Source leads missing from GHL
- `duplicates` — Duplicate lead records
- `wordpress-forms` — WordPress form summary
