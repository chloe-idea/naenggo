/**
 * 앱 네비게이션 SVG 아이콘 (베이지·오렌지 톤 라인)
 */
window.NAV_ICONS = {
  home: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-5v-5H10v5H5a1 1 0 01-1-1v-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  recipes: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 4h8a2 2 0 012 2v14a2 2 0 01-2-1.732H6V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M18 4h-8a2 2 0 00-2 2v14a2 2 0 002-1.732H18V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>
  </svg>`,
  community: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/>
    <path d="M4 12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M12 4c2.2 2.4 2.2 11.6 0 16M12 4c-2.2 2.4-2.2 11.6 0 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  planner: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M4 9h16M8 3v3M16 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M8 13h2M8 16h2M14 13h2M14 16h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  calendar: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M4 9h16M8 3v3M16 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="8" y="12" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.35"/>
    <rect x="13" y="12" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.35"/>
  </svg>`,
  fridge: `<svg class="nav-icon nav-icon--lg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M6 10h12" stroke="currentColor" stroke-width="1.6"/>
    <path d="M9 6.5v1M9 13v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M15 13v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
};

function initNavIcons() {
  const map = {
    main: NAV_ICONS.home,
    'my-recipes': NAV_ICONS.recipes,
    community: NAV_ICONS.community,
    planner: NAV_ICONS.planner,
    calendar: NAV_ICONS.calendar,
  };
  document.querySelectorAll('.tab-bar__item[data-view]').forEach((btn) => {
    const icon = btn.querySelector('.tab-bar__icon');
    if (icon && map[btn.dataset.view]) icon.innerHTML = map[btn.dataset.view];
  });
  const headerIcon = document.querySelector('.header__icon');
  if (headerIcon) headerIcon.innerHTML = NAV_ICONS.fridge;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavIcons);
} else {
  initNavIcons();
}
