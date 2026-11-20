import type { DatabaseSync } from 'node:sqlite';
import { all, get, json, now, run } from '../lib/db.ts';
import { audit } from '../lib/auth.ts';
import { HttpError, requireInt } from '../lib/http.ts';
import { childSummary, getProfile, stageStates } from './common.ts';

function assertLinked(db: DatabaseSync, parentId: string, childId: string) {
  const link = get<any>(
    db,
    "SELECT * FROM family_links WHERE parent_id = ? AND child_id = ? AND status = 'active'",
    parentId,
    childId,
  );
  if (!link) throw new HttpError(403, 'NOT_YOUR_CHILD', 'You can only view children linked to your account');
  const child = get<any>(db, 'SELECT * FROM users WHERE id = ?', childId);
  if (!child) throw new HttpError(404, 'CHILD_NOT_FOUND', 'Child not found');
  return child;
}

function dayOf(value: string | null | undefined): string {
  return String(value || '').slice(0, 10);
}

function streakFromDays(days: Set<string>): number {
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function reportForChild(db: DatabaseSync, parentId: string, childId: string, days = 30) {
  const child = assertLinked(db, parentId, childId);
  const profile = getProfile(db, childId);
  const summary = childSummary(db, childId)!;
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const answers = all<any>(
    db,
    `SELECT sq.answered_at, sq.correct, sq.time_ms, qs.kind, qs.stage_key, qs.knowledge_code
     FROM session_questions sq JOIN quiz_sessions qs ON qs.id = sq.session_id
     WHERE qs.student_id = ? AND sq.answered = 1 AND sq.answered_at >= ?
     ORDER BY sq.answered_at DESC`,
    childId,
    since,
  );
  const allAnswers = all<any>(
    db,
    `SELECT sq.answered_at, sq.correct, sq.time_ms FROM session_questions sq
     JOIN quiz_sessions qs ON qs.id = sq.session_id WHERE qs.student_id = ? AND sq.answered = 1`,
    childId,
  );
  const today = new Date().toISOString().slice(0, 10);
  const daysWithAnswers = new Set(allAnswers.map((row) => dayOf(row.answered_at)).filter(Boolean));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const rows = allAnswers.filter((row) => dayOf(row.answered_at) === key);
    return {
      date: key,
      answers: rows.length,
      correct: rows.filter((row) => Number(row.correct) === 1).length,
      studyMs: rows.reduce((sum, row) => sum + Number(row.time_ms || 0), 0),
    };
  });
  const mastery = all<any>(
    db,
    `SELECT m.*, k.name_zh, k.name_en, k.domain FROM mastery_records m
     LEFT JOIN knowledge_points k ON k.code = m.knowledge_code
     WHERE m.student_id = ? ORDER BY m.score ASC`,
    childId,
  ).map((row) => ({
    knowledgeCode: row.knowledge_code,
    name: { zh: row.name_zh || row.knowledge_code, en: row.name_en || row.knowledge_code },
    domain: row.domain,
    score: Math.round(Number(row.score) || 0),
    attempts: Number(row.attempts) || 0,
    correct: Number(row.correct) || 0,
    lastPracticedAt: row.last_practiced_at,
  }));
  const mistakes = all<any>(
    db,
    `SELECT id, knowledge_code, wrong_count, updated_at, content_json FROM mistakes
     WHERE student_id = ? AND resolved = 0 ORDER BY updated_at DESC LIMIT 30`,
    childId,
  ).map((row) => {
    let stem = { zh: '', en: '' };
    try {
      stem = JSON.parse(row.content_json).stem || stem;
    } catch {
      // ignore malformed snapshots
    }
    return {
      id: row.id,
      knowledgeCode: row.knowledge_code,
      wrongCount: Number(row.wrong_count) || 1,
      updatedAt: row.updated_at,
      stem,
    };
  });
  const stages = stageStates(db, childId, profile?.grade || 4);
  const completedStages = stages.domains.flatMap((domain: any) =>
    domain.stages.filter((stage: any) => stage.completed),
  );
  const current = answers.find((row) => row.knowledge_code);
  const currentKnowledge = current
    ? get<any>(db, 'SELECT name_zh, name_en FROM knowledge_points WHERE code = ?', current.knowledge_code)
    : null;

  return {
    child: summary,
    generatedAt: now(),
    periodDays: days,
    today: {
      answers: answers.filter((row) => dayOf(row.answered_at) === today).length,
      correct: answers.filter((row) => dayOf(row.answered_at) === today && Number(row.correct) === 1).length,
      studyMs: answers.filter((row) => dayOf(row.answered_at) === today).reduce((sum, row) => sum + Number(row.time_ms || 0), 0),
    },
    period: {
      answers: answers.length,
      correct: answers.filter((row) => Number(row.correct) === 1).length,
      accuracy: answers.length ? Math.round((answers.filter((row) => Number(row.correct) === 1).length / answers.length) * 100) : 0,
      studyMs: answers.reduce((sum, row) => sum + Number(row.time_ms || 0), 0),
    },
    allTime: {
      answers: allAnswers.length,
      correct: allAnswers.filter((row) => Number(row.correct) === 1).length,
      accuracy: allAnswers.length ? Math.round((allAnswers.filter((row) => Number(row.correct) === 1).length / allAnswers.length) * 100) : 0,
      studyMs: allAnswers.reduce((sum, row) => sum + Number(row.time_ms || 0), 0),
      streakDays: streakFromDays(daysWithAnswers),
      studyDays: daysWithAnswers.size,
    },
    weekly: weekDays,
    mastery,
    mistakes,
    currentChapter: currentKnowledge
      ? { knowledgeCode: current.knowledge_code, name: { zh: currentKnowledge.name_zh, en: currentKnowledge.name_en } }
      : null,
    completedStages: completedStages.map((stage: any) => ({
      key: stage.key,
      name: stage.name,
      stars: stage.bestStars,
    })),
    totalStages: stages.domains.reduce((sum: number, domain: any) => sum + domain.stages.length, 0),
    controls: profile?.controls_json ? JSON.parse(profile.controls_json) : {},
  };
}

