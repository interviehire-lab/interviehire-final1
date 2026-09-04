'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, ErrorBanner, SubmitButton } from '../AuthShell';
import { apiSignup, apiMe, isAuthed } from '../../../src/auth-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthed()) return;
    let cancelled = false;
    apiMe()
      .then((me) => {
        if (!cancelled) {
          router.replace(me?.onboarding_required ? '/onboarding' : '/dashboard');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [router]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    if (form.name.trim().length < 2) return 'Please enter your full name.';
    if (!EMAIL_RE.test(form.email.trim())) return 'Please enter a valid email address.';
    if (form.password.length < 6) return 'Password must be at least 6 characters.';
    if (form.password !== form.confirm) return 'Passwords do not match.';
    return '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    setLoading(true);
    try {
      const { onboardingRequired } = await apiSignup({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      router.replace(onboardingRequired ? '/onboarding' : '/dashboard');
    } catch (err) {
      setError((err && err.message) || 'Could not create your account.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Set up a recruiter account to start authoring interview blueprints."
      footer={<>Already have an account? <a className="auth-link" href="/login">Sign in</a></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <ErrorBanner message={error} />

        <div className="auth-field">
          <label className="auth-label" htmlFor="name">Full name</label>
          <input id="name" className="auth-input" type="text" autoComplete="name"
            placeholder="Ada Lovelace" value={form.name} onChange={set('name')} autoFocus required />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="email">Email</label>
          <input id="email" className="auth-input" type="email" autoComplete="email"
            placeholder="ada@company.com" value={form.email} onChange={set('email')} required />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">Password</label>
          <input id="password" className="auth-input" type="password" autoComplete="new-password"
            placeholder="At least 6 characters" value={form.password} onChange={set('password')} required />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="confirm">Confirm password</label>
          <input id="confirm" className="auth-input" type="password" autoComplete="new-password"
            placeholder="Re-enter password" value={form.confirm} onChange={set('confirm')} required />
        </div>

        <SubmitButton loading={loading} idle="Create account" busy="Creating…" />
      </form>
    </AuthShell>
  );
}
