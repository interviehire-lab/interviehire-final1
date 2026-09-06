import { document, signal, setTimeout, setInterval, clearInterval } from './runtime';
import { escapeHTML } from './escape';
import { filterCandidatesByDateRange, renderAnalyticsTable, renderJobCards, updateSummaryMetrics } from './render-views';
import { saveStateToLocalStorage } from './ai-api';
import { soundEngine } from './sound';
import { AppState } from './state';
import { getDataSource, apiMoveApplicantStage } from './api';

// ==========================================
// CREATIVE FEATURES ADDITIONAL LOGIC
// ==========================================

function recalculateJobPipelines() {
  const dateFiltered = filterCandidatesByDateRange(AppState.candidates);
  AppState.jobs.forEach(job => {
    const jobCandidates = dateFiltered.filter(c => {
      if (getDataSource() === 'api' && job._backend) {
        return c.jobId === job.id;
      }
      return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
    });

    job.pipeline.total = jobCandidates.length;
    job.pipeline.resume = jobCandidates.filter(c => c.status === 'Resume').length;
    job.pipeline.screening = jobCandidates.filter(c => c.status === 'Screening').length;
    job.pipeline.functional = jobCandidates.filter(c => c.status === 'Functional').length;
  });
}

function renderKanbanBoard() {
  const container = document.getElementById('jobs-board-container');
  if (!container) return;

  const cols = {
    Resume: document.getElementById('col-resume'),
    Screening: document.getElementById('col-screening'),
    Functional: document.getElementById('col-functional'),
    Hired: document.getElementById('col-hired')
  };

  // Reset columns
  Object.values(cols).forEach(col => {
    if (col) col.innerHTML = '';
  });

  const counts = { Resume: 0, Screening: 0, Functional: 0, Hired: 0 };
  const searchVal = AppState.globalSearch.toLowerCase();

  // Filter candidates
  const filteredCandidates = AppState.candidates.filter(c => {
    if (searchVal) {
      return c.name.toLowerCase().includes(searchVal) || c.jobApplied.toLowerCase().includes(searchVal);
    }
    return true;
  });

  filteredCandidates.forEach(c => {
    const stage = c.status; // e.g. 'Resume', 'Screening', 'Functional', 'Hired'
    if (!cols[stage]) return;

    counts[stage]++;

    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.setAttribute('draggable', 'true');
    
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', c.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
    
    const isHired = stage === 'Hired';
    
    card.innerHTML = `
      <div class="kanban-card-title">${escapeHTML(c.name)}</div>
      <div class="kanban-card-job">${escapeHTML(c.jobApplied)}</div>
      <div class="kanban-card-footer">
        <span class="kanban-card-score">${c.score}</span>
        ${isHired 
          ? `<span style="font-size: 0.72rem; color: var(--color-success); font-weight: 600;">✓ Hired</span>` 
          : `<button class="btn-advance-kanban" data-candidate-id="${c.id}">Advance →</button>`
        }
      </div>
    `;

    cols[stage].appendChild(card);
  });

  // Update counts in column headers
  document.getElementById('board-count-resume').textContent = counts.Resume;
  document.getElementById('board-count-screening').textContent = counts.Screening;
  document.getElementById('board-count-functional').textContent = counts.Functional;
  document.getElementById('board-count-hired').textContent = counts.Hired;

  // Bind click handlers to advance buttons
  container.querySelectorAll('.btn-advance-kanban').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const candId = btn.getAttribute('data-candidate-id');
      advanceCandidate(candId);
    });
  });
}

async function syncStageToBackend(candidate, newStatus) {
  if (getDataSource() !== 'api' || !candidate?._backend) return;
  const id = candidate.backendId || candidate.id;
  const keep = { jobApplied: candidate.jobApplied, jobId: candidate.jobId, registeredOn: candidate.registeredOn };
  const updated = await apiMoveApplicantStage(id, newStatus);
  if (updated) {
    Object.assign(candidate, updated);
    if (keep.jobApplied) candidate.jobApplied = keep.jobApplied;
    if (keep.jobId) candidate.jobId = keep.jobId;
    if (keep.registeredOn) candidate.registeredOn = keep.registeredOn;
  }
}

