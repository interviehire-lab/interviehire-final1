import { document } from './runtime';

function drawFunnelSVG(job, candidates) {
  const svgEl = document.getElementById('jd-funnel-svg');
  if (!svgEl) return;

  const wrap = svgEl.parentElement;
  const rect = wrap ? wrap.getBoundingClientRect() : { width: 460, height: 400 };
  const W = Math.max(rect.width || 460, 200);
  const H = Math.max(rect.height || 400, 200);
  const cx = W / 2;
  const maxHW = W * 0.32;
  const padT = 10, padB = 10;

  const total = Math.max(job.pipeline.total, 1);
  const completedCount = candidates.filter(c => c.interviewStatus === 'Completed').length;
  const qualifiedCount = candidates.filter(c => c.status === 'Hired').length;

  const cfg = job.pipelineConfig || {};
  const includeResume = cfg.resumeAnalysis?.enabled !== false;
  const includeScreening = cfg.recruiterScreening?.enabled !== false;
  const includeFunctional = cfg.functionalInterview?.enabled !== false;

  const stageLabels = ['Total Candidates'];
  const stageCounts = [job.pipeline.total];
  if (includeResume) { stageLabels.push('Resume Analysis'); stageCounts.push(job.pipeline.resume || 0); }
  if (includeScreening) { stageLabels.push('Recruiter Screening'); stageCounts.push(job.pipeline.screening || 0); }
  if (includeFunctional) { stageLabels.push('Functional Interview'); stageCounts.push(job.pipeline.functional || 0); }
  stageLabels.push('Completed', 'Qualified');
  stageCounts.push(completedCount, qualifiedCount);
  const n = stageCounts.length;
  const ys = stageCounts.map((_, i) => padT + (i / (n - 1)) * (H - padT - padB));

  const hws = stageCounts.map((c, i) => {
    if (i === 0) return maxHW;
    if (c === 0) return 3;
    return Math.max((c / total) * maxHW, 9);
  });

  const pts = stageCounts.map((_, i) => ({
    y: ys[i],
    lx: cx - hws[i],
    rx: cx + hws[i],
  }));

  const isLight = document.body.classList.contains('light-theme');
  const dividerStroke = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.065)';

  const sourceColors = {
    'Career Page': '#6366f1', 'ATS': '#06b6d4', 'Bulk Upload': '#f59e0b',
    'Scheduled': '#ec4899', 'Direct Link': '#10b981'
  };
  const sourceOrder = ['Career Page', 'ATS', 'Bulk Upload', 'Scheduled', 'Direct Link'];
  const stageStatusMap = {
    'Total Candidates': null, 'Resume Analysis': 'Resume', 'Recruiter Screening': 'Screening',
    'Functional Interview': 'Functional', 'Completed': 'Functional', 'Qualified': 'Hired'
  };

  function getBreakdownForStage(stageLabel) {
    const status = stageStatusMap[stageLabel];
    let stageCands;
    if (stageLabel === 'Total Candidates') stageCands = candidates;
    else if (stageLabel === 'Completed') stageCands = candidates.filter(c => c.status === 'Functional' || c.status === 'Hired');
    else stageCands = candidates.filter(c => c.status === status);
    const breakdown = {};
    stageCands.forEach(c => { const src = c.source || 'Unknown'; breakdown[src] = (breakdown[src] || 0) + 1; });
    return breakdown;
  }

  function getSourceFractions(stageIdx) {
    const label = stageLabels[stageIdx];
    const breakdown: any = getBreakdownForStage(label);
    const stageTotal = (Object.values(breakdown) as number[]).reduce((a, b) => a + b, 0) || 1;
    const fracs = [];
    sourceOrder.forEach(src => {
      if (breakdown[src]) fracs.push({ source: src, frac: breakdown[src] / stageTotal, color: sourceColors[src] });
    });
    Object.keys(breakdown).forEach(src => {
      if (!sourceOrder.includes(src)) fracs.push({ source: src, frac: breakdown[src] / stageTotal, color: '#888' });
    });
    if (fracs.length === 0) fracs.push({ source: 'None', frac: 1, color: 'rgba(255,255,255,0.08)' });
    return fracs;
  }

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('pointer-events', 'all');
  svgEl.style.cursor = 'pointer';

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const svgNS = 'http://www.w3.org/2000/svg';

  pts.slice(1, -1).forEach(p => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', p.lx - 14);
    line.setAttribute('y1', p.y);
    line.setAttribute('x2', p.rx + 14);
    line.setAttribute('y2', p.y);
    line.setAttribute('stroke', dividerStroke);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 3');
    line.setAttribute('pointer-events', 'none');
    svgEl.appendChild(line);
  });

  for (let i = 0; i < n - 1; i++) {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('data-stage-idx', String(i));
    g.setAttribute('pointer-events', 'all');
    g.style.cursor = 'pointer';

    const p = pts[i], q = pts[i + 1];
    const dy = q.y - p.y;
    const cp1Y = p.y + dy * 0.28; // organic flow
    const cp2Y = p.y + dy * 0.72; // organic flow
    const topW = p.rx - p.lx;
    const botW = q.rx - q.lx;
    const fracs = getSourceFractions(i);

    let topOffset = 0;
    let botOffset = 0;
    fracs.forEach(({ frac, color }) => {
      const topSlice = topW * frac;
      const botSlice = botW * frac;
      const tl = p.lx + topOffset;
      const tr = tl + topSlice;
      const bl = q.lx + botOffset;
      const br = bl + botSlice;

      const d =
        `M ${tl} ${p.y} L ${tr} ${p.y}` +
        ` C ${tr} ${cp1Y} ${br} ${cp2Y} ${br} ${q.y}` +
        ` L ${bl} ${q.y}` +
        ` C ${bl} ${cp2Y} ${tl} ${cp1Y} ${tl} ${p.y} Z`;

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', color);
      path.setAttribute('opacity', '0.9');
      path.setAttribute('pointer-events', 'all');
      g.appendChild(path);

      topOffset += topSlice;
      botOffset += botSlice;
    });

    svgEl.appendChild(g);
  }

  /* ── Feathered gradient overlays at stage boundaries ── */
  if (n > 2) {
    const defs = document.createElementNS(svgNS, 'defs');
    for (let i = 1; i <= n - 2; i++) {
      const bY = pts[i].y;
      const bandH = 12;
      const gradId = `funnel-blend-grad-${i}`;

      /* average colour of the two adjacent stages */
      const fracsAbove = getSourceFractions(i - 1);
      const fracsBelow = getSourceFractions(i);
      const pickFirst = (arr) => (arr.length ? arr[0].color : '#888');
      const cAbove = pickFirst(fracsAbove);
      const cBelow = pickFirst(fracsBelow);

      /* parse hex → rgb helper */
      const hexToRgb = (hex) => {
        const h = hex.replace('#', '');
        return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
      };
      const [r1,g1,b1] = hexToRgb(cAbove);
      const [r2,g2,b2] = hexToRgb(cBelow);
      const mr = Math.round((r1+r2)/2), mg = Math.round((g1+g2)/2), mb = Math.round((b1+b2)/2);

      const grad = document.createElementNS(svgNS, 'linearGradient');
      grad.setAttribute('id', gradId);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      const stops = [
        { offset: '0%',   color: `rgba(${mr},${mg},${mb},0)` },
        { offset: '45%',  color: `rgba(${mr},${mg},${mb},0.15)` },
        { offset: '55%',  color: `rgba(${mr},${mg},${mb},0.15)` },
        { offset: '100%', color: `rgba(${mr},${mg},${mb},0)` },
      ];
      stops.forEach(s => {
        const stop = document.createElementNS(svgNS, 'stop');
        stop.setAttribute('offset', s.offset);
        stop.setAttribute('stop-color', s.color);
        grad.appendChild(stop);
      });
      defs.appendChild(grad);

      /* overlay rect */
      const maxLx = Math.min(pts[i-1].lx, pts[i].lx) - 4;
      const maxRx = Math.max(pts[i-1].rx, pts[i].rx) + 4;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', maxLx);
      rect.setAttribute('y', bY - bandH / 2);
      rect.setAttribute('width', maxRx - maxLx);
      rect.setAttribute('height', bandH);
      rect.setAttribute('fill', `url(#${gradId})`);
      rect.setAttribute('pointer-events', 'none');
      svgEl.appendChild(rect);
    }
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  let funnelTooltipEl = document.getElementById('funnel-svg-tooltip');
  if (!funnelTooltipEl) {
    funnelTooltipEl = document.createElement('div');
    funnelTooltipEl.id = 'funnel-svg-tooltip';
    funnelTooltipEl.className = 'funnel-svg-tooltip';
    document.body.appendChild(funnelTooltipEl);
  }
  funnelTooltipEl.style.display = 'none';

  const stageItems = document.querySelectorAll('#jd-funnel-stages .jd-stage-item');
  const stagesContainer = document.getElementById('jd-funnel-stages');
  if (stagesContainer && stageItems.length === n) {
    stagesContainer.style.position = 'relative';
    stagesContainer.style.gap = '0';
    stagesContainer.style.height = H + 'px';
    // ys[] holds n evenly-spaced points (padT .. H-padB), one per stage —
    // meant for the SVG trapezoids above (n-1 of them, each connecting
    // consecutive points). The last stage has no trapezoid of its own to
    // align with, and reusing `H - padB` as both its top AND bottom (it
    // already equals ys[n-1] by construction) collapsed it to zero height —
    // its content still rendered, just overflowing a 0px box (the visual
    // "compressed" row). The list itself doesn't need to track the chart's
    // n-1 point-to-point spacing band-for-band — dividing its own available
    // height into n equal rows fills the container exactly, with every row
    // (including the last) getting real height and no overflow past H.
    const rowH = (H - padT - padB) / n;
    stageItems.forEach((item, i) => {
      const segTop = padT + i * rowH;
      const segH = rowH;
      item.style.position = 'absolute';
      item.style.left = '0';
      item.style.right = '0';
      item.style.top = segTop + 'px';
      item.style.height = segH + 'px';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
    });
  }

  let activeSegIdx = -1;

  function showTooltip(idx, clientX, clientY) {
    if (activeSegIdx === idx) {
      funnelTooltipEl.style.left = (clientX + 14) + 'px';
      funnelTooltipEl.style.top = (clientY - 10) + 'px';
      return;
    }
    activeSegIdx = idx;
    const label = stageLabels[idx];
    const count = stageCounts[idx];
    const breakdown: any = getBreakdownForStage(label);
    const rows = Object.entries(breakdown).map(([src, cnt]) => {
      const color = sourceColors[src] || '#888';
      return '<div class="funnel-tooltip-row"><span class="funnel-tooltip-dot" style="background:' + color + '"></span><span>' + src + '</span><strong>' + cnt + '</strong></div>';
    }).join('');

    funnelTooltipEl.innerHTML = '<div class="funnel-tooltip-title">' + label + ' <span>(' + count + ')</span></div>' + (rows || '<div class="funnel-tooltip-row"><span style="color:var(--color-text-faint)">No candidates</span></div>');
    funnelTooltipEl.style.display = 'block';
    funnelTooltipEl.style.left = (clientX + 14) + 'px';
    funnelTooltipEl.style.top = (clientY - 10) + 'px';

    svgEl.querySelectorAll('g[data-stage-idx]').forEach(g => {
      const gi = parseInt(g.getAttribute('data-stage-idx'));
      const paths = g.querySelectorAll('path');
      if (gi === idx) {
        paths.forEach(p => { p.setAttribute('opacity', '1'); p.style.filter = 'brightness(1.25)'; });
      } else {
        paths.forEach(p => { p.setAttribute('opacity', '0.9'); p.style.filter = ''; });
      }
    });
    stageItems.forEach((si, si_i) => {
      if (si_i === idx) si.classList.add('funnel-hover-active');
      else si.classList.remove('funnel-hover-active');
    });
  }

  function hideTooltip() {
    activeSegIdx = -1;
    funnelTooltipEl.style.display = 'none';
    svgEl.querySelectorAll('g[data-stage-idx] path').forEach(p => {
      p.setAttribute('opacity', '0.9');
      p.style.filter = '';
    });
    stageItems.forEach(si => si.classList.remove('funnel-hover-active'));
  }

  svgEl.addEventListener('mousemove', function(e) {
    const target = e.target;
    const g = target.closest ? target.closest('g[data-stage-idx]') : null;
    if (!g && target.tagName === 'path') {
      const parent = target.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'g' && parent.hasAttribute('data-stage-idx')) {
        showTooltip(parseInt(parent.getAttribute('data-stage-idx')), e.clientX, e.clientY);
        return;
      }
    }
    if (g) {
      showTooltip(parseInt(g.getAttribute('data-stage-idx')), e.clientX, e.clientY);
    } else {
      hideTooltip();
    }
  });

  svgEl.addEventListener('mouseleave', function() {
    hideTooltip();
  });
}

