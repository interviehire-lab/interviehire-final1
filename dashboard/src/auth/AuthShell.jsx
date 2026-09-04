'use client';

// ─── AuthShell — Split-Panel Sliding Auth Container ──────────────────────────
// Custom dual-slot card with real-time sliding welcome panel and state transition.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiLogin, apiSignup, apiMe, isAuthed } from '../auth-client';

// SVG Icons
const EyeOpen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeClosed = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Particle Canvas ──────────────────────────────────────────────────────────
function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = W;
      canvas.height = H;
    };
    window.addEventListener('resize', resize);

    const COUNT = 38;
    const particles = Array.from({ length: COUNT }, () => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      r:    Math.random() * 1.2 + 0.3,
      vx:   (Math.random() - 0.5) * 0.22,
      vy:   -(Math.random() * 0.30 + 0.05),
      life: Math.random(),
      maxLife: Math.random() * 0.4 + 0.4,
    }));

    let raf;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 0.002;

        if (p.y < -4 || p.life > p.maxLife) {
          p.x    = Math.random() * W;
          p.y    = H + 4;
          p.life = 0;
          p.maxLife = Math.random() * 0.4 + 0.4;
          p.vx   = (Math.random() - 0.5) * 0.22;
          p.vy   = -(Math.random() * 0.30 + 0.05);
          p.r    = Math.random() * 1.2 + 0.3;
        }

        const t = p.life / p.maxLife;
        const alpha = t < 0.2  ? t / 0.2
                    : t > 0.75 ? (1 - t) / 0.25
                    : 1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45,212,191,${alpha * 0.55})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
      aria-hidden="true"
    />
  );
}

// ── ScanLine ─────────────────────────────────────────────────────────────────
function ScanLine() {
  return <div className="auth-scanline" aria-hidden="true" />;
}

