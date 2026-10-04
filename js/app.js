import * as S from './storage.js';
import { renderMarkdown } from './md.js';

const $app = document.getElementById('app');
const state = { exams: [], questions: {}, timer: null, histFilter: 'all' };

// ================= ユーティリティ =================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 問題文・選択肢用: エスケープ後に `code` と改行だけ整形
const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
const go = (path) => { location.hash = '#' + path; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const fmtDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} を読み込めませんでした (${r.status})`);
  return r.json();
}
const currentExam = () => state.exams.find((e) => e.id === S.getExam());
async function questionsOf(examId) {
  if (!state.questions[examId]) state.questions[examId] = await loadJSON(`data/questions/${examId}.json`);
  return state.questions[examId];
}
const domainName = (ex, id) => ex.domains.find((d) => d.id === id)?.name ?? id;

function page(title, body, { back = '/menu', sub = '' } = {}) {
  return `
    <header class="bar">
      ${back ? `<a class="back" href="#${back}" aria-label="戻る">‹</a>` : '<span class="back"></span>'}
      <div class="bar-title"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    </header>
    <section class="content">${body}</section>`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function confirmDialog(msg, okLabel = 'OK') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      <p>${esc(msg)}</p>
      <div class="row"><button class="btn ghost" data-r="0">キャンセル</button><button class="btn primary" data-r="1">${esc(okLabel)}</button></div>
    </div>`;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b && e.target !== wrap) return;
      wrap.remove();
      resolve(b ? b.dataset.r === '1' : false);
    });
    document.body.appendChild(wrap);
  });
}

// 回答履歴の ✓✗ ドット（直近 n 件）
function dots(qid, n = 5) {
  const h = S.history(qid).slice(-n);
  if (!h.length) return '<span class="dots muted">未回答</span>';
  return `<span class="dots">${h.map((x) => `<i class="${x.c ? 'ok' : 'ng'}">${x.c ? '○' : '×'}</i>`).join('')}</span>`;
}
const weakBtn = (qid) =>
  `<button class="weak ${S.isWeak(qid) ? 'on' : ''}" data-action="weak" data-id="${esc(qid)}" aria-pressed="${S.isWeak(qid)}">${S.isWeak(qid) ? '★ 苦手' : '☆ 苦手'}</button>`;

// 試験ごとの集計（各問題の「最新の回答」で正答率を出す）
function stats(qs, ex) {
  const by = {};
  for (const d of ex.domains) by[d.id] = { total: 0, answered: 0, correct: 0, weak: 0 };
  const all = { total: 0, answered: 0, correct: 0, weak: 0 };
  for (const q of qs) {
    const t = by[q.domain];
    const last = S.lastResult(q.id);
    for (const s of [t, all]) {
      if (!s) continue;
      s.total++;
      if (last !== null) { s.answered++; if (last) s.correct++; }
      if (S.isWeak(q.id)) s.weak++;
    }
  }
  return { by, all };
}
const bar = (v) => `<div class="meter"><span style="width:${v}%"></span></div>`;

// ================= ルーティング =================
async function route() {
  stopTimer();
  const [path, qs] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const p = path || '/';
  const ex = currentExam();
  try {
    if (!['/', '/settings'].includes(p) && !ex) return go('/');
    switch (p) {
      case '/': await viewSelect(); break;
      case '/menu': await viewMenu(ex); break;
      case '/domains': await viewDomains(ex); break;
      case '/mock': await viewMockSetup(ex); break;
      case '/weak': await viewWeak(ex); break;
      case '/quiz': await viewQuiz(); break;
      case '/summary': await viewSummary(); break;
      case '/history': await viewHistory(ex); break;
      case '/q': await viewQuestion(ex, params.get('id')); break;
      case '/guide': await viewGuide(); break;
      case '/settings': await viewSettings(); break;
      default: go('/');
    }
  } catch (e) {
    console.error(e);
    $app.innerHTML = page('エラー', `<p class="card">${esc(e.message)}</p>`, { back: '/' });
  }
}

