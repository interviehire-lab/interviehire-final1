'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { API_BASE } from '../../src/auth-client';
import styles from './reschedule.module.css';

// Candidate-facing interview reschedule page. Linked from every interview
// invite/reminder email as `{FRONTEND_URL}/reschedule?token=...` (previously
// a static public/reschedule.html — rebuilt here as a proper route so the
// date/time picker can be a real component instead of the bare browser
// <input type="datetime-local">).
//   GET  {API}/public/schedule/{token}    -> current interview details
//   POST {API}/public/reschedule/{token}  -> set a new time (updates the
//                                             calendar event + emails a
//                                             fresh iCal invite)

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
  const [error, setError] = useState('');
  const [doneText, setDoneText] = useState('');
  const [gcalHref, setGcalHref] = useState('');

  const now = () => new Date();
  const maxDate = new Date(Date.now() + MAX_WINDOW_MS);

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
        // candidate's own device timezone, same guarantee the old hand-
        // rolled IST math gave, now handled by the library.
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
      const res = await fetch(`${API_BASE}/public/reschedule/${encodeURIComponent(token!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_time: newTime }),
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
      const out = await res.json();
      const when = out.new_scheduled_time || newTime;
      setDoneText(`${ctx.stage || 'Your interview'} is now set for ${fmtIST(when)}.`);
      setGcalHref(gcalUrl(when, `${ctx.stage || 'Interview'} · ${ctx.job_title || 'IntervieHire'}`));
      setStatus('done');
    } catch (e) {
      setError(`Could not reschedule: ${e instanceof Error ? e.message : 'please try again.'}`);
    } finally {
      setSubmitting(false);
    }
  }, [picked, token, ctx]);

  return (
    <div className={styles.body}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandDot} /> IntervieHire
        </div>

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
            <div className={styles.info}>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Candidate</span>
                <span className={styles.infoValue}>{ctx.candidate_name || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Role</span>
                <span className={styles.infoValue}>{ctx.job_title || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Stage</span>
                <span className={styles.infoValue}>{ctx.stage || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoKey}>Current time</span>
                <span className={styles.infoValue}>{fmtIST(ctx.scheduled_at)}</span>
              </div>
            </div>

            <label className={styles.label} htmlFor="newtime">
              New date &amp; time (IST)
            </label>
            <DatePicker
              id="newtime"
              selected={picked}
              onChange={(date) => setPicked(date)}
              timeZone={IST_TIME_ZONE}
              showTimeSelect
              timeIntervals={15}
              dateFormat="MMM d, yyyy · h:mm aa"
              minDate={now()}
              maxDate={maxDate}
              wrapperClassName={styles.pickerWrap}
              className={styles.pickerInput}
              popperPlacement="bottom-start"
            />

            <button className={styles.btn} onClick={submit} disabled={submitting}>
              {submitting ? 'Rescheduling…' : 'Confirm new time'}
            </button>
            {error && <div className={`${styles.msg} ${styles.msgErr}`}>{error}</div>}
          </>
        )}

        {status === 'done' && (
          <div className={styles.center}>
            <h1 className={styles.title} style={{ color: '#10b981' }}>
              Interview rescheduled ✓
            </h1>
            <p className={styles.sub}>{doneText}</p>
            <a className={styles.gcal} href={gcalHref} target="_blank" rel="noopener noreferrer">
              📅 Add to Google Calendar
            </a>
            <p className={styles.sub} style={{ marginTop: 18 }}>
              A new calendar invitation has been emailed to you.
            </p>
          </div>
        )}

        {status === 'fatal' && (
          <div className={styles.center}>
            <h1 className={styles.title} style={{ color: '#f87171' }}>
              Link not valid
            </h1>
            <p className={styles.sub}>{fatalText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReschedulePage() {
  return (
    <Suspense
      fallback={
        <div className={styles.body}>
          <div className={styles.card}>
            <div className={styles.spinner} />
          </div>
        </div>
      }
    >
      <RescheduleForm />
    </Suspense>
  );
}
