import { GRADES, SUBJECTS } from '../content/config.js';
import { getLang, localize, setLang, t } from '../i18n/index.js';
import { api, clearToken, download, getToken, setToken } from './api.js';

const app = {
  screen: 'loading',
  user: null,
  profile: null,
  family: null,
  save: null,
  map: null,
  activeSession: null,
  announcement: null,
  grade: 4,
  stage: null,
  session: null,
  question: null,
  feedback: null,
  hint: null,
  selected: new Set(),
  result: null,
  mistakes: [],
  mistakeFilter: 'open',
  growth: null,
  parent: { children: [], selectedId: null, report: null, days: 7 },
  settings: { lang: 'zh', sound: true, reducedMotion: false, highContrast: false, fontScale: 1, countdown: false },
  authTab: 'login',
  authRole: 'student',
  busy: false,
  focus: null,
  dialog: null,
  toastTimer: null,
  answerStartedAt: 0,
  tutorialSeen: false,
};

let audioContext = null;

function $(selector, root = document) {
  return root.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function attr(value) {
  return escapeHtml(value);
}

function loc(value) {
  if (value == null) return '';
  if (typeof value === 'object' && !value.key && ('zh' in value || 'en' in value)) {
    return String(getLang() === 'zh' ? value.zh ?? '' : value.en ?? '');
  }
  return localize(value);
}

function locText(value) {
  return escapeHtml(loc(value));
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#${name}"></use></svg>`;
}

function starsHTML(stars, max = 3, className = '') {
  const filled = Math.max(0, Math.min(max, Number(stars) || 0));
  let glyphs = '';
  for (let index = 0; index < max; index += 1) {
    glyphs += `<span class="star ${index < filled ? 'is-filled' : ''}" aria-hidden="true">★</span>`;
  }
  return `<span class="stars ${className}" aria-label="${attr(t('common.stars'))}: ${filled}/${max}">${glyphs}</span>`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total < 60) return t('common.secondsShort', { n: total });
  if (total < 3600) return t('common.minutesShort', { n: Math.round(total / 60) });
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return `${t('common.hoursShort', { n: hours })} ${t('common.minutesShort', { n: minutes })}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLang() === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }).format(date);
}

function levelProgress() {
  return app.save?.levelProgress || { level: 1, current: 0, needed: 80, percent: 0 };
}

function findStage(stageKey) {
  if (!app.map) return null;
  for (const domain of app.map.domains) {
    const stage = domain.stages.find((item) => item.key === stageKey);
    if (stage) return { domain, stage };
  }
  return null;
}

function stageFromSession() {
  if (app.session?.stageKey) return findStage(app.session.stageKey);
  if (app.session?.knowledgeCode && app.map) {
    for (const domain of app.map.domains) {
      const stage = domain.stages.find((item) => item.knowledgeCode === app.session.knowledgeCode);
      if (stage) return { domain, stage };
    }
  }
  return null;
}

function prefersReducedMotion() {
  return app.settings.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.remove('is-visible');
  void toast.offsetWidth;
  toast.classList.add('is-visible');
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.hidden = true;
  }, 3200);
}

function handleError(error) {
  if (error?.status === 401) {
    clearToken();
    app.user = null;
    app.screen = 'auth';
    render();
    showToast(t('error.unauthorized'));
    return;
  }
  showToast(error?.status === 0 ? t('error.network') : error?.message || t('error.generic'));
}

async function withBusy(work) {
  if (app.busy) return;
  app.busy = true;
  try {
    await work();
  } catch (error) {
    handleError(error);
  } finally {
    app.busy = false;
  }
}

function progressBar(percent, className = '') {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  return `<span class="progress-track ${className}" aria-hidden="true"><span style="width:${value}%"></span></span>`;
}

function renderTopbar() {
  const topbar = $('#topbar');
  if (!topbar) return;
  if (!app.user || ['auth', 'loading', 'onboarding'].includes(app.screen)) {
    topbar.innerHTML = '';
    return;
  }
  const isStudent = app.user.role === 'student';
  const level = levelProgress();
  const nav = isStudent
    ? [['map', 'nav.map', 'icon-map'], ['mistakes', 'nav.mistakes', 'icon-book'], ['growth', 'nav.growth', 'icon-star'], ['settings', 'nav.settings', 'icon-bolt']]
    : [['parent', 'nav.parent', 'icon-heart'], ['settings', 'nav.settings', 'icon-bolt']];
  topbar.innerHTML = `
    <button class="brand" type="button" data-action="nav" data-screen="${isStudent ? 'home' : 'parent'}" aria-label="${attr(t('aria.homeLink'))}">
      <span class="brand-mark">${icon('icon-rune')}</span>
      <span class="brand-text"><b>${t('brand.name')}</b><small>${t('brand.sub')}</small></span>
    </button>
    <nav class="topnav" aria-label="${attr(t('brand.name'))}">
      ${nav.map(([screen, key, iconName]) => `<button class="topnav-link ${app.screen === screen ? 'is-active' : ''}" type="button" data-action="nav" data-screen="${screen}">${icon(iconName)}<span>${t(key)}</span></button>`).join('')}
    </nav>
    <div class="topbar-stats">
      ${isStudent ? `
        <span class="stat stat--level" aria-label="${attr(t('aria.heroProgress', { level: level.level, current: level.current, needed: level.needed }))}"><span class="stat-label">${t('common.level')}</span><b>${level.level}</b><span class="xp-track" aria-hidden="true"><span style="width:${level.percent}%"></span></span></span>
        <span class="stat" title="${attr(t('common.coins'))}">${icon('icon-coin', 'stat-icon stat-icon--coin')}<b>${app.save?.coins ?? 0}</b></span>
        <span class="stat" title="${attr(t('common.stars'))}">${icon('icon-star', 'stat-icon stat-icon--star')}<b>${app.save?.stars ?? 0}</b></span>` : ''}
    </div>
    <div class="topbar-actions">
      <button class="lang-toggle" type="button" data-action="toggle-lang" aria-label="${attr(t('aria.langToggle'))}">${t('lang.switch')}</button>
      <button class="icon-btn" type="button" data-action="toggle-sound" aria-pressed="${app.settings.sound}" aria-label="${attr(t('aria.soundToggle'))}" title="${attr(t(app.settings.sound ? 'sound.on' : 'sound.off'))}">${icon(app.settings.sound ? 'icon-sound' : 'icon-mute')}</button>
      <span class="user-chip" title="${attr(app.user.displayName)}">${escapeHtml(app.profile?.nickname || app.user.displayName)}</span>
      <button class="icon-btn" type="button" data-action="logout" aria-label="${attr(t('nav.logout'))}" title="${attr(t('nav.logout'))}">${icon('icon-close')}</button>
    </div>`;
  requestAnimationFrame(() => {
    const height = Math.ceil(topbar.getBoundingClientRect().height);
    if (height > 0) document.documentElement.style.setProperty('--topbar-height', `${height}px`);
  });
}

/* Auth / onboarding ------------------------------------------------- */

function authHTML() {
  const registering = app.authTab === 'register';
  return `
    <section class="screen screen--auth">
      <div class="auth-wrap">
        <div class="auth-art" aria-hidden="true">
          <span class="art-halo"></span><span class="art-orbit art-orbit--one"></span><span class="art-orbit art-orbit--two"></span>
          <svg class="art-sprite art-sprite--hero" viewBox="0 0 220 260"><use href="#hero-wizard"></use></svg>
          <svg class="art-sprite art-sprite--monster" viewBox="0 0 240 220"><use href="#monster-mossling"></use></svg>
          <span class="art-symbol art-symbol--one">+</span><span class="art-symbol art-symbol--two">×</span><span class="art-symbol art-symbol--three">π</span>
          <span class="art-card">7 + 5 = <b>12</b></span>
        </div>
        <div class="auth-card">
          <p class="eyebrow"><span class="eyebrow-dot"></span>${t('auth.eyebrow')}</p>
          <h1>${t('auth.title')}</h1>
          <p class="lead">${t('auth.lead')}</p>
          <div class="auth-tabs" role="tablist">
            <button class="auth-tab ${registering ? '' : 'is-active'}" type="button" data-action="auth-tab" data-tab="login">${t('auth.login')}</button>
            <button class="auth-tab ${registering ? 'is-active' : ''}" type="button" data-action="auth-tab" data-tab="register">${t('auth.register')}</button>
          </div>
          <label class="field"><span>${t('auth.username')}</span><input id="auth-username" autocomplete="username" maxlength="24" placeholder="${attr(t('auth.usernameHint'))}" /></label>
          <label class="field"><span>${t('auth.password')}</span><input id="auth-password" type="password" autocomplete="current-password" maxlength="72" /></label>
          ${registering ? `
            <div class="field-row">
              <label class="field"><span>${t('auth.role')}</span><select id="auth-role"><option value="student" ${app.authRole === 'student' ? 'selected' : ''}>${t('auth.student')}</option><option value="parent" ${app.authRole === 'parent' ? 'selected' : ''}>${t('auth.parent')}</option></select></label>
              <label class="field"><span>${t('auth.grade')}</span><select id="auth-grade">${GRADES.map((grade) => `<option value="${grade}" ${grade === 4 ? 'selected' : ''}>${t('map.gradeTab', { grade })}</option>`).join('')}</select></label>
            </div>
            <label class="field"><span>${t('auth.nickname')}</span><input id="auth-nickname" maxlength="24" /></label>
            <label class="check-field"><input id="auth-consent" type="checkbox" /><span>${t('auth.consent')}</span></label>` : ''}
          <button class="btn btn--primary btn--lg btn--block" type="button" data-action="auth-submit">${registering ? t('auth.registerBtn') : t('auth.loginBtn')} ${icon('icon-arrow')}</button>
          <div class="demo-block">
            <div class="demo-head"><b>${t('auth.demoTitle')}</b><span>${t('auth.demoHint')}</span></div>
            <div class="demo-grid">
              <button class="demo-btn" type="button" data-action="demo-login" data-username="xiaoyu" data-password="demo1234"><b>xiaoyu</b><span>${t('auth.student')} · 4</span></button>
              <button class="demo-btn" type="button" data-action="demo-login" data-username="mama" data-password="demo1234"><b>mama</b><span>${t('auth.parent')}</span></button>
              <button class="demo-btn" type="button" data-action="demo-login" data-username="admin" data-password="admin1234"><b>admin</b><span>${t('nav.admin')}</span></button>
            </div>
          </div>
          <p class="auth-footer">${t('auth.footer')}</p>
        </div>
      </div>
    </section>`;
}

function onboardingHTML() {
  return `
    <section class="screen screen--auth">
      <div class="auth-card auth-card--narrow">
        <p class="eyebrow"><span class="eyebrow-dot"></span>${t('onboarding.title')}</p>
        <h1>${t('onboarding.title')}</h1>
        <p class="lead">${t('onboarding.lead')}</p>
        <label class="check-field"><input id="onboarding-consent" type="checkbox" /><span>${t('auth.consent')}</span></label>
        <button class="btn btn--primary btn--block" type="button" data-action="consent">${t('onboarding.start')}</button>
        <button class="btn btn--ghost btn--block" type="button" data-action="logout">${t('nav.logout')}</button>
      </div>
    </section>`;
}

/* Home -------------------------------------------------------------- */

function homeHTML() {
  return `
    <section class="screen screen--home"><div class="wrap">
      <div class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-dot"></span>${t('home.eyebrow')}</p>
          <h1>${t('home.title')}</h1><p class="lead">${t('home.lead')}</p>
          <div class="grade-picker" role="group" aria-label="${attr(t('home.gradeLabel'))}">${GRADES.map((grade) => `<button class="grade-chip ${grade === app.grade ? 'is-active' : ''}" type="button" data-action="select-grade" data-grade="${grade}" aria-pressed="${grade === app.grade}">${t('map.gradeTab', { grade })}</button>`).join('')}</div>
          <p class="hint">${t('home.gradeHint')}</p>
          <div class="hero-actions">
            <button class="btn btn--primary btn--lg" type="button" data-action="nav" data-screen="map">${icon('icon-play')}${t('home.ctaContinue')}${icon('icon-arrow')}</button>
            <button class="btn btn--ghost" type="button" data-action="howto">${t('home.howTo')}</button>
          </div>
          <ul class="hero-stats"><li>${icon('icon-book')}${t('home.stats.grades')}</li><li>${icon('icon-map')}${t('home.stats.realms')}</li><li>${icon('icon-bolt')}${t('home.stats.battles')}</li><li>${icon('icon-rune')}${t('home.stats.questions')}</li></ul>
        </div>
        <div class="hero-art" aria-hidden="true">
          <span class="art-halo"></span><span class="art-orbit art-orbit--one"></span><span class="art-orbit art-orbit--two"></span>
          <svg class="art-sprite art-sprite--hero" viewBox="0 0 220 260"><use href="#hero-wizard"></use></svg>
          <svg class="art-sprite art-sprite--monster" viewBox="0 0 240 220"><use href="#monster-mossling"></use></svg>
          <span class="art-symbol art-symbol--one">+</span><span class="art-symbol art-symbol--two">×</span><span class="art-symbol art-symbol--three">π</span><span class="art-card">7 + 5 = <b>12</b></span>
        </div>
      </div>
      <section class="subjects" aria-labelledby="subjects-title">
        <div class="section-head"><h2 id="subjects-title">${t('home.subjects.title')}</h2><p>${t('home.subjects.lead')}</p></div>
        <div class="subject-grid">${SUBJECTS.map((subject) => `<button class="subject-card ${subject.available ? 'is-available' : 'is-soon'}" type="button" data-action="${subject.available ? 'nav' : 'coming-soon'}" ${subject.available ? 'data-screen="map"' : ''}><span class="subject-icon">${icon(`icon-${subject.icon}`)}</span><span class="subject-body"><span class="subject-name">${t(subject.nameKey)}</span><span class="subject-desc">${subject.descKey ? t(subject.descKey) : t('home.subjects.soon')}</span></span><span class="subject-mark" aria-hidden="true">${subject.available ? icon('icon-arrow') : icon('icon-lock')}</span></button>`).join('')}</div>
      </section>
    </div></section>`;
}

/* Map --------------------------------------------------------------- */

function mapHTML() {
  const map = app.map;
  if (!map) return `<section class="screen"><div class="wrap"><p class="lead">${t('common.loading')}</p></div></section>`;
  return `
    <section class="screen screen--map"><div class="wrap">
      <div class="screen-head">
        <div><button class="btn btn--ghost btn--sm" type="button" data-action="nav" data-screen="home">${icon('icon-arrow', 'icon--flip')}${t('map.backHome')}</button><h1>${t('map.title')}</h1><p>${t('map.lead')}</p></div>
        <div class="head-actions"><button class="btn btn--ghost btn--sm" type="button" data-action="howto">${t('nav.howToPlay')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="nav" data-screen="mistakes">${icon('icon-book')}${t('nav.mistakes')}</button></div>
      </div>
      ${app.activeSession ? `<div class="resume-banner"><span>${icon('icon-bolt')}${t('map.activeBanner')}</span><div><button class="btn btn--primary btn--sm" type="button" data-action="resume-session">${t('map.resume')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="abandon-session">${t('map.abandon')}</button></div></div>` : ''}
      ${app.announcement ? `<div class="announcement">${locText(app.announcement)}</div>` : ''}
      <div class="grade-tabs" role="group" aria-label="${attr(t('map.gradeLabel'))}">${GRADES.map((grade) => `<button class="grade-tab ${grade === app.grade ? 'is-active' : ''}" type="button" data-action="select-grade" data-grade="${grade}" aria-pressed="${grade === app.grade}" aria-label="${attr(t('aria.gradeTab', { grade }))}">${t('map.gradeTab', { grade })}</button>`).join('')}</div>
      <div class="map-summary">
        <span class="summary-chip">${icon('icon-star', 'stat-icon stat-icon--star')} ${map.stars.earned} / ${map.stars.total} ${t('map.gradeStars')}</span>
        <span class="summary-chip">${icon('icon-rune')} ${app.save?.level ?? 1} ${t('common.level')}</span>
        <span class="summary-chip">${icon('icon-coin', 'stat-icon stat-icon--coin')} ${app.save?.coins ?? 0} ${t('common.coins')}</span>
      </div>
      <div class="realm-grid">${map.domains.map((domain) => {
        const accent = domain.accent || '#8b5cf6';
        const realmStars = domain.stages.reduce((sum, stage) => sum + (stage.bestStars || 0), 0);
        return `<article class="realm-card" style="--accent:${accent};--accent-soft:${accent}22">
          <header class="realm-head"><span class="realm-icon">${icon(`icon-${domain.id}`)}</span><div class="realm-title"><h2>${locText({ zh: domain.nameZh, en: domain.nameEn })}</h2><p>${t(`domain.${domain.id}.desc`)}</p></div><span class="realm-stars">${icon('icon-star', 'stat-icon stat-icon--star')}<b>${realmStars}</b><small>/${domain.stages.length * 3}</small></span></header>
          <div class="stage-list">${domain.stages.map((stage) => `<button class="stage-row ${stage.unlocked ? '' : 'is-locked'}" type="button" data-action="start-battle" data-stage-key="${attr(stage.key)}" ${stage.unlocked ? '' : 'disabled'} aria-label="${attr(`${loc(stage.name)} · ${loc(stage.monster.name)} · ${t('map.stageStars', { stars: stage.bestStars })}${stage.unlocked ? '' : ` · ${t('aria.lockedStage')}`}`)}">
            <span class="stage-monster">${icon(`monster-${stage.monster.id}`)}</span>
            <span class="stage-body"><span class="stage-name">${locText(stage.name)}</span><span class="stage-meta">${locText(stage.monster.name)} · ${t('map.skill')}: ${locText(stage.name)}</span></span>
            <span class="stage-right">${starsHTML(stage.bestStars, 3, 'stars--sm')}<span class="stage-action">${stage.unlocked ? (stage.completed ? t('common.replay') : t('common.challenge')) : `${icon('icon-lock')}${t('common.locked')}`}</span></span>
          </button>`).join('')}</div>
        </article>`;
      }).join('')}</div>
    </div></section>`;
}

/* Battle ------------------------------------------------------------ */

function hpMarkup(current, max, label) {
  const percent = Math.max(0, Math.min(100, Math.round((Number(current) / Math.max(1, Number(max))) * 100)));
  return `<div class="hp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${current}" aria-label="${attr(label)}"><span class="hp-fill" style="width:${percent}%"></span><span class="hp-text">${current} / ${max}</span></div>`;
}

function answerArea(question, feedback) {
  const answered = Boolean(feedback);
  if (!question.options || !question.options.length) {
    return `<div class="input-answer">
      <label class="field"><span>${question.type === 'FRACTION' ? t('battle.inputText') : t('battle.inputText')}</span><input id="answer-input" value="${attr(app.inputs.answer || '')}" inputmode="${question.type === 'NUMBER' || question.type === 'FRACTION' ? 'decimal' : 'text'}" autocomplete="off" ${answered ? 'disabled' : ''} /></label>
      ${!answered ? `<button class="btn btn--primary" type="button" data-action="submit-answer">${t('battle.submit')}</button>` : ''}
    </div>`;
  }
  const options = question.options.map((option) => {
    let className = 'answer';
    const selected = app.selected.has(option.key);
    if (selected) className += ' is-selected';
    if (answered) {
      const correctKeys = feedback.correctAnswerKeys || (feedback.correctAnswerKey ? [feedback.correctAnswerKey] : []);
      if (correctKeys.includes(option.key)) className += ' is-correct';
      else if (selected) className += ' is-wrong';
      else className += ' is-muted';
    }
    return `<button class="${className}" type="button" data-action="choose-answer" data-key="${attr(option.key)}" ${answered ? 'disabled' : ''} aria-pressed="${selected}"><span class="answer-key">${escapeHtml(option.key === 'T' ? '✓' : option.key === 'F' ? '×' : option.key)}</span><span class="answer-text">${locText(option.text)}</span></button>`;
  }).join('');
  return `<div class="answers">${options}</div>${!answered && question.type === 'MULTI' ? `<button class="btn btn--primary btn--block" type="button" data-action="submit-answer">${t('battle.submit')}</button>` : ''}`;
}

function battleHTML() {
  const found = stageFromSession();
  const session = app.session;
  const question = app.question;
  if (!session || !question) return mapHTML();
  const stage = found?.stage;
  const domain = found?.domain;
  const battle = question.battle || {};
  const feedback = app.feedback;
  const answered = Boolean(feedback);
  const combo = Number(battle.combo) || 0;
  const monster = battle.monster || (stage ? { ...stage.monster, maxHp: stage.monster.hp } : { id: 'mossling', name: { zh: '怪物', en: 'Monster' }, hp: 130, maxHp: 130 });
  const hero = battle.hero || { hp: 100, maxHp: 100 };
  const finalClass = feedback && Number(feedback.monsterHp) <= 0 ? 'is-victory' : feedback && Number(feedback.heroHp) <= 0 ? 'is-defeat' : '';
  const phase = feedback ? (Number(feedback.monsterHp) <= 0 ? 'victory' : Number(feedback.heroHp) <= 0 ? 'defeat' : feedback.correct ? 'cast' : 'counter') : 'answer';
  return `
    <section class="screen screen--battle ${feedback ? (feedback.correct ? 'is-correct' : 'is-wrong') : ''} ${finalClass}" data-phase="${phase}" style="--accent:${domain?.accent || '#8b5cf6'};--accent-soft:${domain?.accent || '#8b5cf6'}22">
      <h1 class="visually-hidden">${locText(stage?.name)}</h1>
      <div class="battle-wrap">
        <div class="battle-toolbar">
          <button class="btn btn--ghost btn--sm" type="button" data-action="leave-battle">${icon('icon-arrow', 'icon--flip')}${t('battle.leave')}</button>
          <div class="battle-context"><span class="battle-context-icon">${icon(`icon-${domain?.id || 'numbers'}`)}</span><span>${locText(stage?.name)}</span></div>
          <span class="battle-phase phase--${phase}">${phase === 'answer' ? t('battle.phaseAnswer') : phase === 'cast' ? t('battle.phaseCast') : phase === 'counter' ? t('battle.phaseCounter') : phase === 'victory' ? t('battle.phaseVictory') : t('battle.phaseDefeat')}</span>
          <span class="battle-round">${t('battle.progress', { n: question.seq + 1, total: question.total })}</span>
        </div>
        <div class="arena">
          <div class="arena-glow" aria-hidden="true"></div>
          ${feedback ? `<span class="fx-projectile ${feedback.correct ? 'fx-projectile--hero' : 'fx-projectile--monster'}" aria-hidden="true"></span><span class="fx-spell ${feedback.correct ? 'fx-spell--cast' : 'fx-spell--counter'}" aria-hidden="true">${t(`domain.${domain?.id || 'numbers'}.spell`)}</span><span class="fx-flash" aria-hidden="true"></span><span class="fx-damage ${feedback.correct ? 'fx-damage--monster' : 'fx-damage--hero'}" aria-hidden="true">-${feedback.damage}</span>` : ''}
          <div class="fighter fighter--hero">
            <div class="fighter-top"><span class="fighter-name">${t('battle.hero')}<small>Lv.${app.save?.level || 1}</small></span>${hpMarkup(hero.hp, hero.maxHp, t('battle.heroHpShort'))}</div>
            <div class="sprite-wrap"><svg class="sprite sprite--hero" viewBox="0 0 220 260" role="img" aria-label="${attr(t('battle.hero'))}"><use href="#hero-wizard"></use></svg><span class="sprite-shadow" aria-hidden="true"></span><span class="fx-impact" aria-hidden="true"></span></div>
            ${combo > 1 ? `<span class="streak-badge">${icon('icon-bolt')}${t('battle.streak', { n: combo })}</span>` : ''}
          </div>
          <div class="arena-center" aria-hidden="true"><span class="vs">VS</span><span class="arena-turn">${t('battle.round', { n: question.seq + 1 })}</span></div>
          <div class="fighter fighter--monster">
            <div class="fighter-top"><span class="fighter-name">${locText(monster.name || { zh: monster.nameZh, en: monster.nameEn })}</span>${hpMarkup(monster.hp, monster.maxHp || stage?.monster?.hp || 130, t('battle.monsterHpShort'))}</div>
            <div class="sprite-wrap"><svg class="sprite sprite--monster" viewBox="0 0 240 220" role="img" aria-label="${attr(loc(monster.name || { zh: monster.nameZh, en: monster.nameEn }))}"><use href="#monster-${monster.id || 'mossling'}"></use></svg><span class="sprite-shadow" aria-hidden="true"></span><span class="fx-impact" aria-hidden="true"></span></div>
          </div>
          ${feedback?.correct && feedback.combo > 1 ? `<span class="fx-combo" aria-hidden="true">×${feedback.combo}</span>` : ''}
        </div>
        <div class="question-panel">
          <div class="question-head"><span class="spell-tag">${icon(`icon-${domain?.id || 'numbers'}`)}${t(`domain.${domain?.id || 'numbers'}.spell`)}</span><span class="question-round">${t('battle.progress', { n: question.seq + 1, total: question.total })}</span></div>
          <p class="question-prompt" id="question-prompt">${locText(question.stem)}</p>
          <p class="question-skill">${icon('icon-book')}${locText(question.skill)}</p>
          ${app.hint ? `<div class="hint-box"><b>${t('battle.hintRevealed')}</b><p>${locText(app.hint)}</p></div>` : ''}
          ${!answered && question.hintsUsed < question.hintsAvailable ? `<button class="btn btn--ghost btn--sm hint-btn" type="button" data-action="hint">${icon('icon-bolt')}${t('battle.hintBtn')} · ${t('battle.hintLeft', { n: question.hintsAvailable - question.hintsUsed })}</button>` : ''}
          ${answerArea(question, feedback)}
          ${feedback ? `<div class="feedback ${feedback.correct ? 'is-correct' : 'is-wrong'}" id="feedback" tabindex="-1" aria-live="polite">
            <div class="feedback-head"><span class="feedback-icon">${icon(feedback.correct ? 'icon-check' : 'icon-close')}</span><span class="feedback-title">${t(feedback.correct ? 'battle.correctTitle' : 'battle.wrongTitle')}</span><b class="feedback-damage">${feedback.correct ? t('battle.damageMonster', { n: feedback.damage }) : t('battle.damageHero', { n: feedback.damage })}</b></div>
            ${!feedback.correct ? `<p class="feedback-answer">${t('battle.correctAnswer')}：${escapeHtml(feedback.correctAnswer)}</p>` : ''}
            <p class="feedback-explain"><span>${t('battle.explanationTitle')}</span>${locText(feedback.explanation)}</p>
            <button class="btn btn--primary btn--block" type="button" data-action="${feedback.isFinal ? 'finish-battle' : 'next-question'}">${feedback.isFinal ? t('battle.finish') : t('battle.continueShort')}</button>
          </div>` : `<p class="battle-hint">${icon('icon-bolt')}${t('battle.hint')}</p>`}
        </div>
      </div>
    </section>`;
}

/* Result ------------------------------------------------------------ */

function resultHTML() {
  const payload = app.result;
  if (!payload?.result) return mapHTML();
  const result = payload.result;
  const found = stageFromSession();
  const stage = found?.stage;
  return `
    <section class="screen screen--result" style="--accent:${found?.domain?.accent || '#8b5cf6'};--accent-soft:${found?.domain?.accent || '#8b5cf6'}22"><div class="wrap result-wrap">
      <div class="result-card ${result.victory ? 'is-victory' : 'is-defeat'}">
        <p class="eyebrow">${icon(result.victory ? 'icon-star' : 'icon-close')}${t(result.victory ? 'result.stageClear' : 'battle.defeat')}</p>
        <h1 class="result-title" tabindex="-1">${t(result.victory ? 'result.victoryTitle' : 'result.defeatTitle')}</h1>
        <p class="result-lead">${t(result.victory ? 'result.victoryLead' : 'result.defeatLead', { monster: loc(stage?.monster?.name) || t('stage.1.monster') })}</p>
        ${result.victory ? `<div class="result-stars">${starsHTML(result.stars, 3, 'stars--xl')}</div>` : ''}
        <div class="result-grid">
          <div class="result-stat"><span>${t('common.correct')}</span><b>${result.correct} / ${result.asked}</b></div>
          <div class="result-stat"><span>${t('result.accuracy')}</span><b>${result.accuracy}%</b></div>
          <div class="result-stat"><span>${t('result.time')}</span><b>${formatDuration(result.durationMs)}</b></div>
          <div class="result-stat"><span>${t('common.xp')}</span><b class="is-xp">${t('result.xpGain', { xp: result.xp })}</b></div>
          <div class="result-stat"><span>${t('common.coins')}</span><b class="is-coin">${t('result.coinGain', { coins: result.coins })}</b></div>
          <div class="result-stat"><span>${t('result.starCurrency')}</span><b class="is-star">${t('result.starGain', { stars: result.starCurrency })}</b></div>
          <div class="result-stat"><span>${t('result.bestStreak')}</span><b>×${result.bestStreak}</b></div>
          <div class="result-stat"><span>${t('common.level')}</span><b>${result.level}</b></div>
        </div>
        ${result.levelUp ? `<p class="level-up">${icon('icon-bolt')}${t('result.levelUp', { level: result.level })}</p>` : ''}
        <div class="result-actions">
          ${result.kind === 'STAGE' ? `<button class="btn btn--primary" type="button" data-action="retry">${icon('icon-arrow', 'icon--flip')}${t('result.retry')}</button>` : ''}
          ${payload.nextStage ? `<button class="btn btn--secondary" type="button" data-action="next-stage" data-stage-key="${attr(payload.nextStage.stageKey)}">${t('result.nextStage')}${icon('icon-arrow')}</button>` : ''}
          <button class="btn btn--ghost" type="button" data-action="nav" data-screen="mistakes">${t('result.mistakes')}</button>
          <button class="btn btn--ghost" type="button" data-action="nav" data-screen="map">${t('result.map')}</button>
        </div>
      </div>
    </div></section>`;
}

/* Mistakes ---------------------------------------------------------- */

function mistakesHTML() {
  const items = (app.mistakes || []).filter((item) => {
    if (app.mistakeFilter === 'open') return !item.resolved;
    if (app.mistakeFilter === 'done') return item.resolved;
    return true;
  });
  return `
    <section class="screen screen--content"><div class="wrap">
      <div class="screen-head"><div><p class="eyebrow">${icon('icon-book')}${t('nav.mistakes')}</p><h1>${t('mistakes.title')}</h1><p>${t('mistakes.lead')}</p></div><button class="btn btn--ghost btn--sm" type="button" data-action="nav" data-screen="map">${icon('icon-arrow', 'icon--flip')}${t('result.map')}</button></div>
      <div class="filter-tabs" role="group">${[['all', 'mistakes.all'], ['open', 'mistakes.open'], ['done', 'mistakes.done']].map(([filter, key]) => `<button class="filter-tab ${app.mistakeFilter === filter ? 'is-active' : ''}" type="button" data-action="mistake-filter" data-filter="${filter}">${t(key)}</button>`).join('')}</div>
      ${items.length ? `<div class="mistake-list">${items.map((item) => `<article class="mistake-card ${item.resolved ? 'is-resolved' : ''}">
        <div class="mistake-head"><span class="badge ${item.resolved ? 'badge--green' : 'badge--gold'}">${item.resolved ? t('mistakes.resolved') : t('mistakes.open')}</span><span class="mistake-meta">${locText(item.skill)} · ${t('mistakes.wrongTimes', { n: item.wrongCount })}</span></div>
        <p class="mistake-stem">${locText(item.stem)}</p>
        <div class="mistake-actions">${!item.resolved ? `<button class="btn btn--primary btn--sm" type="button" data-action="review-mistake" data-id="${item.id}">${t('mistakes.review')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="resolve-mistake" data-id="${item.id}">${t('mistakes.resolve')}</button>` : ''}<span class="mistake-date">${formatDate(item.updatedAt)}</span></div>
      </article>`).join('')}</div>` : `<div class="empty-state">${icon('icon-check')}<p>${t('mistakes.empty')}</p></div>`}
    </div></section>`;
}

/* Growth ------------------------------------------------------------ */

function growthHTML() {
  const growth = app.growth;
  if (!growth) return `<section class="screen"><div class="wrap"><p class="lead">${t('common.loading')}</p></div></section>`;
  const level = levelProgress();
  return `
    <section class="screen screen--content"><div class="wrap">
      <div class="screen-head"><div><p class="eyebrow">${icon('icon-star')}${t('nav.growth')}</p><h1>${t('growth.title')}</h1><p>${t('growth.lead')}</p></div></div>
      <div class="growth-hero"><svg class="growth-avatar" viewBox="0 0 220 260" aria-hidden="true"><use href="#hero-wizard"></use></svg><div class="growth-main"><h2>${escapeHtml(app.profile?.nickname || app.user.displayName)} <span class="badge badge--violet">Lv.${level.level}</span></h2>${progressBar(level.percent, 'progress-track--lg')}<p class="hint">${level.current} / ${level.needed} ${t('common.xp')}</p><div class="growth-chips"><span class="summary-chip">${icon('icon-star', 'stat-icon stat-icon--star')}${growth.stars} ${t('common.stars')}</span><span class="summary-chip">${icon('icon-coin', 'stat-icon stat-icon--coin')}${growth.coins} ${t('common.coins')}</span><span class="summary-chip">${icon('icon-map')}${growth.clearedStages} ${t('growth.cleared')}</span></div></div></div>
      <div class="stat-grid"><div class="stat-card"><span>${t('growth.answers')}</span><b>${growth.answers}</b></div><div class="stat-card"><span>${t('growth.correct')}</span><b>${growth.correct}</b></div><div class="stat-card"><span>${t('growth.accuracy')}</span><b>${growth.answers ? Math.round((growth.correct / growth.answers) * 100) : 0}%</b></div><div class="stat-card"><span>${t('growth.studyTime')}</span><b>${formatDuration(growth.studyMs)}</b></div></div>
      <section class="content-section"><h2>${t('growth.mastery')}</h2>${growth.mastery?.length ? `<div class="mastery-list">${growth.mastery.map((item) => `<div class="mastery-row"><div class="mastery-name"><b>${locText(item.name)}</b><small>${item.attempts} ${t('growth.answers')}</small></div>${progressBar(item.score)}<span class="mastery-score">${item.score}</span></div>`).join('')}</div>` : `<p class="hint">${t('growth.noMastery')}</p>`}</section>
      <section class="content-section"><h2>${t('growth.achievements')}</h2><div class="achievement-grid">${growth.achievements.map((item) => `<div class="achievement ${item.unlocked ? 'is-unlocked' : ''}"><span class="achievement-icon">${icon(item.unlocked ? 'icon-star' : 'icon-lock')}</span><b>${locText(item.name)}</b><small>${item.unlocked ? t('growth.unlocked') : t('growth.locked')}</small></div>`).join('')}</div></section>
      <section class="content-section"><h2>${t('growth.items')}</h2><div class="item-grid">${(growth.items || []).map((item) => `<div class="item-card">${icon('icon-flask')}<b>${locText(item.name)}</b><small>×${item.count}</small></div>`).join('')}</div></section>
    </div></section>`;
}

/* Parent ------------------------------------------------------------ */

function parentHTML() {
  const parent = app.parent;
  const children = parent.children || [];
  const report = parent.report;
  const selected = parent.selectedId || children[0]?.id;
  return `
    <section class="screen screen--content"><div class="wrap">
      <div class="screen-head"><div><p class="eyebrow">${icon('icon-heart')}${t('nav.parent')}</p><h1>${t('parent.title')}</h1><p>${t('parent.lead')}</p></div></div>
      ${children.length ? `<div class="child-tabs" role="tablist">${children.map((child) => `<button class="child-tab ${child.id === selected ? 'is-active' : ''}" type="button" data-action="select-child" data-id="${child.id}"><b>${escapeHtml(child.nickname)}</b><span>${t('map.gradeTab', { grade: child.grade })} · Lv.${child.level}</span></button>`).join('')}</div>${report ? parentReportHTML(report, selected) : `<div class="empty-state">${icon('icon-rune')}<p>${t('parent.noReport')}</p></div>`}` : `<div class="empty-state">${icon('icon-heart')}<p>${t('parent.noChildren')}</p><button class="btn btn--primary" type="button" data-action="open-bind">${t('parent.bind')}</button></div>`}
      <div class="parent-tools"><button class="btn btn--ghost btn--sm" type="button" data-action="open-bind">${icon('icon-rune')}${t('parent.bind')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="open-create-child">${icon('icon-star')}${t('parent.create')}</button>${selected ? `<button class="btn btn--ghost btn--sm" type="button" data-action="export-child" data-id="${selected}">${icon('icon-book')}${t('parent.export')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="unbind-child" data-id="${selected}">${icon('icon-close')}${t('parent.unbind')}</button><button class="btn btn--ghost btn--sm" type="button" data-action="delete-child" data-id="${selected}">${icon('icon-close')}${t('parent.deletion')}</button>` : ''}</div>
    </div></section>`;
}

function parentReportHTML(report, childId) {
  const child = report.child;
  const maxWeek = Math.max(1, ...(report.weekly || []).map((day) => day.answers));
  return `
    <div class="report-head"><div><h2>${escapeHtml(child.nickname)}</h2><p class="hint">${t('parent.inviteCode')}: <b>${escapeHtml(child.inviteCode || '')}</b></p></div><div class="filter-tabs">${[7, 30].map((days) => `<button class="filter-tab ${report.periodDays === days ? 'is-active' : ''}" type="button" data-action="report-days" data-days="${days}">${days === 7 ? t('parent.week') : t('parent.month')}</button>`).join('')}</div></div>
    <div class="stat-grid"><div class="stat-card"><span>${t('parent.today')}</span><b>${report.today.answers}</b><small>${formatDuration(report.today.studyMs)}</small></div><div class="stat-card"><span>${t('parent.answers')}</span><b>${report.period.answers}</b><small>${report.period.accuracy}%</small></div><div class="stat-card"><span>${t('parent.studyTime')}</span><b>${formatDuration(report.period.studyMs)}</b><small>${report.periodDays} ${t('parent.days')}</small></div><div class="stat-card"><span>${t('parent.streak')}</span><b>${report.allTime.streakDays}</b><small>${t('parent.days')}</small></div></div>
    <section class="content-section"><h2>${t('parent.week')}</h2><div class="week-chart">${report.weekly.map((day) => `<div class="week-bar"><span class="week-value">${day.answers}</span><span class="week-column" style="height:${Math.max(4, Math.round((day.answers / maxWeek) * 100))}%"></span><small>${formatDate(`${day.date}T00:00:00Z`)}</small></div>`).join('')}</div></section>
    <div class="report-columns"><section class="content-section"><h2>${t('parent.currentChapter')}</h2><p class="lead">${report.currentChapter ? locText(report.currentChapter.name) : t('parent.noReport')}</p><p class="hint">${t('parent.answers')} ${report.allTime.answers} · ${t('parent.correctRate')} ${report.allTime.accuracy}% · ${t('parent.studyTime')} ${formatDuration(report.allTime.studyMs)}</p><div class="stage-progress">${report.completedStages.slice(0, 8).map((stage) => `<span class="summary-chip">${icon('icon-star', 'stat-icon stat-icon--star')}${locText(stage.name)} ${stage.stars}/3</span>`).join('')}</div></section><section class="content-section"><h2>${t('parent.recentMistakes')}</h2>${report.mistakes.length ? report.mistakes.slice(0, 5).map((item) => `<div class="mini-mistake"><span class="badge badge--gold">${t('mistakes.wrongTimes', { n: item.wrongCount })}</span><p>${locText(item.stem)}</p></div>`).join('') : `<p class="hint">${t('parent.noMistakes')}</p>`}</section></div>
    <section class="content-section"><h2>${t('parent.weakSkills')}</h2>${report.mastery.length ? `<div class="mastery-list">${report.mastery.filter((item) => item.score < 80).slice(0, 8).map((item) => `<div class="mastery-row"><div class="mastery-name"><b>${locText(item.name)}</b><small>${item.attempts} ${t('growth.answers')}</small></div>${progressBar(item.score)}<span class="mastery-score">${item.score}</span></div>`).join('')}</div>` : `<p class="hint">${t('growth.noMastery')}</p>`}</section>
    <section class="content-section"><h2>${t('growth.mastery')}</h2>${report.mastery.length ? `<div class="mastery-list">${report.mastery.map((item) => `<div class="mastery-row"><div class="mastery-name"><b>${locText(item.name)}</b><small>${item.attempts} ${t('growth.answers')}</small></div>${progressBar(item.score)}<span class="mastery-score">${item.score}</span></div>`).join('')}</div>` : `<p class="hint">${t('growth.noMastery')}</p>`}</section>
    <section class="content-section"><h2>${t('parent.controls')}</h2><div class="controls-grid"><label class="field"><span>${t('parent.dailyMinutes')}</span><input id="control-minutes" type="number" min="0" max="240" value="${attr(report.controls?.dailyMinutes ?? 40)}" /></label><label class="field"><span>${t('parent.allowedFrom')}</span><input id="control-from" type="time" value="${attr(report.controls?.allowedFrom || '17:00')}" /></label><label class="field"><span>${t('parent.allowedTo')}</span><input id="control-to" type="time" value="${attr(report.controls?.allowedTo || '21:00')}" /></label><label class="check-field"><input id="control-notifications" type="checkbox" ${report.controls?.notifications ? 'checked' : ''} /><span>${t('parent.notifications')}</span></label><label class="check-field"><input id="control-purchase" type="checkbox" ${report.controls?.purchaseApproval ? 'checked' : ''} /><span>${t('parent.purchaseApproval')}</span></label></div><button class="btn btn--primary" type="button" data-action="save-controls" data-id="${childId}">${t('parent.saveControls')}</button></section>`;
}

/* Settings ---------------------------------------------------------- */

function settingsHTML() {
  return `
    <section class="screen screen--content"><div class="wrap wrap--narrow">
      <div class="screen-head"><div><p class="eyebrow">${icon('icon-bolt')}${t('nav.settings')}</p><h1>${t('settings.title')}</h1><p>${t('settings.lead')}</p></div></div>
      <section class="content-section">
        <h2>${t('settings.language')}</h2>
        <div class="settings-row"><div><b>${t('settings.language')}</b><p class="hint">${t('lang.switch')}</p></div><button class="btn btn--ghost" type="button" data-action="toggle-lang">${t(getLang() === 'zh' ? 'settings.langEn' : 'settings.langZh')}</button></div>
        <div class="settings-row"><div><b>${t('settings.sound')}</b><p class="hint">${t('sound.toggle')}</p></div><button class="btn btn--ghost" type="button" data-action="toggle-sound" aria-pressed="${app.settings.sound}">${t(app.settings.sound ? 'sound.on' : 'sound.off')}</button></div>
        <div class="settings-row"><div><b>${t('settings.fontScale')}</b><p class="hint">${t('settings.large')} / ${t('settings.normal')}</p></div><button class="btn btn--ghost" type="button" data-action="toggle-font">${app.settings.fontScale > 1 ? t('settings.large') : t('settings.normal')}</button></div>
        <div class="settings-row"><div><b>${t('settings.highContrast')}</b></div><button class="btn btn--ghost" type="button" data-action="toggle-contrast" aria-pressed="${app.settings.highContrast}">${app.settings.highContrast ? 'On' : 'Off'}</button></div>
        <div class="settings-row"><div><b>${t('settings.reducedMotion')}</b></div><button class="btn btn--ghost" type="button" data-action="toggle-motion" aria-pressed="${app.settings.reducedMotion}">${app.settings.reducedMotion ? 'On' : 'Off'}</button></div>
        ${app.user.role === 'student' ? `<div class="settings-row"><div><b>${t('settings.tutorial')}</b></div><button class="btn btn--ghost" type="button" data-action="replay-tutorial">${icon('icon-play')}</button></div>` : ''}
      </section>
      <section class="content-section"><h2>${t('settings.account')}</h2><div class="settings-row"><div><b>${escapeHtml(app.user.displayName)}</b><p class="hint">@${escapeHtml(app.user.username)} · ${t(`auth.${app.user.role}`)}</p></div></div>${app.user.role === 'student' ? `<div class="settings-row"><div><b>${t('settings.familyCode')}</b><p class="hint">${escapeHtml(app.profile?.inviteCode || '')}</p></div><span class="badge badge--violet">${app.profile?.consentAt ? t('settings.consented') : t('settings.notConsented')}</span></div>` : ''}<button class="btn btn--danger" type="button" data-action="logout">${t('settings.logout')}</button></section>
    </div></section>`;
}

/* Dialog ------------------------------------------------------------ */

function closeDialog() {
  const root = $('#dialog-root');
  if (!root) return;
  const dialog = root.querySelector('dialog');
  if (dialog?.open) dialog.close();
  root.innerHTML = '';
  app.dialog = null;
}

function openDialog({ title, body, confirmLabel = '', cancelLabel = '', onConfirm = null, tone = 'info' }) {
  closeDialog();
  const root = $('#dialog-root');
  if (!root) return;
  root.innerHTML = `<dialog class="modal modal--${tone}" aria-labelledby="dialog-title"><div class="modal-card"><button class="icon-btn modal-close" type="button" data-action="dialog-cancel" aria-label="${attr(t('aria.closeDialog'))}">${icon('icon-close')}</button><h2 id="dialog-title">${title}</h2><div class="modal-body">${body}</div><div class="modal-actions"><button class="btn btn--ghost" type="button" data-action="dialog-cancel">${cancelLabel || t('common.close')}</button>${onConfirm ? `<button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-action="dialog-confirm">${confirmLabel || t('common.confirm')}</button>` : ''}</div></div></dialog>`;
  const dialog = root.querySelector('dialog');
  app.dialog = { onConfirm };
  dialog.addEventListener('close', () => { root.innerHTML = ''; app.dialog = null; });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.showModal();
  dialog.querySelector('[data-action="dialog-cancel"]')?.focus();
}

function openHowTo() {
  openDialog({ title: t('howto.title'), body: `<p class="modal-lead">${t('howto.lead')}</p><ol class="howto-list">${[1, 2, 3, 4].map((step) => `<li><span class="howto-num">${step}</span><div><h3>${t(`howto.step${step}.title`)}</h3><p>${t(`howto.step${step}.desc`)}</p></div></li>`).join('')}</ol>`, cancelLabel: t('howto.gotIt'), tone: 'info' });
}

function openTutorial() {
  if (app.tutorialSeen) return;
  app.tutorialSeen = true;
  const key = `mathrealms.tutorial.v1.${app.user?.id || 'guest'}`;
  try { if (localStorage.getItem(key)) return; } catch { /* ignore */ }
  openDialog({
    title: t('tutorial.title'),
    body: `<ol class="howto-list">${[1, 2, 3, 4, 5].map((step) => `<li><span class="howto-num">${step}</span><div><p>${t(`tutorial.step${step}`)}</p></div></li>`).join('')}</ol>`,
    confirmLabel: t('tutorial.gotIt'),
    cancelLabel: t('onboarding.skip'),
    onConfirm: () => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } app.screen = 'map'; render(); },
  });
}

/* Render ------------------------------------------------------------ */

function render({ focus = null, keepScroll = false } = {}) {
  const scrollY = keepScroll ? window.scrollY : null;
  renderTopbar();
  const main = $('#main');
  if (!main) return;
  if (app.screen === 'auth') main.innerHTML = authHTML();
  else if (app.screen === 'onboarding') main.innerHTML = onboardingHTML();
  else if (app.screen === 'loading') main.innerHTML = `<section class="screen"><div class="wrap"><p class="lead">${t('common.loading')}</p></div></section>`;
  else if (app.screen === 'map') main.innerHTML = mapHTML();
  else if (app.screen === 'battle') main.innerHTML = battleHTML();
  else if (app.screen === 'result') main.innerHTML = resultHTML();
  else if (app.screen === 'mistakes') main.innerHTML = mistakesHTML();
  else if (app.screen === 'growth') main.innerHTML = growthHTML();
  else if (app.screen === 'parent') main.innerHTML = parentHTML();
  else if (app.screen === 'settings') main.innerHTML = settingsHTML();
  else main.innerHTML = homeHTML();
  if (scrollY != null) window.scrollTo({ top: scrollY, behavior: 'auto' });
  else window.scrollTo({ top: 0, behavior: 'auto' });
  const target = focus || app.focus;
  if (target) {
    app.focus = null;
    applyFocus(target);
  }
}

function applyFocus(target) {
  const selectors = { main: '#main', feedback: '#feedback', answer: '.answer:not(:disabled), #answer-input', result: '.result-title' };
  const element = document.querySelector(selectors[target] || target);
  if (element) {
    if (target === 'feedback') {
      element.focus({ preventScroll: true });
      const panel = element.closest('.question-panel');
      if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    element.focus({ preventScroll: true });
  }
}

/* Data loading ------------------------------------------------------ */

function applySettings(settings) {
  app.settings = { ...app.settings, ...(settings || {}) };
  const lang = app.settings.lang === 'en' ? 'en' : 'zh';
  setLang(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = lang;
  document.documentElement.classList.toggle('is-large-text', Number(app.settings.fontScale) > 1);
  document.documentElement.classList.toggle('is-high-contrast', Boolean(app.settings.highContrast));
  document.documentElement.classList.toggle('is-reduced-motion', Boolean(app.settings.reducedMotion));
  document.title = t('app.title');
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('home.lead'));
}

async function bootstrap() {
  app.screen = 'loading';
  render();
  try {
    const me = await api('/me');
    app.user = me.user;
    app.profile = me.user.profile;
    app.family = me.family;
    applySettings(me.user.save?.settings);
    if (me.user.role === 'admin') {
      window.location.href = '/admin';
      return;
    }
    if (me.user.role === 'parent') {
      app.screen = 'parent';
      await loadParent();
      render({ focus: 'main' });
      return;
    }
    const state = await api('/game/save');
    app.user = state.user;
    app.profile = state.profile;
    app.family = state.family;
    app.save = state.save;
    app.map = state.map;
    app.activeSession = state.activeSession;
    app.announcement = state.announcement;
    app.grade = state.profile?.grade || 4;
    applySettings(state.save.settings);
    if (!app.profile?.consentAt) {
      app.screen = 'onboarding';
      render();
      return;
    }
    app.screen = 'home';
    render({ focus: 'main' });
    openTutorial();
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      clearToken();
      app.user = null;
      app.screen = 'auth';
      render();
      return;
    }
    handleError(error);
    app.screen = 'auth';
    render();
  }
}

async function loadMap() {
  if (!app.user || app.user.role !== 'student') return;
  app.map = await api(`/game/map?grade=${app.grade}`);
}

async function loadParent() {
  const family = await api('/family');
  app.family = family;
  const children = family.children || [];
  app.parent.children = children;
  if (!app.parent.selectedId || !children.some((child) => child.id === app.parent.selectedId)) {
    app.parent.selectedId = children[0]?.id || null;
  }
  app.parent.report = app.parent.selectedId
    ? await api(`/parent/children/${app.parent.selectedId}/report?days=${app.parent.days}`)
    : null;
}

async function loadReport(childId, days = app.parent.days) {
  app.parent.selectedId = childId;
  app.parent.days = days;
  app.parent.report = await api(`/parent/children/${childId}/report?days=${days}`);
}

function setBattleFromPayload(payload) {
  app.session = payload.session;
  app.question = payload.question;
  app.feedback = payload.question?.answered ? payload.question.feedback : null;
  app.hint = null;
  app.selected = new Set();
  app.inputs = {};
  app.answerStartedAt = Date.now();
  app.screen = 'battle';
  render({ focus: 'main' });
}

/* Actions ----------------------------------------------------------- */

async function doAuth() {
  const username = String($('#auth-username')?.value || '').trim();
  const password = String($('#auth-password')?.value || '');
  if (!username || !password) return showToast(t('error.generic'));
  if (app.authTab === 'register') {
    const role = $('#auth-role')?.value || 'student';
    const consent = Boolean($('#auth-consent')?.checked);
    if (role === 'student' && !consent) return showToast(t('auth.needConsent'));
    const result = await api('/auth/register', {
      method: 'POST',
      body: {
        username,
        password,
        role,
        nickname: String($('#auth-nickname')?.value || '').trim() || username,
        grade: Number($('#auth-grade')?.value || 4),
        consent,
      },
    });
    setToken(result.token);
  } else {
    const result = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(result.token);
  }
  await bootstrap();
}

async function loginAs(username, password) {
  const result = await api('/auth/login', { method: 'POST', body: { username, password } });
  setToken(result.token);
  await bootstrap();
}

async function selectGrade(grade) {
  const value = Number(grade);
  if (!GRADES.includes(value)) return;
  app.grade = value;
  await api('/game/grade', { method: 'PUT', body: { grade: value } });
  const state = await api('/game/save');
  app.save = state.save;
  app.map = state.map;
  app.activeSession = state.activeSession;
  render({ keepScroll: true });
}

async function toggleLanguage() {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  await updateSetting({ lang: next });
}

async function updateSetting(patch) {
  app.settings = { ...app.settings, ...patch };
  applySettings(app.settings);
  if (app.user?.role === 'student') {
    const result = await api('/game/save', { method: 'PUT', body: patch });
    app.settings = { ...app.settings, ...result.settings };
    app.save = { ...app.save, settings: result.settings };
  }
  render({ keepScroll: true });
}

async function startBattle(stageKey) {
  const found = findStage(stageKey);
  if (!found) return;
  if (!found.stage.unlocked) return showToast(t('map.stageLocked'));
  const payload = await api('/quiz-sessions', { method: 'POST', body: { kind: 'STAGE', stageKey } });
  app.activeSession = payload.session.status === 'ACTIVE' ? payload.session : null;
  app.result = null;
  setBattleFromPayload(payload);
  playSound('click');
}

async function resumeSession() {
  if (!app.activeSession) return;
  const payload = await api(`/quiz-sessions/${app.activeSession.id}`);
  setBattleFromPayload(payload);
  showToast(t('toast.sessionResumed'));
}

async function chooseAnswer(key) {
  if (app.feedback || !app.question) return;
  if (app.question.type === 'MULTI') {
    if (app.selected.has(key)) app.selected.delete(key);
    else app.selected.add(key);
    render({ keepScroll: true });
    return;
  }
  await submitAnswer({ optionKey: key });
}

async function submitAnswer(explicit) {
  if (!app.session || !app.question || app.feedback) return;
  const timeMs = Math.max(250, Date.now() - (app.answerStartedAt || Date.now()));
  const answer = explicit || buildAnswerPayload();
  const payload = await api(`/quiz-sessions/${app.session.id}/answers`, {
    method: 'POST',
    body: { seq: app.question.seq, answer, timeMs },
  });
  app.feedback = payload;
  app.session = { ...app.session, ...payload.session };
  const previousBattle = app.question.battle || {};
  app.question = {
    ...app.question,
    battle: {
      ...previousBattle,
      ...payload,
      monster: { ...(previousBattle.monster || {}), hp: payload.monsterHp, maxHp: payload.monsterMaxHp },
      hero: { ...(previousBattle.hero || {}), hp: payload.heroHp, maxHp: payload.heroMaxHp },
      combo: payload.combo,
      pending: true,
    },
  };
  if (payload.isFinal) app.activeSession = null;
  playSound(payload.correct ? 'correct' : 'wrong');
  app.focus = 'feedback';
  render();
}

function buildAnswerPayload() {
  return { value: String($('#answer-input')?.value || '').trim() };
}

async function requestHint() {
  if (!app.session || !app.question || app.feedback) return;
  const payload = await api(`/quiz-sessions/${app.session.id}/hints`, { method: 'POST', body: { seq: app.question.seq } });
  app.hint = payload.hint;
  app.question = { ...app.question, hintsUsed: payload.hintsUsed };
  render({ keepScroll: true });
  showToast(t('toast.hintAdded'));
}

async function nextQuestion() {
  if (!app.session) return;
  const payload = await api(`/quiz-sessions/${app.session.id}/next-question`);
  if (payload.finished) {
    await finishBattle();
    return;
  }
  app.session = payload.session;
  app.question = payload.question;
  app.feedback = null;
  app.hint = null;
  app.selected = new Set();
  app.inputs = {};
  app.answerStartedAt = Date.now();
  app.focus = 'answer';
  render();
}

async function finishBattle() {
  if (!app.session) return;
  const payload = await api(`/quiz-sessions/${app.session.id}/result`);
  app.result = payload;
  if (payload.map) app.map = payload.map;
  const state = await api('/game/save');
  app.save = state.save;
  app.activeSession = state.activeSession;
  app.screen = 'result';
  app.focus = 'result';
  playSound(payload.result?.victory ? 'victory' : 'defeat');
  render();
}

async function retryBattle() {
  const key = app.result?.result?.stageKey || app.session?.stageKey;
  if (key) await startBattle(key);
}

function leaveBattle() {
  openDialog({
    title: t('battle.leaveTitle'),
    body: `<p>${t('battle.leaveBody')}</p>`,
    confirmLabel: t('battle.quit'),
    cancelLabel: t('battle.stay'),
    tone: 'danger',
    onConfirm: async () => {
      if (app.session) await api(`/quiz-sessions/${app.session.id}/abandon`, { method: 'POST', body: {} });
      app.session = null;
      app.question = null;
      app.feedback = null;
      app.activeSession = null;
      app.screen = 'map';
      await loadMap();
      render();
      showToast(t('toast.abandoned'));
    },
  });
}

async function goScreen(screen) {
  if (!app.user) return;
  if (screen === 'mistakes') app.mistakes = await api('/mistakes');
  else if (screen === 'growth') app.growth = await api('/inventory');
  else if (screen === 'parent') await loadParent();
  else if (screen === 'map') await loadMap();
  else if (screen === 'settings' && !app.save && app.user.role === 'student') {
    const state = await api('/game/save');
    app.save = state.save;
  }
  app.screen = screen;
  app.focus = 'main';
  render();
}

async function reviewMistake(id) {
  const payload = await api(`/mistakes/${id}/review`, { method: 'POST', body: {} });
  app.result = null;
  setBattleFromPayload(payload);
}

async function resolveMistake(id) {
  await api(`/mistakes/${id}/resolve`, { method: 'POST', body: {} });
  app.mistakes = (app.mistakes || []).map((item) => (item.id === id ? { ...item, resolved: true } : item));
  render({ keepScroll: true });
  showToast(t('toast.resolved'));
}

function openBindDialog() {
  openDialog({
    title: t('parent.bind'),
    body: `<p class="modal-lead">${t('parent.bindHint')}</p><label class="field"><span>${t('parent.inviteCode')}</span><input id="bind-code" maxlength="10" autocomplete="off" /></label>`,
    confirmLabel: t('parent.bind'),
    onConfirm: async (values = {}) => {
      const inviteCode = String(values['bind-code'] || '').trim();
      await api('/family/bind', { method: 'POST', body: { inviteCode } });
      await loadParent();
      render();
      showToast(t('toast.bound'));
    },
  });
}

function openCreateChildDialog() {
  openDialog({
    title: t('parent.create'),
    body: `<p class="modal-lead">${t('parent.createHint')}</p><label class="field"><span>${t('auth.nickname')}</span><input id="child-nickname" maxlength="24" /></label><label class="field"><span>${t('auth.grade')}</span><select id="child-grade">${GRADES.map((grade) => `<option value="${grade}" ${grade === 4 ? 'selected' : ''}>${t('map.gradeTab', { grade })}</option>`).join('')}</select></label>`,
    confirmLabel: t('parent.create'),
    onConfirm: async (values = {}) => {
      const result = await api('/family/children', {
        method: 'POST',
        body: { nickname: String(values['child-nickname'] || '').trim(), grade: Number(values['child-grade'] || 4) },
      });
      await loadParent();
      render();
      openDialog({
        title: t('parent.credentials'),
        body: `<p><b>${t('parent.username')}:</b> <code>${escapeHtml(result.credentials.username)}</code></p><p><b>${t('parent.password')}:</b> <code>${escapeHtml(result.credentials.password)}</code></p>`,
        cancelLabel: t('common.close'),
      });
    },
  });
}

function openTutorialAgain() {
  const key = `mathrealms.tutorial.v1.${app.user?.id || 'guest'}`;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  app.tutorialSeen = false;
  openTutorial();
}

async function abandonSession() {
  if (!app.activeSession) return;
  await api(`/quiz-sessions/${app.activeSession.id}/abandon`, { method: 'POST', body: {} });
  app.activeSession = null;
  await loadMap();
  render();
  showToast(t('toast.abandoned'));
}

async function saveControls(childId) {
  const payload = {
    dailyMinutes: Number($('#control-minutes')?.value || 40),
    allowedFrom: String($('#control-from')?.value || '17:00'),
    allowedTo: String($('#control-to')?.value || '21:00'),
    notifications: Boolean($('#control-notifications')?.checked),
    purchaseApproval: Boolean($('#control-purchase')?.checked),
  };
  await api(`/parent/children/${childId}/controls`, { method: 'PUT', body: payload });
  await loadReport(childId);
  render({ keepScroll: true });
  showToast(t('toast.controlsSaved'));
}

function unbindChild(childId) {
  openDialog({
    title: t('parent.unbind'),
    body: `<p>${t('parent.lead')}</p>`,
    confirmLabel: t('parent.unbind'),
    tone: 'danger',
    onConfirm: async () => {
      await api('/family/unbind', { method: 'POST', body: { childId } });
      await loadParent();
      render();
      showToast(t('toast.unbound'));
    },
  });
}

function requestChildDeletion(childId) {
  openDialog({
    title: t('parent.deletion'),
    body: `<p>${t('parent.lead')}</p>`,
    confirmLabel: t('common.confirm'),
    tone: 'danger',
    onConfirm: async () => {
      await api(`/parent/children/${childId}/deletion-request`, { method: 'POST', body: {} });
      showToast(t('settings.saved'));
    },
  });
}

/* Sound ------------------------------------------------------------- */

function ensureAudio() {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try { audioContext = new Ctor(); } catch { return null; }
  return audioContext;
}

function playNote(context, frequency, start, duration, type = 'sine', volume = 0.045) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playSound(kind) {
  if (!app.settings.sound) return;
  const context = ensureAudio();
  if (!context) return;
  if (context.state === 'suspended') context.resume().catch(() => {});
  const now = context.currentTime + 0.01;
  if (kind === 'correct') [523.25, 659.25, 783.99].forEach((frequency, index) => playNote(context, frequency, now + index * 0.07, 0.18, 'triangle', 0.04));
  else if (kind === 'wrong') {
    playNote(context, 196, now, 0.16, 'sawtooth', 0.03);
    playNote(context, 146.83, now + 0.12, 0.24, 'sawtooth', 0.03);
  } else if (kind === 'victory') [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => playNote(context, frequency, now + index * 0.11, 0.3, 'triangle', 0.045));
  else if (kind === 'defeat') {
    playNote(context, 220, now, 0.24, 'sine', 0.04);
    playNote(context, 164.81, now + 0.18, 0.34, 'sine', 0.04);
  } else playNote(context, 660, now, 0.06, 'triangle', 0.03);
}

/* Events ------------------------------------------------------------ */

function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const run = (work) => withBusy(work);
  switch (action) {
    case 'nav': run(() => goScreen(target.dataset.screen)); break;
    case 'auth-tab': app.authTab = target.dataset.tab; render(); break;
    case 'auth-submit': run(doAuth); break;
    case 'demo-login': run(() => loginAs(target.dataset.username, target.dataset.password)); break;
    case 'consent':
      run(async () => {
        if (!$('#onboarding-consent')?.checked) return showToast(t('auth.needConsent'));
        await api('/me/consent', { method: 'POST', body: {} });
        app.profile = { ...app.profile, consentAt: new Date().toISOString() };
        showToast(t('toast.consentSaved'));
        app.screen = 'home';
        render({ focus: 'main' });
        openTutorial();
      });
      break;
    case 'logout':
      run(async () => {
        try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* stateless */ }
        clearToken();
        app.user = null;
        app.save = null;
        app.map = null;
        app.screen = 'auth';
        showToast(t('toast.loggedOut'));
        render();
      });
      break;
    case 'select-grade': run(() => selectGrade(target.dataset.grade)); break;
    case 'toggle-lang': run(toggleLanguage); break;
    case 'toggle-sound': run(() => updateSetting({ sound: !app.settings.sound })); break;
    case 'toggle-font': run(() => updateSetting({ fontScale: app.settings.fontScale > 1 ? 1 : 1.15 })); break;
    case 'toggle-contrast': run(() => updateSetting({ highContrast: !app.settings.highContrast })); break;
    case 'toggle-motion': run(() => updateSetting({ reducedMotion: !app.settings.reducedMotion })); break;
    case 'howto': openHowTo(); break;
    case 'replay-tutorial': openTutorialAgain(); break;
    case 'coming-soon': showToast(t('toast.comingSoon')); break;
    case 'start-battle': run(() => startBattle(target.dataset.stageKey)); break;
    case 'resume-session': run(resumeSession); break;
    case 'abandon-session': run(abandonSession); break;
    case 'choose-answer': run(() => chooseAnswer(target.dataset.key)); break;
    case 'submit-answer': run(() => submitAnswer()); break;
    case 'hint': run(requestHint); break;
    case 'next-question': run(nextQuestion); break;
    case 'finish-battle': run(finishBattle); break;
    case 'retry': run(retryBattle); break;
    case 'next-stage': run(() => startBattle(target.dataset.stageKey)); break;
    case 'leave-battle': leaveBattle(); break;
    case 'mistake-filter': app.mistakeFilter = target.dataset.filter; render({ keepScroll: true }); break;
    case 'review-mistake': run(() => reviewMistake(target.dataset.id)); break;
    case 'resolve-mistake': run(() => resolveMistake(target.dataset.id)); break;
    case 'select-child': run(() => loadReport(target.dataset.id).then(() => render({ focus: 'main' }))); break;
    case 'report-days': run(() => loadReport(app.parent.selectedId, Number(target.dataset.days)).then(() => render({ keepScroll: true }))); break;
    case 'save-controls': run(() => saveControls(target.dataset.id)); break;
    case 'open-bind': openBindDialog(); break;
    case 'open-create-child': openCreateChildDialog(); break;
    case 'export-child': run(() => download(`/parent/children/${target.dataset.id}/export`, `mathrealms-child-${target.dataset.id}.json`).then(() => showToast(t('toast.exported')))); break;
    case 'unbind-child': unbindChild(target.dataset.id); break;
    case 'delete-child': requestChildDeletion(target.dataset.id); break;
    case 'dialog-cancel': closeDialog(); break;
    case 'dialog-confirm': {
      const dialog = target.closest('dialog');
      const values = {};
      dialog?.querySelectorAll('input, select, textarea').forEach((element) => {
        if (!element.id) return;
        values[element.id] = element.type === 'checkbox' ? element.checked : element.value;
      });
      const callback = app.dialog?.onConfirm;
      closeDialog();
      if (callback) run(() => callback(values));
      break;
    }
    default: break;
  }
}

function handleKeyDown(event) {
  if (document.querySelector('dialog[open]')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.screen === 'battle' && app.question) {
    if (event.key === 'Enter') {
      if (app.feedback) {
        event.preventDefault();
        withBusy(app.feedback.isFinal ? finishBattle : nextQuestion);
        return;
      }
      if (!app.question.options?.length || app.question.type === 'MULTI') {
        event.preventDefault();
        withBusy(() => submitAnswer());
        return;
      }
    }
    if (/^[1-4]$/.test(event.key) && !app.feedback && app.question.options?.length) {
      const option = app.question.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        withBusy(() => chooseAnswer(option.key));
      }
    }
  }
  if (event.key === 'Escape') closeDialog();
}

function init() {
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('input', (event) => {
    if (event.target?.id === 'answer-input') app.inputs.answer = event.target.value;
  });
  if (getToken()) bootstrap();
  else {
    app.screen = 'auth';
    render();
  }
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__mathrealms = { app, refresh: () => bootstrap(), goScreen, startBattle, submitAnswer, nextQuestion, finishBattle };
  }
}

init();