// ================= 画面: 試験選択 =================
async function viewSelect() {
  const cards = [];
  for (const ex of state.exams) {
    const qs = await questionsOf(ex.id);
    const st = stats(qs, ex).all;
    cards.push(`
      <button class="exam-card" data-action="select-exam" data-id="${ex.id}">
        <span class="badge">${esc(ex.level)}</span>
        <strong class="code">${esc(ex.code)}</strong>
        <span class="name">${esc(ex.name)}</span>
        <span class="muted">${esc(ex.summary)}</span>
        <span class="mini">問題数 ${st.total} ・ 回答済 ${st.answered} ・ 正答率 ${pct(st.correct, st.answered)}%</span>
      </button>`);
  }
  $app.innerHTML = `
    <header class="hero"><h1>Git Study</h1><p>勉強する試験を選んでください</p></header>
    <section class="content">${cards.join('')}
      <a class="link-center" href="#/settings">設定・データ管理</a>
    </section>`;
}

// ================= 画面: メニュー =================
async function viewMenu(ex) {
  const qs = await questionsOf(ex.id);
  const st = stats(qs, ex).all;
  const s = S.getSession();
  const resume = s && !s.finished && s.exam === ex.id
    ? `<div class="card resume"><div><strong>続きから</strong><br><span class="muted">${esc(s.title)}（${s.items.filter((i) => i.done || i.sel.length).length}/${s.items.length}）</span></div>
       <div class="row"><button class="btn ghost small" data-action="discard">破棄</button><a class="btn primary small" href="#/quiz">再開</a></div></div>`
    : '';
  const lastMock = S.mocks(ex.id).slice(-1)[0];
  $app.innerHTML = page(`${ex.code} ${ex.name}`, `
    ${resume}
    <div class="card stats">
      <div><b>${st.answered}</b><span>/${st.total}問 回答済</span></div>
      <div><b>${pct(st.correct, st.answered)}%</b><span>正答率</span></div>
      <div><b>${st.weak}</b><span>苦手</span></div>
    </div>
    ${bar(pct(st.answered, st.total))}
    <nav class="menu">
      <a class="menu-item" href="#/domains"><span class="ic">📚</span><span><b>分野別に学習</b><small>分野を選んで1問ずつ解説付きで解く</small></span></a>
      <a class="menu-item" href="#/mock"><span class="ic">⏱</span><span><b>模擬試験</b><small>${lastMock ? `前回 ${lastMock.score}点（${lastMock.score >= ex.passScore ? '合格ライン到達' : '合格ライン未達'}）` : '本番形式・時間制限あり'}</small></span></a>
      <a class="menu-item" href="#/weak"><span class="ic">★</span><span><b>苦手を学習</b><small>苦手マーク ${st.weak}問・前回不正解の問題</small></span></a>
      <a class="menu-item" href="#/history"><span class="ic">📈</span><span><b>学習履歴</b><small>過去の正誤・模擬試験の結果</small></span></a>
      <a class="menu-item" href="#/guide"><span class="ic">ℹ️</span><span><b>試験ガイド</b><small>出題範囲・受験ステップ</small></span></a>
    </nav>
    <div class="row center"><a class="btn ghost small" href="#/">試験を切り替える</a><a class="btn ghost small" href="#/settings">設定</a></div>
  `, { back: '/' });
}

// ================= 画面: 分野一覧 =================
async function viewDomains(ex) {
  const qs = await questionsOf(ex.id);
  const st = stats(qs, ex);
  const items = ex.domains.map((d) => {
    const s = st.by[d.id];
    return `
      <div class="card domain">
        <div class="domain-head"><b>${esc(d.name)}</b><span class="tag">${esc(d.weight)}</span></div>
        <div class="muted mini">${s.total}問 ・ 回答済 ${s.answered} ・ 正答率 ${pct(s.correct, s.answered)}% ・ 苦手 ${s.weak}</div>
        ${bar(pct(s.correct, s.total))}
        <div class="row">
          <button class="btn primary small" data-action="start-domain" data-id="${d.id}" ${s.total ? '' : 'disabled'}>全問</button>
          <button class="btn ghost small" data-action="start-domain" data-id="${d.id}" data-filter="unanswered" ${s.total - s.answered ? '' : 'disabled'}>未回答のみ</button>
        </div>
      </div>`;
  }).join('');
  $app.innerHTML = page('分野別に学習', `
    <button class="btn primary block" data-action="start-random">全分野からランダム10問</button>
    ${items}`, { sub: ex.code });
}