export function updateControls(db: DatabaseSync, parentId: string, childId: string, body: any, ip: string, requestId: string) {
  assertLinked(db, parentId, childId);
  const profile = getProfile(db, childId);
  const current = profile?.controls_json ? JSON.parse(profile.controls_json) : {};
  const next = {
    ...current,
    dailyMinutes: requireInt(body.dailyMinutes ?? current.dailyMinutes ?? 40, 'dailyMinutes', { min: 0, max: 240 }),
    allowedFrom: typeof body.allowedFrom === 'string' ? body.allowedFrom : current.allowedFrom || '17:00',
    allowedTo: typeof body.allowedTo === 'string' ? body.allowedTo : current.allowedTo || '21:00',
    notifications: typeof body.notifications === 'boolean' ? body.notifications : Boolean(current.notifications),
    purchaseApproval: typeof body.purchaseApproval === 'boolean' ? body.purchaseApproval : Boolean(current.purchaseApproval),
  };
  run(db, 'UPDATE profiles SET controls_json = ? WHERE user_id = ?', json(next), childId);
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'PARENT_CONTROLS_UPDATE', 'profile', childId, current, next, ip, requestId);
  return { controls: next };
}

export function exportChild(db: DatabaseSync, parentId: string, childId: string, ip: string, requestId: string) {
  const child = assertLinked(db, parentId, childId);
  const profile = getProfile(db, childId);
  const sessions = all<any>(db, 'SELECT * FROM quiz_sessions WHERE student_id = ? ORDER BY started_at DESC', childId)
    .map((session) => ({
      ...session,
      state_json: undefined,
      answers: all<any>(
        db,
        'SELECT seq, answered, correct, time_ms, hints_used, answered_at FROM session_questions WHERE session_id = ? ORDER BY seq',
        session.id,
      ),
    }));
  const data = {
    exportedAt: now(),
    child: {
      id: child.id,
      username: child.username,
      displayName: child.display_name,
      nickname: profile?.nickname,
      grade: profile?.grade,
      createdAt: child.created_at,
    },
    sessions,
    mastery: all<any>(db, 'SELECT * FROM mastery_records WHERE student_id = ?', childId),
    mistakes: all<any>(db, 'SELECT * FROM mistakes WHERE student_id = ?', childId),
    stageResults: all<any>(db, 'SELECT * FROM stage_results WHERE student_id = ?', childId),
  };
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'PARENT_DATA_EXPORT', 'user', childId, null, null, ip, requestId);
  return data;
}

export function requestDeletion(db: DatabaseSync, parentId: string, childId: string, ip: string, requestId: string) {
  assertLinked(db, parentId, childId);
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'PARENT_DELETION_REQUEST', 'user', childId, null, { requestedAt: now() }, ip, requestId);
  return { ok: true, message: 'Deletion request recorded. An administrator will process it after identity verification.' };
}
