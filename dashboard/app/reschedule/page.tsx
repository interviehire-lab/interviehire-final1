'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '../../src/auth-client';
import { DateTimeField } from './DateTimeField';
import styles from './reschedule.module.css';

// Candidate-facing interview reschedule page. Linked from every interview
// invite/reminder email as `{FRONTEND_URL}/reschedule?token=...`. Styled to
// match src/styles/auth.css (login/signup) — same standalone-public-page
// language (black bg, ambient teal orbs, sharp bottom-emphasis inputs,
// solid-teal sheen-sweep CTA) rather than a one-off theme.
//   GET  {API}/public/schedule/{token}    -> current interview details
//   POST {API}/public/reschedule/{token}  -> set a new time (updates the
//                                             calendar event + emails a
//                                             fresh iCal invite, unless
//                                             skip_notification is set)

// Reads the env var directly (not via src/dashboard/api.ts's ENGINE_WEB_URL)
// so this standalone route stays free of the vanilla-JS dashboard module
// graph — same reasoning as auth-client.ts's own API_BASE.
const ENGINE_WEB_URL = (process.env.NEXT_PUBLIC_ENGINE_WEB_URL || 'http://localhost:3001').replace(/\/$/, '');

const IST_TIME_ZONE = 'Asia/Kolkata';
const MIN_LEAD_MS = 60_000;
const MAX_WINDOW_MS = 60 * 24 * 60 * 60_000; // 60 days

type ScheduleCtx = {
  candidate_name?: string;
  job_title?: string;
  stage?: string;
  scheduled_at?: string | null;
};

function fmtIST(iso?: string | null): string {
  if (!iso) return 'Not set yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString('en-IN', {
      timeZone: IST_TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' IST'
  );
}

// "in 2 days", "in 4 hours", "in 20 minutes" — lets a candidate gauge their
// current slot at a glance instead of doing date math against an absolute
// timestamp.
function relativeFromNow(iso?: string | null): string | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let phrase: string;
  if (minutes < 60) phrase = `${minutes} min`;
  else if (hours < 48) phrase = `${hours} hr`;
  else phrase = `${days} day${days === 1 ? '' : 's'}`;
  return past ? `${phrase} ago` : `in ${phrase}`;
}