// ================= 画面: 苦手 =================
async function viewWeak(ex) {
  const qs = await questionsOf(ex.id);
  const weak = qs.filter((q) => S.isWeak(q.id));
  const wrong = qs.filter((q) => S.lastResult(q.id) === false);
  const list = weak.length
    ? weak.map((q) => `
      <div class="card qrow">
        <a href="#/q?id=${encodeURIComponent(q.id)}"><span class="mini muted">${esc(domainName(ex, q.domain))}</span><br>${rich(q.question)}</a>
        <div class="row between">${dots(q.id)}${weakBtn(q.id)}</div>
      </div>`).join('')
    : '<p class="card muted">まだ苦手マークはありません。問題を解いたあと「☆ 苦手」を押すと、ここに集まります。</p>';
  $app.innerHTML = page('苦手を学習', `
    <button class="btn primary block" data-action="start-weak" ${weak.length ? '' : 'disabled'}>苦手マークの問題を解く（${weak.length}問）</button>
    <button class="btn ghost block" data-action="start-wrong" ${wrong.length ? '' : 'disabled'}>前回まちがえた問題を解く（${wrong.length}問）</button>
    <h2>苦手マーク一覧</h2>${list}`, { sub: ex.code });
}

// ================= 画面: 模擬試験の設定 =================
async function viewMockSetup(ex) {
  const qs = await questionsOf(ex.id);
  const opts = mockOptions(ex, qs);
  const recent = S.mocks(ex.id).slice(-5).reverse();
  $app.innerHTML = page('模擬試験', `
    <div class="card">
      <p>出題範囲の比重に合わせて問題を選びます。解答中は正誤を表示せず、最後にまとめて採点します。</p>
      <fieldset class="choices-stack">
        <legend>形式</legend>
        ${opts.map((o, i) => `<label><input type="radio" name="mockopt" value="${i}" ${i === 0 ? 'checked' : ''}><span><b>${esc(o.label)}</b><br><span class="muted mini">${o.count}問・${o.minutes}分</span></span></label>`).join('')}
      </fieldset>
      <p class="muted mini">本番の問題数は非公開のため、受験者の報告にもとづく目安です。合格ラインは${ex.passScore}点/1000点として採点します。</p>
      <button class="btn primary block" data-action="start-mock">開始する</button>
    </div>
    ${recent.length ? `<h2>最近の結果</h2>${recent.map((m) => `<div class="card qrow row between"><span>${fmtDate(m.date)}<br><span class="muted mini">${m.correct}/${m.total}問正解</span></span><b class="${m.score >= ex.passScore ? 'pass' : 'fail'}">${m.score}点</b></div>`).join('')}` : ''}
  `, { sub: ex.code });
}

// 模擬試験の形式（本番形式とハーフ）
function mockOptions(ex, qs) {
  const m = ex.mock || { count: 50, minutes: 100 };
  const full = Math.min(m.count, qs.length);
  const minutesFull = Math.round((m.minutes * full) / m.count);
  const half = Math.ceil(full / 2);
  return [
    { label: '本番形式', count: full, minutes: minutesFull },
    { label: 'ハーフ', count: half, minutes: Math.round((minutesFull * half) / full) },
  ];
}

// ================= セッション開始 =================
function startSession({ mode, title, qs, back = '/menu', timeLimitSec = 0 }) {
  if (!qs.length) return toast('対象の問題がありません');
  const ex = currentExam();
  const s = {
    exam: ex.id, mode, title, back,
    items: qs.map((q) => ({ id: q.id, order: shuffle(q.choices.map((_, i) => i)), sel: [], done: false, correct: null })),
    index: 0, startedAt: Date.now(), finished: false,
    timeLimitSec,
  };
  S.saveSession(s);
  go('/quiz');
}

