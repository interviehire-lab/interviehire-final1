'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './reschedule.module.css';

// React port of the recruiter-side date+time picker (createDateTimePicker in
// src/dashboard/resume-analysis.ts) — same interaction: a field button opens
// a popover with a month calendar (click a day) plus a native
// <input type="time"> for the time-of-day, which is why this never
// restricts entry to fixed intervals the way a dropdown-based time picker
// (e.g. react-datepicker's timeIntervals) would. Restyled to this page's
// black/teal aesthetic rather than the recruiter dashboard's glass theme —
// same component behavior, this page's own visual language.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtField(d: Date) {
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST';
}

export function DateTimeField({
  value,
  onChange,
  minDate,
  maxDate,
  id,
}: {
  value: Date;
  onChange: (d: Date) => void;
  minDate: Date;
  maxDate: Date;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Whether the popover should open upward (.dtPopUp) instead of its default
  // downward placement — flips when there isn't enough room below the field
  // to fit the full month grid + time row without the outer .screen having
  // to clip or scroll it out of reach (see reschedule.module.css's .dtPop
  // comment for the bug this fixes: candidates having to zoom out to reach
  // the time input).
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  // Measured after the popover is in the DOM (default: opens downward), so
  // its real rendered height reflects the current month's row count (5 vs 6
  // weeks). Runs before paint, so a flip is invisible — no flash of the
  // wrong position.
  useLayoutEffect(() => {
    if (!open) {
      setFlipUp(false);
      return;
    }
    const field = fieldRef.current;
    const pop = popRef.current;
    if (!field || !pop) return;
    const fieldRect = field.getBoundingClientRect();
    const popHeight = pop.offsetHeight;
    const margin = 14; // .dtPop's own 6px offset + a little breathing room
    const spaceBelow = window.innerHeight - fieldRect.bottom;
    const spaceAbove = fieldRect.top;
    setFlipUp(spaceBelow < popHeight + margin && spaceAbove > spaceBelow);
  }, [open, viewYear, viewMonth]);

  const minKey = dayKey(minDate);
  const maxKey = dayKey(maxDate);

  const cells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: Array<{ d: number } | null> = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push({ d });
    return out;
  }, [viewYear, viewMonth]);

  const selectDay = (d: number) => {
    const next = new Date(value.getTime());
    next.setFullYear(viewYear, viewMonth, d);
    onChange(next);
  };

  const onTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, mi] = e.target.value.split(':').map(Number);
    const next = new Date(value.getTime());
    next.setHours(h || 0, mi || 0, 0, 0);
    onChange(next);
  };

  const navMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const isBoundaryDay = (key: string) => key === minKey || key === maxKey;

  return (
    <div className={styles.dt} ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={fieldRef}
        className={styles.dtField}
        onClick={() => setOpen((v) => !v)}
      >
        {fmtField(value)}
      </button>
      {open && (
        <div ref={popRef} className={`${styles.dtPop} ${flipUp ? styles.dtPopUp : ''}`}>
          <div className={styles.dtHead}>
            <button type="button" className={styles.dtNav} onClick={() => navMonth(-1)} aria-label="Previous month">‹</button>
            <span className={styles.dtTitle}>{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" className={styles.dtNav} onClick={() => navMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className={styles.dtDow}>{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className={styles.dtGrid}>
            {cells.map((cell, i) => {
              if (!cell) return <span key={`e${i}`} className={`${styles.dtDay} ${styles.dtDayEmpty}`} />;
              const cellDate = new Date(viewYear, viewMonth, cell.d);
              const key = dayKey(cellDate);
              const selected = key === dayKey(value);
              const disabled = key < minKey || key > maxKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    styles.dtDay,
                    selected ? styles.dtDaySel : '',
                    disabled ? styles.dtDayDisabled : '',
                  ].filter(Boolean).join(' ')}
                  disabled={disabled}
                  onClick={() => selectDay(cell.d)}
                >
                  {cell.d}
                </button>
              );
            })}
          </div>
          <div className={styles.dtTimeRow}>
            <label htmlFor={`${id}-time`}>Time</label>
            <input
              id={`${id}-time`}
              type="time"
              className={styles.dtTimeInput}
              value={`${pad2(value.getHours())}:${pad2(value.getMinutes())}`}
              onChange={onTimeChange}
              // Native time input, no step restriction — any minute is a
              // valid pick, unlike a dropdown-list time picker.
              min={isBoundaryDay(dayKey(value)) && dayKey(value) === minKey ? `${pad2(minDate.getHours())}:${pad2(minDate.getMinutes())}` : undefined}
              max={isBoundaryDay(dayKey(value)) && dayKey(value) === maxKey ? `${pad2(maxDate.getHours())}:${pad2(maxDate.getMinutes())}` : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
