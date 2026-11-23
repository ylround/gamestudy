import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, all, get, run, transaction } from '../lib/db.ts';
import { seedDatabase } from '../seed/index.ts';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.ts';
import { judge, parseNumeric } from '../lib/judge.ts';
import type { QuestionAnswer, QuestionContent } from '../lib/types.ts';
import { createSession, getSession, nextQuestion, requestHint, result, submitAnswer } from '../modules/quiz.ts';
import { createTemplateXlsx, parseImportPayload, validateImport, createBatch, commitBatch, rollbackBatch } from '../modules/imports.ts';
import { createJob, getJob, processJob, reviewItem } from '../modules/ai.ts';
import { stageStates } from '../modules/common.ts';
import { characterList, selectCharacterForUser } from '../modules/characters.ts';

let dir = '';
let db: any;
let studentId = '';
let parentId = '';
let adminId = '';

function answerPayload(answer: QuestionAnswer) {
  if (answer.kind === 'SINGLE') return { optionKey: String(answer.value) };
  if (answer.kind === 'MULTI') return { optionKeys: Array.isArray(answer.value) ? answer.value.map(String) : [String(answer.value)] };
  if (answer.kind === 'JUDGE') return { optionKey: answer.value ? 'T' : 'F' };
  return { value: answer.value };
}