function pickMockQuestions(ex, qs, count) {
  // 分野の比重どおりに配分（最大剰余法で合計を count に合わせる）
  const pools = Object.fromEntries(ex.domains.map((d) => [d.id, shuffle(qs.filter((q) => q.domain === d.id))]));
  const sumW = ex.domains.reduce((a, d) => a + d.w, 0);
  const quota = ex.domains.map((d) => {
    const exact = (count * d.w) / sumW;
    return { id: d.id, n: Math.min(Math.floor(exact), pools[d.id].length), rest: exact - Math.floor(exact) };
  });
  let left = count - quota.reduce((a, q) => a + q.n, 0);
  for (const q of [...quota].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    if (q.n < pools[q.id].length) { q.n++; left--; }
  }
  const picked = quota.flatMap((q) => pools[q.id].splice(0, q.n));
  const rest = shuffle(Object.values(pools).flat());
  while (picked.length < count && rest.length) picked.push(rest.pop());
  return shuffle(picked);
}

const isCorrect = (q, item) => {
  const chosen = item.sel.map((di) => item.order[di]).sort();
  const ans = q.answer.slice().sort();
  return chosen.length === ans.length && chosen.every((v, i) => v === ans[i]);
};

// ================= 画面: 出題 =================
async function viewQuiz() {
  const s = S.getSession();
  if (!s || s.finished) return go(s?.finished ? '/summary' : '/menu');
  const ex = state.exams.find((e) => e.id === s.exam);
  const qs = await questionsOf(s.exam);
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const item = s.items[s.index];
  const q = byId[item.id];
  if (!q) { S.clearSession(); return go('/menu'); }
  const mock = s.mode === 'mock';
  const need = q.answer.length;

  const choiceHtml = item.order.map((orig, di) => {
    const selected = item.sel.includes(di);
    let cls = selected ? 'sel' : '';
    if (!mock && item.done) {
      if (q.answer.includes(orig)) cls += ' right';
      else if (selected) cls += ' wrong';
    }
    return `<button class="choice ${cls}" data-action="pick" data-i="${di}" ${!mock && item.done ? 'disabled' : ''}>
      <span class="mark">${need > 1 ? (selected ? '☑' : '☐') : (selected ? '●' : '○')}</span><span>${rich(q.choices[orig])}</span></button>`;
  }).join('');

  let footer;
  if (mock) {
    const palette = s.items.map((it, i) => `<button class="pal ${it.sel.length ? 'done' : ''} ${i === s.index ? 'cur' : ''}" data-action="jump" data-i="${i}">${i + 1}</button>`).join('');
    footer = `
      <div class="row between">
        <button class="btn ghost" data-action="prev" ${s.index === 0 ? 'disabled' : ''}>‹ 前へ</button>
        ${s.index < s.items.length - 1 ? '<button class="btn primary" data-action="next">次へ ›</button>' : '<button class="btn primary" data-action="grade">採点する</button>'}
      </div>
      <details class="palette-wrap"><summary>問題一覧（回答済 ${s.items.filter((i) => i.sel.length).length}/${s.items.length}）</summary><div class="palette">${palette}</div>
        <button class="btn ghost block" data-action="grade">ここで採点する</button></details>`;
  } else if (!item.done) {
    footer = `<button class="btn primary block" data-action="answer" ${item.sel.length === need ? '' : 'disabled'}>回答する</button>`;
  } else {
    const h = S.history(q.id);
    footer = `
      <div class="result ${item.correct ? 'ok' : 'ng'}">${item.correct ? '○ 正解' : '× 不正解'}</div>
      <div class="card explain"><b>解説</b><p>${rich(q.explanation)}</p>
        ${q.ref ? `<a href="${esc(q.ref)}" target="_blank" rel="noopener" class="mini">参考ドキュメント ↗</a>` : ''}</div>
      <div class="row between"><span class="mini muted">この問題の履歴 ${dots(q.id, 8)}（${h.filter((x) => x.c).length}/${h.length}回正解）</span>${weakBtn(q.id)}</div>
      <button class="btn primary block" data-action="next">${s.index < s.items.length - 1 ? '次の問題へ ›' : '結果を見る'}</button>`;
  }

  $app.innerHTML = `
    <header class="bar">
      <button class="back" data-action="leave" aria-label="中断">‹</button>
      <div class="bar-title"><h1>${esc(s.title)}</h1><small>${s.index + 1} / ${s.items.length}</small></div>
      ${mock ? '<span class="timer" id="timer"></span>' : weakBtn(q.id)}
    </header>
    <div class="progress"><span style="width:${pct(s.index + 1, s.items.length)}%"></span></div>
    <section class="content">
      <p class="mini muted">${esc(domainName(ex, q.domain))}</p>
      <div class="question">${rich(q.question)}</div>
      ${need > 1 ? `<p class="hint">${need}つ選択してください</p>` : ''}
      <div class="choices">${choiceHtml}</div>
      ${footer}
    </section>`;
  if (mock) startTimer(s);
}

