import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_TITLE = 'Nexus HRM — Enterprise People, Payroll & Compliance Platform';
const SITE_DESCRIPTION =
  'Industry-standard multi-branch enterprise Human Resource Management platform featuring statutory payroll, uniform RBAC and TOTP MFA, tamper-evident audit logging, custom approval workflows, executive analytics, and public REST API with signed webhooks.';

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#FAFAFB] text-[#111827] dark:bg-[#0B0F17] dark:text-[#F8FAFC] antialiased selection:bg-blue-600/15 selection:text-blue-700 dark:selection:text-blue-300">
        {children}
      </body>
    </html>
  );
}
