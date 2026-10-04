// 学習データの保存（端末のブラウザ内 localStorage）
const KEY = 'gitStudy.v1';
const SESSION_KEY = 'gitStudy.session';
const MAX_HISTORY = 50;
const MAX_MOCKS = 50;

function empty() {
  return { version: 1, exam: null, records: {}, mocks: [] };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.version === 1) return { ...empty(), ...d };
  } catch (e) { /* 読めない場合は初期状態 */ }
  return empty();
}

let db = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('保存に失敗', e); }
}

// ---- 選択中の試験 ----
export const getExam = () => db.exam;
export function setExam(id) { db.exam = id; save(); }

// ---- 問題ごとの記録 ----
// records[qid] = { h: [{ t: 時刻, c: 1/0, m: 'practice'|'mock' }], weak: bool }
function rec(qid) {
  if (!db.records[qid]) db.records[qid] = { h: [], weak: false };
  return db.records[qid];
}
export const history = (qid) => db.records[qid]?.h ?? [];
export const lastResult = (qid) => {
  const h = history(qid);
  return h.length ? h[h.length - 1].c === 1 : null;
};
export const isWeak = (qid) => !!db.records[qid]?.weak;

export function record(qid, correct, mode) {
  const r = rec(qid);
  r.h.push({ t: Date.now(), c: correct ? 1 : 0, m: mode });
  if (r.h.length > MAX_HISTORY) r.h.splice(0, r.h.length - MAX_HISTORY);
  save();
}

export function setWeak(qid, weak) {
  rec(qid).weak = !!weak;
  save();
}

// ---- 模擬試験の記録 ----
export const mocks = (examId) => db.mocks.filter((m) => m.exam === examId);
export function addMock(m) {
  db.mocks.push(m);
  if (db.mocks.length > MAX_MOCKS) db.mocks.splice(0, db.mocks.length - MAX_MOCKS);
  save();
}

// ---- 進行中のセッション（中断・再開用） ----
export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
export function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { console.warn(e); }
}
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
}

// ---- バックアップ ----
export const exportData = () => JSON.stringify(db, null, 2);
export function importData(text) {
  const d = JSON.parse(text);
  if (!d || d.version !== 1 || typeof d.records !== 'object') throw new Error('このアプリのバックアップ形式ではありません');
  db = { ...empty(), ...d };
  save();
}
export function resetAll() {
  const exam = db.exam;
  db = empty();
  db.exam = exam;
  save();
  clearSession();
}
