# Nexus HRM — Enterprise Multi-Branch Human Resource Management

Full-stack TypeScript enterprise HRM workspace built with **Next.js (App Router)**, **React 19**, **Tailwind CSS v4**, and **Supabase PostgreSQL** (with automatic local SQLite fallback for offline development).

## Core Capabilities

- **Enterprise Security & Governance**: Supabase Auth integration, `scrypt` password hashing, DB-tracked account lockout, RFC 6238 TOTP MFA with 8 single-use recovery codes, uniform server-side RBAC matrix, and SHA-256 tamper-evident hash-chained audit logging.
- **Multi-Branch Enterprise Topology**: Single-company workspace (`Nexus Technologies Inc.`) with regional office branches (Austin HQ, New York East, London EMEA, Singapore APAC), cost centers, state tax rates, and regional holiday calendars.
- **Statutory Payroll & Benefits Engine**: Multi-stage payroll governance (`Draft → Simulated → Approved → Finalized/Locked`), progressive federal tax brackets, state tax, FICA Social Security cap & Additional Medicare, pre-tax 401(k)/Section 125 deductions, mid-period proration, overtime, variance anomaly detection, printable payslips, Bank ACH & Statutory CSV exports, and COBRA administration.
- **Core HR, Time & Talent**: Employee directory, interactive Org Chart, onboarding/exit clearances, self-service clock-in/out & shift builder, workflow-routed leave requests, Recruitment ATS with Public Career Portal & one-click Hire-to-Employee, and Performance Calibration & OKRs.
- **Workplace Operations & Executive Intelligence**: Workflow-routed expenses, IT hardware asset custody, digital policy sign-offs, payroll-linked loans, HR Help Desk, Executive Analytics with CSV export, and Custom Approval Workflow Builder.
- **Public REST API v1 & Outbound Webhooks**: Versioned `/api/v1/*` endpoints with OpenAPI 3.1 schema, scoped Bearer API keys, biometric terminal sync (`POST /api/v1/integrations/biometric-sync`), and HMAC-SHA256 signed outbound webhooks.

## Scripts

- `npm run dev` — Start Next.js development server on port 3000
- `npm run build` — Compile production Next.js build
- `npm run start` — Start Next.js production server on port 3000
- `npm run lint` — TypeScript static check (`tsc --noEmit`)
- `npm test` — Run pure domain & SQL translation unit test suite (`node:test`)

## Connecting Supabase Database & Deploying to Vercel

Nexus HRM runs natively on **Vercel** using Next.js App Router and `/src/app/api/[[...route]]/route.ts`.

Configure these Environment Variables in your Vercel project (or `.env.local`):

- `DATABASE_URL` *(or `SUPABASE_DB_URL`)* — Your Supabase PostgreSQL connection string (from **Supabase Dashboard → Connect → Transaction Pooler / Session Pooler URI**)
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase Project URL (`https://<project-ref>.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase public `anon` key
- `SUPABASE_URL` — Same Supabase Project URL (used by Next.js API routes to verify Supabase JWTs)
- `SUPABASE_ANON_KEY` — Same Supabase `anon` key
- `HRM_ADMIN_EMAIL` *(optional)* — Email address automatically granted `super_admin` when signing in via Supabase

All 35 HRM tables and initial enterprise seed data are initialized automatically on the first API request when connected to Supabase PostgreSQL. You can also inspect or run `/supabase/schema.sql` directly in the Supabase SQL Editor.