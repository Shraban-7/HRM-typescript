# Nexus HRM — Enterprise Multi-Branch Human Resource Management

Full-stack TypeScript enterprise HRM workspace built with **React 19**, **Tailwind CSS v4**, **Express 5**, and **SQLite (`node:sqlite`)**.

## Core Capabilities

- **Enterprise Security & Governance**: `scrypt` password hashing, DB-tracked account lockout, RFC 6238 TOTP MFA with 8 single-use recovery codes, uniform server-side RBAC matrix, and SHA-256 tamper-evident hash-chained audit logging.
- **Multi-Branch Enterprise Topology**: Single-company workspace (`Nexus Technologies Inc.`) with regional office branches (Austin HQ, New York East, London EMEA, Singapore APAC), cost centers, state tax rates, and regional holiday calendars.
- **Statutory Payroll & Benefits Engine**: Multi-stage payroll governance (`Draft → Simulated → Approved → Finalized/Locked`), progressive federal tax brackets, state tax, FICA Social Security cap & Additional Medicare, pre-tax 401(k)/Section 125 deductions, mid-period proration, overtime, variance anomaly detection, printable payslips, Bank ACH & Statutory CSV exports, and COBRA administration.
- **Core HR, Time & Talent**: Employee directory, interactive Org Chart, onboarding/exit clearances, self-service clock-in/out & shift builder, workflow-routed leave requests, Recruitment ATS with Public Career Portal & one-click Hire-to-Employee, and Performance Calibration & OKRs.
- **Workplace Operations & Executive Intelligence**: Workflow-routed expenses, IT hardware asset custody, digital policy sign-offs, payroll-linked loans, HR Help Desk, Executive Analytics with CSV export, and Custom Approval Workflow Builder.
- **Public REST API v1 & Outbound Webhooks**: Versioned `/api/v1/*` endpoints with OpenAPI 3.1 schema, scoped Bearer API keys, biometric terminal sync (`POST /api/v1/integrations/biometric-sync`), and HMAC-SHA256 signed outbound webhooks.

## Scripts

- `npm run dev` — Start Express + Vite full-stack server on port 3000
- `npm run build` — Compile production frontend bundle
- `npm run lint` — TypeScript static check (`tsc --noEmit`)
- `npm test` — Run pure domain unit test suite (`node:test`)

## Deploying to Vercel with Supabase Login

Vercel routes all `/api/*` traffic to the serverless Express handler in `api/index.ts` via `vercel.json`.

Configure these Environment Variables in your Vercel project settings to enable Supabase Authentication:

- `VITE_SUPABASE_URL` — Your Supabase Project URL (`https://<project-ref>.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` — Your Supabase public `anon` key
- `SUPABASE_URL` — Same Supabase Project URL (used by the server to verify Supabase JWTs)
- `SUPABASE_ANON_KEY` — Same Supabase `anon` key (used by the server to verify Supabase JWTs)
- `HRM_ADMIN_EMAIL` *(optional)* — Email address automatically granted `super_admin` when signing in via Supabase
- `HRM_SESSION_SECRET` *(optional)* — Random 32+ byte secret for signing stateless session tokens across serverless instances