function contentFixture(overrides: Partial<QuestionContent> = {}): QuestionContent {
  return {
    stem: { zh: '1 + 1 = ?', en: '1 + 1 = ?' },
    options: [
      { key: 'A', text: { zh: '2', en: '2' } },
      { key: 'B', text: { zh: '3', en: '3' } },
    ],
    hints: [{ zh: '数一数', en: 'Count' }],
    explanation: { zh: '1+1=2', en: '1+1=2' },
    skill: { zh: '加法', en: 'Addition' },
    ...overrides,
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mathrealms-test-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  seedDatabase(db);
  studentId = get<any>(db, "SELECT id FROM users WHERE username = 'xiaoyu'").id;
  parentId = get<any>(db, "SELECT id FROM users WHERE username = 'mama'").id;
  adminId = get<any>(db, "SELECT id FROM users WHERE username = 'admin'").id;
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('password hashes and tokens are verifiable and tamper resistant', () => {
  const hash = hashPassword('demo1234');
  assert.equal(verifyPassword('demo1234', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  const token = signToken({ id: 'u1', role: 'student', username: 'demo', displayName: 'Demo' });
  assert.equal(verifyToken(token)?.sub, 'u1');
  assert.equal(verifyToken(`${token.slice(0, -1)}x`), null);
});

test('judging supports choice, true/false, number tolerance, fractions, multi and text', () => {
  const answer: QuestionAnswer = { kind: 'SINGLE', value: 'A' };
  assert.equal(judge(contentFixture(), answer, { optionKey: 'A' }).correct, true);
  assert.equal(judge(contentFixture(), answer, { optionKey: 'B' }).correct, false);
  assert.equal(judge(contentFixture(), { kind: 'JUDGE', value: true }, { optionKey: 'T' }).correct, true);
  assert.equal(judge(contentFixture(), { kind: 'NUMBER', value: '3.14', tolerance: 0.01 }, { value: '3.141' }).correct, true);
  assert.equal(judge(contentFixture(), { kind: 'NUMBER', value: '3.14', tolerance: 0.01 }, { value: '3.2' }).correct, false);
  assert.equal(judge(contentFixture(), { kind: 'FRACTION', value: '3/4' }, { value: '6/8' }).correct, true);
  assert.equal(judge(contentFixture(), { kind: 'FRACTION', value: '3/4' }, { value: '4/5' }).correct, false);
  assert.equal(judge(contentFixture(), { kind: 'MULTI', value: ['A', 'B'] }, { optionKeys: ['B', 'A'] }).correct, true);
  assert.equal(judge(contentFixture(), { kind: 'MULTI', value: ['A'] }, { optionKeys: ['A', 'B'] }).correct, false);
  assert.equal(judge(contentFixture(), { kind: 'TEXT', value: 'Cat' }, { value: ' cat ' }).correct, true);
  assert.equal(parseNumeric('50%'), 0.5);
  assert.equal(parseNumeric('1 1/2'), 1.5);
});

test('stage session never leaks answers and rewards exactly once', () => {
  const created = createSession(db, studentId, { kind: 'STAGE', stageKey: 'g4-numbers-1' });
  assert.ok(created.session.id);
  assert.equal(created.finished, false);
  assert.equal(created.question.options.every((option: any) => option.correct === undefined), true);
  assert.equal('answer' in created.question, false);
  assert.equal(created.question.explanation, undefined);
  const sessionId = created.session.id;
  const rows = all<any>(db, 'SELECT * FROM session_questions WHERE session_id = ? ORDER BY seq', sessionId);
  assert.equal(rows.length, created.session.questionCount);
  for (let index = 0; index < rows.length; index += 1) {
    const answer = JSON.parse(rows[index].answer_json);
    const response = submitAnswer(db, studentId, sessionId, { seq: index, answer: answerPayload(answer), timeMs: 5000 });
    assert.equal(response.correct, true);
    if (response.isFinal) break;
    const next = nextQuestion(db, studentId, sessionId);
    if (next.finished) break;
  }
  const first = result(db, studentId, sessionId);
  assert.equal(first.result.victory, true);
  assert.equal(first.result.correct, first.result.asked);
  const balancesBefore = get<any>(db, 'SELECT coins, stars FROM currency_accounts WHERE user_id = ?', studentId);
  const second = result(db, studentId, sessionId);
  const balancesAfter = get<any>(db, 'SELECT coins, stars FROM currency_accounts WHERE user_id = ?', studentId);
  assert.deepEqual(balancesBefore, balancesAfter);
  assert.equal(second.result.xp, first.result.xp);
  const stages = stageStates(db, studentId, 4);
  assert.ok(stages.domains[0].stages[0].bestStars >= 1);
  assert.equal(stages.domains[0].stages[1].unlocked, true);
});

test('wrong answers create mistakes, hints are gated and resuming an active session reuses it', () => {
  const created = createSession(db, studentId, { kind: 'STAGE', stageKey: 'g4-numbers-2' });
  const again = createSession(db, studentId, { kind: 'STAGE', stageKey: 'g4-numbers-2' });
  assert.equal(created.session.id, again.session.id);
  const sessionId = created.session.id;
  const rows = all<any>(db, 'SELECT * FROM session_questions WHERE session_id = ? ORDER BY seq', sessionId);
  const answer = JSON.parse(rows[0].answer_json);
  const wrong = answer.kind === 'SINGLE'
    ? { optionKey: answer.value === 'A' ? 'B' : 'A' }
    : answer.kind === 'JUDGE'
      ? { optionKey: answer.value ? 'F' : 'T' }
      : { value: '-999999' };
  const hint = requestHint(db, studentId, sessionId, { seq: 0 });
  assert.ok(hint.hint.zh);
  const response = submitAnswer(db, studentId, sessionId, { seq: 0, answer: wrong, timeMs: 3000 });
  assert.equal(response.correct, false);
  assert.equal(response.heroHp, 80);
  assert.ok(get<any>(db, 'SELECT id FROM mistakes WHERE student_id = ? AND resolved = 0', studentId));
  const retry = submitAnswer(db, studentId, sessionId, { seq: 0, answer: wrong, timeMs: 3000 });
  assert.equal(retry.idempotent, true);
});

test('character selection changes the combat style and difficulty scales the ultimate tier', () => {
  const selected = selectCharacterForUser(db, studentId, 'frost');
  assert.equal(selected.selected.id, 'frost');
  assert.equal(selected.selected.counterReduction, 4);
  const created = createSession(db, studentId, { kind: 'STAGE', stageKey: 'g4-numbers-1' });
  const row = all<any>(db, 'SELECT * FROM session_questions WHERE session_id = ? ORDER BY seq LIMIT 1', created.session.id)[0];
  const answer = JSON.parse(row.answer_json);
  const wrong = answer.kind === 'SINGLE'
    ? { optionKey: answer.value === 'A' ? 'B' : 'A' }
    : answer.kind === 'JUDGE'
      ? { optionKey: answer.value ? 'F' : 'T' }
      : { value: '-999999' };
  const response = submitAnswer(db, studentId, created.session.id, { seq: 0, answer: wrong, timeMs: 3000 });
  assert.equal(response.character.id, 'frost');
  assert.equal(response.heroHp, 84);
  const practice = createSession(db, studentId, { kind: 'PRACTICE', knowledgeCode: 'MATH-RJ-G4-T1-NUM-03' });
  const practiceRow = all<any>(db, 'SELECT * FROM session_questions WHERE session_id = ? ORDER BY seq LIMIT 1', practice.session.id)[0];
  const practiceAnswer = JSON.parse(practiceRow.answer_json);
  const correct = practiceAnswer.kind === 'SINGLE'
    ? { optionKey: practiceAnswer.value }
    : practiceAnswer.kind === 'JUDGE'
      ? { optionKey: practiceAnswer.value ? 'T' : 'F' }
      : { value: practiceAnswer.value };
  const practiceResponse = submitAnswer(db, studentId, practice.session.id, { seq: 0, answer: correct, timeMs: 4000 });
  assert.equal(practiceResponse.cast.tier, 3);
  assert.equal(practiceResponse.cast.ultimate, true);
  assert.ok(practiceResponse.cast.name.zh);
  const roster = characterList(db, studentId);
  assert.equal(roster.length, 3);
  assert.ok(roster.find((item: any) => item.id === 'frost').outfitTier >= 2);
  selectCharacterForUser(db, studentId, 'pyra');
});

test('XLSX template round-trips and CSV validation catches bad rows', async () => {
  const template = await createTemplateXlsx();
  const parsed = await parseImportPayload({ filename: 'template.xlsx', base64: template.toString('base64') });
  const preview = validateImport(db, parsed.sheets);
  assert.equal(preview.errors.length, 0);
  assert.ok(preview.questions.length >= 2);
  const batchId = createBatch(db, get<any>(db, 'SELECT * FROM users WHERE role = ?', 'admin'), parsed.filename, parsed.hash, preview);
  const committed = commitBatch(db, get<any>(db, 'SELECT * FROM users WHERE role = ?', 'admin'), batchId, '127.0.0.1', 'req-test');
  assert.ok(committed.created >= 2);
  const createdQuestions = all<any>(db, "SELECT * FROM questions WHERE batch_id = ?", batchId);
  assert.equal(createdQuestions.every((row: any) => row.status === 'DRAFT'), true);
  const rolled = rollbackBatch(db, get<any>(db, 'SELECT * FROM users WHERE role = ?', 'admin'), batchId, '127.0.0.1', 'req-test-2');
  assert.ok(rolled.removed + rolled.archived >= 2);

  const csv = [
    'question_code,knowledge_code,question_type,difficulty,stem,question_options,answer_value',
    'BAD-1,UNKNOWN,SINGLE,2,"1 + 1 = ?",,A',
    'BAD-2,MATH-RJ-G4-T1-NUM-01,SINGLE,2,"1 + 1 = ?",,A',
  ].join('\n');
  const badParsed = await parseImportPayload({ filename: 'bad.csv', text: csv });
  const badPreview = validateImport(db, badParsed.sheets);
  assert.ok(badPreview.errors.length >= 1);
});

test('AI jobs generate drafts, reject one and publish an approved draft', async () => {
  const admin = get<any>(db, 'SELECT * FROM users WHERE role = ?', 'admin');
  const actor = { id: admin.id, role: 'admin' as const, username: admin.username, displayName: admin.display_name };
  const job = createJob(db, actor, { knowledgeCode: 'MATH-RJ-G4-T1-NUM-01', type: 'NUMBER', difficulty: 2, count: 2 }, '127.0.0.1', 'req-ai');
  processJob(db, job.id);
  const done = getJob(db, job.id);
  assert.equal(done.status, 'SUCCEEDED');
  assert.ok(done.items.length >= 1);
  const rejected = reviewItem(db, actor, done.items[0].id, { action: 'reject', reason: '测试驳回' }, '127.0.0.1', 'req-ai-2');
  assert.equal(rejected.status, 'REJECTED');
  if (done.items[1]) {
    const approved = reviewItem(db, actor, done.items[1].id, { action: 'approve' }, '127.0.0.1', 'req-ai-3');
    assert.equal(approved.status, 'APPROVED');
    const question = get<any>(db, 'SELECT * FROM questions WHERE id = ?', approved.question.id);
    assert.equal(question.status, 'PUBLISHED');
    assert.equal(question.source, 'AI');
  }
});
