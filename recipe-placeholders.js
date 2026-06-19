/**
 * 카테고리별 SVG 플레이스홀더 (베이지·오렌지 톤 라인 아이콘)
 * dishType 키 → SVG markup
 */
window.DISH_PLACEHOLDER_SVGS = {
  stew: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 22h28v14a4 4 0 01-4 4H14a4 4 0 01-4-4V22z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8 22h32" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M18 14h12v4H18v-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M20 8c0 2 1.5 3 4 3s4-1 4-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M24 5v2M30 6l-1 2M18 6l1 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  'fried-rice': `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="24" cy="30" rx="16" ry="6" stroke="currentColor" stroke-width="1.8"/>
    <path d="M8 30c0-10 7-16 16-16s16 6 16 16" stroke="currentColor" stroke-width="1.8"/>
    <path d="M16 26l2 2 4-4M26 24l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="20" cy="22" r="1.2" fill="currentColor"/><circle cx="28" cy="20" r="1.2" fill="currentColor"/><circle cx="24" cy="25" r="1.2" fill="currentColor"/>
  </svg>`,
  noodle: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="24" cy="32" rx="15" ry="5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M9 32c0-9 6.5-15 15-15s15 6 15 15" stroke="currentColor" stroke-width="1.8"/>
    <path d="M14 18c2 4 4 6 6 6M20 16c2 5 4 7 8 7M26 17c2 4 3 6 8 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  salad: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="24" cy="31" rx="14" ry="5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M10 31c0-8 6-14 14-14s14 6 14 14" stroke="currentColor" stroke-width="1.8"/>
    <path d="M18 20c-2 3-2 6 0 8M24 17c0 4 0 8 0 11M30 20c2 3 2 6 0 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  'rice-bowl': `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 28h32l-3 8H11l-3-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <ellipse cx="24" cy="28" rx="16" ry="4" stroke="currentColor" stroke-width="1.8"/>
    <path d="M16 22h16v4H16v-4z" fill="currentColor" opacity="0.25"/>
    <path d="M18 18c2-2 4-3 6-3s4 1 6 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  toast: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="12" y="10" width="24" height="28" rx="4" stroke="currentColor" stroke-width="1.8"/>
    <path d="M16 18h16M16 24h16M16 30h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    <rect x="12" y="10" width="24" height="8" rx="4" fill="currentColor" opacity="0.15"/>
  </svg>`,
  soup: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14 20h20v16a3 3 0 01-3 3H17a3 3 0 01-3-3V20z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 20h24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M20 12h8v4h-8v-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M22 8c0 1.5 1 2.5 2 2.5s2-1 2-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  'stir-fry': `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 28c4-2 8-3 12-3h8c4 0 8 1 12 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <ellipse cx="24" cy="28" rx="16" ry="5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M36 26l8-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="18" cy="24" r="1.5" fill="currentColor"/><circle cx="26" cy="22" r="1.5" fill="currentColor"/>
  </svg>`,
  pancake: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="24" cy="30" rx="14" ry="5" stroke="currentColor" stroke-width="1.8"/>
    <ellipse cx="24" cy="26" rx="12" ry="4" stroke="currentColor" stroke-width="1.8"/>
    <ellipse cx="24" cy="22" rx="10" ry="3.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M18 18l4-4M30 18l-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  </svg>`,
  snack: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="24" cy="24" r="12" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="20" cy="20" r="1.5" fill="currentColor"/><circle cx="28" cy="22" r="1.5" fill="currentColor"/><circle cx="24" cy="28" r="1.5" fill="currentColor"/>
    <path d="M24 12v-2M32 16l1.5-1.5M16 16l-1.5-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  </svg>`,
  sandwich: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 18l14-6 14 6v16l-14 6-14-6V18z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M10 24h28M10 30h28" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    <path d="M24 12v28" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  </svg>`,
  dessert: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 32h24l-4-14H16l-4 14z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M24 10v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="24" cy="8" r="2" fill="currentColor" opacity="0.4"/>
    <path d="M16 32h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  drink: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M16 14h16l-2 24H18L16 14z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M14 14h20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M28 10l4 4M32 14l-6 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M20 22h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  </svg>`,
  default: `<svg class="recipe-placeholder-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="24" cy="24" r="14" stroke="currentColor" stroke-width="1.8"/>
    <path d="M24 14v10l6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

window.DISH_TYPE_LABELS = {
  stew: '찌개',
  'fried-rice': '볶음밥',
  noodle: '면',
  salad: '샐러드',
  'rice-bowl': '덮밥',
  toast: '토스트',
  soup: '국',
  'stir-fry': '볶음',
  pancake: '전·부침',
  snack: '간식',
  sandwich: '샌드위치',
  dessert: '디저트',
  drink: '음료',
  default: '요리',
};