async function advanceCandidate(candId) {
  const candidate = AppState.candidates.find(c => c.id === candId);
  if (!candidate) return;

  const currentStatus = candidate.status;
  let newStatus = currentStatus;

  if (currentStatus === 'Resume') {
    newStatus = 'Screening';
  } else if (currentStatus === 'Screening') {
    newStatus = 'Functional';
  } else if (currentStatus === 'Functional') {
    newStatus = 'Hired';
  }

  if (newStatus !== currentStatus) {
    candidate.status = newStatus;
    saveStateToLocalStorage();
    
    // Play sound chime
    soundEngine.playChime([329.63, 440.00, 523.25], 0.2, 0.08);
    
    // Recalculate and update views
    recalculateJobPipelines();
    updateSummaryMetrics();
    renderAnalyticsTable();
    
    if (document.getElementById('jobs-board-container').style.display !== 'none') {
      renderKanbanBoard();
    } else {
      renderJobCards();
    }

    try {
      await syncStageToBackend(candidate, newStatus);
      saveStateToLocalStorage();
      recalculateJobPipelines();
      updateSummaryMetrics();
      renderAnalyticsTable();
      if (document.getElementById('jobs-board-container').style.display !== 'none') {
        renderKanbanBoard();
      } else {
        renderJobCards();
      }
    } catch (err) {
      console.warn('Stage change saved locally but backend sync failed:', err);
      candidate.status = currentStatus;
      saveStateToLocalStorage();
      recalculateJobPipelines();
      updateSummaryMetrics();
      renderAnalyticsTable();
      renderKanbanBoard();
    }
  }
}

function appendTerminalLog(text, colorClass = '') {
  const termBody = document.getElementById('swarm-terminal-body');
  if (!termBody) return;
  const div = document.createElement('div');
  div.className = 'term-log' + (colorClass ? ' ' + colorClass : '');
  div.innerHTML = text;
  termBody.appendChild(div);
  termBody.scrollTop = termBody.scrollHeight;
}

// Waveform interview snippet player simulation
let waveformInterval = null;
let waveformPlayTime = 0; // in milliseconds
const waveformDuration = 12000; // 12 seconds

function setupWaveformBars() {
  const container = document.getElementById('waveform-viz-bars');
  if (!container) return;
  container.innerHTML = '';
  
  for (let i = 0; i < 28; i++) {
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    const h = Math.floor(Math.random() * 80 + 10);
    bar.style.height = `${h}%`;
    container.appendChild(bar);
  }
}

function resetWaveformAudio() {
  if (waveformInterval) {
    clearInterval(waveformInterval);
    waveformInterval = null;
  }
  waveformPlayTime = 0;
  
  const timer = document.getElementById('waveform-timer');
  if (timer) timer.textContent = '0:00 / 0:12';
  
  const playBtn = document.getElementById('btn-play-wave');
  if (playBtn) {
    playBtn.querySelector('.play-svg').style.display = 'block';
    playBtn.querySelector('.pause-svg').style.display = 'none';
  }
  
  const bars = document.querySelectorAll('#waveform-viz-bars .wave-bar');
  bars.forEach(bar => bar.classList.remove('played'));
}

function toggleWaveformAudio() {
  const playBtn = document.getElementById('btn-play-wave');
  if (!playBtn) return;
  
  const isPlaying = waveformInterval !== null;
  
  if (isPlaying) {
    clearInterval(waveformInterval);
    waveformInterval = null;
    playBtn.querySelector('.play-svg').style.display = 'block';
    playBtn.querySelector('.pause-svg').style.display = 'none';
    soundEngine.playClick();
  } else {
    playBtn.querySelector('.play-svg').style.display = 'none';
    playBtn.querySelector('.pause-svg').style.display = 'block';
    soundEngine.playChime([440, 554.37], 0.1, 0.05);
    
    waveformInterval = setInterval(() => {
      waveformPlayTime += 100;
      if (waveformPlayTime >= waveformDuration) {
        resetWaveformAudio();
        soundEngine.playChime([523.25, 392], 0.15, 0.08);
        return;
      }
      
      const timer = document.getElementById('waveform-timer');
      if (timer) {
        const secs = Math.floor(waveformPlayTime / 1000);
        timer.textContent = `0:${secs.toString().padStart(2, '0')} / 0:12`;
      }
      
      const bars = document.querySelectorAll('#waveform-viz-bars .wave-bar');
      const progress = waveformPlayTime / waveformDuration;
      const activeIndex = Math.floor(progress * bars.length);
      
      bars.forEach((bar, idx) => {
        if (idx === activeIndex || (idx < activeIndex && Math.random() > 0.4)) {
          const h = Math.floor(Math.random() * 80 + 15);
          bar.style.height = `${h}%`;
        }
        
        if (idx <= activeIndex) {
          bar.classList.add('played');
        } else {
          bar.classList.remove('played');
        }
      });
    }, 100);
  }
}

