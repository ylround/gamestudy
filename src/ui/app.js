import {
  DOMAINS,
  GRADES,
  MAX_STARS,
  MAX_STARS_PER_GRADE,
  STAGES,
  SUBJECTS,
  getDomain,
  getStage,
  skillKey,
} from '../content/config.js';
import { createQuestionFactory } from '../content/questions.js';
import { advance, answer, createBattle, rewardsFor } from '../engine/battle.js';
import {
  getStageResult,
  gradeStars,
  grantRewards,
  isStageUnlocked,
  levelProgress,
  loadState,
  recordResult,
  resetProgress,
  saveState,
  totalStars,
} from '../engine/progress.js';
import { randomSeed } from '../engine/rng.js';
import { getLang, localize, setLang, t } from '../i18n/index.js';

const app = {
  state: null,
  screen: 'home',
  grade: 1,
  domainId: null,
  stageId: null,
  battle: null,
  result: null,
  lastEvent: null,
  lastAnswerIndex: null,
  focus: null,
  dialog: null,
  finishTimer: null,
  toastTimer: null,
  audio: null,
};

let audioContext = null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function $(selector, root = document) {
  return root.querySelector(selector);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character];
  });
}

function attr(value) {
  return escapeHtml(value);
}

function text(value) {
  return escapeHtml(localize(value));
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#${name}"></use></svg>`;
}

function starsHTML(stars, max = 3, className = '') {
  const filled = Math.max(0, Math.min(max, stars));
  let glyphs = '';
  for (let index = 0; index < max; index += 1) {
    glyphs += `<span class="star ${index < filled ? 'is-filled' : ''}" aria-hidden="true">★</span>`;
  }
  return `<span class="stars ${className}" aria-label="${attr(t('common.stars'))}: ${filled}/${max}">${glyphs}</span>`;
}