function gcalUrl(iso: string, title: string): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + 30 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const f = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${f(start)}/${f(end)}` +
    `&details=${encodeURIComponent('Your IntervieHire interview. Join link was sent to your email.')}`
  );
}

// Small inline icons matching this app's existing convention of hand-rolled
// SVGs for one-off UI needs (see AuthShell.jsx's EyeOpen/EyeClosed) rather
// than pulling in an icon library for four glyphs.
const IconUser = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const IconBriefcase = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);
const IconTag = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42Z" /><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
const IconCalendar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

function RescheduleForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'form' | 'done' | 'fatal'>('loading');
  const [fatalText, setFatalText] = useState(
    "This reschedule link is invalid or has expired. Please contact the recruiter for a new one."
  );
  const [ctx, setCtx] = useState<ScheduleCtx>({});
  const [picked, setPicked] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startingNow, setStartingNow] = useState(false);
  const [error, setError] = useState('');
  const [doneText, setDoneText] = useState('');
  const [gcalHref, setGcalHref] = useState('');

  const minDate = new Date();
  const maxDate = new Date(Date.now() + MAX_WINDOW_MS);
  const currentRelative = relativeFromNow(ctx.scheduled_at);

  useEffect(() => {
    if (!token) {
      setFatalText('No interview token in the link.');
      setStatus('fatal');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/public/schedule/${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error('bad token');
        const data: ScheduleCtx = await res.json();
        if (cancelled) return;
        setCtx(data);
        // Default the picker to the current scheduled time, or +1 day at
        // 1pm IST if none is set yet — timeZone="Asia/Kolkata" below means
        // react-datepicker displays/edits this in IST regardless of the
        // candidate's own device timezone.
        let base = data.scheduled_at ? new Date(data.scheduled_at) : null;
        if (!base || Number.isNaN(base.getTime())) {
          base = new Date();
          base.setUTCDate(base.getUTCDate() + 1);
          base.setUTCHours(7, 30, 0, 0); // 13:00 IST = 07:30 UTC
        }
        setPicked(base);
        setStatus('form');
      } catch {
        if (!cancelled) setStatus('fatal');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const postReschedule = useCallback(
    async (newTime: string, skipNotification: boolean) => {
      const res = await fetch(`${API_BASE}/public/reschedule/${encodeURIComponent(token!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_time: newTime, skip_notification: skipNotification }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const d = await res.json();
          detail = d.detail || detail;
        } catch {
          /* body wasn't JSON — keep the HTTP status message */
        }
        throw new Error(detail);
      }
      return res.json() as Promise<{ new_scheduled_time?: string; applicant_id?: string; job_id?: string | null }>;
    },
    [token]
  );

  const submit = useCallback(async () => {
    if (!picked) {
      setError('Please pick a date and time.');
      return;
    }
    if (picked.getTime() < Date.now() - MIN_LEAD_MS) {
      setError('Please choose a time in the future.');
      return;
    }
    if (picked.getTime() > Date.now() + MAX_WINDOW_MS) {
      setError('Please choose a time within the next 60 days.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const newTime = picked.toISOString();
      const out = await postReschedule(newTime, false);
      const when = out.new_scheduled_time || newTime;
      setDoneText(`${ctx.stage || 'Your interview'} is now set for ${fmtIST(when)}.`);
      setGcalHref(gcalUrl(when, `${ctx.stage || 'Interview'} · ${ctx.job_title || 'IntervieHire'}`));
      setStatus('done');
    } catch (e) {
      setError(`Could not reschedule: ${e instanceof Error ? e.message : 'please try again.'}`);
    } finally {
      setSubmitting(false);
    }
  }, [picked, postReschedule, ctx]);

  // Moves the slot to right now and drops the candidate straight into the
  // interview room — skips the confirmation email/WhatsApp entirely (see
  // skip_notification on the backend route) since telling someone "your
  // interview has moved" is pointless the instant before they join it.
  const startNow = useCallback(async () => {
    setError('');
    setStartingNow(true);
    try {
      const out = await postReschedule(new Date().toISOString(), true);
      if (!out.applicant_id) throw new Error('Could not start the interview — missing session id.');
      const jobQs = out.job_id ? `&jobId=${encodeURIComponent(out.job_id)}` : '';
      window.location.href = `${ENGINE_WEB_URL}/interviewcandidateroom?sessionId=${encodeURIComponent(out.applicant_id)}${jobQs}`;
    } catch (e) {
      setError(`Could not start the interview: ${e instanceof Error ? e.message : 'please try again.'}`);
      setStartingNow(false);
    }
  }, [postReschedule]);

  return (
    <main className={styles.screen}>
      <div className={`${styles.orb} ${styles.orbA}`} aria-hidden="true" />
      <div className={`${styles.orb} ${styles.orbB}`} aria-hidden="true" />

      <div className={styles.card}>
        <a href="/" className={styles.brand} aria-label="IntervieHire home">
          <span className={styles.logoMark} aria-hidden="true" />
          <span className={styles.wordmark}>
            Intervie<span className={styles.wordmarkAccent}>Hire</span>
          </span>
        </a>

        {status === 'loading' && (
          <>
            <div className={styles.spinner} />
            <p className={`${styles.sub} ${styles.center}`}>Loading your interview…</p>
          </>
        )}

        {status === 'form' && (
          <>
            <h1 className={styles.title}>Reschedule your interview</h1>
            <p className={styles.sub}>
              Pick a new time that works for you. We&apos;ll update your calendar invite and email you a fresh
              confirmation.
            </p>

            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryIcon}><IconUser /></span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>Candidate</span>
                  <span className={styles.summaryValue}>{ctx.candidate_name || '—'}</span>
                </div>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryIcon}><IconBriefcase /></span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>Role</span>
                  <span className={styles.summaryValue}>{ctx.job_title || '—'}</span>
                </div>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryIcon}><IconTag /></span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>Stage</span>
                  <span className={styles.summaryValue}>{ctx.stage || '—'}</span>
                </div>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryIcon}><IconCalendar /></span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>Current time</span>
                  <span className={styles.summaryValue}>
                    {fmtIST(ctx.scheduled_at)}
                    {currentRelative && <span className={styles.summaryRelative}> · {currentRelative}</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="newtime">New date &amp; time (IST)</label>
              {picked && (
                <DateTimeField id="newtime" value={picked} onChange={setPicked} minDate={minDate} maxDate={maxDate} />
              )}
            </div>

            {picked && ctx.scheduled_at && picked.getTime() !== new Date(ctx.scheduled_at).getTime() && (
              <p className={styles.recap}>
                Moving from <span className={styles.recapValue}>{fmtIST(ctx.scheduled_at)}</span>
                <span className={styles.recapArrow}>→</span>
                <span className={styles.recapValue}>{fmtIST(picked.toISOString())}</span>
              </p>
            )}

            <button className={styles.submit} onClick={submit} disabled={submitting || startingNow}>
              {submitting ? 'Rescheduling…' : 'Confirm new time'}
            </button>

            <div className={styles.divider}>or</div>
            <button className={styles.startNow} onClick={startNow} disabled={submitting || startingNow}>
              {startingNow ? 'Starting…' : 'Start the interview right now instead'}
            </button>

            {error && <div className={`${styles.banner} ${styles.bannerErr}`}>{error}</div>}
          </>
        )}

        {status === 'done' && (
          <div className={styles.center}>
            <h1 className={styles.title}>Interview rescheduled</h1>
            <div className={`${styles.banner} ${styles.bannerOk}`}>{doneText}</div>
            <a className={styles.gcal} href={gcalHref} target="_blank" rel="noopener noreferrer">
              <IconCalendar /> Add to Google Calendar
            </a>
            <p className={styles.sub} style={{ marginTop: 18 }}>
              A new calendar invitation has been emailed to you. You can close this tab now.
            </p>
          </div>
        )}

        {status === 'fatal' && (
          <div className={styles.center}>
            <h1 className={styles.title}>Link not valid</h1>
            <div className={`${styles.banner} ${styles.bannerErr}`}>{fatalText}</div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ReschedulePage() {
  return (
    <Suspense
      fallback={
        <main className={styles.screen}>
          <div className={styles.card}>
            <div className={styles.spinner} />
          </div>
        </main>
      }
    >
      <RescheduleForm />
    </Suspense>
  );
}
