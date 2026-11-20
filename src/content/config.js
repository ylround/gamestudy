export const GRADES = [1, 2, 3, 4, 5, 6];

export const STAGES = [
  {
    id: 1,
    nameKey: 'stage.1.name',
    shortKey: 'stage.1.short',
    monsterKey: 'stage.1.monster',
    monster: 'mossling',
    hp: 100,
  },
  {
    id: 2,
    nameKey: 'stage.2.name',
    shortKey: 'stage.2.short',
    monsterKey: 'stage.2.monster',
    monster: 'golem',
    hp: 100,
  },
  {
    id: 3,
    nameKey: 'stage.3.name',
    shortKey: 'stage.3.short',
    monsterKey: 'stage.3.monster',
    monster: 'dragon',
    hp: 100,
  },
];

export const DOMAINS = [
  {
    id: 'numbers',
    nameKey: 'domain.numbers.name',
    descKey: 'domain.numbers.desc',
    spellKey: 'domain.numbers.spell',
    icon: 'numbers',
    accent: '#4ade80',
    accentSoft: 'rgba(74, 222, 128, 0.16)',
  },
  {
    id: 'fractions',
    nameKey: 'domain.fractions.name',
    descKey: 'domain.fractions.desc',
    spellKey: 'domain.fractions.spell',
    icon: 'fractions',
    accent: '#c084fc',
    accentSoft: 'rgba(192, 132, 252, 0.16)',
  },
  {
    id: 'geometry',
    nameKey: 'domain.geometry.name',
    descKey: 'domain.geometry.desc',
    spellKey: 'domain.geometry.spell',
    icon: 'geometry',
    accent: '#f5c46b',
    accentSoft: 'rgba(245, 196, 107, 0.16)',
  },
  {
    id: 'data',
    nameKey: 'domain.data.name',
    descKey: 'domain.data.desc',
    spellKey: 'domain.data.spell',
    icon: 'data',
    accent: '#67e8f9',
    accentSoft: 'rgba(103, 232, 249, 0.16)',
  },
];

export const SUBJECTS = [
  {
    id: 'math',
    nameKey: 'home.subjects.math',
    descKey: 'home.subjects.math.desc',
    icon: 'numbers',
    available: true,
  },
  {
    id: 'chinese',
    nameKey: 'home.subjects.chinese',
    descKey: null,
    icon: 'book',
    available: false,
  },
  {
    id: 'english',
    nameKey: 'home.subjects.english',
    descKey: null,
    icon: 'globe',
    available: false,
  },
  {
    id: 'science',
    nameKey: 'home.subjects.science',
    descKey: null,
    icon: 'flask',
    available: false,
  },
];

export const MAX_STARS_PER_GRADE = DOMAINS.length * STAGES.length * 3;
export const MAX_STARS = GRADES.length * MAX_STARS_PER_GRADE;

export function skillKey(grade, domain) {
  return `skill.${grade}.${domain}`;
}

export function getDomain(id) {
  return DOMAINS.find((domain) => domain.id === id) || null;
}

export function getStage(id) {
  return STAGES.find((stage) => stage.id === Number(id)) || null;
}
