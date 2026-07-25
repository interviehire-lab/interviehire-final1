export const html = `
<!-- Scene / Background -->
    <div class="scene">
      <canvas id="crystal-shader-canvas"></canvas>
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
      <div class="orb orb-4"></div>
    </div>
    <div class="noise"></div>

    <!-- Dashboard App Grid -->
    <div class="dashboard-app">
      
      <!-- Left Sidebar Navigation -->
      <aside class="sidebar">
        <!-- Sidebar Header -->
        <div class="sidebar-header">
          <a href="/" class="logo-area">
            <div class="logo-mark">iH</div>
            <span class="logo-text">Intervie<span class="logo-highlight">Hire</span></span>
          </a>
        </div>

        <!-- Navigation Menu -->
        <nav class="sidebar-nav">
          <ul>
            <li class="nav-item active" data-tab="jobs">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              <span>Jobs</span>
            </li>
            <li class="nav-item" data-tab="analytics">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              <span>Usage Overview</span>
            </li>
            <li class="nav-item" data-tab="swarm">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="2" y1="20" x2="22" y2="20"></line>
                <line x1="5" y1="17" x2="19" y2="17"></line>
                <circle cx="12" cy="10" r="2"></circle>
              </svg>
              <span>AI Swarm</span>
            </li>
            <li class="nav-item" data-tab="talent">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <path d="M8 11h6"></path>
              </svg>
              <span>Talent Finder</span>
            </li>
            <li class="nav-item" data-tab="team">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <span>Team Access</span>
            </li>
            <li class="nav-item" data-tab="career">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
              <span>Career Page</span>
            </li>
            <li class="nav-item" data-tab="data-rights">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>Data Rights</span>
            </li>
            <li class="nav-item has-sub" data-tab="settings">
              <div class="nav-item-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>Settings</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <ul class="sub-nav">
                <li data-subtab="settings-general">General Settings</li>
              </ul>
            </li>
          </ul>
        </nav>

        <!-- Sidebar Footer -->
        <div class="sidebar-footer">
          <!-- Free Trial Plan Card -->
          <div class="card-plan">
            <div class="plan-header">
              <span class="plan-badge">Free Trial</span>
              <span class="plan-alert">Plan expired</span>
            </div>
            <button class="btn-upgrade">Upgrade Plan</button>
          </div>
          
          <!-- User Profile -->
          <div class="user-profile">
            <div class="user-avatar">D</div>
            <div class="user-info">
              <div class="user-name">Account</div>
              <div class="user-role">Org. Admin</div>
            </div>
            <button class="btn-logout" aria-label="Logout">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main Dashboard Container -->
      <main class="main-content">
        
        <!-- Header Bar -->
        <header class="dashboard-header">
          <div class="header-left">
            <button id="btn-toggle-sidebar" class="sidebar-toggle" aria-label="Toggle Sidebar">
              <svg class="icon-toggle" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
            <div class="breadcrumbs">
              <span class="breadcrumb-link" id="bc-portal-link">Client Portal</span>
              <span class="breadcrumb-separator">/</span>
              <span class="breadcrumb-item active" id="breadcrumb-title">Jobs</span>
            </div>
          </div>
          
          <div class="header-right">
            <!-- Search field -->
            <div class="search-box">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="global-search" placeholder="Search jobs, candidates..." />
            </div>

            <!-- Organisation Switcher (super-admin only; revealed by JS) -->
            <div class="org-switcher" id="org-switcher" style="display:none;">
              <button class="btn-org-switcher" id="btn-org-switcher" aria-haspopup="true" aria-expanded="false" title="Switch organisation">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 8h1"/><path d="M9 12h1"/><path d="M9 16h1"/><path d="M14 8h1"/><path d="M14 12h1"/><path d="M14 16h1"/></svg>
                <span class="org-switcher-label" id="org-switcher-label">Organisation</span>
                <svg class="org-switcher-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div class="bulk-actions-dropdown org-switcher-menu" id="org-switcher-menu" style="display:none;"></div>
            </div>

            <!-- Theme Toggle Button -->
            <button class="btn-theme-toggle" id="btn-theme-toggle" aria-label="Toggle Theme">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-sun"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            </button>
            <!-- Interview Settings Button -->
            <button class="btn-theme-toggle" id="btn-interview-settings" aria-label="Interview Settings" title="Interview Settings">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <!-- Contextual action button -->
            <button class="btn-action" id="header-action-btn">
              <span class="btn-icon">+</span>
              <span id="header-action-btn-text">New Job</span>
            </button>
          </div>
        </header>

        <!-- View Body Content -->
        <div class="dashboard-view-body">
          <!-- Dashboard Greeting Banner -->
          <div class="dashboard-banner-wrapper" id="dashboard-banner-wrapper">
            <h1 class="header-heading" id="header-main-title">Good morning</h1>
            <p class="header-subheading" id="header-sub-text">A squad of AI agents working for you</p>
          </div>
          
          <!-- ===================================== -->
          <!-- JOBS LIST VIEW (TAB 1) -->
          <!-- ===================================== -->
          <section class="dashboard-view active-view" id="view-jobs">
            <!-- Filtering Sub-bar -->
            <div class="view-filter-bar">
              <div class="filter-options">
                <button class="filter-tab active" data-filter="all">All (<span class="count-all">2</span>)</button>
                <button class="filter-tab" data-filter="published">Published (<span class="count-published">2</span>)</button>
                <button class="filter-tab" data-filter="draft">Draft (<span class="count-draft">0</span>)</button>
                <button class="filter-tab" data-filter="archived">Archived (<span class="count-archived">0</span>)</button>
              </div>

              <!-- Layout view selectors -->
              <div class="layout-toggle-group">
                <button class="layout-toggle-btn active" id="btn-view-cards" title="Cards View">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>
                </button>
                <button class="layout-toggle-btn" id="btn-view-board" title="List View">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
              </div>

              <div class="filter-meta">
                <span class="meta-label">Created by:</span>
                <select class="meta-select" id="jobs-creator-select">
                  <option value="all">All</option>
                  <option value="me">Me</option>
                </select>
              </div>
            </div>

            <!-- Jobs Cards Grid -->
            <div class="jobs-cards-grid" id="jobs-list-container">
              <!-- Dynamically populated via JS -->
            </div>

            <!-- Kanban board wrapper -->
            <div class="kanban-board-container" id="jobs-board-container" style="display: none;">
              <div class="kanban-column" data-stage="Resume">
                <h3 class="kanban-col-title">Resume Analysis (<span class="col-count" id="board-count-resume">0</span>)</h3>
                <div class="kanban-cards-list" id="col-resume"></div>
              </div>
              <div class="kanban-column" data-stage="Screening">
                <h3 class="kanban-col-title">Recruiter Screening (<span class="col-count" id="board-count-screening">2</span>)</h3>
                <div class="kanban-cards-list" id="col-screening"></div>
              </div>
              <div class="kanban-column" data-stage="Functional">
                <h3 class="kanban-col-title">Functional Interview (<span class="col-count" id="board-count-functional">2</span>)</h3>
                <div class="kanban-cards-list" id="col-functional"></div>
              </div>
              <div class="kanban-column" data-stage="Hired">
                <h3 class="kanban-col-title">Hired (<span class="col-count" id="board-count-hired">0</span>)</h3>
                <div class="kanban-cards-list" id="col-hired"></div>
              </div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- ANALYTICS VIEW (TAB 2) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-analytics">
            <!-- Date Range Bar -->
            <div class="date-range-bar">
              <div class="date-range-wrap" id="analytics-date-range-wrap">
                <button class="btn-date-range-trigger" id="btn-analytics-daterange">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  <span id="analytics-daterange-label">All Time</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="date-range-dropdown" id="analytics-daterange-dropdown">
                  <div class="dr-presets">
                    <button class="dr-preset active" data-range="all">All Time</button>
                    <button class="dr-preset" data-range="7d">Last 7 Days</button>
                    <button class="dr-preset" data-range="30d">Last 30 Days</button>
                    <button class="dr-preset" data-range="90d">Last 90 Days</button>
                  </div>
                  <div class="dr-divider"></div>
                  <div class="dr-calendar-section">
                    <label class="dr-label">Custom Range</label>
                    <div class="dr-calendar-inputs">
                      <div class="dr-cal-field">
                        <label>From</label>
                        <input type="date" id="date-from" class="date-input" />
                      </div>
                      <div class="dr-cal-field">
                        <label>To</label>
                        <input type="date" id="date-to" class="date-input" />
                      </div>
                    </div>
                    <button class="dr-apply-btn" id="dr-apply-custom">Apply</button>
                  </div>
                </div>
              </div>
              <select class="date-range-select" id="date-range-select" style="display:none;">
                <option value="all" selected>All Time</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <!-- Metrics Row -->
            <div class="metrics-grid">
              <!-- Metric 1: Total Applicants -->
              <div class="card-metric">
                <div class="metric-header">
                  <div class="metric-icon-wrap icon-purple">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  </div>
                  <span class="metric-title">Total Applicants</span>
                  <span class="metric-val" id="stat-total-applicants">20</span>
                </div>
                <div class="metric-pills">
                  <div class="m-pill">Career Page <span class="v">0</span></div>
                  <div class="m-pill">Bulk Upload <span class="v">0</span></div>
                  <div class="m-pill">Scheduled <span class="v">3</span></div>
                  <div class="m-pill">Direct Link <span class="v">1</span></div>
                </div>
              </div>

              <!-- Metric 2: Resume Analysis -->
              <div class="card-metric">
                <div class="metric-header">
                  <div class="metric-icon-wrap icon-orange">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  </div>
                  <span class="metric-title">Resume Analysis</span>
                  <span class="metric-val" id="stat-resume-analysis">0</span>
                </div>
                <div class="metric-pills">
                  <div class="m-pill">Analysed <span class="v">0</span></div>
                  <div class="m-pill">Shortlisted <span class="v">0</span></div>
                  <div class="m-pill">Waitlisted <span class="v">0</span></div>
                </div>
              </div>

              <!-- Metric 3: Recruiter Screening -->
              <div class="card-metric">
                <div class="metric-header">
                  <div class="metric-icon-wrap icon-blue">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                  </div>
                  <span class="metric-title">Recruiter Screening</span>
                  <span class="metric-val" id="stat-recruiter-screening">3</span>
                </div>
                <div class="metric-pills">
                  <div class="m-pill">Attempted <span class="v">2</span></div>
                  <div class="m-pill">Scheduled <span class="v">1</span></div>
                  <div class="m-pill">Shortlisted <span class="v">0</span></div>
                  <div class="m-pill">Waitlisted <span class="v">0</span></div>
                </div>
              </div>

              <!-- Metric 4: Functional Interview -->
              <div class="card-metric">
                <div class="metric-header">
                  <div class="metric-icon-wrap icon-green">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  </div>
                  <span class="metric-title">Functional Interview</span>
                  <span class="metric-val" id="stat-functional-interview">2</span>
                </div>
                <div class="metric-pills">
                  <div class="m-pill">Attempted <span class="v">1</span></div>
                  <div class="m-pill">Scheduled <span class="v">1</span></div>
                  <div class="m-pill">Shortlisted <span class="v">0</span></div>
                  <div class="m-pill">Waitlisted <span class="v">0</span></div>
                </div>
              </div>
            </div>

            <!-- Table View Section -->
            <div class="table-card card-glass">
              <div class="table-tabs">
                <button class="table-tab-btn active" data-table="jobs-data">Jobs data</button>
                <button class="table-tab-btn" data-table="candidates-data">Candidate data <span class="badge-new">New</span></button>
              </div>

              <!-- Table Control Bar -->
              <div class="table-controls">
                <div class="ctrl-left">
                  <div class="search-mini">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" id="table-search" placeholder="Search table..." />
                  </div>
                  <button class="btn-ctrl-filter">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                    Filter
                  </button>
                </div>
                <div class="ctrl-right">
                  <button class="btn-ctrl-action" id="btn-columns-toggle">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                    Columns
                  </button>
                  <div class="columns-popup card-glass" id="pop-columns-toggle" style="display: none;"></div>
                  <button class="btn-ctrl-action" id="btn-export-jobs">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Export to Excel
                  </button>
                </div>
              </div>

              <!-- Table Data Viewport -->
              <div class="table-responsive">
                <table class="data-table" id="analytics-jobs-table">
                  <thead>
                    <tr>
                      <th data-sort="id">Job ID <span class="arrow">↕</span></th>
                      <th data-sort="role">Role Name <span class="arrow">↕</span></th>
                      <th data-sort="card">Card Name <span class="arrow">↕</span></th>
                      <th>Custom Job ID</th>
                      <th>Experience Band</th>
                      <th>Tags</th>
                      <th>Job Created By</th>
                      <th>Collaborators</th>
                      <th>Recruiters</th>
                    </tr>
                  </thead>
                  <tbody id="analytics-table-body">
                    <!-- Loaded dynamically via JS -->
                  </tbody>
                </table>
              </div>

              <!-- Table Footer Pagination -->
              <div class="table-footer">
                <span class="showing-txt" id="analytics-table-showing">Showing 1-2 of 2</span>
                <div class="pagination-wrap">
                  <span class="rows-select-wrap">
                    Rows per page:
                    <select class="rows-select" id="analytics-table-limit">
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                    </select>
                  </span>
                  <div class="pagination-pages">
                    <button class="btn-pag prev" disabled>Previous</button>
                    <span class="page-num">Page 1 of 1</span>
                    <button class="btn-pag next" disabled>Next</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- TEAM ACCESS VIEW (TAB 3) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-team">
            <!-- Team filtering filters -->
            <div class="view-filter-bar" style="margin-bottom: 20px;">
              <div class="filter-options" id="team-status-tabs">
                <button class="filter-tab active" data-team-filter="all">Team TOTAL (<span class="team-count-all">1</span>)</button>
                <button class="filter-tab" data-team-filter="active">Active (<span class="team-count-active">1</span>)</button>
                <button class="filter-tab" data-team-filter="invited">Invited (<span class="team-count-invited">0</span>)</button>
                <button class="filter-tab" data-team-filter="inactive">Inactive (<span class="team-count-inactive">0</span>)</button>
              </div>
            </div>

            <!-- Team Access Table -->
            <div class="table-card card-glass">
              <div class="table-controls">
                <div class="ctrl-left">
                  <div class="search-mini">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" id="team-search" placeholder="Search by name or email..." />
                  </div>
                  <select class="meta-select-styled" id="team-role-filter">
                    <option value="all">All Usertypes</option>
                    <option value="Org. Admin">Org. Admin</option>
                    <option value="Recruiter">Recruiter</option>
                    <option value="Interviewer">Interviewer</option>
                  </select>
                </div>
                <div class="ctrl-right">
                  <button class="btn-ctrl-action" id="btn-columns-team">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                    Columns
                  </button>
                  <div class="columns-popup card-glass" id="pop-columns-team" style="display: none;"></div>
                  <button class="btn-ctrl-action" id="btn-export-team">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Export
                  </button>
                </div>
              </div>

              <!-- Team table viewport -->
              <div class="table-responsive">
                <table class="data-table" id="team-members-table">
                  <thead>
                    <tr>
                      <th>Team Member</th>
                      <th>Designation</th>
                      <th>Usertype</th>
                      <th>Registered On</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="team-table-body">
                    <!-- Dynamically populated via JS -->
                  </tbody>
                </table>
              </div>

              <!-- Team Table Footer -->
              <div class="table-footer">
                <span class="showing-txt" id="team-table-showing">Showing 1-1 of 1</span>
                <div class="pagination-wrap">
                  <span class="rows-select-wrap">
                    Rows per page:
                    <select class="rows-select" id="team-table-limit">
                      <option value="20">20</option>
                      <option value="50">50</option>
                    </select>
                  </span>
                  <div class="pagination-pages">
                    <button class="btn-pag prev" disabled>Previous</button>
                    <span class="page-num">Page 1 of 1</span>
                    <button class="btn-pag next" disabled>Next</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- AI SWARM VIEW (TAB 2.5) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-swarm">
            <div class="swarm-layout">
              <!-- Agents Cards Grid -->
              <div class="agents-status-grid">
                <!-- Agent Lina -->
                <div class="card-glass agent-card" id="agent-aria">
                  <div class="agent-avatar-status">
                    <div class="agent-pic">AR</div>
                    <span class="pulse-dot green"></span>
                  </div>
                  <div class="agent-meta">
                    <h3 class="agent-name">Lina</h3>
                    <p class="agent-role-lbl">Resume Analyst Agent</p>
                    <p class="agent-status-msg" id="aria-status">Monitoring candidate submissions...</p>
                  </div>
                </div>
                <!-- Agent Kaelen -->
                <div class="card-glass agent-card" id="agent-kaelen">
                  <div class="agent-avatar-status">
                    <div class="agent-pic">KL</div>
                    <span class="pulse-dot green"></span>
                  </div>
                  <div class="agent-meta">
                    <h3 class="agent-name">Kaelen</h3>
                    <p class="agent-role-lbl">Technical Vetting Specialist</p>
                    <p class="agent-status-msg" id="kaelen-status">Generating code challenge rubrics...</p>
                  </div>
                </div>
                <!-- Agent Lyra -->
                <div class="card-glass agent-card" id="agent-lyra">
                  <div class="agent-avatar-status">
                    <div class="agent-pic">LY</div>
                    <span class="pulse-dot orange"></span>
                  </div>
                  <div class="agent-meta">
                    <h3 class="agent-name">Lyra</h3>
                    <p class="agent-role-lbl">HR Communications Bot</p>
                    <p class="agent-status-msg" id="lyra-status">Idle. Waiting for candidate triggers...</p>
                  </div>
                </div>
              </div>

              <!-- Terminal console logs -->
              <div class="card-glass terminal-box">
                <div class="terminal-header">
                  <div class="terminal-dots">
                    <span class="dot red"></span>
                    <span class="dot yellow"></span>
                    <span class="dot green"></span>
                  </div>
                  <span class="terminal-title">A.I. Swarm Ticker Activity Feed</span>
                </div>
                <div class="terminal-body" id="swarm-terminal-body">
                  <div class="term-log"><code>[10:42:01] Lina:</code> System diagnostics initiated. Swarm link online.</div>
                  <div class="term-log"><code>[10:42:15] Lyra:</code> Syncing candidate databases with email queue...</div>
                  <div class="term-log font-gold"><code>[10:43:02] Kaelen:</code> Dispatched coding test to Candidate CAN-8234-EA1.</div>
                </div>
                <div class="terminal-input-wrap">
                  <span class="terminal-prompt">&gt;</span>
                  <input type="text" id="swarm-prompter" placeholder="Ask the AI Swarm to do something... (e.g. 'Lina, search for Go devs')" />
                  <button id="btn-swarm-prompt" class="btn-term-send">Send</button>
                </div>
              </div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- TALENT FINDER VIEW (top-level page) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-talent">
            <!-- Rendered by talent-finder-panel.js into #jd-pane-talent -->
            <div id="jd-pane-talent">
              <div class="tf-muted" style="padding:20px">Loading Talent Finder…</div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- CAREER PAGE VIEW (TAB 4) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-career">
            <div class="config-grid">
              <div class="card-glass panel-setting">
                <h3 class="panel-title">Career Page Settings</h3>
                <p class="panel-desc">Configure your public career subdomain page and listing styling rules.</p>
                
                <form class="settings-form" id="career-settings-form">
                  <div class="form-group">
                    <label for="career-subdomain">Company Subdomain</label>
                    <div class="input-prefix-wrap">
                      <span class="prefix">interviehire.com/careers/</span>
                      <input type="text" id="career-subdomain" value="devasri-tech" required />
                    </div>
                  </div>
                  <div class="form-group">
                    <label for="career-theme">Portal Theme Mode</label>
                    <select id="career-theme">
                      <option value="dark">Dark Slate Brand Theme (Default)</option>
                      <option value="light">Crisp Editorial Light Theme</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="career-intro">Hero Headline Introduction</label>
                    <input type="text" id="career-intro" value="Build the future of technology with us." />
                  </div>
                  <button type="submit" class="btn-submit">Save Configurations</button>
                </form>
              </div>

              <div class="card-glass panel-preview">
                <h3 class="panel-title">Live Subdomain Status</h3>
                <div class="status-indicator-box">
                  <span class="pulsing-dot green"></span>
                  <div class="status-text">
                    <div class="status-title">Live & Active</div>
                    <a href="https://interviehire.com/careers/devasri-tech" target="_blank" class="status-link">interviehire.com/careers/devasri-tech ↗</a>
                  </div>
                </div>
                <div class="meta-metric-box">
                  <div class="sub-metric">
                    <span class="lbl">Subdomain Visits</span>
                    <span class="val">142</span>
                  </div>
                  <div class="sub-metric">
                    <span class="lbl">Apply Rate</span>
                    <span class="val">12.4%</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Jobs live on the public career page — the dashboard-side record +
                 quick-manage list. Static shell filled by renderCareerJobs()
                 (career-panel.js); mirrors the #jobs-list-container pattern. -->
            <section class="card-glass career-jobs-panel">
              <h3 class="panel-title">Jobs on your career page</h3>
              <p class="panel-desc">These roles are live on your public career page right now. Remove one to take it down instantly.</p>
              <div id="career-jobs-list"></div>
            </section>

            <!-- Company-wide default application questions. Static shell filled by
                 renderOrgApplicationQuestions() (application-questions-editor.ts). -->
            <section class="card-glass" id="career-questions-editor" style="margin-top:16px;"></section>
          </section>

          <!-- ===================================== -->
          <!-- DATA RIGHTS VIEW (DSAR) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-data-rights">
            <section class="card-glass">
              <h3 class="panel-title">Data-rights requests</h3>
              <p class="panel-desc">Access, correction, and deletion requests from candidates (DPDP Act 2023). Click a row for its audit trail.</p>
              <div id="dsar-requests-list"></div>
            </section>
          </section>

          <!-- ===================================== -->
          <!-- SETTINGS VIEWS (SUBTABS) -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-settings-general">
            <div class="settings-unified">

              <div class="settings-section">
                <h4 class="settings-section-title">Account & Security</h4>
                <p class="settings-section-desc">Manage your login credentials and authentication.</p>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Email Address</span>
                    <span class="settings-row-hint">vanshmalik6606@gmail.com</span>
                  </div>
                  <button class="settings-btn-action" id="btn-change-email">Change</button>
                </div>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Password</span>
                    <span class="settings-row-hint">Last changed 30 days ago</span>
                  </div>
                  <button class="settings-btn-action" id="btn-change-password">Update Password</button>
                </div>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Two-Factor Authentication</span>
                    <span class="settings-row-hint">Add an extra layer of security to your account</span>
                  </div>
                  <div class="settings-toggle" id="toggle-2fa"></div>
                </div>
              </div>

              <div class="settings-section">
                <h4 class="settings-section-title">Notifications</h4>
                <p class="settings-section-desc">Control how and when you receive alerts.</p>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Email Notifications</span>
                    <span class="settings-row-hint">Get notified when candidates apply or interviews complete</span>
                  </div>
                  <div class="settings-toggle active" id="toggle-email-notif"></div>
                </div>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Sound Effects</span>
                    <span class="settings-row-hint">Play chimes and click sounds in the dashboard</span>
                  </div>
                  <div class="settings-toggle active" id="toggle-sound"></div>
                </div>
              </div>

              <div class="settings-section">
                <h4 class="settings-section-title">Privacy & Data</h4>
                <p class="settings-section-desc">Manage cookies and data tracking preferences.</p>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Essential Cookies</span>
                    <span class="settings-row-hint">Required for session management. Cannot be disabled.</span>
                  </div>
                  <div class="settings-toggle active" style="opacity:0.5;pointer-events:none;"></div>
                </div>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Analytics Tracking</span>
                    <span class="settings-row-hint">Usage metrics and performance data collection</span>
                  </div>
                  <div class="settings-toggle active" id="toggle-analytics"></div>
                </div>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Export My Data</span>
                    <span class="settings-row-hint">Download a copy of all your stored data</span>
                  </div>
                  <button class="settings-btn-action" id="btn-export-data">Export</button>
                </div>
              </div>

              <div class="settings-section">
                <h4 class="settings-section-title">Appearance</h4>
                <p class="settings-section-desc">Customize the look and feel of your dashboard.</p>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Dark Mode</span>
                    <span class="settings-row-hint">Switch between light and dark themes</span>
                  </div>
                  <div class="settings-toggle active" id="toggle-dark-mode"></div>
                </div>
              </div>

              <div class="settings-section" style="border-color: rgba(239,68,68,0.15);">
                <h4 class="settings-section-title" style="color: #f87171;">Danger Zone</h4>
                <p class="settings-section-desc">Irreversible actions. Proceed with caution.</p>
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Delete Account</span>
                    <span class="settings-row-hint">Permanently remove your account and all data</span>
                  </div>
                  <button class="settings-btn-action danger" id="btn-delete-account">Delete Account</button>
                </div>
              </div>

            </div>
          </section>

          <!-- ===================================== -->
          <!-- CREATE JOB VIEW -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-create-job">
            <div class="create-job-wrapper">

              <!-- Lina Requisition Banner -->
              <div class="aria-requisition-banner card-glass">
                <div class="aria-banner-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                </div>
                <div class="aria-banner-content">
                  <div class="aria-banner-title">
                    Lina Requisition: Create a new job by talking to Lina.
                    <span class="aria-time-badge">10–15 Min</span>
                  </div>
                  <p class="aria-banner-desc">Lina captures the hiring manager's requirements and automatically creates a structured, AI-powered interview.</p>
                </div>
                <button class="btn-start-aria" id="btn-start-aria-creation">
                  Start Creation <span style="font-size:1.1rem; margin-left:2px;">›</span>
                </button>
              </div>

              <!-- OR Divider -->
              <div class="create-job-or"><span>OR</span></div>

              <!-- JD Upload Section -->
              <div class="create-jd-section">
                <div class="create-jd-header">
                  <h3 class="create-jd-title">Create by Uploading a Job Description</h3>
                  <a href="#" class="create-jd-no-file" id="btn-no-file-click">No file? click here</a>
                </div>

                <!-- Paste textarea (hidden by default) -->
                <textarea id="create-jd-paste" class="create-jd-paste-area" placeholder="Paste your job description here..." style="display:none;"></textarea>

                <!-- Drop zone -->
                <div class="jd-dropzone" id="jd-dropzone" role="button" tabindex="0" aria-label="Upload a job description file — PDF, DOCX, or TXT">
                  <input type="file" id="jd-file-input" accept=".pdf,.docx,.txt" style="display:none;" />
                  <div class="dropzone-icon-wrap">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path></svg>
                  </div>
                  <p class="dropzone-title">Drag and drop your file here</p>
                  <p class="dropzone-sub">Supported Formats: .pdf, .docx &amp; .txt</p>
                  <div class="dropzone-file-preview" id="dropzone-file-preview" style="display:none;"></div>
                </div>

                <div class="create-job-footer">
                  <button class="btn-create-continue" id="btn-create-job-continue" aria-live="polite">
                    Continue
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </button>
                </div>
              </div>

            </div>
          </section>

          <!-- ===================================== -->
          <!-- ARIA CHAT VIEW -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-aria-chat">
            <div class="aria-chat-wrapper">
              <div class="aria-chat-messages" id="aria-chat-messages"></div>
              <div class="aria-chat-input-row">
                <input type="text" id="aria-chat-input" class="aria-chat-input" placeholder="Type your response to Lina..." autocomplete="off" />
                <button class="btn-aria-send" id="btn-aria-send">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
              </div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- JOB DETAIL VIEW -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-job-detail">

            <!-- Sub-nav: tabs + action bar -->
            <div class="jd-subnav">
              <div class="jd-tabs">
                <button class="jd-tab active" data-jd-tab="overview">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  Overview
                </button>
                <button class="jd-tab" data-jd-tab="apply">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                  Apply Link
                </button>
                <button class="jd-tab" data-jd-tab="resume">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  Resume Analysis
                </button>
                <button class="jd-tab" data-jd-tab="screening">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                  Recruiter Screening
                  <span class="jd-count-pill" id="jd-count-screening">0</span>
                </button>
                <button class="jd-tab" data-jd-tab="functional">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                  Functional Interview
                  <span class="jd-count-pill" id="jd-count-functional">0</span>
                </button>
                <button class="jd-tab" data-jd-tab="interviewanalysis">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path></svg>
                  Interview Analysis
                  <span class="jd-count-pill" id="jd-count-interviewanalysis">0</span>
                </button>
                <button class="jd-tab" data-jd-tab="questions">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line><circle cx="12" cy="12" r="10"></circle></svg>
                  Questions Generator
                </button>
                <button class="jd-tab" data-jd-tab="analysis">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                  Deep Analysis
                </button>
                <button class="jd-tab" data-jd-tab="testinterview">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Test Interview
                </button>
              </div>
              <div class="jd-actions">
                <div class="jd-search-wrap">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input type="text" id="jd-candidate-search" placeholder="Search candidate" />
                </div>
                <button class="btn-jd-ghost" id="btn-jd-collaborator">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  Add Collaborator
                </button>
                <button class="btn-jd-primary" id="btn-jd-add-applicants">+ Add Applicants</button>
                <div class="jd-date-range-wrap" id="jd-date-range-wrap">
                  <button class="btn-jd-ghost" id="btn-jd-daterange">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <span id="jd-daterange-label">All Time</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </button>
                  <div class="jd-daterange-dropdown" id="jd-daterange-dropdown">
                    <div class="jd-daterange-presets">
                      <button class="jd-dr-preset active" data-range="all">All Time</button>
                      <button class="jd-dr-preset" data-range="7d">7 Days</button>
                      <button class="jd-dr-preset" data-range="30d">30 Days</button>
                      <button class="jd-dr-preset" data-range="90d">90 Days</button>
                    </div>
                    <div class="jd-daterange-custom">
                      <div class="dr-cal-field">
                        <label>From</label>
                        <input type="date" id="jd-date-from" class="date-input" />
                      </div>
                      <div class="dr-cal-field">
                        <label>To</label>
                        <input type="date" id="jd-date-to" class="date-input" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tab panes -->
            <div class="jd-panes">

              <!-- Overview pane -->
              <div class="jd-pane active" id="jd-pane-overview">
                <div class="jd-overview-grid">

                  <!-- Left: Candidate Funnel -->
                  <div class="card-glass jd-funnel-card">
                    <div class="jd-panel-header">
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <h3 class="jd-card-title">Candidate Funnel</h3>
                    </div>
                    <div class="jd-funnel-body">
                      <div class="jd-funnel-stages" id="jd-funnel-stages"></div>
                      <div class="jd-funnel-chart-wrap">
                        <svg id="jd-funnel-svg" preserveAspectRatio="xMidYMid meet"></svg>
                      </div>
                    </div>
                    <div class="jd-funnel-legend">
                      <div class="jd-legend-item"><span class="jd-ldot" style="background:#6366f1"></span>Career Page</div>
                      <div class="jd-legend-item"><span class="jd-ldot" style="background:#06b6d4"></span>ATS</div>
                      <div class="jd-legend-item"><span class="jd-ldot" style="background:#f59e0b"></span>Bulk Upload</div>
                      <div class="jd-legend-item"><span class="jd-ldot" style="background:#ec4899"></span>Scheduled</div>
                      <div class="jd-legend-item"><span class="jd-ldot" style="background:#10b981"></span>Direct Link</div>
                    </div>
                  </div>

                  <!-- Right: Insights + Score Distribution -->
                  <div class="jd-right-panels">
                    <div class="card-glass jd-insights-card">
                      <div class="jd-panel-header">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        <h3 class="jd-card-title">Funnel Insights</h3>
                        <span class="jd-badge-tag">Recommendations</span>
                      </div>
                      <div class="jd-insights-body" id="jd-insights-body"></div>
                    </div>

                    <div class="card-glass jd-score-card">
                      <div class="jd-score-header">
                        <div class="jd-score-title-row">
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                          <h3 class="jd-card-title">Score Distribution</h3>
                        </div>
                        <select class="jd-score-select" id="jd-score-type">
                          <option value="interview">Interview Score</option>
                          <option value="resume">Resume Score</option>
                        </select>
                      </div>
                      <div class="jd-score-chart-wrap">
                        <svg id="jd-score-svg" preserveAspectRatio="xMidYMid meet"></svg>
                      </div>
                      <div class="jd-score-legend">
                        <span class="jd-legend-item"><span class="jd-ldot" style="background:#6366f1; border-radius:2px;"></span>Percentage</span>
                      </div>
                    </div>
                  </div>

                </div>

              </div><!-- /overview -->

              <!-- Apply Link pane — public apply link, QR, embed & deadline (renderApplyShare)
                   plus the per-job custom application questions (renderJobApplicationQuestions) -->
              <div class="jd-pane" id="jd-pane-apply">
                <div class="card-glass" id="jd-apply-share"></div>
                <div class="card-glass" id="jd-apply-questions" style="margin-top:16px;"></div>
              </div>

              <!-- Stage panes -->
              <div class="jd-pane" id="jd-pane-resume">
                <div class="jd-stage-candidates-list" id="list-stage-resume"></div>
              </div>
              <div class="jd-pane" id="jd-pane-screening">
                <div class="jd-stage-candidates-list" id="list-stage-screening"></div>
              </div>
              <div class="jd-pane" id="jd-pane-functional">
                <div class="jd-stage-candidates-list" id="list-stage-functional"></div>
              </div>

              <!-- Interview Analysis Pane (rendered by interview-analysis.js) -->
              <div class="jd-pane" id="jd-pane-interviewanalysis">
                <div class="jd-stage-candidates-list" id="list-stage-interviewanalysis"></div>
              </div>

              <!-- Questions Generator Pane (rendered by blueprint-studio.js) -->
              <div class="jd-pane" id="jd-pane-questions"></div>

              <div class="jd-pane" id="jd-pane-analysis">
                <div id="list-stage-analysis"></div>
              </div>

              <!-- Test Interview Pane (rendered by test-interview.js) -->
              <div class="jd-pane" id="jd-pane-testinterview">
                <div id="list-stage-testinterview"></div>
              </div>

            </div><!-- /jd-panes -->

          </section><!-- /view-job-detail -->

      <!-- Candidate Report (full page) -->
      <section class="dashboard-view" id="view-candidate-report">
        <div id="report-page-root"></div>
      </section>

          <!-- ===================================== -->
          <!-- JOB FLOW PIPELINE VIEW -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-job-flow">
            <div class="jf-layout">
              <div class="jf-pipeline-panel" id="jf-pipeline-panel"></div>
              <div class="jf-config-panel" id="jf-config-panel"></div>
            </div>
          </section>

          <!-- ===================================== -->
          <!-- SOURCING & MASS ADD APPLICANTS VIEW -->
          <!-- ===================================== -->
          <section class="dashboard-view" id="view-sourcing">
            <!-- Sourcing Sub-nav -->
            <div class="sourcing-nav-header">
              <div class="sourcing-breadcrumbs">
                <span class="breadcrumb-link" id="src-bc-jobs">Jobs</span>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-link" id="src-bc-jobname">Job Detail</span>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-item active">Sourcing</span>
              </div>
              <!-- Stage context banner — shown when arriving from a specific stage -->
              <div id="sourcing-stage-context" style="display:none;align-items:center;gap:8px;margin-top:6px;padding:5px 12px;background:rgba(var(--color-gold-rgb),0.08);border:1px solid rgba(var(--color-gold-rgb),0.2);border-radius:20px;font-size:0.75rem;color:var(--color-gold);font-family:var(--font-body);font-weight:500;">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Adding to: <strong id="sourcing-stage-label">Pipeline</strong>
              </div>
              <div class="sourcing-actions">
                <button class="btn-jd-ghost" id="btn-src-collaborator">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  Add Collaborator
                </button>
                <button class="btn-jd-ghost" id="btn-src-view-responses">
                  View Responses
                </button>
              </div>
            </div>

            <!-- Mode selector -->
            <div class="sourcing-mode-container">
              <div class="sourcing-mode-toggle">
                <button class="mode-toggle-btn" data-sourcing-mode="analyse">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                  Analyse Candidate Resumes
                </button>
                <button class="mode-toggle-btn active" data-sourcing-mode="schedule">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  Schedule AI Interviews
                </button>
              </div>
            </div>

            <!-- Tab selector cards -->
            <div class="sourcing-cards-grid" id="sourcing-cards-grid">
              <!-- Upload Sheet (CSV) -->
              <button class="sourcing-tab-card active" id="card-src-csv" data-sourcing-tab="csv">
                <span class="selection-dot"></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="card-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <div class="sourcing-card-text">
                  <span class="card-title">Upload Sheet (CSV)</span>
                  <span class="card-desc">Import candidates from a spreadsheet</span>
                </div>
              </button>

              <!-- Upload Resumes -->
              <button class="sourcing-tab-card" id="card-src-resumes" data-sourcing-tab="resumes">
                <span class="selection-dot"></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="card-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6M9 15l3-3 3 3"/></svg>
                <div class="sourcing-card-text">
                  <span class="card-title">Upload Resumes</span>
                  <span class="card-desc">Upload single or multiple resumes</span>
                </div>
              </button>

              <!-- Add Manually -->
              <button class="sourcing-tab-card" id="card-src-manual" data-sourcing-tab="manual">
                <span class="selection-dot"></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="card-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                <div class="sourcing-card-text">
                  <span class="card-title">Add Manually</span>
                  <span class="card-desc">Enter candidate details manually</span>
                </div>
              </button>

              <!-- Connect ATS -->
              <button class="sourcing-tab-card locked" id="card-src-ats" data-sourcing-tab="ats">
                <span class="lock-icon-badge">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="card-icon"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                <div class="sourcing-card-text">
                  <span class="card-title">Connect ATS</span>
                  <span class="card-desc">Import from your ATS</span>
                </div>
              </button>
            </div>

            <!-- Workspace Panels -->
            <div class="sourcing-workspace">

              <!-- CSV Panel -->
              <div class="sourcing-panel active" id="panel-src-csv">
                <div class="sourcing-dropzone-container" id="dropzone-csv">
                  <div class="dropzone-content">
                    <div class="dropzone-icon-wrap">
                      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    </div>
                    <h3>Drop your sheet as .csv file here</h3>
                    <p class="dropzone-sub">Columns: Name, Email, Phone (optional)</p>
                    <button class="btn-browse-file" id="btn-browse-csv">Browse Files</button>
                    <input type="file" id="input-file-csv" accept=".csv" style="display:none;" />
                  </div>
                </div>
                
                <div class="sourcing-panel-footer">
                  <span class="footer-help">Add candidate details like name, email and phone to a Sheet (CSV) <a href="#" class="guide-link">View guide</a></span>
                  <a href="#" class="btn-download-template" id="btn-download-csv-template">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download template
                  </a>
                </div>

                <!-- CSV Preview Section -->
                <div class="parsed-preview-box" id="csv-preview-box" style="display:none;">
                  <div class="preview-header">
                    <h4>Parsed Candidates (<span id="csv-parsed-count">0</span>)</h4>
                    <p>Verify details before importing</p>
                  </div>
                  <div class="preview-table-wrapper">
                    <table class="preview-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody id="csv-preview-rows"></tbody>
                    </table>
                  </div>
                  <div class="preview-actions">
                    <button class="btn-preview-cancel" id="btn-csv-cancel">Cancel</button>
                    <button class="btn-preview-confirm" id="btn-csv-import">Import Candidates</button>
                  </div>
                </div>
              </div>

              <!-- Resumes Panel -->
              <div class="sourcing-panel" id="panel-src-resumes" style="display:none;">
                <div class="sourcing-dropzone-container" id="dropzone-resumes">
                  <div class="dropzone-content">
                    <div class="dropzone-icon-wrap">
                      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6M9 15l3-3 3 3"/></svg>
                    </div>
                    <h3>Drop your file here</h3>
                    <p class="dropzone-sub">Accepts PDF, DOCX, and ZIP formats</p>
                    <button class="btn-browse-file" id="btn-browse-resumes">Browse Files</button>
                    <input type="file" id="input-file-resumes" accept=".pdf,.docx,.zip" multiple style="display:none;" />
                  </div>
                </div>
                
                <div class="sourcing-panel-footer">
                  <span class="footer-help">For multiple resumes, compress the resume folder into a ZIP file <a href="#" class="guide-link">View guide</a></span>
                </div>

                <!-- Resumes Uploading Section -->
                <div class="parsed-preview-box" id="resumes-preview-box" style="display:none;">
                  <div class="preview-header">
                    <h4>Uploading Resumes (<span id="resumes-upload-count">0</span>)</h4>
                    <p>AI agents are extracting details and creating profiles...</p>
                  </div>
                  <div class="uploaded-files-list" id="resumes-files-list"></div>
                  <div class="preview-actions">
                    <button class="btn-preview-cancel" id="btn-resumes-cancel">Cancel</button>
                    <button class="btn-preview-confirm" id="btn-resumes-import" disabled>Import Candidates</button>
                  </div>
                </div>
              </div>

              <!-- Manual Panel -->
              <div class="sourcing-panel" id="panel-src-manual" style="display:none;">
                <div class="manual-entry-grid">
                  <div class="manual-form-card card-glass">
                    <h4>Candidate Details</h4>
                    <form class="manual-candidate-form" id="form-manual-candidate">
                      <div class="form-group-custom">
                        <label for="manual-name">Full Name</label>
                        <div class="input-icon-wrap">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                          <input type="text" id="manual-name" placeholder="John Doe" required />
                        </div>
                      </div>
                      <div class="form-group-custom">
                        <label for="manual-email">Email Address</label>
                        <div class="input-icon-wrap">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                          <input type="email" id="manual-email" placeholder="john.doe@example.com" required />
                        </div>
                      </div>
                      <div class="form-group-custom">
                        <label for="manual-phone">Phone Number (Optional)</label>
                        <div class="input-icon-wrap">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          <input type="tel" id="manual-phone" placeholder="+1 (555) 019-2834" />
                        </div>
                      </div>
                      <button type="submit" class="btn-add-to-queue">Add to Queue</button>
                    </form>
                  </div>

                  <div class="manual-queue-card card-glass">
                    <div class="queue-header">
                      <h4>Queue for Import (<span id="manual-queue-count">0</span>)</h4>
                      <button class="btn-clear-queue" id="btn-clear-manual" style="display:none;">Clear All</button>
                    </div>
                    <div class="queue-list-wrapper">
                      <div class="queue-empty-state" id="manual-queue-empty">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                        <p>No candidates added to import queue yet.</p>
                      </div>
                      <ul class="queue-list" id="manual-queue-list"></ul>
                    </div>
                    <button class="btn-queue-confirm" id="btn-manual-import" disabled>Import Queue</button>
                  </div>
                </div>
              </div>

              <!-- ATS Panel -->
              <div class="sourcing-panel" id="panel-src-ats" style="display:none;">
                <div class="locked-feature-state card-glass">
                  <div class="lock-icon-large">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  </div>
                  <h3>ATS Integration is a Premium Feature</h3>
                  <p>Seamlessly import candidates and sync job statuses directly from Greenhouse, Lever, Workday, or BambooHR.</p>
                  <button class="btn-upgrade-sourcing">Upgrade to Enterprise</button>
                </div>
              </div>

            </div>
          </section><!-- /view-sourcing -->

        </div>
      </main>

      <!-- ===================================== -->
      <!-- SLIDE-OUT DRAWERS (FORM SECTIONS) -->
      <!-- ===================================== -->
      <!-- Modal: Edit Job Name -->
      <div class="modal-overlay" id="modal-edit-job" style="display: none;">
        <div class="modal-box">
          <div class="modal-header">
            <h2 class="modal-title">Edit Job Name</h2>
            <button class="modal-close-btn" id="modal-edit-job-close" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <div class="modal-field">
              <label class="modal-label">Job Name <span class="modal-required">*</span></label>
              <input type="text" id="modal-edit-job-name" class="modal-input" placeholder="Enter job name" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Job Id <span class="modal-optional">(optional)</span></label>
              <input type="text" id="modal-edit-job-id" class="modal-input" placeholder="e.g. 49298af015c842336b57a62a1" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Tags <span class="modal-optional">(optional)</span></label>
              <div class="modal-tags-wrap">
                <div class="modal-tags-list" id="modal-edit-tags-list"></div>
                <input type="text" id="modal-edit-tags-input" class="modal-input" placeholder="Type and press Enter or comma" />
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-save-btn" id="modal-edit-job-save">Save Changes</button>
          </div>
        </div>
      </div>

      <div class="drawer-overlay" id="drawer-backdrop"></div>

      <!-- Drawer: Job Creator -->
      <div class="slide-drawer" id="drawer-job">
        <div class="drawer-header">
          <h2 class="drawer-title">Create New Job</h2>
          <button class="btn-close-drawer" id="btn-close-drawer-job" aria-label="Close panel">×</button>
        </div>
        <div class="drawer-body">
          <form id="form-create-job">
            <div class="form-group">
              <label for="job-title-input">Job Card Title</label>
              <input type="text" id="job-title-input" placeholder="e.g. Senior Backend Engineer" required />
            </div>
            <div class="form-group">
              <label for="job-role-input">Role Type Name</label>
              <input type="text" id="job-role-input" placeholder="e.g. Go Backend Developer" required />
            </div>
            <div class="form-group">
              <label for="job-experience-input">Experience Band</label>
              <select id="job-experience-input">
                <option value="Fresher">Fresher</option>
                <option value="Upto 2 Years" selected>Upto 2 Years</option>
                <option value="1-4 Years">1-4 Years</option>
                <option value="3-6 Years">3-6 Years</option>
                <option value="5-10 Years">5-10 Years</option>
                <option value="8-15 Years">8-15 Years</option>
                <option value="10+ Years">10+ Years</option>
              </select>
            </div>
            <div class="form-group">
              <label for="job-custom-id">Custom Job ID (Optional)</label>
              <input type="text" id="job-custom-id" placeholder="e.g. AKRO62EF45E26E54" />
            </div>
            <div class="form-group">
              <label for="job-creator-input">Created By</label>
              <input type="text" id="job-creator-input" value="" readonly />
            </div>
            <div class="form-group">
              <label for="job-description-input">Job Description</label>
              <textarea id="job-description-input" placeholder="Enter detailed job description, responsibilities, and required skills..." rows="4"></textarea>
            </div>
            <div class="form-group">
              <label>Initial Pipeline Statuses</label>
              <div class="pipeline-checkbox-list">
                <label class="pipeline-check-item">
                  <input type="checkbox" id="chk-resume" checked />
                  <span>Resume Analysis</span>
                </label>
                <label class="pipeline-check-item">
                  <input type="checkbox" id="chk-screening" checked />
                  <span>Recruiter Screening</span>
                </label>
                <label class="pipeline-check-item">
                  <input type="checkbox" id="chk-functional" checked />
                  <span>Functional Interview</span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label>Interview Configuration</label>
              <div class="drawer-interview-config">
                <div class="drawer-config-item">
                  <span>Number of Questions</span>
                  <select id="drawer-cfg-num-q">
                    <option value="3">3</option>
                    <option value="5" selected>5</option>
                    <option value="7">7</option>
                    <option value="10">10</option>
                  </select>
                </div>
                <div class="drawer-config-item">
                  <span>Question Types</span>
                  <select id="drawer-cfg-types">
                    <option value="mixed" selected>Mixed</option>
                    <option value="technical">Technical</option>
                    <option value="behavioral">Behavioral</option>
                    <option value="situational">Situational</option>
                  </select>
                </div>
                <div class="drawer-config-item">
                  <span>Difficulty</span>
                  <select id="drawer-cfg-diff">
                    <option value="mixed" selected>Mixed</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
                <div class="drawer-config-item">
                  <span>Interview Duration</span>
                  <select id="drawer-cfg-duration">
                    <option value="15">15 min</option>
                    <option value="30" selected>30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
              </div>
            </div>
            <button type="submit" class="btn-drawer-submit">Create Job Card</button>
          </form>
        </div>
      </div>

      <!-- Drawer: Job Description View/Edit -->
      <div class="slide-drawer" id="drawer-view-jd">
        <div class="drawer-header">
          <h2 class="drawer-title">Job Description</h2>
          <button class="btn-close-drawer" id="btn-close-drawer-view-jd" aria-label="Close panel">×</button>
        </div>
        <div class="drawer-body">
          <div class="jd-viewer-container" style="display: flex; flex-direction: column; height: 100%;">
            <div class="form-group" style="flex-grow: 1; display: flex; flex-direction: column;">
              <label for="drawer-jd-text">Edit detailed requirements and skills for this role:</label>
              <textarea id="drawer-jd-text" style="flex-grow: 1; min-height: 250px; max-height: 450px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px; color: var(--color-text-primary); font-family: var(--font-body); font-size: 0.88rem; line-height: 1.5; outline: none;"></textarea>
            </div>
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px;">
              <button class="btn-drawer-submit" id="btn-save-drawer-jd">Save Description</button>
              <div style="display: flex; gap: 8px;">
                <button id="btn-enhance-drawer-jd" style="flex:1; padding: 9px 12px; background: rgba(212,175,55,0.08); border: 1px solid rgba(212,175,55,0.3); border-radius: 8px; color: var(--color-gold); font-size: 0.82rem; font-family: var(--font-body); cursor: pointer; transition: var(--spring-fast);">✨ Enhance with AI</button>
                <button id="btn-generate-from-drawer-jd" style="flex:1; padding: 9px 12px; background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; color: var(--color-indigo, #6366f1); font-size: 0.82rem; font-family: var(--font-body); cursor: pointer; transition: var(--spring-fast);">📋 Generate Questions</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Drawer: Member Inviter -->
      <div class="slide-drawer" id="drawer-member">
        <div class="drawer-header">
          <h2 class="drawer-title">Invite Member</h2>
          <button class="btn-close-drawer" id="btn-close-drawer-member" aria-label="Close panel">×</button>
        </div>
        <div class="drawer-body">
          <form id="form-invite-member">
            <div class="form-group">
              <label for="member-name-input">Full Name</label>
              <input type="text" id="member-name-input" placeholder="e.g. Aditya Rana" required />
            </div>
            <div class="form-group">
              <label for="member-email-input">Work Email</label>
              <input type="email" id="member-email-input" placeholder="e.g. aditya@interviehire.com" required />
            </div>
            <div class="form-group">
              <label for="member-designation-input">Designation</label>
              <input type="text" id="member-designation-input" placeholder="e.g. Technical Director" required />
            </div>
            <div class="form-group">
              <label for="member-role-input">Usertype Role</label>
              <select id="member-role-input">
                <option value="Org. Admin">Org. Admin</option>
                <option value="Recruiter">Recruiter (Screening)</option>
                <option value="Interviewer">Interviewer (Expert Vetting)</option>
              </select>
            </div>
             <button type="submit" class="btn-drawer-submit">Send Email Invitation</button>
          </form>
        </div>
      </div>

      <!-- Drawer: Agent Customizer -->
      <div class="slide-drawer" id="drawer-agent-config">
        <div class="drawer-header">
          <h2 class="drawer-title" id="agent-config-title">Customize Agent Config</h2>
          <button class="btn-close-drawer" id="btn-close-drawer-agent" aria-label="Close panel">×</button>
        </div>
        <div class="drawer-body">
          <form id="form-agent-config">
            <input type="hidden" id="config-agent-id" />
            <div class="form-group">
              <label for="agent-model-select">AI Model</label>
              <select id="agent-model-select">
                <option value="gpt-4o">GPT-4o (Premium Vetting)</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Analytical)</option>
                <option value="gemini-1-5-pro">Gemini 1.5 Pro (Deep Context)</option>
              </select>
            </div>
            <div class="form-group">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label for="agent-temp-slider">Creativity / Temperature</label>
                <span id="agent-temp-val" style="font-weight:600; font-family:var(--font-mono); color:var(--color-gold);">0.4</span>
              </div>
              <input type="range" id="agent-temp-slider" min="0" max="1" step="0.1" value="0.4" style="width:100%; margin-top:8px;" />
            </div>
            <div class="form-group">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label for="agent-threshold-slider">Match Threshold (%)</label>
                <span id="agent-threshold-val" style="font-weight:600; font-family:var(--font-mono); color:var(--color-indigo-light);">80%</span>
              </div>
              <input type="range" id="agent-threshold-slider" min="50" max="95" step="5" value="80" style="width:100%; margin-top:8px;" />
            </div>
            <div class="form-group">
              <label for="agent-prompt-input">Agent Instructions (System Prompt)</label>
              <textarea id="agent-prompt-input" rows="6" style="width:100%; font-family:var(--font-sans); background:var(--color-bg-dark); color:var(--color-text); border:1px solid var(--color-border); border-radius:4px; padding:8px; resize:vertical;"></textarea>
            </div>
            <button type="submit" class="btn-drawer-submit">Save Settings</button>
          </form>
        </div>
      </div>


      <!-- Modal: AI Question Enhancer -->
      <div class="modal-overlay" id="enhance-modal" style="display: none;">
        <div class="modal-card card-glass">
          <div class="modal-header">
            <h3 class="modal-title">✨ AI Question Enhancer</h3>
            <button class="btn-close-modal" id="btn-close-enhance-modal" aria-label="Close modal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="comparison-grid">
              <div class="comp-col">
                <label class="comp-label">Original Draft</label>
                <div class="comp-box-original" id="modal-original-text"></div>
              </div>
              <div class="comp-col">
                <label class="comp-label">Enhanced Question Text</label>
                <textarea id="modal-enhanced-text" class="input-glass" style="height: 120px; width: 100%; border-radius: 8px; border: 1px solid var(--glass-border); padding: 10px; color: var(--color-text-primary); background: rgba(0,0,0,0.2); font-family: var(--font-body);"></textarea>
              </div>
            </div>
            <div class="form-group-modal" style="margin-top: 16px;">
              <label class="comp-label">Suggested Evaluation Rubric</label>
              <textarea id="modal-rubric-text" class="input-glass" style="height: 80px; width: 100%; border-radius: 8px; border: 1px solid var(--glass-border); padding: 10px; color: var(--color-text-primary); background: rgba(0,0,0,0.2); font-family: var(--font-body);"></textarea>
            </div>
            <div class="form-group-modal" style="margin-top: 16px;">
              <label class="comp-label">Suggested Follow-Up Questions</label>
              <div class="follow-ups-list" id="modal-follow-ups" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                <!-- Dynamically populated list of inputs -->
              </div>
            </div>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
            <button class="btn-jd-ghost" id="btn-cancel-enhance">Discard</button>
            <button class="btn-jd-primary" id="btn-accept-enhance">Accept & Add to Rubric</button>
          </div>
        </div>
      </div>

      <!-- CMD+K Spotlight Command Bar -->
      <div class="spotlight-overlay" id="spotlight-modal">
        <div class="spotlight-box card-glass">
          <div class="spotlight-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="spotlight-input" placeholder="Type a command or search... (esc to close)" />
          </div>
          <div class="spotlight-results" id="spotlight-results-list">
            <!-- Dynamically populated commands / shortcuts -->
          </div>
          <div class="spotlight-footer">
            <span>Use ↑↓ to navigate, <kbd>Enter</kbd> to execute, <kbd>Esc</kbd> to exit</span>
          </div>
        </div>
      </div>

    </div>

    <!-- Interview Settings Modal -->
    <div class="iset-overlay" id="interview-settings-overlay">
      <div class="iset-modal">
        <div class="iset-header">
          <h3 class="iset-title">Interview Settings</h3>
          <button class="iset-close" id="btn-close-iset">&times;</button>
        </div>
        <div class="iset-body">
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><polyline points="9 11 12 14 22 4"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Interview status</span>
                <span class="iset-hint">Enable or disable the interview</span>
              </div>
            </div>
            <div class="settings-toggle active" id="iset-toggle-status"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Allow access on mobile</span>
                <span class="iset-hint">We recommend using desktop for better experience</span>
              </div>
            </div>
            <div class="settings-toggle" id="iset-toggle-mobile"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Allow late attempts</span>
                <span class="iset-hint">Enables candidates to attempt after the scheduled time</span>
              </div>
            </div>
            <div class="settings-toggle" id="iset-toggle-late"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Continue from middle</span>
                <span class="iset-hint">Candidates can resume from where they left off</span>
              </div>
            </div>
            <div class="settings-toggle active" id="iset-toggle-continue"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Allow reattempt</span>
                <span class="iset-hint">Enable candidates to reattempt the interview</span>
              </div>
            </div>
            <div class="settings-toggle" id="iset-toggle-reattempt"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Request candidate's CV</span>
              </div>
            </div>
            <div class="settings-toggle active" id="iset-toggle-cv"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Anti-Cheat Proctoring</span>
                <span class="iset-hint">Monitor candidates for suspicious behavior</span>
              </div>
            </div>
            <div class="settings-toggle active" id="iset-toggle-proctor"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">White labelled interview</span>
                <span class="iset-hint">Show your company branding in the interview room</span>
              </div>
            </div>
            <div class="settings-toggle" id="iset-toggle-whitelabel"></div>
          </div>
          <div class="iset-row">
            <div class="iset-row-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <div class="iset-row-info">
                <span class="iset-label">Allow interview access to</span>
              </div>
            </div>
            <select class="iset-select" id="iset-access">
              <option value="link" selected>Anyone with the link</option>
              <option value="invited">Invited candidates only</option>
              <option value="scheduled">Scheduled candidates only</option>
            </select>
          </div>
        </div>
        <div class="iset-footer">
          <button class="btn-jd-primary" id="btn-save-iset" style="width:100%;">Save Settings</button>
        </div>
      </div>
    </div>

    <!-- Scripts -->
    
`;
