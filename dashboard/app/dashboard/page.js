'use client';

// The bare /dashboard path renders nothing itself — DashboardShell's
// navigateToPath (in the layout) owns the default-tab decision (Jobs, or
// Platform for a superadmin without an explicit org). A hardcoded redirect
// here used to send everyone straight to /dashboard/jobs before that logic
// ever got to see the bare path.
export default function DashboardRootPage() {
  return null;
}
