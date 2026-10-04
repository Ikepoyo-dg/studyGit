// 学習データの保存（端末のブラウザ内 localStorage）
//
// 【学習履歴を消さないためのルール】
// - KEY（保存先の名前）は絶対に変更しない。変えると過去の履歴が読めなくなる。
// - データ形式を変えるときは VERSION を上げ、MIGRATIONS に「旧形式 → 新形式」の変換を追加する。
//   古いデータを捨てる処理は書かない。
// - 問題の id（data/questions/*.json）は一度公開したら変更しない。履歴は id に紐づいている。
const KEY = 'gitStudy.v1';
const SESSION_KEY = 'gitStudy.session';
const RESCUE_KEY = 'gitStudy.rescue'; // 読み込めなかったデータの退避先
const VERSION = 1;
const MAX_HISTORY = 50;
const MAX_MOCKS = 50;

// 形式の変換: MIGRATIONS[n] は「バージョン n のデータ」を「n + 1」に変換する関数
// 例) 2: (d) => ({ ...d, version: 3, settings: {} }),
const MIGRATIONS = {};

function empty() {
  return { version: VERSION, exam: null, records: {}, mocks: [] };
}

function migrate(d) {
  let v = Number(d.version) || 1;
  while (v < VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`バージョン${v}からの変換がありません`);
    d = step(d);
    v = d.version;
  }
  if (v > VERSION) throw new Error(`新しい形式（バージョン${v}）のデータです`);
  return { ...empty(), ...d, records: d.records || {}, mocks: d.mocks || [] };
}

function rescue(raw, reason) {
  // 読めないデータも捨てずに退避しておく（後から手動で復旧できるように）
  try {
    localStorage.setItem(RESCUE_KEY, JSON.stringify({ at: Date.now(), reason: String(reason), raw }));
  } catch (e) { /* noop */ }
}

let readOnly = false; // 読み込みに失敗したときは上書き保存しない

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { return empty(); }
  if (!raw) return empty();
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('学習データを読み込めませんでした', e);
    rescue(raw, e.message);
    readOnly = true;
    return empty();
  }
}

let db = load();

function save() {
  if (readOnly) return;
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
  if (!d || typeof d.records !== 'object') throw new Error('このアプリのバックアップ形式ではありません');
  db = migrate(d);
  readOnly = false;
  save();
}
// 端末の容量不足などでブラウザがデータを自動削除しないよう「永続保存」を要求する
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}
export async function isPersisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch (e) { return null; }
}
export const loadFailed = () => readOnly;

export function resetAll() {
  readOnly = false;
  const exam = db.exam;
  db = empty();
  db.exam = exam;
  save();
  clearSession();
}