function drawScoreDistributionSVG(job, candidates) {
  const svgEl = document.getElementById('jd-score-svg');
  if (!svgEl) return;

  const buckets = ['0-20', '20-40', '40-60', '60-80', '80-100'];
  const counts = [0, 0, 0, 0, 0];

  candidates.forEach(c => {
    const s = parseFloat(c.score);
    if (s < 20) counts[0]++;
    else if (s < 40) counts[1]++;
    else if (s < 60) counts[2]++;
    else if (s < 80) counts[3]++;
    else counts[4]++;
  });

  const totalC = Math.max(candidates.length, 1);
  const percs = counts.map(c => (c / totalC) * 100);

  const wrap = svgEl.parentElement;
  const sRect = wrap ? wrap.getBoundingClientRect() : { width: 380, height: 220 };
  const W = Math.max(sRect.width || 380, 200);
  const H = Math.max(sRect.height || 220, 150);
  const padL = 42, padR = 12, padT = 18, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = (chartW / buckets.length) * 0.52;
  const gap = chartW / buckets.length;

  const isLight = document.body.classList.contains('light-theme');
  const gridStroke = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.045)';
  const labelFill = isLight ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.3)';
  const valFill = isLight ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.65)';
  const bucketFill = isLight ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.35)';
  const bucketColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

  const yTicks = [0, 25, 50, 75, 100];
  const yLines = yTicks.map(v => {
    const y = padT + chartH - (v / 100) * chartH;
    return `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"
        stroke="${gridStroke}" stroke-width="1"/>
      <text x="${padL - 6}" y="${y + 3.5}" text-anchor="end"
        fill="${labelFill}" font-size="9" font-family="sans-serif">${v}%</text>`;
  }).join('');

  const bars = percs.map((p, i) => {
    const barH = Math.max((p / 100) * chartH, p > 0 ? 2 : 0);
    const x = padL + i * gap + (gap - barW) / 2;
    const y = padT + chartH - barH;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${bucketColors[i]}" rx="3" opacity="0.9"/>
      ${p > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle"
        fill="${valFill}" font-size="9.5" font-family="sans-serif">${Math.round(p)}%</text>` : ''}
      <text x="${x + barW / 2}" y="${H - padB + 14}" text-anchor="middle"
        fill="${bucketFill}" font-size="9" font-family="sans-serif">${buckets[i]}</text>`;
  }).join('');

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.innerHTML = yLines + bars;
}

// Spotlight shortcuts CMD+K modal logic

export { drawFunnelSVG, drawScoreDistributionSVG };