// ── AuthShell (Main Split Panel Component) ──────────────────────────────────
export function AuthShell({ initialMode = 'login', title, subtitle, footer, children }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [noTrans, setNoTrans] = useState(true);
  const hasCustomContent = Boolean(children);

  // Form States — Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Form States — Signup
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);

  // Disable sliding animations on initial paint
  useEffect(() => {
    const timer = setTimeout(() => setNoTrans(false), 50);
    return () => clearTimeout(timer);
  }, []);

  // Sync route if user uses browser back/forward buttons
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handlePopState = () => {
        const path = window.location.pathname;
        if (path === '/signup') setMode('signup');
        if (path === '/login') setMode('login');
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, []);

  // Handle auto-login if session exists
  useEffect(() => {
    // Pages such as onboarding own their session guard and render custom content
    // inside this shell. Redirecting from here as well made an org-less account
    // bounce forever between /onboarding and /dashboard.
    if (hasCustomContent || !isAuthed()) return;
    let cancelled = false;
    apiMe()
      .then((me) => {
        if (!cancelled) {
          router.replace(me?.onboarding_required ? '/onboarding' : '/dashboard');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasCustomContent, router]);

  // Toggle Mode Helper
  const handleToggleMode = (targetMode) => {
    setMode(targetMode);
    // Smooth URL update without unmounting layout
    window.history.pushState(null, '', `/${targetMode}`);
  };

  // Submit Login
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginError('');
    setLoginLoading(true);
    try {
      const { onboardingRequired } = await apiLogin(loginEmail.trim(), loginPassword);
      router.replace(onboardingRequired ? '/onboarding' : '/dashboard');
    } catch (err) {
      setLoginError((err && err.message) || 'Sign in failed. Please try again.');
      setLoginLoading(false);
    }
  };

  // Validate Signup Form
  const validateSignup = () => {
    if (signupForm.name.trim().length < 2) return 'Please enter your full name.';
    if (!EMAIL_RE.test(signupForm.email.trim())) return 'Enter a valid email address.';
    if (signupForm.password.length < 6) return 'Password must be at least 6 characters.';
    if (signupForm.password !== signupForm.confirm) return 'Passwords do not match.';
    return '';
  };

  // Submit Signup
  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    if (signupLoading) return;
    const v = validateSignup();
    if (v) { setSignupError(v); return; }
    setSignupError('');
    setSignupLoading(true);
    try {
      const { onboardingRequired } = await apiSignup({
        name: signupForm.name.trim(),
        email: signupForm.email.trim(),
        password: signupForm.password,
      });
      router.replace(onboardingRequired ? '/onboarding' : '/dashboard');
    } catch (err) {
      setSignupError((err && err.message) || 'Could not create your account.');
      setSignupLoading(false);
    }
  };

  const pwMatch = signupForm.confirm.length > 0
    ? signupForm.password === signupForm.confirm
    : null;

  // Onboarding and any other focused auth flow reuse the visual shell while
  // supplying their own form. Keep that content visible instead of silently
  // replacing it with the login/signup slider.
  if (hasCustomContent) {
    return (
      <main className="auth-screen">
        <div className="auth-orb a" aria-hidden="true" />
        <div className="auth-orb b" aria-hidden="true" />
        <ParticleField />
        <ScanLine />

        <div className="auth-split-card mode-login no-trans">
          <section className="auth-slot auth-slot-custom" data-slot="login">
            <a href="/" className="auth-brand" aria-label="intervieHire home">
              <span className="auth-logo-mark" aria-hidden="true" />
              <span className="auth-wordmark">
                intervie<span className="auth-wordmark-accent">Hire</span>
              </span>
            </a>
            <header className="auth-head">
              <h1 className="auth-title">{title}</h1>
              {subtitle && <p className="auth-sub">{subtitle}</p>}
            </header>
            {children}
            {footer && <div className="auth-foot">{footer}</div>}
          </section>

          <section className="auth-slot" data-slot="signup" aria-hidden="true" />
          <section className="auth-panel-slide" aria-hidden="true">
            <div className="auth-welcome">
              <span className="auth-welcome-star">✦</span>
              <h2 className="auth-welcome-title">SET UP<br />YOUR WORKSPACE</h2>
              <div className="auth-welcome-line" />
              <p className="auth-welcome-sub">
                Add your organisation details to finish creating your recruiter workspace.
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      {/* Background decorations */}
      <div className="auth-orb a" aria-hidden="true" />
      <div className="auth-orb b" aria-hidden="true" />
      <ParticleField />
      <ScanLine />

      {/* Main Split Panel Container */}
      <div className={`auth-split-card mode-${mode}${noTrans ? ' no-trans' : ''}`}>
        
        {/* ==================== LEFT SLOT: LOGIN ==================== */}
        <section className="auth-slot" data-slot="login" aria-hidden={mode !== 'login'}>
          {/* Brand */}
          <a href="/" className="auth-brand" aria-label="intervieHire home">
            <span className="auth-logo-mark" aria-hidden="true" />
            <span className="auth-wordmark">
              intervie<span className="auth-wordmark-accent">Hire</span>
            </span>
          </a>

          <header className="auth-head">
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-sub">Access your recruiter workspace.</p>
          </header>

          <form className="auth-form" onSubmit={handleLoginSubmit} noValidate>
            <ErrorBanner message={loginError} />

            <div className="auth-field">
              <label className="auth-label" htmlFor="login-email">Email</label>
              <div className="auth-input-wrap">
                <input
                  id="login-email"
                  className={`auth-input${loginError ? ' invalid' : ''}`}
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  disabled={loginLoading}
                  required
                />
              </div>
            </div>

            <div className="auth-field">
              <div className="auth-label-row">
                <label className="auth-label" htmlFor="login-password">Password</label>
                <a
                  href="/forgot-password"
                  className="auth-link-subtle"
                >
                  Forgot?
                </a>
              </div>
              <div className="auth-input-wrap">
                <input
                  id="login-password"
                  className={`auth-input${loginError ? ' invalid' : ''}`}
                  type={showLoginPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  disabled={loginLoading}
                  required
                />
                <button
                  type="button"
                  className="auth-input-action"
                  aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowLoginPw(v => !v)}
                >
                  {showLoginPw ? <EyeClosed /> : <EyeOpen />}
                </button>
              </div>
            </div>

            <SubmitButton loading={loginLoading} idle="Sign in" busy="Signing in…" />
          </form>

          <div className="auth-foot">
            No account?{' '}
            <button
              type="button"
              className="auth-switch-btn"
              onClick={() => handleToggleMode('signup')}
            >
              Create one
            </button>
          </div>
        </section>

        {/* ==================== RIGHT SLOT: SIGNUP ==================== */}
        <section className="auth-slot" data-slot="signup" aria-hidden={mode !== 'signup'}>
          {/* Brand */}
          <a href="/" className="auth-brand" aria-label="intervieHire home">
            <span className="auth-logo-mark" aria-hidden="true" />
            <span className="auth-wordmark">
              intervie<span className="auth-wordmark-accent">Hire</span>
            </span>
          </a>

          <header className="auth-head">
            <h1 className="auth-title">Get started</h1>
            <p className="auth-sub">Create your recruiter workspace.</p>
          </header>

          <form className="auth-form" onSubmit={handleSignupSubmit} noValidate>
            <ErrorBanner message={signupError} />

            <div className="auth-field">
              <label className="auth-label" htmlFor="signup-name">Full name</label>
              <div className="auth-input-wrap">
                <input
                  id="signup-name"
                  className="auth-input"
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={signupForm.name}
                  onChange={(e) => setSignupForm(f => ({ ...f, name: e.target.value }))}
                  disabled={signupLoading}
                  required
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="signup-email">Work email</label>
              <div className="auth-input-wrap">
                <input
                  id="signup-email"
                  className="auth-input"
                  type="email"
                  autoComplete="email"
                  placeholder="ada@company.com"
                  value={signupForm.email}
                  onChange={(e) => setSignupForm(f => ({ ...f, email: e.target.value }))}
                  disabled={signupLoading}
                  required
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="signup-password">Password</label>
              <div className="auth-input-wrap">
                <input
                  id="signup-password"
                  className="auth-input"
                  type={showSignupPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={signupForm.password}
                  onChange={(e) => setSignupForm(f => ({ ...f, password: e.target.value }))}
                  disabled={signupLoading}
                  required
                />
                <button
                  type="button"
                  className="auth-input-action"
                  aria-label={showSignupPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowSignupPw(v => !v)}
                >
                  {showSignupPw ? <EyeClosed /> : <EyeOpen />}
                </button>
              </div>
              <PasswordStrength password={signupForm.password} />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="signup-confirm">Confirm password</label>
              <div className="auth-input-wrap">
                <input
                  id="signup-confirm"
                  className="auth-input"
                  type={showSignupConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={signupForm.confirm}
                  onChange={(e) => setSignupForm(f => ({ ...f, confirm: e.target.value }))}
                  disabled={signupLoading}
                  required
                />
                <button
                  type="button"
                  className="auth-input-action"
                  aria-label={showSignupConfirm ? 'Hide password' : 'Show password'}
                  onClick={() => setShowSignupConfirm(v => !v)}
                >
                  {showSignupConfirm ? <EyeClosed /> : <EyeOpen />}
                </button>
              </div>
              {pwMatch !== null && (
                <div className={`auth-match ${pwMatch ? 'ok' : 'bad'}`}>
                  {pwMatch ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      Passwords match
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      Passwords do not match
                    </>
                  )}
                </div>
              )}
            </div>

            <SubmitButton loading={signupLoading} idle="Create account" busy="Creating…" />

            <p className="auth-terms">
              By signing up you agree to our{' '}
              <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
            </p>
          </form>

          <div className="auth-foot">
            Already have an account?{' '}
            <button
              type="button"
              className="auth-switch-btn"
              onClick={() => handleToggleMode('login')}
            >
              Sign in
            </button>
          </div>
        </section>

        {/* ==================== SLIDING WELCOME PANEL ==================== */}
        <section className="auth-panel-slide" aria-live="polite">
          <div className="auth-welcome">
            <span className="auth-welcome-star" aria-hidden="true">✦</span>
            <h2 className="auth-welcome-title">
              {mode === 'login' ? (
                <>WELCOME<br />BACK!</>
              ) : (
                <>JOIN US<br />TODAY!</>
              )}
            </h2>
            <div className="auth-welcome-line" />
            <p className="auth-welcome-sub">
              {mode === 'login' ? (
                'Access the future of candidate screening and automated video interviews.'
              ) : (
                'Start screening candidates faster, smarter, and with zero scheduling.'
              )}
            </p>
            <div className="auth-welcome-dots">
              <span className="auth-welcome-dot">AI-powered screening running 24/7</span>
              <span className="auth-welcome-dot">Anti-cheating security baked directly in</span>
              <span className="auth-welcome-dot">Structured scorecards & hiring analytics</span>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}

// ── ErrorBanner ───────────────────────────────────────────────────────────────
export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="auth-error" role="alert">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>{message}</span>
    </div>
  );
}

// ── PasswordStrength ──────────────────────────────────────────────────────────
export function PasswordStrength({ password }) {
  if (!password) return null;

  let score = 0;
  if (password.length >= 6)         score++;
  if (password.length >= 10)        score++;
  if (/[A-Z]/.test(password))      score++;
  if (/[0-9]/.test(password))      score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return (
    <div className="auth-strength" role="meter" aria-label="Password strength" aria-valuenow={score} aria-valuemin={0} aria-valuemax={5}>
      {[1,2,3,4,5].map((n) => (
        <div
          key={n}
          className={`auth-strength-bar${score >= n ? ` active-${Math.min(score, n)}` : ''}`}
        />
      ))}
    </div>
  );
}

// ── SubmitButton ──────────────────────────────────────────────────────────────
export function SubmitButton({ loading, idle, busy }) {
  return (
    <button
      id="auth-submit-btn"
      type="submit"
      className="auth-submit"
      disabled={loading}
    >
      {loading ? (
        <><span className="auth-spinner" />{busy}</>
      ) : idle}
    </button>
  );
}

export default AuthShell;
