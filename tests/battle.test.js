import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_MAX_HP,
  MONSTER_MAX_HP,
  WRONG_DAMAGE,
  advance,
  answer,
  createBattle,
  damageForStreak,
  rewardsFor,
  starsFor,
} from '../src/engine/battle.js';

function question(index) {
  return {
    prompt: { key: 'q.total_gems', params: { a: index, b: 1 } },
    choices: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    explanation: 'x',
  };
}

function battleWith(limit = 30) {
  let index = 0;
  return createBattle({ nextQuestion: () => question(index++) });
}

test('streak damage steps are 22, 28, 34 and 40', () => {
  assert.equal(damageForStreak(1), 22);
  assert.equal(damageForStreak(2), 28);
  assert.equal(damageForStreak(3), 34);
  assert.equal(damageForStreak(4), 40);
  assert.equal(damageForStreak(9), 40);
});

test('four clean hits win the battle with three stars', () => {
  const battle = battleWith();
  const events = [];
  for (let i = 0; i < 4; i += 1) {
    events.push(answer(battle, 0));
    if (battle.status === 'active') assert.equal(advance(battle), true);
  }
  assert.deepEqual(
    events.map((event) => event.damage),
    [22, 28, 34, 16],
  );
  assert.equal(battle.status, 'victory');
  assert.equal(battle.monsterHp, 0);
  assert.equal(battle.heroHp, HERO_MAX_HP);
  assert.equal(battle.correct, 4);
  assert.equal(starsFor(battle.wrong), 3);
});

test('five wrong answers lose the battle', () => {
  const battle = battleWith();
  for (let i = 0; i < 5; i += 1) {
    const event = answer(battle, 1);
    assert.equal(event.type, 'wrong');
    assert.equal(event.damage, WRONG_DAMAGE);
    if (battle.status === 'active') assert.equal(advance(battle), true);
  }
  assert.equal(battle.status, 'defeat');
  assert.equal(battle.heroHp, 0);
  assert.equal(battle.wrong, 5);
  assert.equal(battle.streak, 0);
  assert.equal(rewardsFor(battle).stars, 0);
});

test('a wrong answer resets the streak and advances only on demand', () => {
  const battle = battleWith();
  answer(battle, 0);
  assert.equal(battle.streak, 1);
  assert.equal(advance(battle), true);
  const wrong = answer(battle, 1);
  assert.equal(wrong.type, 'wrong');
  assert.equal(wrong.answerIndex, 0);
  assert.equal(battle.streak, 0);
  assert.equal(battle.pending, true);
  assert.equal(answer(battle, 0), null, 'answers are ignored while feedback is pending');
  assert.equal(advance(battle), true);
  assert.equal(battle.pending, false);
  const hit = answer(battle, 0);
  assert.equal(hit.damage, 22, 'the first hit after a break is a fresh 22');
});

test('invalid choices and finished battles are ignored', () => {
  const battle = battleWith();
  assert.equal(answer(battle, -1), null);
  assert.equal(answer(battle, 99), null);
  assert.equal(battle.asked, 0);

  for (let i = 0; i < 4; i += 1) {
    answer(battle, 0);
    if (battle.status === 'active') advance(battle);
  }
  assert.equal(battle.status, 'victory');
  assert.equal(answer(battle, 0), null);
  assert.equal(advance(battle), false);
});

test('rewards reflect victory, stars and mistakes', () => {
  const battle = battleWith();
  for (let i = 0; i < 4; i += 1) {
    answer(battle, 0);
    if (battle.status === 'active') advance(battle);
  }
  const reward = rewardsFor(battle);
  assert.deepEqual(reward, { victory: true, stars: 3, xp: 82, coins: 22 });

  const defeated = battleWith();
  for (let i = 0; i < 5; i += 1) {
    answer(defeated, 1);
    if (defeated.status === 'active') advance(defeated);
  }
  const practice = rewardsFor(defeated);
  assert.deepEqual(practice, { victory: false, stars: 0, xp: 0, coins: 0 });
});

test('the battle starts with full HP and the first question', () => {
  const battle = battleWith();
  assert.equal(battle.heroHp, HERO_MAX_HP);
  assert.equal(battle.monsterHp, MONSTER_MAX_HP);
  assert.equal(battle.status, 'active');
  assert.equal(battle.question.prompt.key, 'q.total_gems');
});