function startTimer(s) {
  const tick = () => {
    const left = s.timeLimitSec - Math.floor((Date.now() - s.startedAt) / 1000);
    const el = document.getElementById('timer');
    if (el) { el.textContent = fmtTime(left); el.classList.toggle('warn', left < 300); }
    if (left <= 0) { stopTimer(); toast('時間切れです。採点します'); gradeMock(); }
  };
  tick();
  state.timer = setInterval(tick, 1000);
}
function stopTimer() { if (state.timer) clearInterval(state.timer); state.timer = null; }

async function gradeMock() {
  const s = S.getSession();
  if (!s || s.finished) return;
  const ex = state.exams.find((e) => e.id === s.exam);
  const byId = Object.fromEntries((await questionsOf(s.exam)).map((q) => [q.id, q]));
  const dom = {};
  let correct = 0;
  for (const it of s.items) {
    const q = byId[it.id];
    it.correct = isCorrect(q, it);
    it.done = true;
    if (it.correct) correct++;
    dom[q.domain] = dom[q.domain] || { total: 0, correct: 0 };
    dom[q.domain].total++;
    if (it.correct) dom[q.domain].correct++;
    S.record(q.id, it.correct, 'mock');
  }
  const score = Math.round((correct / s.items.length) * 1000);
  s.result = { score, correct, total: s.items.length, dom, sec: Math.floor((Date.now() - s.startedAt) / 1000) };
  s.finished = true;
  S.saveSession(s);
  S.addMock({ exam: ex.id, date: Date.now(), score, correct, total: s.items.length, dom });
  go('/summary');
}

// ================= 画面: 結果 =================
async function viewSummary() {
  const s = S.getSession();
  if (!s || !s.finished) return go('/menu');
  const ex = state.exams.find((e) => e.id === s.exam);
  const byId = Object.fromEntries((await questionsOf(s.exam)).map((q) => [q.id, q]));
  const correct = s.items.filter((i) => i.correct).length;
  const wrongCount = s.items.length - correct;

  let head;
  if (s.mode === 'mock') {
    const r = s.result;
    const pass = r.score >= ex.passScore;
    head = `
      <div class="card score ${pass ? 'pass' : 'fail'}">
        <div class="big">${r.score}<small>/1000</small></div>
        <div>${pass ? '合格ライン到達' : '合格ライン未達'}（${ex.passScore}点）</div>
        <div class="muted mini">${r.correct}/${r.total}問正解 ・ 所要 ${fmtTime(r.sec)}</div>
      </div>
      <p class="mini muted">※ 本番の採点方式は非公開のため、正答率を1000点満点に換算した目安です。</p>
      <h2>分野別</h2>
      ${ex.domains.filter((d) => r.dom[d.id]).map((d) => {
        const x = r.dom[d.id];
        return `<div class="dom-row"><span>${esc(d.name)}</span><span>${x.correct}/${x.total}</span>${bar(pct(x.correct, x.total))}</div>`;
      }).join('')}`;
  } else {
    head = `<div class="card score"><div class="big">${correct}<small>/${s.items.length}</small></div><div>正解</div></div>`;
  }

  const review = s.items.map((it, i) => {
    const q = byId[it.id];
    if (!q) return '';
    const yours = it.sel.map((di) => q.choices[it.order[di]]);
    return `
      <details class="card review">
        <summary><span class="${it.correct ? 'ok' : 'ng'}">${it.correct ? '○' : '×'}</span> 問${i + 1}. ${rich(q.question.length > 60 ? q.question.slice(0, 60) + '…' : q.question)}</summary>
        <div class="question">${rich(q.question)}</div>
        <p><b>あなたの回答:</b> ${yours.length ? yours.map(rich).join(' / ') : '（未回答）'}</p>
        <p><b>正解:</b> ${q.answer.map((a) => rich(q.choices[a])).join(' / ')}</p>
        <p class="explain-text">${rich(q.explanation)}</p>
        <div class="row end">${weakBtn(q.id)}</div>
      </details>`;
  }).join('');

  $app.innerHTML = page(s.mode === 'mock' ? '模擬試験の結果' : '結果', `
    ${head}
    <div class="row">
      <button class="btn primary" data-action="retry-wrong" ${wrongCount ? '' : 'disabled'}>まちがえた${wrongCount}問を復習</button>
      <button class="btn ghost" data-action="finish">メニューへ</button>
    </div>
    <h2>問題ごとの振り返り</h2>
    <p class="mini muted">タップで解説を表示。「☆ 苦手」を押すと苦手リストに入ります。</p>
    ${review}`, { back: '', sub: ex.code });
}