const CandidateReviews = {
  'CAN-8234-EA1': {
    file: 'App.jsx (React)',
    code: `<span class="keyword">import</span> { useState, useEffect } <span class="keyword">from</span> <span class="string">'react'</span>;\n\n<span class="keyword">export default function</span> <span class="func">UserList</span>() {\n  <span class="keyword">const</span> [users, setUsers] = useState([]);\n  <span class="keyword">const</span> [loading, setLoading] = useState(<span class="keyword">true</span>);\n\n  useEffect(() =&gt; {\n    <span class="keyword">const</span> controller = <span class="keyword">new</span> <span class="class-name">AbortController</span>();\n    <span class="func">fetchUsers</span>(controller.signal);\n    <span class="keyword">return</span> () =&gt; controller.abort();\n  }, []);`,
    reviewer: 'Sarah J.',
    initials: 'SJ',
    comment: 'Excellent cleanup hook. Aditya handles asynchronous API mounts using the correct React AbortController pattern. Prevents race conditions and memory leaks.'
  },
  'CAN-7128-DF5': {
    file: 'tender_process.go (Golang)',
    code: `<span class="keyword">package</span> main\n\n<span class="keyword">import</span> (\n  <span class="string">"context"</span>\n  <span class="string">"time"</span>\n)\n\n<span class="keyword">func</span> <span class="func">ProcessTender</span>(ctx context.Context, id <span class="keyword">string</span>) <span class="keyword">error</span> {\n  ctx, cancel := context.WithTimeout(ctx, 5*time.Second)\n  <span class="keyword">defer</span> cancel()\n  \n  <span class="keyword">return</span> <span class="func">FetchTenderDetails</span>(ctx, id)\n}`,
    reviewer: 'Sarah J.',
    initials: 'SJ',
    comment: 'Devasri has structured this scraper with clean worker pools and context timeouts. Excellent handling of HTTP request parameters.'
  },
  'CAN-3401-EA1': {
    file: 'HomeLayout.css (CSS3)',
    code: `<span class="keyword">.grid-container</span> {\n  <span class="keyword">display</span>: grid;\n  <span class="keyword">grid-template-columns</span>: repeat(auto-fit, minmax(280px, 1fr));\n  <span class="keyword">gap</span>: 1.5rem;\n  <span class="keyword">padding</span>: 2rem;\n  <span class="keyword">background-color</span>: <span class="string">var(--color-bg)</span>;\n}`,
    reviewer: 'Sarah J.',
    initials: 'SJ',
    comment: 'Ines uses modern semantic CSS grid and variables. Clean, legible code structure.'
  },
  'CAN-9012-EA2': {
    file: 'auth_helper.py (Python)',
    code: `<span class="keyword">import</span> jwt\n<span class="keyword">from</span> datetime <span class="keyword">import</span> datetime, timedelta\n\n<span class="keyword">def</span> <span class="func">create_token</span>(user_id: str) -&gt; str:\n  payload = {\n    <span class="string">'sub'</span>: user_id,\n    <span class="string">'exp'</span>: datetime.utcnow() + timedelta(days=1)\n  }\n  <span class="keyword">return</span> jwt.encode(payload, <span class="string">'SECRET_KEY'</span>, algorithm=<span class="string">'HS256'</span>)`,
    reviewer: 'Sarah J.',
    initials: 'SJ',
    comment: 'Sarah uses robust encryption packages. Recommended addition of rate limit headers.'
  }
};


export { advanceCandidate, appendTerminalLog, CandidateReviews, recalculateJobPipelines, renderKanbanBoard, resetWaveformAudio, setupWaveformBars, toggleWaveformAudio, waveformDuration, waveformInterval, waveformPlayTime };
