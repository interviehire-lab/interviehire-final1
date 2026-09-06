/**
 * url-sync.js
 *
 * Bridges vanilla-JS dashboard navigation with the browser URL bar.
 * Called once from index.js after initMountBindings() is scheduled.
 *
 * Strategy:
 * - Intercepts sidebar tab clicks and uses history.pushState to update
 *   the URL WITHOUT a full page reload, keeping the SPA alive.
 * - Patches window.navigateToJobDetail / window.openJobFlowView /
 *   window.navigateToSourcing to also push the correct URL.
 *
 * Uses runtime-proxied globals (document, window, setTimeout,
 * requestAnimationFrame) so all listeners/timers are torn down cleanly
 * when React unmounts the page.
 */
import { document, window, requestAnimationFrame, setTimeout } from './runtime';

// Tab ID → URL segment mapping
const TAB_URLS = {
  'jobs':      '/dashboard/jobs',
  'analytics': '/dashboard/analytics',
  'talent':    '/dashboard/talent',
  'team':      '/dashboard/team',
  'career':    '/dashboard/career',
};

const SUBTAB_URLS = {
  'settings-general': '/dashboard/settings/general',
};

/**
 * Pushes a URL to the browser history without reloading the page.
 * Debounced to avoid double-push from simultaneous React + vanilla nav.
 */
let _pushPending = false;
export function pushUrl(url) {
  if (typeof window === 'undefined') return;
  if (_pushPending) return;
  if (window.location.pathname === url) return;
  _pushPending = true;
  requestAnimationFrame(() => {
    if (typeof window.__ihPushState === 'function') {
      window.__ihPushState(url);
    } else {
      history.pushState(null, '', url);
    }
    _pushPending = false;
  });
}


/**
 * Patches window.navigateToJobDetail to also update the URL.
 */
function patchJobDetailNav() {
  const original = window.navigateToJobDetail;
  if (!original || original.__urlPatched) return;
  // navigateToJobDetail already pushes the (stage-aware) URL internally, so the
  // wrapper only forwards the optional `stage` argument through.
  window.navigateToJobDetail = function(jobId, stage) {
    original(jobId, stage);
  };
  window.navigateToJobDetail.__urlPatched = true;
}

/**
 * Patches window.openJobFlowView to also update the URL.
 */
function patchJobFlowNav() {
  const original = window.openJobFlowView;
  if (!original || original.__urlPatched) return;
  window.openJobFlowView = function(jobId, ...rest) {
    original(jobId, ...rest);
    pushUrl(`/dashboard/jobs/${jobId}/flow`);
  };
  window.openJobFlowView.__urlPatched = true;
}

/**
 * Patches window.navigateToSourcing to also update the URL.
 */
function patchSourcingNav() {
  const original = window.navigateToSourcing;
  if (!original || original.__urlPatched) return;
  window.navigateToSourcing = function(jobId, targetStage) {
    original(jobId, targetStage);
    pushUrl(`/dashboard/sourcing/${jobId}${targetStage ? `?stage=${targetStage}` : ''}`);
  };
  window.navigateToSourcing.__urlPatched = true;
}

/**
 * Adds href attributes to sidebar nav <li> items and intercepts their
 * click events to push URL changes via history.pushState.
 *
 * We do NOT prevent the vanilla navigateToTab() from firing — that
 * still handles the SPA view switching. We just additionally push the URL.
 */
function patchSidebarNavLinks() {
  document.querySelectorAll('.sidebar-nav .nav-item[data-tab]').forEach(item => {
    const tabId = item.getAttribute('data-tab');
    if (!tabId || tabId === 'settings') return; // settings uses subnav

    const url = TAB_URLS[tabId];
    if (!url) return;

    // Mark the element for accessibility / right-click
    item.setAttribute('data-href', url);
    item.style.cursor = 'pointer';

    // Listen on capture so we fire AFTER the existing mount.js listener
    // which already calls navigateToTab(tabId).
    item.addEventListener('click', () => {
      pushUrl(url);
    });
  });

  // Settings subnav items
  document.querySelectorAll('.sub-nav li[data-subtab]').forEach(li => {
    const subtabId = li.getAttribute('data-subtab');
    const url = SUBTAB_URLS[subtabId];
    if (!url) return;

    li.addEventListener('click', () => {
      pushUrl(url);
    });
  });
}

/**
 * Main init — call after initMountBindings() so window globals are set.
 */
export function initUrlSync() {
  // Patch window globals for job-level navigation (these are set in index.js)
  // Retry loop in case they aren't exposed yet (initMountBindings is async via setTimeout)
  let attempts = 0;
  const tryPatch = () => {
    patchJobDetailNav();
    patchJobFlowNav();
    patchSourcingNav();
    attempts++;
    if (attempts < 10) {
      // Retry after short delay in case window globals weren't ready yet
      if (!window.navigateToJobDetail?.__urlPatched ||
          !window.openJobFlowView?.__urlPatched ||
          !window.navigateToSourcing?.__urlPatched) {
        setTimeout(tryPatch, 100);
      }
    }
  };

  // Patch sidebar links immediately (DOM is ready)
  patchSidebarNavLinks();

  // Patch window globals (may need a tick for index.js to run)
  setTimeout(tryPatch, 50);
}
