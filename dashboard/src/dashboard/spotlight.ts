import { document, window } from './runtime';
import { closeDrawers, navigateToSubtab, navigateToTab, openDrawer } from './navigation';
import { soundEngine } from './sound';

const spotlightUi = { selectedIndex: 0 };
const SpotlightCommands = [
  { name: 'Switch to Jobs View', desc: 'Navigate to jobs listings and pipeline', action: () => navigateToTab('jobs'), shortcut: 'Alt+1' },
  { name: 'View Usage Overview', desc: 'Track funnel metrics and analytics tables', action: () => navigateToTab('analytics'), shortcut: 'Alt+2' },
  { name: 'View Team Access Logs', desc: 'Manage team invites, roles, and security', action: () => navigateToTab('team'), shortcut: 'Alt+4' },
  { name: 'Configure Career Subdomain', desc: 'Update public career subdomain configurations', action: () => navigateToTab('career'), shortcut: 'Alt+5' },
  { name: 'Open Job Creator Drawer', desc: 'Create a new recruitment pipeline job card', action: () => openDrawer('job'), shortcut: 'Alt+N' },
  { name: 'Open Invitation Drawer', desc: 'Invite a new team member or manager', action: () => openDrawer('member'), shortcut: 'Alt+I' },
  { name: 'Change Security Settings', desc: 'Change password credential settings', action: () => navigateToSubtab('settings-password'), shortcut: 'Alt+P' },
  { name: 'Cookie Settings', desc: 'Manage session privacy cookie settings', action: () => navigateToSubtab('settings-cookies'), shortcut: 'Alt+C' }
];


function toggleSpotlightModal(show) {
  const modal = document.getElementById('spotlight-modal');
  if (!modal) return;
  
  if (show) {
    modal.classList.add('active');
    const input = document.getElementById('spotlight-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    spotlightUi.selectedIndex = 0;
    renderSpotlightResults();
    soundEngine.playClick();
  } else {
    modal.classList.remove('active');
  }
}

function renderSpotlightResults() {
  const listContainer = document.getElementById('spotlight-results-list');
  if (!listContainer) return;
  
  const input = document.getElementById('spotlight-input');
  const query = input ? input.value.toLowerCase().trim() : '';
  listContainer.innerHTML = '';
  
  const filtered = SpotlightCommands.filter(cmd => {
    return cmd.name.toLowerCase().includes(query) || cmd.desc.toLowerCase().includes(query);
  });
  
  if (filtered.length === 0) {
    listContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">No command shortcuts match your query</div>`;
    return;
  }
  
  if (spotlightUi.selectedIndex >= filtered.length) {
    spotlightUi.selectedIndex = filtered.length - 1;
  }
  if (spotlightUi.selectedIndex < 0) {
    spotlightUi.selectedIndex = 0;
  }
  
  filtered.forEach((cmd, idx) => {
    const item = document.createElement('div');
    const isSelected = idx === spotlightUi.selectedIndex;
    item.className = 'spotlight-item' + (isSelected ? ' selected' : '');
    
    let iconSvg = '';
    if (cmd.name.includes('Jobs') || cmd.name.includes('Job')) {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`;
    } else if (cmd.name.includes('Usage') || cmd.name.includes('Overview')) {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`;
    } else if (cmd.name.includes('Team') || cmd.name.includes('Invite')) {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>`;
    } else {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    }
    
    item.innerHTML = `
      <div class="item-left">
        ${iconSvg}
        <span class="cmd-name">${cmd.name}</span>
        <span class="cmd-desc">${cmd.desc}</span>
      </div>
      <span class="cmd-shortcut"><kbd>${cmd.shortcut}</kbd></span>
    `;
    
    item.addEventListener('click', () => {
      toggleSpotlightModal(false);
      cmd.action();
    });
    
    listContainer.appendChild(item);
  });
}

// Global window key listeners for shortcuts
function initSpotlightShortcuts() {
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modal = document.getElementById('spotlight-modal');
    const isActive = modal ? modal.classList.contains('active') : false;
    toggleSpotlightModal(!isActive);
  }
  
  if (e.key === 'Escape') {
    const modal = document.getElementById('spotlight-modal');
    if (modal && modal.classList.contains('active')) {
      toggleSpotlightModal(false);
    } else {
      closeDrawers();
    }
  }
  
  if (e.altKey) {
    if (e.key === '1') { e.preventDefault(); navigateToTab('jobs'); }
    else if (e.key === '2') { e.preventDefault(); navigateToTab('analytics'); }
    else if (e.key === '4') { e.preventDefault(); navigateToTab('team'); }
    else if (e.key === '5') { e.preventDefault(); navigateToTab('career'); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openDrawer('job'); }
    else if (e.key.toLowerCase() === 'i') { e.preventDefault(); openDrawer('member'); }
    else if (e.key.toLowerCase() === 'p') { e.preventDefault(); navigateToSubtab('settings-password'); }
    else if (e.key.toLowerCase() === 'c') { e.preventDefault(); navigateToSubtab('settings-cookies'); }
  }
});
}


export { initSpotlightShortcuts, renderSpotlightResults, SpotlightCommands, spotlightUi, toggleSpotlightModal };
