import { getLang, t } from '../i18n/index.js';

const WIDTH = 1200;
const HEIGHT = 820;

// Node coordinates are shared by the HTML buttons and the SVG trail so the
// path always runs through the stage markers.
const POSITIONS = {
  numbers: [[200, 560], [330, 650], [470, 560]],
  fractions: [[720, 590], [850, 680], [1000, 570]],
  geometry: [[200, 240], [340, 160], [480, 240]],
  data: [[720, 220], [860, 140], [1000, 220]],
};

const REGION_LABELS = {
  numbers: [92, 470],
  fractions: [842, 500],
  geometry: [92, 112],
  data: [842, 70],
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function loc(value) {
  if (value == null) return '';
  if (typeof value === 'object' && !value.key && ('zh' in value || 'en' in value)) {
    return String(getLang() === 'zh' ? value.zh ?? '' : value.en ?? '');
  }
  return String(value);
}

function pct(value, total) {
  return `${Math.round((value / total) * 10000) / 100}%`;
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#${name}"></use></svg>`;
}

function stars(starsCount, max = 3) {
  const filled = Math.max(0, Math.min(max, Number(starsCount) || 0));
  return `<span class="map-node-stars" aria-label="${filled}/${max}">${[1, 2, 3].map((index) => `<span class="${index <= filled ? 'is-filled' : ''}">★</span>`).join('')}</span>`;
}

function trailPath() {
  const [n1, n2, n3] = POSITIONS.numbers;
  const [f1, f2, f3] = POSITIONS.fractions;
  const [g1, g2, g3] = POSITIONS.geometry;
  const [d1, d2, d3] = POSITIONS.data;
  return [
    `M ${n1[0]} ${n1[1]}`,
    `Q ${(n1[0] + n2[0]) / 2} ${n2[1] - 30} ${n2[0]} ${n2[1]}`,
    `Q ${(n2[0] + n3[0]) / 2} ${n3[1] + 24} ${n3[0]} ${n3[1]}`,
    `Q 590 ${n3[1] + 70} ${f1[0]} ${f1[1]}`,
    `Q ${(f1[0] + f2[0]) / 2} ${f2[1] - 24} ${f2[0]} ${f2[1]}`,
    `Q ${(f2[0] + f3[0]) / 2} ${f3[1] + 20} ${f3[0]} ${f3[1]}`,
    `Q 1100 380 ${d3[0]} ${d3[1]}`,
    `Q ${(d3[0] + d2[0]) / 2} ${d2[1] - 32} ${d2[0]} ${d2[1]}`,
    `Q ${(d2[0] + d1[0]) / 2} ${d1[1] + 28} ${d1[0]} ${d1[1]}`,
    `Q 560 150 ${g3[0]} ${g3[1]}`,
    `Q ${(g3[0] + g2[0]) / 2} ${g2[1] + 20} ${g2[0]} ${g2[1]}`,
    `Q ${(g2[0] + g1[0]) / 2} ${g1[1] - 18} ${g1[0]} ${g1[1]}`,
  ].join(' ');
}

function scenery() {
  return `
    <defs>
      <linearGradient id="wm-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#172452"/>
        <stop offset="0.55" stop-color="#14203f"/>
        <stop offset="1" stop-color="#091426"/>
      </linearGradient>
      <radialGradient id="wm-glow" cx="50%" cy="0%" r="75%">
        <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.32"/>
        <stop offset="0.55" stop-color="#67e8f9" stop-opacity="0.08"/>
        <stop offset="1" stop-color="#67e8f9" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="wm-grass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2f8f69"/>
        <stop offset="1" stop-color="#0d4a3c"/>
      </linearGradient>
      <linearGradient id="wm-forest" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1f6b54"/>
        <stop offset="1" stop-color="#0b3d34"/>
      </linearGradient>
      <linearGradient id="wm-crystal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c084fc"/>
        <stop offset="1" stop-color="#4c1d95"/>
      </linearGradient>
      <linearGradient id="wm-mountain" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f5c46b"/>
        <stop offset="0.5" stop-color="#a16207"/>
        <stop offset="1" stop-color="#3f2a12"/>
      </linearGradient>
      <linearGradient id="wm-skyisle" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#67e8f9"/>
        <stop offset="0.5" stop-color="#0e7490"/>
        <stop offset="1" stop-color="#083344"/>
      </linearGradient>
      <linearGradient id="wm-sand" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fde68a"/>
        <stop offset="1" stop-color="#b45309"/>
      </linearGradient>
      <filter id="wm-blur"><feGaussianBlur stdDeviation="14"/></filter>
      <filter id="wm-soft"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wm-sky)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wm-glow)"/>
    <!-- stars -->
    <g fill="#fff" opacity="0.7">
      <circle cx="112" cy="58" r="1.7"/><circle cx="262" cy="92" r="1.2"/><circle cx="418" cy="48" r="2"/><circle cx="562" cy="96" r="1.4"/>
      <circle cx="650" cy="40" r="1.6"/><circle cx="1094" cy="74" r="1.8"/><circle cx="1152" cy="178" r="1.3"/><circle cx="82" cy="310" r="1.5"/>
      <circle cx="1138" cy="342" r="1.2"/><circle cx="552" cy="330" r="1.1"/><circle cx="630" cy="520" r="1.7"/><circle cx="1030" cy="760" r="1.2"/>
    </g>
    <!-- sea waves -->
    <g fill="none" stroke="#67e8f9" stroke-width="2" opacity="0.13">
      <path d="M60 720q50-18 100 0t100 0 100 0 100 0"/>
      <path d="M580 760q50-18 100 0t100 0 100 0 100 0"/>
      <path d="M450 470q40-14 80 0t80 0 80 0"/>
      <path d="M80 420q40-14 80 0t80 0 80 0"/>
    </g>
    <!-- geometry peaks, top left -->
    <ellipse cx="300" cy="290" rx="310" ry="160" fill="#0f2c33" opacity="0.75"/>
    <path d="M-20 360 170 120 260 205 360 60 520 300 600 360Z" fill="url(#wm-mountain)"/>
    <path d="M280 90 320 150 355 110 410 190 360 250 270 210Z" fill="#f8e7bd" opacity="0.16"/>
    <path d="M94 220 160 150 220 220 250 300 40 300Z" fill="#0b1a27" opacity="0.3"/>
    <!-- data sky islands, top right -->
    <g opacity="0.9">
      <path d="M690 282 780 220 900 252 1000 196 1098 262 1074 330 940 354 820 330Z" fill="url(#wm-skyisle)" opacity="0.55" filter="url(#wm-soft)"/>
      <path d="M720 246 812 210 920 238 1008 200 1070 252 1042 300 930 316 820 296Z" fill="#0e7490" opacity="0.45"/>
      <path d="M760 250 830 238 900 254 870 278 790 276Z" fill="#a5f3fc" opacity="0.18"/>
    </g>
    <!-- fractions crystal cove, bottom right -->
    <ellipse cx="860" cy="650" rx="330" ry="170" fill="#1b1036" opacity="0.8"/>
    <path d="M560 700 660 590 790 560 960 590 1130 540 1180 660 1080 780 840 790 650 760Z" fill="url(#wm-crystal)" opacity="0.55"/>
    <path d="M700 690 745 520 790 690Z" fill="#c084fc" opacity="0.8"/>
    <path d="M760 700 810 450 862 700Z" fill="#a855f7" opacity="0.9"/>
    <path d="M840 710 900 520 950 710Z" fill="#7c3aed" opacity="0.9"/>
    <path d="M930 700 980 560 1030 700Z" fill="#c084fc" opacity="0.65"/>
    <g fill="#e9d5ff" opacity="0.45"><circle cx="770" cy="610" r="3"/><circle cx="870" cy="580" r="2"/><circle cx="950" cy="620" r="3"/></g>
    <!-- numbers meadow, bottom left -->
    <ellipse cx="300" cy="650" rx="340" ry="190" fill="#102f2a" opacity="0.85"/>
    <path d="M-40 700 60 560 220 520 420 550 540 650 500 800 240 820 20 780Z" fill="url(#wm-grass)" opacity="0.78"/>
    <path d="M80 660 150 590 240 610 310 560 400 620 470 600 510 700 380 760 180 770Z" fill="url(#wm-forest)" opacity="0.8"/>
    <!-- trees -->
    <g>
      <g transform="translate(120 590)"><path d="M0 50 22 0 44 50Z" fill="#0b3d34"/><rect x="18" y="46" width="8" height="18" fill="#5b3a1e"/></g>
      <g transform="translate(270 540)"><path d="M0 62 28 0 56 62Z" fill="#14532d"/><rect x="24" y="56" width="8" height="22" fill="#5b3a1e"/></g>
      <g transform="translate(420 600)"><path d="M0 48 22 0 44 48Z" fill="#166534"/><rect x="18" y="44" width="8" height="18" fill="#5b3a1e"/></g>
      <g transform="translate(540 650)"><path d="M0 40 18 0 36 40Z" fill="#0b3d34"/><rect x="14" y="36" width="8" height="16" fill="#5b3a1e"/></g>
    </g>
    <!-- little houses -->
    <g fill="#fbbf24" opacity="0.85"><rect x="190" y="650" width="24" height="18" rx="3"/><path d="M186 650 202 636 218 650Z" fill="#b45309"/><rect x="200" y="657" width="5" height="11" fill="#3b1d05"/></g>
    <!-- clouds -->
    <g fill="#cffafe" opacity="0.18" filter="url(#wm-blur)">
      <ellipse cx="180" cy="120" rx="110" ry="34"/><ellipse cx="960" cy="90" rx="130" ry="38"/><ellipse cx="650" cy="420" rx="120" ry="30"/>
    </g>
    <!-- compass rose -->
    <g transform="translate(1120 710)" opacity="0.55">
      <circle r="34" fill="none" stroke="#c4b5fd" stroke-width="1.5"/>
      <path d="M0-26 8-4 0 4-8-4Z" fill="#67e8f9"/><path d="M0 26 8 4 0-4-8 4Z" fill="#8b5cf6"/>
      <text y="-40" text-anchor="middle" fill="#e9d5ff" font-size="13" font-family="serif">N</text>
    </g>
  `;
}

export function worldMapHTML(map, options = {}) {
  const domains = map.domains || [];
  const allStages = domains.flatMap((domain) => domain.stages.map((stage) => ({ ...stage, domain })));
  const current = allStages.find((stage) => stage.unlocked && !stage.completed)
    || [...allStages].reverse().find((stage) => stage.unlocked)
    || allStages[0];
  const currentKey = options.currentKey || current?.key;
  const currentStage = allStages.find((stage) => stage.key === currentKey) || current;
  const currentPos = currentStage ? stagePosition(currentStage) : null;

  const nodes = domains.map((domain) => domain.stages.map((stage) => {
    const position = stagePosition(stage, domain.id);
    if (!position) return '';
    const classes = [
      'map-node',
      stage.bestStars > 0 ? 'is-completed' : '',
      stage.unlocked ? 'is-unlocked' : 'is-locked',
      stage.key === currentKey ? 'is-current' : '',
    ].filter(Boolean).join(' ');
    const label = `${loc(stage.name)} · ${loc(stage.monster.name)} · ${t('map.stageStars', { stars: stage.bestStars })}${stage.unlocked ? '' : ` · ${t('aria.lockedStage')}`}`;
    const stateIcon = !stage.unlocked ? icon('icon-lock') : stage.bestStars > 0 ? icon('icon-check') : stage.key === currentKey ? icon('icon-bolt') : '';
    return `
      <button class="${classes}" type="button"
        data-action="start-battle" data-stage-key="${esc(stage.key)}"
        style="--x:${pct(position[0], WIDTH)};--y:${pct(position[1], HEIGHT)};--accent:${domain.accent || '#8b5cf6'}"
        ${stage.unlocked ? '' : 'disabled'}
        aria-label="${esc(label)}">
        <span class="map-node-halo" aria-hidden="true"></span>
        <span class="map-node-disc">
          <svg class="map-node-monster" viewBox="0 0 240 220" aria-hidden="true"><use href="#monster-${esc(stage.monster.id)}"></use></svg>
          <span class="map-node-state" aria-hidden="true">${stateIcon}</span>
        </span>
        ${stars(stage.bestStars)}
        <span class="map-node-label">${t('map.stageShort', { n: stage.stage })}</span>
        <span class="map-node-tooltip" role="tooltip">${esc(loc(stage.name))}<br><small>${esc(loc(stage.monster.name))} · ${t('map.stageStars', { stars: stage.bestStars })}</small></span>
      </button>`;
  }).join('')).join('');

  const regionLabels = domains.map((domain) => {
    const position = REGION_LABELS[domain.id] || [80, 80];
    const earned = domain.stages.reduce((sum, stage) => sum + (stage.bestStars || 0), 0);
    return `<div class="map-region-label" style="--x:${pct(position[0], WIDTH)};--y:${pct(position[1], HEIGHT)};--accent:${domain.accent || '#8b5cf6'}">
      <span class="map-region-icon">${icon(`icon-${domain.id}`)}</span>
      <span><b>${esc(loc({ zh: domain.nameZh, en: domain.nameEn }))}</b><small>${t('map.regionProgress', { stars: earned, max: domain.stages.length * 3 })}</small></span>
    </div>`;
  }).join('');

  const hero = currentPos ? `<div class="map-hero" style="--x:${pct(currentPos[0], WIDTH)};--y:${pct(currentPos[1], HEIGHT)}" aria-hidden="true">
    <span class="map-hero-bubble">${t('map.youAreHere')}</span>
    <svg viewBox="0 0 220 260"><use href="#hero-wizard"></use></svg>
  </div>` : '';

  return `
    <div class="worldmap-shell">
      <div class="worldmap" role="group" aria-label="${esc(t('map.title'))}">
        <svg class="worldmap-art" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${scenery()}</svg>
        <svg class="worldmap-trail" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path class="worldmap-trail-shadow" d="${trailPath()}"/>
          <path class="worldmap-trail-line" d="${trailPath()}"/>
          <path class="worldmap-trail-dots" d="${trailPath()}"/>
        </svg>
        ${regionLabels}
        ${nodes}
        ${hero}
      </div>
    </div>
    <div class="map-legend">
      <span>${icon('icon-check')}${t('map.legendCleared')}</span>
      <span class="legend-current">${icon('icon-bolt')}${t('map.legendCurrent')}</span>
      <span>${icon('icon-lock')}${t('map.legendLocked')}</span>
      <span class="legend-note">${t('map.independent')}</span>
    </div>
    <p class="map-pan-hint">${icon('icon-arrow')}${t('map.panHint')}</p>`;
}

function stagePosition(stage, domainId = stage.domain?.id) {
  const points = POSITIONS[domainId || ''];
  if (!points) return null;
  return points[Math.max(0, Math.min(2, Number(stage.stage) - 1))];
}