// ================= 画面: 履歴 =================
async function viewHistory(ex) {
  const qs = await questionsOf(ex.id);
  const st = stats(qs, ex);
  const f = state.histFilter;
  const filters = { all: 'すべて', weak: '苦手', wrong: '前回不正解', unanswered: '未回答' };
  const shown = qs.filter((q) => {
    if (f === 'weak') return S.isWeak(q.id);
    if (f === 'wrong') return S.lastResult(q.id) === false;
    if (f === 'unanswered') return S.lastResult(q.id) === null;
    return true;
  });
  const mocks = S.mocks(ex.id).slice().reverse();
  $app.innerHTML = page('学習履歴', `
    <h2>分野別の正答率</h2>
    ${ex.domains.map((d) => {
      const x = st.by[d.id];
      return `<div class="dom-row"><span>${esc(d.name)}</span><span>${pct(x.correct, x.answered)}%</span>${bar(pct(x.correct, x.answered))}</div>`;
    }).join('')}
    <p class="mini muted">各問題の最新の回答で集計しています。</p>
    ${mocks.length ? `<h2>模擬試験</h2><div class="card">${mocks.map((m) => `<div class="row between line"><span>${fmtDate(m.date)}</span><span>${m.correct}/${m.total}</span><b class="${m.score >= ex.passScore ? 'pass' : 'fail'}">${m.score}点</b></div>`).join('')}</div>` : ''}
    <h2>問題ごとの正誤</h2>
    <div class="chips">${Object.entries(filters).map(([k, v]) => `<button class="chip ${f === k ? 'on' : ''}" data-action="hist-filter" data-id="${k}">${v}</button>`).join('')}</div>
    ${shown.length ? shown.map((q) => `
      <div class="card qrow">
        <a href="#/q?id=${encodeURIComponent(q.id)}"><span class="mini muted">${esc(domainName(ex, q.domain))}</span><br>${rich(q.question)}</a>
        <div class="row between">${dots(q.id)}${weakBtn(q.id)}</div>
      </div>`).join('') : '<p class="card muted">該当する問題はありません。</p>'}
  `, { sub: ex.code });
}

// ================= 画面: 問題詳細 =================
async function viewQuestion(ex, id) {
  const qs = await questionsOf(ex.id);
  const q = qs.find((x) => x.id === id);
  if (!q) return go('/history');
  const h = S.history(q.id).slice().reverse();
  $app.innerHTML = page('問題の詳細', `
    <p class="mini muted">${esc(domainName(ex, q.domain))} ・ ${esc(q.id)}</p>
    <div class="question">${rich(q.question)}</div>
    <div class="choices">${q.choices.map((c, i) => `<div class="choice static ${q.answer.includes(i) ? 'right' : ''}"><span class="mark">${q.answer.includes(i) ? '✔' : ''}</span><span>${rich(c)}</span></div>`).join('')}</div>
    <div class="card explain"><b>解説</b><p>${rich(q.explanation)}</p>${q.ref ? `<a href="${esc(q.ref)}" target="_blank" rel="noopener" class="mini">参考ドキュメント ↗</a>` : ''}</div>
    <div class="row between">${weakBtn(q.id)}<button class="btn primary small" data-action="solve-one" data-id="${esc(q.id)}">この問題を解く</button></div>
    <h2>回答履歴</h2>
    ${h.length ? `<div class="card">${h.map((x) => `<div class="row between line"><span>${fmtDate(x.t)}</span><span class="mini muted">${x.m === 'mock' ? '模擬試験' : '学習'}</span><span class="${x.c ? 'ok' : 'ng'}">${x.c ? '○ 正解' : '× 不正解'}</span></div>`).join('')}</div>` : '<p class="card muted">まだ回答していません。</p>'}
  `, { back: '/history', sub: ex.code });
}