function domainStars(grade, domainId) {
  return STAGES.reduce((sum, stage) => {
    return sum + (getStageResult(app.state, grade, domainId, stage.id)?.stars || 0);
  }, 0);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function renderTopbar() {
  const progress = levelProgress(app.state.player.xp);
  const stars = gradeStars(app.state, app.grade);
  const soundOn = app.state.settings.sound;
  const topbar = $('#topbar');
  if (!topbar) return;
  topbar.innerHTML = `
    <button class="brand" type="button" data-action="home" aria-label="${attr(t('aria.homeLink'))}">
      <span class="brand-mark">${icon('icon-rune')}</span>
      <span class="brand-text">
        <b>${t('brand.name')}</b>
        <small>${t('brand.sub')}</small>
      </span>
    </button>
    <div class="topbar-stats">
      <span class="stat stat--level" aria-label="${attr(t('aria.heroProgress', { level: progress.level, current: progress.current, needed: progress.needed }))}">
        <span class="stat-label">${t('common.level')}</span>
        <b>${progress.level}</b>
        <span class="xp-track" aria-hidden="true"><span style="width:${progress.percent}%"></span></span>
      </span>
      <span class="stat" title="${attr(t('common.coins'))}">
        ${icon('icon-coin', 'stat-icon stat-icon--coin')}
        <b>${app.state.player.coins}</b>
      </span>
      <span class="stat" title="${attr(t('common.stars'))}">
        ${icon('icon-star', 'stat-icon stat-icon--star')}
        <b>${stars}</b>
        <small>/${MAX_STARS_PER_GRADE}</small>
      </span>
    </div>
    <div class="topbar-actions">
      <button class="lang-toggle" type="button" data-action="toggle-lang" aria-label="${attr(t('aria.langToggle'))}">${t('lang.switch')}</button>
      <button class="icon-btn" type="button" data-action="toggle-sound" aria-pressed="${soundOn}" aria-label="${attr(t('aria.soundToggle'))}" title="${attr(t(soundOn ? 'sound.on' : 'sound.off'))}">
        ${icon(soundOn ? 'icon-sound' : 'icon-mute')}
      </button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function homeHTML() {
  const hasProgress = totalStars(app.state) > 0;
  return `
    <section class="screen screen--home">
      <div class="wrap">
        <div class="hero">
          <div class="hero-copy">
            <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>${t('home.eyebrow')}</p>
            <h1>${t('home.title')}</h1>
            <p class="lead">${t('home.lead')}</p>

            <div class="grade-picker" role="group" aria-label="${attr(t('home.gradeLabel'))}">
              ${GRADES.map((grade) => {
                return `<button class="grade-chip ${grade === app.grade ? 'is-active' : ''}" type="button" data-action="select-grade" data-grade="${grade}" aria-pressed="${grade === app.grade}">${t('map.gradeTab', { grade })}</button>`;
              }).join('')}
            </div>
            <p class="hint">${t('home.gradeHint')}</p>

            <div class="hero-actions">
              <button class="btn btn--primary btn--lg" type="button" data-action="start">
                ${icon('icon-play')}
                ${hasProgress ? t('home.ctaContinue') : t('home.ctaStart')}
                ${icon('icon-arrow')}
              </button>
              <button class="btn btn--ghost" type="button" data-action="howto">${t('home.howTo')}</button>
            </div>

            <ul class="hero-stats">
              <li>${icon('icon-book')}${t('home.stats.grades')}</li>
              <li>${icon('icon-map')}${t('home.stats.realms')}</li>
              <li>${icon('icon-bolt')}${t('home.stats.battles')}</li>
              <li>${icon('icon-rune')}${t('home.stats.questions')}</li>
            </ul>
          </div>

          <div class="hero-art" aria-hidden="true">
            <span class="art-halo"></span>
            <span class="art-orbit art-orbit--one"></span>
            <span class="art-orbit art-orbit--two"></span>
            <svg class="art-sprite art-sprite--hero" viewBox="0 0 220 260" role="presentation"><use href="#hero-wizard"></use></svg>
            <svg class="art-sprite art-sprite--monster" viewBox="0 0 240 220" role="presentation"><use href="#monster-mossling"></use></svg>
            <span class="art-symbol art-symbol--one">+</span>
            <span class="art-symbol art-symbol--two">×</span>
            <span class="art-symbol art-symbol--three">π</span>
            <span class="art-card">7 + 5 = <b>12</b></span>
          </div>
        </div>

        <section class="subjects" aria-labelledby="subjects-title">
          <div class="section-head">
            <h2 id="subjects-title">${t('home.subjects.title')}</h2>
            <p>${t('home.subjects.lead')}</p>
          </div>
          <div class="subject-grid">
            ${SUBJECTS.map((subject) => {
              const available = Boolean(subject.available);
              return `
                <button class="subject-card ${available ? 'is-available' : 'is-soon'}" type="button" data-action="${available ? 'open-map' : 'coming-soon'}" aria-label="${attr(t(subject.nameKey))}${available ? '' : `, ${t('home.subjects.soon')}`}">
                  <span class="subject-icon">${icon(`icon-${subject.icon}`)}</span>
                  <span class="subject-body">
                    <span class="subject-name">${t(subject.nameKey)}</span>
                    <span class="subject-desc">${subject.descKey ? t(subject.descKey) : t('home.subjects.soon')}</span>
                  </span>
                  <span class="subject-mark" aria-hidden="true">${available ? icon('icon-arrow') : icon('icon-lock')}</span>
                </button>`;
            }).join('')}
          </div>
        </section>

        <section class="features" aria-label="${attr(t('home.title'))}">
          <article class="feature-card">
            <span class="feature-icon feature-icon--bolt">${icon('icon-bolt')}</span>
            <h3>${t('home.feature.battle.title')}</h3>
            <p>${t('home.feature.battle.desc')}</p>
          </article>
          <article class="feature-card">
            <span class="feature-icon feature-icon--map">${icon('icon-map')}</span>
            <h3>${t('home.feature.realms.title')}</h3>
            <p>${t('home.feature.realms.desc')}</p>
          </article>
          <article class="feature-card">
            <span class="feature-icon feature-icon--globe">${icon('icon-globe')}</span>
            <h3>${t('home.feature.bilingual.title')}</h3>
            <p>${t('home.feature.bilingual.desc')}</p>
          </article>
        </section>

        <p class="footnote">${t('home.footer.note')} · ${t('home.footer.builtWith')}</p>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

function mapHTML() {
  const gradeStarsCount = gradeStars(app.state, app.grade);
  return `
    <section class="screen screen--map">
      <div class="wrap">
        <div class="screen-head">
          <div>
            <button class="btn btn--ghost btn--sm" type="button" data-action="home">${icon('icon-arrow', 'icon--flip')}${t('map.backHome')}</button>
            <h1>${t('map.title')}</h1>
            <p>${t('map.lead')}</p>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-action="howto">${t('nav.howToPlay')}</button>
        </div>

        <div class="grade-tabs" role="group" aria-label="${attr(t('map.gradeLabel'))}">
          ${GRADES.map((grade) => {
            return `<button class="grade-tab ${grade === app.grade ? 'is-active' : ''}" type="button" data-action="select-grade" data-grade="${grade}" aria-pressed="${grade === app.grade}" aria-label="${attr(t('aria.gradeTab', { grade }))}">${t('map.gradeTab', { grade })}</button>`;
          }).join('')}
        </div>

        <div class="map-summary">
          <span class="summary-chip">${icon('icon-star', 'stat-icon stat-icon--star')} ${gradeStarsCount} / ${MAX_STARS_PER_GRADE} ${t('map.gradeStars')}</span>
          <span class="summary-chip">${icon('icon-rune')} ${totalStars(app.state)} / ${MAX_STARS} ${t('map.totalStars')}</span>
          <button class="link-btn" type="button" data-action="reset">${icon('icon-close')}${t('map.reset')}</button>
        </div>

        <div class="realm-grid">
          ${DOMAINS.map((domain) => {
            const realmStars = domainStars(app.grade, domain.id);
            return `
              <article class="realm-card" style="--accent:${domain.accent};--accent-soft:${domain.accentSoft}">
                <header class="realm-head">
                  <span class="realm-icon">${icon(`icon-${domain.icon}`)}</span>
                  <div class="realm-title">
                    <h2>${t(domain.nameKey)}</h2>
                    <p>${t(domain.descKey)}</p>
                  </div>
                  <span class="realm-stars">${icon('icon-star', 'stat-icon stat-icon--star')}<b>${realmStars}</b><small>/9</small></span>
                </header>
                <p class="realm-skill"><span>${t('map.skill')}</span>${t(skillKey(app.grade, domain.id))}</p>
                <div class="stage-list">
                  ${STAGES.map((stage) => {
                    const result = getStageResult(app.state, app.grade, domain.id, stage.id);
                    const unlocked = isStageUnlocked(app.state, app.grade, domain.id, stage.id);
                    const stars = result?.stars || 0;
                    const actionLabel = stars > 0 ? t('common.replay') : t('common.challenge');
                    return `
                      <button class="stage-row ${unlocked ? '' : 'is-locked'}" type="button"
                        data-action="start-battle" data-domain="${domain.id}" data-stage="${stage.id}"
                        ${unlocked ? '' : 'disabled'}
                        aria-label="${attr(`${t(stage.nameKey)} · ${t(stage.monsterKey)} · ${t('map.stageStars', { stars })}${unlocked ? '' : ` · ${t('aria.lockedStage')}`}`)}"
                        title="${attr(unlocked ? `${t(stage.nameKey)} · ${t(stage.monsterKey)}` : t('map.stageLocked'))}">
                        <span class="stage-monster">${icon(`monster-${stage.monster}`)}</span>
                        <span class="stage-body">
                          <span class="stage-name">${t(stage.nameKey)}</span>
                          <span class="stage-meta">${t(stage.monsterKey)} · ${t(stage.shortKey)}</span>
                        </span>
                        <span class="stage-right">
                          ${starsHTML(stars, 3, 'stars--sm')}
                          <span class="stage-action">${unlocked ? actionLabel : `${icon('icon-lock')}${t('common.locked')}`}</span>
                        </span>
                      </button>`;
                  }).join('')}
                </div>
              </article>`;
          }).join('')}
        </div>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Battle                                                              */
/* ------------------------------------------------------------------ */

function hpMarkup(current, max, label) {
  const percent = Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  return `
    <div class="hp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${current}" aria-label="${attr(label)}">
      <span class="hp-fill" style="width:${percent}%"></span>
      <span class="hp-text">${current} / ${max}</span>
    </div>`;
}

function battleHTML() {
  const domain = getDomain(app.domainId);
  const stage = getStage(app.stageId);
  const battle = app.battle;
  if (!domain || !stage || !battle) return homeHTML();

  const question = battle.question;
  const feedback = battle.feedback;
  const answered = Boolean(feedback);
  const event = app.lastEvent;
  const chosenIndex = app.lastAnswerIndex;
  const battleClass = event ? `is-${event.type}` : '';
  const streak = battle.streak;
  const questionNumber = Math.max(1, battle.asked + (battle.pending ? 0 : 1));

  const answers = question.choices.map((choice, index) => {
    let className = 'answer';
    if (answered) {
      if (index === question.answerIndex) className += ' is-correct';
      else if (index === chosenIndex) className += ' is-wrong';
      else className += ' is-muted';
    }
    return `
      <button class="${className}" type="button" data-action="answer" data-index="${index}"
        ${answered ? 'disabled' : ''}
        aria-label="${attr(t('aria.answerOption', { n: index + 1, text: localize(choice) }))}">
        <span class="answer-key">${index + 1}</span>
        <span class="answer-text">${text(choice)}</span>
      </button>`;
  }).join('');

  const feedbackMarkup = feedback
    ? `
      <div class="feedback ${feedback.type === 'correct' ? 'is-correct' : 'is-wrong'}" id="feedback" tabindex="-1" aria-live="polite">
        <div class="feedback-head">
          <span class="feedback-icon">${icon(feedback.type === 'correct' ? 'icon-check' : 'icon-close')}</span>
          <span class="feedback-title">${t(feedback.type === 'correct' ? 'battle.correctTitle' : 'battle.wrongTitle')}</span>
          <b class="feedback-damage">${t(feedback.type === 'correct' ? 'battle.correctBody' : 'battle.wrongBody', { spell: t(domain.spellKey), damage: feedback.damage })}</b>
        </div>
        ${feedback.type === 'wrong' ? `<p class="feedback-answer">${t('battle.answerWas', { answer: text(question.choices[question.answerIndex]) })}</p>` : ''}
        ${question.explanation ? `<p class="feedback-explain"><span>${t('battle.explanation')}</span>${text(question.explanation)}</p>` : ''}
        <button class="btn btn--primary btn--block" type="button" data-action="${battle.status === 'active' ? 'advance' : 'finish'}">
          ${battle.status === 'active' ? t('battle.continue') : t('battle.viewResult')}
        </button>
      </div>`
    : `<p class="battle-hint">${icon('icon-bolt')}${t('battle.hint')}</p>`;

  return `
    <section class="screen screen--battle ${battleClass}" style="--accent:${domain.accent};--accent-soft:${domain.accentSoft}">
      <h1 class="visually-hidden">${t(domain.nameKey)} · ${t(stage.nameKey)}</h1>
      <div class="battle-wrap">
        <div class="battle-toolbar">
          <button class="btn btn--ghost btn--sm" type="button" data-action="leave-battle">${icon('icon-arrow', 'icon--flip')}${t('battle.leave')}</button>
          <div class="battle-context">
            <span class="battle-context-icon">${icon(`icon-${domain.icon}`)}</span>
            <span>${t(domain.nameKey)} · ${t(stage.nameKey)}</span>
          </div>
          <span class="battle-round">${t('battle.round', { n: questionNumber })}</span>
        </div>

        <div class="arena">
          <div class="arena-glow" aria-hidden="true"></div>
          <div class="fighter fighter--hero">
            <div class="fighter-top">
              <span class="fighter-name">${t('battle.hero')}<small>Lv.${levelProgress(app.state.player.xp).level}</small></span>
              ${hpMarkup(battle.heroHp, battle.maxHeroHp, t('battle.heroHp'))}
            </div>
            <div class="sprite-wrap">
              <svg class="sprite sprite--hero" viewBox="0 0 220 260" role="img" aria-label="${attr(t('battle.hero'))}"><use href="#hero-wizard"></use></svg>
              <span class="sprite-shadow" aria-hidden="true"></span>
            </div>
            ${streak > 1 ? `<span class="streak-badge">${icon('icon-bolt')}${t('battle.streak', { n: streak })}</span>` : ''}
          </div>

          <div class="arena-center" aria-hidden="true">
            <span class="vs">VS</span>
            <span class="arena-turn">${t('battle.turn', { n: questionNumber })}</span>
          </div>

          <div class="fighter fighter--monster">
            <div class="fighter-top">
              <span class="fighter-name">${t(stage.monsterKey)}<small>${t(stage.shortKey)}</small></span>
              ${hpMarkup(battle.monsterHp, battle.maxMonsterHp, t('battle.monsterHp'))}
            </div>
            <div class="sprite-wrap">
              <svg class="sprite sprite--monster" viewBox="0 0 240 220" role="img" aria-label="${attr(t(stage.monsterKey))}"><use href="#monster-${stage.monster}"></use></svg>
              <span class="sprite-shadow" aria-hidden="true"></span>
            </div>
            ${event ? `<span class="fx-damage ${event.type === 'correct' ? 'fx-damage--monster' : 'fx-damage--hero'}">-${event.damage}</span>` : ''}
          </div>

          ${event?.type === 'correct' && event.streak > 1 ? `<span class="fx-combo" aria-hidden="true">×${event.streak}</span>` : ''}
        </div>

        <div class="question-panel">
          <div class="question-head">
            <span class="spell-tag">${icon(`icon-${domain.icon}`)}${t(domain.spellKey)}</span>
            <span class="question-round">${t('battle.turn', { n: questionNumber })}</span>
          </div>
          <p class="question-prompt" id="question-prompt">${text(question.prompt)}</p>
          <div class="answers" role="group" aria-labelledby="question-prompt">
            ${answers}
          </div>
          ${feedbackMarkup}
        </div>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function resultHTML() {
  const result = app.result;
  if (!result) return homeHTML();
  const domain = getDomain(result.domainId);
  const stage = getStage(result.stageId);
  const victory = result.victory;
  return `
    <section class="screen screen--result" style="--accent:${domain?.accent || '#fff'};--accent-soft:${domain?.accentSoft || 'rgba(255,255,255,.1)'}">
      <div class="wrap result-wrap">
        <div class="result-card ${victory ? 'is-victory' : 'is-defeat'}">
          <p class="eyebrow">${icon(victory ? 'icon-star' : 'icon-close')}${t(victory ? 'result.stageClear' : 'battle.defeat')}</p>
          <h1 class="result-title" tabindex="-1">${t(victory ? 'result.victoryTitle' : 'result.defeatTitle')}</h1>
          <p class="result-lead">${t(victory ? 'result.victoryLead' : 'result.defeatLead', { monster: t(stage?.monsterKey || 'stage.3.monster') })}</p>

          ${victory ? `
            <div class="result-stars">
              ${starsHTML(result.stars, 3, 'stars--xl')}
              ${result.newBest ? `<span class="new-best">${icon('icon-star')}${t('result.newBest')}</span>` : ''}
            </div>` : ''}

          <div class="result-grid">
            <div class="result-stat">
              <span>${t('common.correct')}</span>
              <b>${result.correct} / ${result.asked}</b>
            </div>
            <div class="result-stat">
              <span>${t('common.xp')}</span>
              <b class="is-xp">${t('result.xp', { xp: result.xp })}</b>
            </div>
            <div class="result-stat">
              <span>${t('common.coins')}</span>
              <b class="is-coin">${t('result.coins', { coins: result.coins })}</b>
            </div>
            <div class="result-stat">
              <span>${t('result.bestStreakLabel')}</span>
              <b>×${result.bestStreak}</b>
            </div>
          </div>

          ${result.levelUp ? `<p class="level-up">${icon('icon-bolt')}${t('result.levelUp', { level: result.level })}</p>` : ''}
          ${victory ? '' : `<p class="defeat-hint">${t('result.defeatHint')}</p>`}

          <div class="result-actions">
            <button class="btn btn--primary" type="button" data-action="retry">${icon('icon-arrow', 'icon--flip')}${t('result.retry')}</button>
            ${victory && result.nextStage
              ? `<button class="btn btn--secondary" type="button" data-action="next-stage">${t('result.nextStage')}${icon('icon-arrow')}</button>`
              : ''}
            <button class="btn btn--ghost" type="button" data-action="map">${t('result.map')}</button>
          </div>
        </div>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render({ focus = null, keepScroll = false } = {}) {
  const scrollY = keepScroll ? window.scrollY : null;
  renderTopbar();
  const main = $('#main');
  if (!main) return;
  if (app.screen === 'map') main.innerHTML = mapHTML();
  else if (app.screen === 'battle') main.innerHTML = battleHTML();
  else if (app.screen === 'result') main.innerHTML = resultHTML();
  else main.innerHTML = homeHTML();

  if (scrollY != null) window.scrollTo({ top: scrollY, behavior: 'auto' });

  const target = focus || app.focus;
  if (target) {
    app.focus = null;
    applyFocus(target);
  }
}

function applyFocus(target) {
  const selectors = {
    main: '#main',
    feedback: '#feedback',
    answer: '.answer:not(:disabled)',
    result: '.result-title',
  };
  const element = document.querySelector(selectors[target] || target);
  if (element) {
    element.focus({ preventScroll: false });
    if (target === 'feedback') {
      element.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Battle flow                                                         */
/* ------------------------------------------------------------------ */

function startBattle(domainId, stageId) {
  const domain = getDomain(domainId);
  const stage = getStage(stageId);
  if (!domain || !stage) return;
  if (!isStageUnlocked(app.state, app.grade, domainId, stage.id)) {
    showToast(t('toast.locked'));
    return;
  }

  clearFinishTimer();
  app.domainId = domainId;
  app.stageId = stage.id;
  app.battle = createBattle({
    nextQuestion: createQuestionFactory(app.grade, domainId, stage.id, randomSeed()),
    monsterHp: stage.hp,
  });
  app.result = null;
  app.lastEvent = null;
  app.lastAnswerIndex = null;
  app.screen = 'battle';
  app.focus = 'main';
  render();
  playSound('click');
}

function handleAnswer(index) {
  const battle = app.battle;
  if (!battle || battle.status !== 'active' || battle.pending) return;
  const event = answer(battle, index);
  if (!event) return;
  app.lastEvent = event;
  app.lastAnswerIndex = index;
  playSound(event.type === 'correct' ? 'correct' : 'wrong');
  app.focus = 'feedback';
  render();
  if (battle.status !== 'active') {
    clearFinishTimer();
    app.finishTimer = setTimeout(finishBattle, 1800);
  }
}

function continueBattle() {
  const battle = app.battle;
  if (!battle) return;
  if (battle.status !== 'active') {
    finishBattle();
    return;
  }
  if (!advance(battle)) return;
  app.lastEvent = null;
  app.lastAnswerIndex = null;
  playSound('click');
  app.focus = 'answer';
  render();
}

function finishBattle() {
  clearFinishTimer();
  const battle = app.battle;
  if (!battle || battle.recorded) return;
  battle.recorded = true;

  const rewards = rewardsFor(battle);
  let record = null;
  if (rewards.victory) {
    record = recordResult(app.state, {
      grade: app.grade,
      domain: app.domainId,
      stage: app.stageId,
      stars: rewards.stars,
      correct: battle.correct,
      asked: battle.asked,
    });
  }
  const levelInfo = grantRewards(app.state, { xp: rewards.xp, coins: rewards.coins });
  const saved = saveState(app.state);

  app.result = {
    victory: rewards.victory,
    stars: rewards.stars,
    xp: rewards.xp,
    coins: rewards.coins,
    correct: battle.correct,
    asked: battle.asked,
    bestStreak: battle.bestStreak,
    levelUp: levelInfo.leveledUp,
    level: levelInfo.levelAfter,
    newBest: Boolean(record?.improved),
    grade: app.grade,
    domainId: app.domainId,
    stageId: app.stageId,
    nextStage: rewards.victory && app.stageId < STAGES.length ? app.stageId + 1 : null,
  };
  app.screen = 'result';
  app.focus = 'result';
  playSound(rewards.victory ? 'victory' : 'defeat');
  render();
  if (!saved) showToast(t('toast.storage'));
}

function clearFinishTimer() {
  if (app.finishTimer) {
    clearTimeout(app.finishTimer);
    app.finishTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Navigation and settings                                             */
/* ------------------------------------------------------------------ */

function goHome() {
  clearFinishTimer();
  app.battle = null;
  app.result = null;
  app.screen = 'home';
  app.focus = 'main';
  render();
}

function goMap() {
  clearFinishTimer();
  app.battle = null;
  app.result = null;
  app.screen = 'map';
  app.focus = 'main';
  render();
}

function selectGrade(grade) {
  const value = Number(grade);
  if (!GRADES.includes(value)) return;
  app.grade = value;
  app.state.settings.grade = value;
  saveState(app.state);
  playSound('click');
  render({ keepScroll: true });
}

function applyLanguage(lang) {
  setLang(lang);
  app.state.settings.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = lang;
  document.title = t('app.title');
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('home.lead'));
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.textContent = t('a11y.skip');
}

function toggleLanguage() {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  closeDialog();
  applyLanguage(next);
  saveState(app.state);
  playSound('click');
  render({ keepScroll: true });
}

function toggleSound() {
  app.state.settings.sound = !app.state.settings.sound;
  saveState(app.state);
  if (app.state.settings.sound) playSound('click');
  renderTopbar();
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

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

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
  root.innerHTML = `
    <dialog class="modal modal--${tone}" aria-labelledby="dialog-title">
      <div class="modal-card">
        <button class="icon-btn modal-close" type="button" data-action="dialog-cancel" aria-label="${attr(t('aria.closeDialog'))}">${icon('icon-close')}</button>
        <h2 id="dialog-title">${t(title)}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="btn btn--ghost" type="button" data-action="dialog-cancel">${cancelLabel || t('common.close')}</button>
          ${onConfirm ? `<button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-action="dialog-confirm">${confirmLabel || t('common.confirm')}</button>` : ''}
        </div>
      </div>
    </dialog>`;
  const dialog = root.querySelector('dialog');
  app.dialog = { onConfirm };
  dialog.addEventListener('close', () => {
    root.innerHTML = '';
    app.dialog = null;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
  dialog.querySelector('[data-action="dialog-cancel"]')?.focus();
}

function openHowTo() {
  const body = `
    <p class="modal-lead">${t('howto.lead')}</p>
    <ol class="howto-list">
      ${[1, 2, 3, 4].map((step) => {
        return `<li><span class="howto-num">${step}</span><div><h3>${t(`howto.step${step}.title`)}</h3><p>${t(`howto.step${step}.desc`)}</p></div></li>`;
      }).join('')}
    </ol>`;
  openDialog({
    title: 'howto.title',
    body,
    cancelLabel: t('howto.gotIt'),
    tone: 'info',
  });
}

function openResetConfirm() {
  openDialog({
    title: 'reset.title',
    body: `<p>${t('reset.body')}</p>`,
    confirmLabel: t('reset.confirm'),
    cancelLabel: t('reset.cancel'),
    tone: 'danger',
    onConfirm: () => {
      resetProgress(app.state);
      saveState(app.state);
      app.grade = app.state.settings.grade;
      app.screen = 'map';
      app.focus = 'main';
      showToast(t('toast.reset'));
      render();
    },
  });
}

function openLeaveConfirm(destination = 'map') {
  openDialog({
    title: 'battle.leaveTitle',
    body: `<p>${t('battle.leaveBody')}</p>`,
    confirmLabel: t('battle.quit'),
    cancelLabel: t('battle.stay'),
    tone: 'danger',
    onConfirm: () => {
      clearFinishTimer();
      app.battle = null;
      app.result = null;
      app.screen = destination === 'home' ? 'home' : 'map';
      app.focus = 'main';
      render();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

function ensureAudio() {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
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
  if (!app.state.settings.sound) return;
  const context = ensureAudio();
  if (!context) return;
  if (context.state === 'suspended') context.resume().catch(() => {});
  const now = context.currentTime + 0.01;
  if (kind === 'correct') {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      playNote(context, frequency, now + index * 0.07, 0.18, 'triangle', 0.04);
    });
  } else if (kind === 'wrong') {
    playNote(context, 196, now, 0.16, 'sawtooth', 0.03);
    playNote(context, 146.83, now + 0.12, 0.24, 'sawtooth', 0.03);
  } else if (kind === 'victory') {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      playNote(context, frequency, now + index * 0.11, 0.3, 'triangle', 0.045);
    });
  } else if (kind === 'defeat') {
    playNote(context, 220, now, 0.24, 'sine', 0.04);
    playNote(context, 164.81, now + 0.18, 0.34, 'sine', 0.04);
  } else {
    playNote(context, 660, now, 0.06, 'triangle', 0.03);
  }
}

/* ------------------------------------------------------------------ */
/* Event handling                                                      */
/* ------------------------------------------------------------------ */

function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;

  switch (action) {
    case 'home':
      if (app.screen === 'battle' && app.battle && !app.battle.recorded) {
        openLeaveConfirm('home');
      } else {
        goHome();
      }
      break;
    case 'open-map':
    case 'start':
      goMap();
      break;
    case 'map':
      goMap();
      break;
    case 'select-grade':
      selectGrade(target.dataset.grade);
      break;
    case 'howto':
      openHowTo();
      break;
    case 'toggle-lang':
      toggleLanguage();
      break;
    case 'toggle-sound':
      toggleSound();
      break;
    case 'start-battle':
      startBattle(target.dataset.domain, target.dataset.stage);
      break;
    case 'answer':
      handleAnswer(Number(target.dataset.index));
      break;
    case 'advance':
      continueBattle();
      break;
    case 'finish':
      finishBattle();
      break;
    case 'leave-battle':
      openLeaveConfirm('map');
      break;
    case 'retry':
      if (app.result) startBattle(app.result.domainId, app.result.stageId);
      else if (app.domainId && app.stageId) startBattle(app.domainId, app.stageId);
      break;
    case 'next-stage':
      if (app.result?.nextStage) startBattle(app.result.domainId, app.result.nextStage);
      break;
    case 'reset':
      openResetConfirm();
      break;
    case 'coming-soon':
      showToast(t('toast.comingSoon'));
      break;
    case 'dialog-cancel':
      closeDialog();
      break;
    case 'dialog-confirm': {
      const callback = app.dialog?.onConfirm;
      closeDialog();
      if (callback) callback();
      break;
    }
    default:
      break;
  }
}

function handleKeyDown(event) {
  if (document.querySelector('dialog[open]')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.screen !== 'battle' || !app.battle) return;

  const onControl = event.target instanceof Element && event.target.closest('button, a');
  if (event.key === 'Enter' && app.battle.pending && !onControl) {
    event.preventDefault();
    if (app.battle.status === 'active') continueBattle();
    else finishBattle();
    return;
  }

  if (/^[1-4]$/.test(event.key) && !app.battle.pending && app.battle.status === 'active') {
    const index = Number(event.key) - 1;
    if (index < app.battle.question.choices.length) {
      event.preventDefault();
      handleAnswer(index);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  app.state = loadState();
  app.grade = app.state.settings.grade;
  applyLanguage(app.state.settings.lang);
  render();
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeyDown);

  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__mathRealms = {
      get screen() {
        return app.screen;
      },
      get grade() {
        return app.grade;
      },
      get answerIndex() {
        return app.battle?.question?.answerIndex ?? null;
      },
      get battle() {
        const battle = app.battle;
        if (!battle) return null;
        return {
          status: battle.status,
          heroHp: battle.heroHp,
          monsterHp: battle.monsterHp,
          streak: battle.streak,
          correct: battle.correct,
          wrong: battle.wrong,
          asked: battle.asked,
          answerIndex: battle.question.answerIndex,
        };
      },
      get result() {
        return app.result;
      },
      get state() {
        return JSON.parse(JSON.stringify(app.state));
      },
      startBattle,
      finishBattle,
    };
  }
}

init();
