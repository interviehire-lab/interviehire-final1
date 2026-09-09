'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { isAuthed } from '../../src/auth-client';

const LandingAppDynamic = dynamic(
  () => import('../../src/landing/pages').then(mod => mod.LandingApp),
  { ssr: false }
);

export default function LandingPage() {
  const router = useRouter();
  // Optimistic check only — the local flag auth-client.ts sets on login/signup
  // (the real session is an httpOnly cookie, invisible to JS). A signed-out
  // visitor never sees this fire. /dashboard's own guard (DashboardShell.js)
  // does the real verification against the backend and bounces back to
  // /login if the cookie's actually expired/invalid, so this redirect never
  // needs to be authoritative on its own — it's just a shortcut past the
  // marketing page for someone who's already signed in.
  useEffect(() => {
    if (isAuthed()) router.replace('/dashboard');
  }, [router]);

  return <LandingAppDynamic />;
}
