import { document, window } from './runtime';
import { escapeHTML } from './escape';
import { showPremiumToast } from './sourcing';
import { apiUpdateOrganisation } from './api';

// Reusable form-builder for the public apply page's custom questions. Used in two
// places with different save targets:
//   • Per-job override  → job-detail Overview  (#jd-apply-questions)
//   • Company default    → Career settings view (#career-questions-editor)
//
// Follows the dashboard build→bind pairing: draw() sets innerHTML then binds. On any
// structural action (add/remove/reorder/type-change) it first reads the current field
// values out of the DOM (collect) so in-progress typing is never lost on redraw.
//
// UX: rows reorder by drag handle (↑/↓ buttons remain as an accessible fallback),
// duplicate labels are rejected on save, and an "Unsaved changes" pill + a
// beforeunload guard warn before edits are lost.

const TYPES: Array<[string, string]> = [
  ['short_text', 'Short text'],
  ['long_text', 'Long paragraph'],
  ['boolean', 'Yes / No'],
  ['select', 'Multiple choice (pick one)'],
  ['multi_select', 'Checkboxes (pick many)'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['file', 'File upload'],
];
// Types whose definition carries a candidate-facing list of options.
const OPTION_TYPES = new Set(['select', 'multi_select']);

const IN = 'padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.5);color:#e2e8f0;font-size:13px;';
const BTN = 'padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#cbd5e1;font-size:13px;cursor:pointer;';
const PRIMARY = 'padding:9px 16px;border-radius:8px;border:1px solid rgba(56,189,248,0.4);background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:600;font-size:13px;cursor:pointer;';
const HANDLE = 'cursor:grab;color:#64748b;font-size:16px;line-height:1;padding:0 2px;user-select:none;';

function normalize(qs: any): any[] {
  if (typeof qs === 'string') { try { qs = JSON.parse(qs); } catch { qs = []; } }
  if (!Array.isArray(qs)) return [];
  return qs.map((q) => ({
    id: (q && q.id) || '',
    label: (q && (q.label || q.question)) || '',
    type: TYPES.some((t) => t[0] === (q && q.type)) ? q.type : 'short_text',
    required: !!(q && q.required),
    options: Array.isArray(q && q.options) ? q.options.slice() : [],
  }));
}

// Order- and content-sensitive signature used for dirty tracking (id excluded so a
// freshly-added blank row and its persisted, id-stamped twin compare equal).
function signature(qs: any[]): string {
  return JSON.stringify((qs || []).map((q) => ({
    label: (q.label || '').trim(),
    type: q.type || 'short_text',
    required: !!q.required,
    options: OPTION_TYPES.has(q.type) ? (q.options || []) : [],
  })));
}

function typeSelect(sel: string): string {
  return `<select class="aqe-type" style="${IN}">${TYPES.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

function rowHTML(q: any, i: number): string {
  const showOpts = OPTION_TYPES.has(q.type);
  return `
    <div class="aqe-row" data-idx="${i}" data-id="${escapeHTML(q.id || '')}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">
      <span class="aqe-drag" draggable="true" data-idx="${i}" title="Drag to reorder" style="${HANDLE}">⠿</span>
      <input class="aqe-label" value="${escapeHTML(q.label)}" placeholder="Question label" style="${IN}flex:1;min-width:200px;" />
      ${typeSelect(q.type)}
      <input class="aqe-options" value="${escapeHTML((q.options || []).join(', '))}" placeholder="Options, comma-separated" style="${IN}flex:1;min-width:180px;${showOpts ? '' : 'display:none;'}" />
      <label style="display:flex;align-items:center;gap:5px;color:#94a3b8;font-size:12px;white-space:nowrap;"><input type="checkbox" class="aqe-required" ${q.required ? 'checked' : ''} /> Required</label>
      <button type="button" class="aqe-up" data-idx="${i}" title="Move up" style="${BTN}">↑</button>
      <button type="button" class="aqe-down" data-idx="${i}" title="Move down" style="${BTN}">↓</button>
      <button type="button" class="aqe-remove" data-idx="${i}" title="Remove" style="${BTN}color:#f87171;">✕</button>
    </div>`;
}

function build(questions: any[], opts: any, saving: boolean, dirty: boolean): string {
  const rows = questions.map(rowHTML).join('');
  const empty = questions.length ? '' : `<div style="color:#94a3b8;font-size:13px;padding:8px 0;">No custom questions yet — every candidate is only asked for name, email and resume. Add a question below.</div>`;
  return `
    <div class="jd-panel-header" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange, #38bdf8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line><circle cx="12" cy="12" r="10"></circle></svg>
      <h3 class="jd-card-title">${escapeHTML(opts.heading || 'Application questions')}</h3>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">${escapeHTML(opts.hint || '')}</p>
    <div class="aqe-rows">${empty}${rows}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
      <button type="button" class="aqe-add" style="${BTN}">+ Add question</button>
      <button type="button" class="aqe-save" ${saving ? 'disabled' : ''} style="${PRIMARY}${saving ? 'opacity:0.6;cursor:default;' : ''}">${saving ? 'Saving…' : 'Save questions'}</button>
      <span class="aqe-dirty" style="display:${dirty ? 'inline-flex' : 'none'};align-items:center;gap:5px;color:#fbbf24;font-size:12px;">● Unsaved changes</span>
    </div>`;
}

export function mountApplicationQuestionsEditor(container: any, opts: any): void {
  // Remounting (e.g. switching jobs) reuses the same container — tear down the prior
  // instance's window/container listeners first so beforeunload guards don't stack.
  if (container.__aqeCleanup) { try { container.__aqeCleanup(); } catch { /* noop */ } }

  const state: any = { questions: normalize(opts.questions), saving: false, dirty: false, dragFrom: -1 };
  state.savedSig = signature(state.questions);

  function collect(): any[] {
    return Array.from(container.querySelectorAll('.aqe-row')).map((row: any) => {
      const optsEl = row.querySelector('.aqe-options');
      return {
        id: row.getAttribute('data-id') || '',
        label: (row.querySelector('.aqe-label')?.value || '').trim(),
        type: row.querySelector('.aqe-type')?.value || 'short_text',
        required: !!row.querySelector('.aqe-required')?.checked,
        options: optsEl ? optsEl.value.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      };
    });
  }

  // Live dirty check on typing/toggling — updates the pill without a redraw so the
  // caret isn't lost mid-edit. Structural changes recompute dirty inside draw().
  function refreshDirty() {
    state.dirty = signature(collect()) !== state.savedSig;
    const pill = container.querySelector('.aqe-dirty');
    if (pill) pill.style.display = state.dirty ? 'inline-flex' : 'none';
  }

  function draw() {
    state.dirty = signature(state.questions) !== state.savedSig;
    container.innerHTML = build(state.questions, opts, state.saving, state.dirty);
    bind();
  }

  function bind() {
    container.querySelector('.aqe-add')?.addEventListener('click', () => {
      state.questions = collect();
      state.questions.push({ id: '', label: '', type: 'short_text', required: false, options: [] });
      draw();
    });
    container.querySelectorAll('.aqe-remove').forEach((b: any) => b.addEventListener('click', () => {
      state.questions = collect();
      state.questions.splice(+b.getAttribute('data-idx'), 1);
      draw();
    }));
    container.querySelectorAll('.aqe-up').forEach((b: any) => b.addEventListener('click', () => {
      const i = +b.getAttribute('data-idx');
      if (i <= 0) return;
      state.questions = collect();
      [state.questions[i - 1], state.questions[i]] = [state.questions[i], state.questions[i - 1]];
      draw();
    }));
    container.querySelectorAll('.aqe-down').forEach((b: any) => b.addEventListener('click', () => {
      const i = +b.getAttribute('data-idx');
      state.questions = collect();
      if (i >= state.questions.length - 1) return;
      [state.questions[i + 1], state.questions[i]] = [state.questions[i], state.questions[i + 1]];
      draw();
    }));
    // Drag-and-drop reordering. Grab the handle, drop onto any row; the moved row
    // lands at the target's index. collect() first so in-progress typing survives.
    container.querySelectorAll('.aqe-drag').forEach((h: any) => {
      h.addEventListener('dragstart', (e: any) => {
        state.questions = collect();
        state.dragFrom = +h.getAttribute('data-idx');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(state.dragFrom)); } catch { /* noop */ }
        }
      });
      h.addEventListener('dragend', () => { state.dragFrom = -1; });
    });
    container.querySelectorAll('.aqe-row').forEach((row: any) => {
      row.addEventListener('dragover', (e: any) => {
        if (state.dragFrom < 0) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.style.outline = '1px dashed rgba(56,189,248,0.6)';
      });
      row.addEventListener('dragleave', () => { row.style.outline = ''; });
      row.addEventListener('drop', (e: any) => {
        e.preventDefault();
        row.style.outline = '';
        const to = +row.getAttribute('data-idx');
        const from = state.dragFrom;
        if (from < 0 || Number.isNaN(to) || from === to) return;
        state.questions = collect();
        const [moved] = state.questions.splice(from, 1);
        state.questions.splice(to, 0, moved);
        state.dragFrom = -1;
        draw();
      });
    });
    // Type change → redraw so the options field shows/hides for choice types.
    container.querySelectorAll('.aqe-type').forEach((sel: any) => sel.addEventListener('change', () => {
      state.questions = collect();
      draw();
    }));
    container.querySelector('.aqe-save')?.addEventListener('click', async () => {
      const questions = collect().filter((q: any) => q.label);  // drop blank-label rows
      // Duplicate-label guard (case-insensitive) — answers key off the label, so
      // duplicates would collide on the apply form and in the stored answers.
      const seen = new Set<string>();
      for (const q of questions) {
        const key = q.label.trim().toLowerCase();
        if (seen.has(key)) { showPremiumToast(`Duplicate question label: “${q.label}”. Labels must be unique.`, 'error'); return; }
        seen.add(key);
      }
      const bad = questions.find((q: any) => OPTION_TYPES.has(q.type) && !q.options.length);
      if (bad) { showPremiumToast(`Add at least one option for "${bad.label}".`, 'error'); return; }
      state.saving = true; draw();
      try {
        await opts.onSave(questions);
        state.questions = questions;
        state.savedSig = signature(questions);  // new clean baseline
        state.saving = false; draw();           // draw() clears the dirty pill
        showPremiumToast('Application questions saved.', 'success');
      } catch (e: any) {
        state.saving = false; draw();
        showPremiumToast(`Could not save questions: ${(e && e.message) || 'backend error'}`, 'error');
      }
    });
  }

  // Container-level listeners live for the mount's lifetime (the container element
  // survives innerHTML redraws), so they're attached once here rather than in bind().
  container.addEventListener('input', refreshDirty);
  container.addEventListener('change', refreshDirty);
  const onBeforeUnload = (e: any) => {
    if (!state.dirty) return undefined;
    e.preventDefault();
    e.returnValue = '';  // Chrome requires returnValue to be set to show the prompt
    return '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  container.__aqeCleanup = () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    container.removeEventListener('input', refreshDirty);
    container.removeEventListener('change', refreshDirty);
  };

  draw();
}

// ── Career settings: company-wide default ─────────────────────────────────────
export function renderOrgApplicationQuestions(org: any): void {
  const container = document.getElementById('career-questions-editor');
  if (!container) return;
  mountApplicationQuestionsEditor(container, {
    questions: (org && org.application_questions) || [],
    heading: 'Default application questions (all jobs)',
    hint: 'Asked on every job’s apply page unless that job sets its own questions. Applies company-wide.',
    onSave: async (questions: any[]) => {
      await apiUpdateOrganisation({ application_questions: questions });
    },
  });
}
