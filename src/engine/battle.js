/*
 * Turn-based battle engine.
 *
 * A correct answer casts a spell: 22 damage, growing by 6 for each answer in
 * the streak (22 / 28 / 34 / 40). A wrong answer lets the monster counter for
 * 20. Answering until either side reaches 0 ends the battle, so a clean run
 * wins in four hits and a run of five mistakes loses.
 */

export const HERO_MAX_HP = 100;
export const MONSTER_MAX_HP = 100;
export const WRONG_DAMAGE = 20;

export function damageForStreak(streak) {
  return 22 + Math.min(Math.max(streak - 1, 0), 3) * 6;
}

export function starsFor(wrong) {
  if (wrong === 0) return 3;
  if (wrong === 1) return 2;
  return 1;
}

export function createBattle({ nextQuestion, heroHp = HERO_MAX_HP, monsterHp = MONSTER_MAX_HP } = {}) {
  if (typeof nextQuestion !== 'function') {
    throw new TypeError('createBattle needs a nextQuestion() function');
  }
  return {
    nextQuestion,
    heroHp,
    monsterHp,
    maxHeroHp: heroHp,
    maxMonsterHp: monsterHp,
    status: 'active',
    streak: 0,
    bestStreak: 0,
    correct: 0,
    wrong: 0,
    asked: 0,
    question: nextQuestion(),
    feedback: null,
    pending: false,
  };
}

/**
 * Submit an answer index. Returns a feedback object, or null when the battle
 * cannot accept another answer (finished or waiting for advance()).
 */
export function answer(battle, choiceIndex) {
  if (!battle || battle.status !== 'active' || battle.pending) return null;
  const question = battle.question;
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length) {
    return null;
  }

  battle.asked += 1;
  const isCorrect = choiceIndex === question.answerIndex;

  if (isCorrect) {
    battle.correct += 1;
    battle.streak += 1;
    battle.bestStreak = Math.max(battle.bestStreak, battle.streak);
    const damage = Math.min(battle.monsterHp, damageForStreak(battle.streak));
    battle.monsterHp -= damage;
    if (battle.monsterHp <= 0) {
      battle.monsterHp = 0;
      battle.status = 'victory';
    }
    battle.feedback = {
      type: 'correct',
      damage,
      answerIndex: question.answerIndex,
      question,
      streak: battle.streak,
    };
  } else {
    battle.wrong += 1;
    battle.streak = 0;
    const damage = Math.min(battle.heroHp, WRONG_DAMAGE);
    battle.heroHp -= damage;
    if (battle.heroHp <= 0) {
      battle.heroHp = 0;
      battle.status = 'defeat';
    }
    battle.feedback = {
      type: 'wrong',
      damage,
      answerIndex: question.answerIndex,
      question,
      streak: 0,
    };
  }

  battle.pending = true;
  return battle.feedback;
}

/** Move to the next question after the player has read the feedback. */
export function advance(battle) {
  if (!battle || battle.status !== 'active' || !battle.pending) return false;
  battle.pending = false;
  battle.feedback = null;
  battle.question = battle.nextQuestion();
  return true;
}

/**
 * Stars and rewards for a finished battle. A defeat keeps the practice XP so
 * that a failed attempt still moves the player forward a little.
 */
export function rewardsFor(battle) {
  const victory = battle.status === 'victory';
  const stars = victory ? starsFor(battle.wrong) : 0;
  const xp = victory ? battle.correct * 8 + 20 + stars * 10 : battle.correct * 4;
  const coins = victory ? battle.correct * 3 + 10 : battle.correct * 2;
  return { victory, stars, xp, coins };
}