// ================= 画面: 試験ガイド =================
async function viewGuide() {
  const r = await fetch('content/exam-info.md').catch(() => null);
  const md = r && r.ok ? await r.text() : `# 読み込めませんでした\n\n試験ガイドのファイルを取得できませんでした（${r ? r.status : '通信エラー'}）。通信できる状態で開き直してください。`;
  $app.innerHTML = page('試験ガイド', `<article class="md">${renderMarkdown(md)}</article>`);
}

// ================= 画面: 設定 =================
async function viewSettings() {
  const persisted = await S.isPersisted();
  const persistText = persisted === true ? '有効（端末の容量不足でも自動削除されません）'
    : persisted === false ? '未許可（ホーム画面に追加して使うと許可されやすくなります）' : '確認できません';
  $app.innerHTML = page('設定・データ管理', `
    ${S.loadFailed() ? '<div class="card" style="border-color:var(--ng)"><b class="ng">学習データを読み込めませんでした</b><p class="mini">元のデータは消さずに退避してあります。この状態では新しい記録は保存されません。</p></div>' : ''}
    <div class="card">
      <b>学習データについて</b>
      <p class="mini">正誤の履歴と苦手マークは、この端末のブラウザ内に保存されます。アプリを更新しても消えません。</p>
      <p class="mini">永続保存: ${persistText}</p>
      <p class="mini">ブラウザのサイトデータ削除・アンインストール・機種変更では消えるため、その前にバックアップしてください。</p>
      <div class="row">
        <button class="btn primary small" data-action="export">バックアップを保存</button>
        <label class="btn ghost small">バックアップから復元<input type="file" accept="application/json,.json" id="import" hidden></label>
      </div>
    </div>
    <div class="card">
      <b>リセット</b>
      <p class="mini">すべての正誤履歴・苦手マーク・模擬試験の結果を削除します。</p>
      <button class="btn danger small" data-action="reset">学習データをリセット</button>
    </div>
  `, { back: currentExam() ? '/menu' : '/' });
}

