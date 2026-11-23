import type { Localized } from './types.ts';
import { levelForXp } from './types.ts';

export interface CharacterSpell {
  name: Localized;
  effect: 'fire' | 'ice' | 'lightning';
}

export interface CharacterDef {
  id: 'pyra' | 'frost' | 'volt';
  name: Localized;
  title: Localized;
  element: 'fire' | 'ice' | 'lightning';
  color: string;
  icon: string;
  blurb: Localized;
  trait: Localized;
  damageBonus: number;
  comboBonus: number;
  counterReduction: number;
  spells: CharacterSpell[];
  outfits: Localized[];
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'pyra',
    name: { zh: '焰羽', en: 'Pyra' },
    title: { zh: '焰羽法师', en: 'Ember Mage' },
    element: 'fire',
    color: '#fb923c',
    icon: 'icon-flame',
    blurb: { zh: '以火焰法术轰击怪物的法师，终极技凤凰天火覆盖整个战场。', en: 'A fire mage whose Phoenix Inferno engulfs the whole arena.' },
    trait: { zh: '稳定火焰伤害；终极技范围最大。', en: 'Reliable fire damage; the largest ultimate area.' },
    damageBonus: 0,
    comboBonus: 0,
    counterReduction: 0,
    spells: [
      { name: { zh: '火花弹', en: 'Ember Bolt' }, effect: 'fire' },
      { name: { zh: '烈焰冲击', en: 'Flame Surge' }, effect: 'fire' },
      { name: { zh: '凤凰天火', en: 'Phoenix Inferno' }, effect: 'fire' },
    ],
    outfits: [
      { zh: '初行法袍', en: 'Apprentice Robe' },
      { zh: '赤焰法袍', en: 'Ember Robe' },
      { zh: '凤凰法袍', en: 'Phoenix Robe' },
    ],
  },
  {
    id: 'frost',
    name: { zh: '霜翎', en: 'Frost' },
    title: { zh: '霜翎游侠', en: 'Frost Ranger' },
    element: 'ice',
    color: '#67e8f9',
    icon: 'icon-ice',
    blurb: { zh: '用冰霜箭矢远程消耗怪物，冰霜护盾会削弱怪物反击。', en: 'A ranged ice archer whose shield weakens monster counters.' },
    trait: { zh: '冰霜护盾：怪物反击伤害 -4。', en: 'Frost shield: monster counters deal 4 less damage.' },
    damageBonus: 0,
    comboBonus: 0,
    counterReduction: 4,
    spells: [
      { name: { zh: '冰晶箭', en: 'Crystal Arrow' }, effect: 'ice' },
      { name: { zh: '霜华连射', en: 'Frost Volley' }, effect: 'ice' },
      { name: { zh: '极寒领域', en: 'Absolute Zero' }, effect: 'ice' },
    ],
    outfits: [
      { zh: '雪原斗篷', en: 'Snow Cloak' },
      { zh: '霜纹斗篷', en: 'Frostweave Cloak' },
      { zh: '极光斗篷', en: 'Aurora Cloak' },
    ],
  },
  {
    id: 'volt',
    name: { zh: '雷铠', en: 'Volt' },
    title: { zh: '雷鸣武僧', en: 'Thunder Monk' },
    element: 'lightning',
    color: '#c084fc',
    icon: 'icon-thunder',
    blurb: { zh: '以拳掌和雷电连击压制怪物，连击越高伤害越夸张。', en: 'A thunder monk whose chain combos grow stronger with every streak.' },
    trait: { zh: '连击大师：每层连击额外 +2 伤害。', en: 'Combo master: +2 damage for every combo step.' },
    damageBonus: 0,
    comboBonus: 2,
    counterReduction: 0,
    spells: [
      { name: { zh: '雷光掌', en: 'Thunder Palm' }, effect: 'lightning' },
      { name: { zh: '连锁闪电', en: 'Chain Lightning' }, effect: 'lightning' },
      { name: { zh: '九霄雷劫', en: 'Skybreaker Storm' }, effect: 'lightning' },
    ],
    outfits: [
      { zh: '雷鸣短打', en: 'Thunder Tunic' },
      { zh: '雷纹战衣', en: 'Storm Vest' },
      { zh: '九霄战甲', en: 'Skybreaker Armor' },
    ],
  },
];

export function characterById(id: string | null | undefined): CharacterDef | null {
  return CHARACTERS.find((character) => character.id === id) || null;
}

export function outfitTierForLevel(level: number): 1 | 2 | 3 {
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  return 1;
}

export function spellTierForLevel(level: number): 1 | 2 | 3 {
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  return 1;
}

export function effectTierForDifficulty(difficulty: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, Number(difficulty) || 1)) as 1 | 2 | 3;
}

export function characterSummary(character: CharacterDef, xp: number, selected = false) {
  const progress = levelForXp(xp);
  const outfitTier = outfitTierForLevel(progress.level);
  const spellTier = spellTierForLevel(progress.level);
  return {
    id: character.id,
    name: character.name,
    title: character.title,
    element: character.element,
    color: character.color,
    icon: character.icon,
    blurb: character.blurb,
    trait: character.trait,
    damageBonus: character.damageBonus,
    comboBonus: character.comboBonus,
    counterReduction: character.counterReduction,
    xp,
    level: progress.level,
    levelProgress: progress,
    outfitTier,
    spellTier,
    outfitName: character.outfits[outfitTier - 1],
    spells: character.spells.map((spell, index) => ({
      ...spell,
      tier: index + 1,
      unlocked: index + 1 <= spellTier,
      name: spell.name,
    })),
    ultimate: character.spells[2].name,
    selected,
  };
}

export function castFor(character: CharacterDef, effectTier: number, level: number) {
  const tier = effectTierForDifficulty(effectTier);
  const spell = character.spells[tier - 1];
  return {
    characterId: character.id,
    characterName: character.name,
    color: character.color,
    effect: spell.effect,
    tier,
    name: spell.name,
    ultimate: tier === 3,
    spellTier: spellTierForLevel(level),
  };
}
