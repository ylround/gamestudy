import type { DatabaseSync } from 'node:sqlite';
import { all, get, now, run } from '../lib/db.ts';
import { CHARACTERS, characterById, characterSummary, type CharacterDef } from '../lib/characters.ts';
import { HttpError } from '../lib/http.ts';

export interface CharacterRow {
  user_id: string;
  character_id: string;
  xp: number;
  selected: number;
  created_at: string;
}

function isStudent(db: DatabaseSync, userId: string): boolean {
  return get<any>(db, "SELECT 1 AS ok FROM users WHERE id = ? AND role = 'student'", userId) !== undefined;
}

export function ensureCharacters(db: DatabaseSync, userId: string): CharacterRow[] {
  if (!isStudent(db, userId)) return [];
  let rows = all<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? ORDER BY character_id', userId);
  if (!rows.length) {
    const save = get<any>(db, 'SELECT xp FROM game_saves WHERE user_id = ?', userId);
    const createdAt = now();
    for (const character of CHARACTERS) {
      run(
        db,
        'INSERT OR IGNORE INTO character_saves (user_id, character_id, xp, selected, created_at) VALUES (?,?,?,?,?)',
        userId,
        character.id,
        character.id === 'pyra' ? Number(save?.xp) || 0 : 0,
        character.id === 'pyra' ? 1 : 0,
        createdAt,
      );
    }
    rows = all<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? ORDER BY character_id', userId);
  }
  if (!rows.some((row) => Number(row.selected) === 1)) {
    const fallback = rows.find((row) => row.character_id === 'pyra') || rows[0];
    if (fallback) {
      run(db, 'UPDATE character_saves SET selected = 1 WHERE user_id = ? AND character_id = ?', userId, fallback.character_id);
      rows = all<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? ORDER BY character_id', userId);
    }
  }
  return rows;
}

export function characterList(db: DatabaseSync, userId: string) {
  const rows = ensureCharacters(db, userId);
  const byId = new Map(rows.map((row) => [row.character_id, row]));
  return CHARACTERS.map((character) => characterSummary(character, Number(byId.get(character.id)?.xp) || 0, Number(byId.get(character.id)?.selected) === 1));
}

export function selectedCharacter(db: DatabaseSync, userId: string): { def: CharacterDef; row: CharacterRow; summary: ReturnType<typeof characterSummary> } | null {
  const rows = ensureCharacters(db, userId);
  if (!rows.length) return null;
  const row = rows.find((item) => Number(item.selected) === 1) || rows[0];
  const def = characterById(row.character_id) || CHARACTERS[0];
  return { def, row, summary: characterSummary(def, Number(row.xp) || 0, true) };
}

export function selectCharacterForUser(db: DatabaseSync, userId: string, characterId: string) {
  ensureCharacters(db, userId);
  const def = characterById(characterId);
  if (!def) throw new HttpError(400, 'UNKNOWN_CHARACTER', 'That character does not exist');
  const row = get<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? AND character_id = ?', userId, def.id);
  if (!row) throw new HttpError(404, 'CHARACTER_NOT_OWNED', 'That character is not available on this account');
  run(db, 'UPDATE character_saves SET selected = 0 WHERE user_id = ?', userId);
  run(db, 'UPDATE character_saves SET selected = 1 WHERE user_id = ? AND character_id = ?', userId, def.id);
  return {
    selected: characterSummary(def, Number(row.xp) || 0, true),
    characters: characterList(db, userId),
  };
}

export function awardCharacterXp(db: DatabaseSync, userId: string, characterId: string, xp: number) {
  ensureCharacters(db, userId);
  const def = characterById(characterId) || CHARACTERS[0];
  let row = get<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? AND character_id = ?', userId, def.id);
  if (!row) {
    run(
      db,
      'INSERT INTO character_saves (user_id, character_id, xp, selected, created_at) VALUES (?,?,?,?,?)',
      userId,
      def.id,
      0,
      0,
      now(),
    );
    row = get<CharacterRow>(db, 'SELECT * FROM character_saves WHERE user_id = ? AND character_id = ?', userId, def.id)!;
  }
  const before = characterSummary(def, Number(row.xp) || 0, Number(row.selected) === 1);
  const nextXp = (Number(row.xp) || 0) + Math.max(0, Math.floor(xp));
  run(db, 'UPDATE character_saves SET xp = ? WHERE user_id = ? AND character_id = ?', nextXp, userId, def.id);
  const after = characterSummary(def, nextXp, Number(row.selected) === 1);
  return { before, after, def, row: { ...row, xp: nextXp } };
}