// ================= イベント =================
async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  const ex = currentExam();

  if (a === 'select-exam') { S.setExam(id); return go('/menu'); }
  if (a === 'weak') {
    const on = !S.isWeak(id);
    S.setWeak(id, on);
    document.querySelectorAll(`[data-action="weak"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.textContent = on ? '★ 苦手' : '☆ 苦手';
    });
    return toast(on ? '苦手に追加しました' : '苦手から外しました');
  }
  if (a === 'hist-filter') { state.histFilter = id; return route(); }
  if (a === 'discard') {
    if (await confirmDialog('途中のセッションを破棄しますか？', '破棄する')) { S.clearSession(); route(); }
    return;
  }

  // ---- セッション開始系 ----
  if (a === 'start-domain' || a === 'start-random' || a === 'start-weak' || a === 'start-wrong' || a === 'start-mock' || a === 'solve-one') {
    const qs = await questionsOf(ex.id);
    if (a === 'start-domain') {
      let pool = qs.filter((q) => q.domain === id);
      if (el.dataset.filter === 'unanswered') pool = pool.filter((q) => S.lastResult(q.id) === null);
      return startSession({ mode: 'practice', title: domainName(ex, id), qs: shuffle(pool) });
    }
    if (a === 'start-random') return startSession({ mode: 'practice', title: 'ランダム10問', qs: shuffle(qs).slice(0, 10) });
    if (a === 'start-weak') return startSession({ mode: 'practice', title: '苦手マークの問題', qs: shuffle(qs.filter((q) => S.isWeak(q.id))) });
    if (a === 'start-wrong') return startSession({ mode: 'practice', title: '前回まちがえた問題', qs: shuffle(qs.filter((q) => S.lastResult(q.id) === false)) });
    if (a === 'solve-one') return startSession({ mode: 'practice', title: '1問チャレンジ', qs: qs.filter((q) => q.id === id) });
    if (a === 'start-mock') {
      const opt = mockOptions(ex, qs)[Number(document.querySelector('input[name="mockopt"]:checked')?.value || 0)];
      return startSession({ mode: 'mock', title: `模擬試験 ${opt.label}（${opt.count}問）`, qs: pickMockQuestions(ex, qs, opt.count), timeLimitSec: opt.minutes * 60 });
    }
  }

  // ---- 出題中 ----
  const s = S.getSession();
  if (['pick', 'answer', 'next', 'prev', 'jump', 'grade', 'leave'].includes(a) && !s) return go('/menu');
  if (a === 'pick') {
    const item = s.items[s.index];
    if (s.mode !== 'mock' && item.done) return;
    const q = (await questionsOf(s.exam)).find((x) => x.id === item.id);
    const di = Number(el.dataset.i);
    if (q.answer.length > 1) item.sel = item.sel.includes(di) ? item.sel.filter((x) => x !== di) : [...item.sel, di];
    else item.sel = [di];
    S.saveSession(s);
    return route();
  }
  if (a === 'answer') {
    const item = s.items[s.index];
    const q = (await questionsOf(s.exam)).find((x) => x.id === item.id);
    item.correct = isCorrect(q, item);
    item.done = true;
    S.record(q.id, item.correct, 'practice');
    S.saveSession(s);
    return route();
  }
  if (a === 'next') {
    if (s.index < s.items.length - 1) { s.index++; S.saveSession(s); return route(); }
    s.finished = true; S.saveSession(s); return go('/summary');
  }
  if (a === 'prev') { s.index = Math.max(0, s.index - 1); S.saveSession(s); return route(); }
  if (a === 'jump') { s.index = Number(el.dataset.i); S.saveSession(s); return route(); }
  if (a === 'grade') {
    const left = s.items.filter((i) => !i.sel.length).length;
    if (await confirmDialog(left ? `未回答が${left}問あります。採点しますか？` : '採点しますか？', '採点する')) gradeMock();
    return;
  }
  if (a === 'leave') { stopTimer(); return go(s.back || '/menu'); }

  // ---- 結果画面 ----
  if (a === 'retry-wrong') {
    const qs = await questionsOf(s.exam);
    const ids = s.items.filter((i) => !i.correct).map((i) => i.id);
    return startSession({ mode: 'practice', title: 'まちがえた問題の復習', qs: shuffle(qs.filter((q) => ids.includes(q.id))) });
  }
  if (a === 'finish') { S.clearSession(); return go('/menu'); }

  // ---- 設定 ----
  if (a === 'export') {
    const blob = new Blob([S.exportData()], { type: 'application/json' });
    const link = document.createElement('a');
    const d = new Date();
    link.href = URL.createObjectURL(blob);
    link.download = `git-study-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return toast('バックアップを保存しました');
  }
  if (a === 'reset') {
    if (await confirmDialog('すべての学習データを削除します。元に戻せません。よろしいですか？', '削除する')) { S.resetAll(); toast('リセットしました'); }
  }
}

async function onChange(e) {
  if (e.target.id !== 'import' || !e.target.files[0]) return;
  try {
    S.importData(await e.target.files[0].text());
    toast('復元しました');
  } catch (err) {
    toast('復元に失敗: ' + err.message);
  }
  e.target.value = '';
}

// ================= 起動 =================
async function init() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  try {
    state.exams = (await loadJSON('data/exams.json')).exams;
  } catch (e) {
    $app.innerHTML = `<p class="loading">データを読み込めませんでした。<br>${esc(e.message)}</p>`;
    return;
  }
  if (!location.hash && S.getExam()) go('/menu');
  else route();
  S.requestPersist();
  if (S.loadFailed()) toast('学習データを読み込めませんでした。データは退避済みです（設定画面を参照）');
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW登録失敗', err));
  }
}
init();
