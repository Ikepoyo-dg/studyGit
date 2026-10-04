import * as S from './storage.js';
import { renderMarkdown } from './md.js';
import { FIGURES, figureHtml } from './figures.js';

const $app = document.getElementById('app');
const state = { exams: [], questions: {}, timer: null, histFilter: 'all', noteFilter: 'todo', lastSel: '' };

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

const memoBtn = (qid = '') => `<button class="memo-btn" data-action="memo" data-id="${esc(qid)}" aria-label="用語をメモ">📝 メモ</button>`;
const figBlock = (q) => (q.figure ? figureHtml(q.figure) : '');

// 選択肢ごとの解説（正解／実在する別の概念／誤った説明／存在しない名称）
const NOTE_KIND = {
  o: ['ok', '正解'],
  r: ['real', '実在する別の概念'],
  w: ['wrong', '誤った説明'],
  f: ['fake', '存在しない名称'],
};
function choiceNotesHtml(q, order = null, selected = null) {
  if (!q.choiceNotes) return '';
  const idx = order || q.choices.map((_, i) => i);
  const rows = idx.map((i) => {
    const n = q.choiceNotes[i];
    if (!n) return '';
    const [cls, lbl] = NOTE_KIND[n.k] || ['real', ''];
    const mine = selected && selected.includes(i) ? '<span class="mine">あなたの回答</span>' : '';
    return `<li class="cn ${cls}"><div class="cn-head"><span class="cn-badge ${cls}">${lbl}</span>${mine}</div>
      <div class="cn-choice">${rich(q.choices[i])}</div><div class="cn-text">${rich(n.t)}</div></li>`;
  }).join('');
  return `<details class="cn-wrap" open><summary>選択肢ごとの解説</summary><ul class="cn-list">${rows}</ul>
    <p class="mini muted">「実在する別の概念」は試験に出る可能性のある用語です。「誤った説明」「存在しない名称」はひっかけ用の選択肢です。</p></details>`;
}

// 「Claudeに質問」: 問題・正解・解説を入れた質問文つきで Claude を開く（自動送信はされない）
const CLAUDE_URL = 'https://claude.ai/new?q=';
const L = 'ABCDEFGH';
function askPrompt(ex, q, yours = null) {
  const lines = [
    `GitHub認定試験 ${ex.code}（${ex.name}）の勉強中です。次の問題と解説について質問させてください。`,
    '',
    `【問題】${q.question}`,
    ...q.choices.map((c, i) => `${L[i]}. ${c}`),
    `【正解】${q.answer.map((a) => L[a]).join(', ')}`,
  ];
  if (yours) lines.push(`【私の回答】${yours.length ? yours.map((a) => L[a]).join(', ') : '未回答'}`);
  lines.push(`【解説】${q.explanation}`);
  if (q.ref) lines.push(`【参考】${q.ref}`);
  lines.push('', '【質問】');
  return lines.join('\n');
}
const askBtn = (ex, q, yours = null) =>
  `<a class="btn ghost small ask" href="${CLAUDE_URL}${encodeURIComponent(askPrompt(ex, q, yours))}" target="_blank" rel="noopener">💬 Claudeに質問 ↗</a>`;
const askTermUrl = (ex, term) =>
  CLAUDE_URL + encodeURIComponent(`GitHub認定試験 ${ex.code}（${ex.name}）の勉強中です。「${term}」について、初心者にも分かるように説明してください。試験で問われやすいポイントと、似た用語との違いも教えてください。`);

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
      case '/figures': viewFigures(ex, params.get('id')); break;
      case '/notes': await viewNotes(ex); break;
      case '/stats': await viewStats(ex); break;
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
      <a class="menu-item" href="#/stats"><span class="ic">🔥</span><span><b>学習の記録</b><small>${statsMenuText(ex)}</small></span></a>
      <a class="menu-item" href="#/history"><span class="ic">📈</span><span><b>学習履歴</b><small>過去の正誤・模擬試験の結果</small></span></a>
      <a class="menu-item" href="#/figures"><span class="ic">🧩</span><span><b>図解で理解</b><small>マージ・フォークなどの仕組みを図で確認</small></span></a>
      <a class="menu-item" href="#/notes"><span class="ic">📝</span><span><b>用語メモ</b><small>${S.notes(ex.id).filter((n) => !n.done).length}件が未調査 ・ 気になった用語をあとで調べる</small></span></a>
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
      <p class="mini">本番の画面操作（問題の移動やさまざまな出題形式）は、Microsoft公式の<a href="https://aka.ms/examdemo" target="_blank" rel="noopener">試験サンドボックス ↗</a>で事前に体験できます。</p>
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
        ${choiceNotesHtml(q, item.order, item.sel.map((di) => item.order[di]))}
        ${figBlock(q)}
        ${q.ref ? `<a href="${esc(q.ref)}" target="_blank" rel="noopener" class="mini">参考ドキュメント ↗</a>` : ''}</div>
      <div class="row between"><span class="mini muted">この問題の履歴 ${dots(q.id, 8)}（${h.filter((x) => x.c).length}/${h.length}回正解）</span>${weakBtn(q.id)}</div>
      <button class="btn primary block" data-action="next">${s.index < s.items.length - 1 ? '次の問題へ ›' : '結果を見る'}</button>`;
  }

  $app.innerHTML = `
    <header class="bar">
      <button class="back" data-action="leave" aria-label="中断">‹</button>
      <div class="bar-title"><h1>${esc(s.title)}</h1><small>${s.index + 1} / ${s.items.length}</small></div>
      ${memoBtn(q.id)}${mock ? '<span class="timer" id="timer"></span>' : weakBtn(q.id)}
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
        ${choiceNotesHtml(q, it.order, it.sel.map((di) => it.order[di]))}
        ${figBlock(q)}
        <div class="row end">${askBtn(ex, q, it.sel.map((di) => it.order[di]))}${memoBtn(q.id)}${weakBtn(q.id)}</div>
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
    <div class="card explain"><b>解説</b><p>${rich(q.explanation)}</p>${choiceNotesHtml(q)}${figBlock(q)}${q.ref ? `<a href="${esc(q.ref)}" target="_blank" rel="noopener" class="mini">参考ドキュメント ↗</a>` : ''}
      <div class="row">${askBtn(ex, q)}</div></div>
    <div class="row between"><span class="row">${weakBtn(q.id)}${memoBtn(q.id)}</span><button class="btn primary small" data-action="solve-one" data-id="${esc(q.id)}">この問題を解く</button></div>
    <h2>回答履歴</h2>
    ${h.length ? `<div class="card">${h.map((x) => `<div class="row between line"><span>${fmtDate(x.t)}</span><span class="mini muted">${x.m === 'mock' ? '模擬試験' : '学習'}</span><span class="${x.c ? 'ok' : 'ng'}">${x.c ? '○ 正解' : '× 不正解'}</span></div>`).join('')}</div>` : '<p class="card muted">まだ回答していません。</p>'}
  `, { back: '/history', sub: ex.code });
}

// ================= 画面: 学習の記録 =================
const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const daysAgo = (t) => Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY);
const agoText = (t) => { const n = daysAgo(t); return n === 0 ? '今日' : n === 1 ? '昨日' : `${n}日前`; };

// 日ごとの集計 { 'YYYY-MM-DD': { n, c, mock, qids:Set } }
function dailyStats(examId) {
  const days = {};
  for (const a of S.answerLog(examId)) {
    const k = S.dayKey(a.t);
    const d = (days[k] ||= { n: 0, c: 0, mock: 0, qids: new Set(), t: startOfDay(a.t) });
    d.n++; d.c += a.c; if (a.m === 'mock') d.mock++; d.qids.add(a.qid);
  }
  return days;
}
function streakOf(days) {
  let t = startOfDay(Date.now());
  if (!days[S.dayKey(t)]) t -= DAY; // 今日まだでも、昨日まで続いていれば継続中
  let n = 0;
  while (days[S.dayKey(t)]) { n++; t -= DAY; }
  return n;
}
function statsMenuText(ex) {
  const days = dailyStats(ex.id);
  const st = streakOf(days);
  const today = days[S.dayKey(Date.now())];
  if (today) return `今日 ${today.n}問 ・ ${st}日連続で学習中`;
  return st ? `${st}日連続中 ・ 今日も続けましょう` : '学習した日をカレンダーで確認';
}

// 学習カレンダー（GitHubの草のようなヒートマップ）
function heatmapSvg(days) {
  const WEEKS = 17, CELL = 15, GAP = 3, LEFT = 22, TOP = 16;
  const today = startOfDay(Date.now());
  const start = today - (new Date(today).getDay() + (WEEKS - 1) * 7) * DAY;
  const lv = (n) => (n === 0 ? 0 : n <= 5 ? 1 : n <= 10 ? 2 : n <= 20 ? 3 : 4);
  let cells = '', months = '', lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * DAY;
      if (t > today) continue;
      const x = LEFT + w * (CELL + GAP), y = TOP + d * (CELL + GAP);
      const k = S.dayKey(t), s = days[k];
      const n = s ? s.n : 0;
      const tip = `${md(t)}（${WEEK[d]}）: ${n ? `${n}問・正答率${pct(s.c, s.n)}%` : '学習なし'}`;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" class="hm l${lv(n)} ${t === today ? 'today' : ''}" data-tip="${esc(tip)}"/>`;
      const m = new Date(t).getMonth();
      if (d === 0 && m !== lastMonth) { months += `<text x="${x}" y="11" class="ax">${m + 1}月</text>`; lastMonth = m; }
    }
  }
  const dl = [1, 3, 5].map((d) => `<text x="0" y="${TOP + d * (CELL + GAP) + 11}" class="ax">${WEEK[d]}</text>`).join('');
  const w = LEFT + WEEKS * (CELL + GAP);
  return `<svg viewBox="0 0 ${w} ${TOP + 7 * (CELL + GAP)}" class="viz-svg" role="img" aria-label="過去${WEEKS}週間の学習カレンダー">${months}${dl}${cells}</svg>
    <div class="hm-legend"><span>少ない</span>${[0, 1, 2, 3, 4].map((l) => `<i class="l${l}"></i>`).join('')}<span>多い</span></div>`;
}

// 直近14日の回答数（正解・不正解の積み上げ）
function dailyBarsSvg(days) {
  const N = 14, W = 340, H = 170, L = 28, R = 6, T = 12, B = 26;
  const today = startOfDay(Date.now());
  const list = Array.from({ length: N }, (_, i) => { const t = today - (N - 1 - i) * DAY; const s = days[S.dayKey(t)]; return { t, n: s ? s.n : 0, c: s ? s.c : 0 }; });
  const raw = Math.max(5, ...list.map((x) => x.n));
  const step = raw <= 10 ? 5 : raw <= 50 ? 10 : raw <= 100 ? 20 : 50;
  const max = Math.ceil(raw / step) * step;
  const pw = W - L - R, ph = H - T - B, bw = pw / N;
  const y = (v) => T + ph - (v / max) * ph;
  let g = '';
  for (let v = 0; v <= max; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
  let bars = '';
  list.forEach((d, i) => {
    const x = L + i * bw + 3, w = bw - 6;
    const tip = `${md(d.t)}（${WEEK[new Date(d.t).getDay()]}）: ${d.n}問（正解${d.c}・不正解${d.n - d.c}）`;
    if (d.c) bars += `<rect x="${x}" y="${y(d.c)}" width="${w}" height="${Math.max(0, y(0) - y(d.c))}" rx="2" class="b1"/>`;
    if (d.n - d.c) {
      const top = y(d.n), bottom = y(d.c) - (d.c ? 2 : 0);
      bars += `<rect x="${x}" y="${top}" width="${w}" height="${Math.max(0, bottom - top)}" rx="2" class="b2"/>`;
    }
    bars += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ph + B}" class="hit" data-tip="${esc(tip)}"/>`;
    if (i % 2 === 1 || i === N - 1) bars += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${md(d.t)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="直近14日の回答数">${g}${bars}</svg>
    <div class="viz-legend"><span><i class="b1"></i>正解</span><span><i class="b2"></i>不正解</span></div>`;
}

// 模擬試験の点数の推移
function mockLineSvg(mocks, pass) {
  const W = 340, H = 170, L = 34, R = 14, T = 14, B = 24;
  const list = mocks.slice(-12);
  const pw = W - L - R, ph = H - T - B;
  const x = (i) => (list.length === 1 ? L + pw / 2 : L + (i / (list.length - 1)) * pw);
  const y = (v) => T + ph - (v / 1000) * ph;
  let g = '';
  for (const v of [0, 500, 1000]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${y(pass)}" y2="${y(pass)}" class="passline"/><text x="${L + 4}" y="${y(pass) - 5}" class="ax">合格ライン ${pass}</text>`;
  const pts = list.map((m, i) => `${x(i)},${y(m.score)}`).join(' ');
  let dots = '';
  list.forEach((m, i) => {
    dots += `<circle cx="${x(i)}" cy="${y(m.score)}" r="4.5" class="pt ${m.score >= pass ? 'ok' : ''}"/>`;
    dots += `<circle cx="${x(i)}" cy="${y(m.score)}" r="14" class="hit" data-tip="${esc(`${md(m.date)}: ${m.score}点（${m.correct}/${m.total}問）`)}"/>`;
  });
  const last = list[list.length - 1];
  const lbl = `<text x="${Math.min(x(list.length - 1), W - R - 20)}" y="${y(last.score) - 10}" text-anchor="middle" class="val">${last.score}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="模擬試験の点数の推移">${g}${list.length > 1 ? `<polyline points="${pts}" class="ln1"/>` : ''}${dots}${lbl}</svg>`;
}

async function viewStats(ex) {
  const qs = await questionsOf(ex.id);
  const days = dailyStats(ex.id);
  const keys = Object.keys(days).sort();
  const v = S.visits();
  const todayKey = S.dayKey(Date.now());
  const lastStudyKey = [...keys].reverse().find((k) => k !== todayKey);
  const streak = streakOf(days);
  const total = keys.reduce((a, k) => a + days[k].n, 0);
  const touched = new Set(keys.flatMap((k) => [...days[k].qids])).size;
  const weekFrom = startOfDay(Date.now()) - 6 * DAY;
  const week = keys.filter((k) => days[k].t >= weekFrom).reduce((a, k) => a + days[k].n, 0);
  const today = days[todayKey];
  const mocks = S.mocks(ex.id);

  const msg = today
    ? `今日は ${today.n}問 解きました。${streak >= 2 ? `${streak}日連続です！` : 'この調子で続けましょう。'}`
    : streak ? `${streak}日連続で学習中です。今日も1問から続けましょう。`
      : lastStudyKey ? `前回の学習は${agoText(days[lastStudyKey].t)}です。今日から再開しましょう。` : 'まずは1問解いてみましょう。';
  const tile = (val, label, sub = '') => `<div class="tile"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

  const recent = [...keys].reverse().slice(0, 10).map((k) => {
    const d = days[k];
    return `<tr><td>${md(d.t)}（${WEEK[new Date(d.t).getDay()]}）</td><td class="num">${d.n}</td><td class="num">${pct(d.c, d.n)}%</td><td class="num">${d.qids.size}</td></tr>`;
  }).join('');

  $app.innerHTML = page('学習の記録', `
    <div class="card cheer">${esc(msg)}</div>
    <div class="tiles">
      ${tile(streak, '連続学習日数', streak ? '日' : '')}
      ${tile(lastStudyKey ? agoText(days[lastStudyKey].t) : '—', '前回の学習日', lastStudyKey ? md(days[lastStudyKey].t) : '')}
      ${tile(v.prev ? agoText(v.prev) : '今回が初回', '前回アプリを開いた日', v.prev ? md(v.prev) : '')}
      ${tile(keys.length, '学習した日数', '日')}
      ${tile(total, '累計の回答数', `今週 ${week}問`)}
      ${tile(`${touched}<small>/${qs.length}</small>`, '取り組んだ問題', `${pct(touched, qs.length)}%`)}
    </div>
    <h2>学習カレンダー（過去17週）</h2>
    <div class="card viz">${heatmapSvg(days)}</div>
    <h2>直近14日の回答数</h2>
    <div class="card viz">${dailyBarsSvg(days)}</div>
    ${mocks.length ? `<h2>模擬試験の点数</h2><div class="card viz">${mockLineSvg(mocks, ex.passScore)}</div>` : ''}
    <h2>最近の学習日</h2>
    ${recent ? `<div class="card"><table class="viz-table"><thead><tr><th>日付</th><th class="num">回答数</th><th class="num">正答率</th><th class="num">問題数</th></tr></thead><tbody>${recent}</tbody></table></div>` : '<p class="card muted">まだ記録がありません。</p>'}
    <p class="mini muted">グラフの棒やマスをタップすると詳しい数値が表示されます。記録は ${ex.code} の分だけを集計しています。</p>
  `, { sub: ex.code });
}

// グラフのツールチップ（ホバー・タップ）
function showTip(el, e) {
  let tip = document.getElementById('viz-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'viz-tip'; tip.className = 'viz-tip'; document.body.appendChild(tip); }
  tip.textContent = el.getAttribute('data-tip');
  const r = el.getBoundingClientRect();
  tip.style.display = 'block';
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
  tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
}
function hideTip() { const tip = document.getElementById('viz-tip'); if (tip) tip.style.display = 'none'; }

// ================= 画面: 図解 =================
function viewFigures(ex, focus) {
  const list = Object.entries(FIGURES).filter(([, f]) => f.exams.includes(ex.id));
  const toc = list.map(([id, f]) => `<a class="chip" href="#fig-${id}" data-action="scroll-fig" data-id="${id}">${esc(f.title)}</a>`).join('');
  $app.innerHTML = page('図解で理解', `
    <div class="chips">${toc}</div>
    ${list.map(([id]) => `<div class="card" id="fig-${id}">${figureHtml(id)}</div>`).join('')}
    ${list.length ? '' : '<p class="card muted">この試験の図解はまだありません。</p>'}
  `, { sub: ex.code });
  if (focus) document.getElementById(`fig-${focus}`)?.scrollIntoView();
}

// ================= 画面: 用語メモ =================
async function viewNotes(ex) {
  const qs = await questionsOf(ex.id);
  const all = S.notes(ex.id);
  const f = state.noteFilter;
  const filters = { todo: `未調査（${all.filter((n) => !n.done).length}）`, done: `調査済み（${all.filter((n) => n.done).length}）`, all: 'すべて' };
  const shown = all.filter((n) => (f === 'todo' ? !n.done : f === 'done' ? n.done : true));
  const card = (n) => {
    const q = n.qid && qs.find((x) => x.id === n.qid);
    const term = encodeURIComponent(n.term);
    return `
      <div class="card note ${n.done ? 'done' : ''}">
        <div class="row between"><b class="note-term">${esc(n.term)}</b><span class="mini muted">${fmtDate(n.t)}</span></div>
        ${n.memo ? `<p class="note-memo">${esc(n.memo).replace(/\n/g, '<br>')}</p>` : ''}
        ${q ? `<a class="mini" href="#/q?id=${encodeURIComponent(q.id)}">関連する問題: ${esc(q.question.slice(0, 40))}${q.question.length > 40 ? '…' : ''}</a>` : ''}
        <div class="row">
          <a class="btn ghost small" href="https://www.google.com/search?q=${term}" target="_blank" rel="noopener">Google検索 ↗</a>
          <a class="btn ghost small" href="https://docs.github.com/ja/search?query=${term}" target="_blank" rel="noopener">GitHub Docs ↗</a>
          <a class="btn ghost small" href="${askTermUrl(ex, n.term)}" target="_blank" rel="noopener">💬 Claudeに質問 ↗</a>
        </div>
        <div class="row">
          <button class="btn ${n.done ? 'ghost' : 'primary'} small" data-action="note-done" data-id="${n.id}">${n.done ? '未調査に戻す' : '✔ 調査済みにする'}</button>
          <button class="btn ghost small" data-action="note-edit" data-id="${n.id}">編集</button>
          <button class="btn danger small" data-action="note-del" data-id="${n.id}">削除</button>
        </div>
      </div>`;
  };
  $app.innerHTML = page('用語メモ', `
    <button class="btn primary block" data-action="memo">＋ 用語をメモする</button>
    <p class="mini muted">問題を解いている最中は、画面上部の「📝 メモ」から記録できます。問題文の用語を長押しで選択してから押すと、その用語が入力されます。</p>
    <div class="chips">${Object.entries(filters).map(([k, v]) => `<button class="chip ${f === k ? 'on' : ''}" data-action="note-filter" data-id="${k}">${v}</button>`).join('')}</div>
    ${shown.length ? shown.map(card).join('') : '<p class="card muted">メモはまだありません。</p>'}
  `, { sub: ex.code });
}

// メモの入力ダイアログ（新規・編集）
function noteDialog({ term = '', memo = '', title = '用語をメモ' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<form class="modal-box note-form" role="dialog" aria-modal="true">
      <b>${esc(title)}</b>
      <label class="field">用語・気になったこと<input name="term" value="${esc(term)}" maxlength="200" required autocomplete="off"></label>
      <label class="field">メモ（調べた内容など・任意）<textarea name="memo" rows="4" maxlength="2000">${esc(memo)}</textarea></label>
      <div class="row"><button type="button" class="btn ghost" data-r="0">キャンセル</button><button type="submit" class="btn primary">保存</button></div>
    </form>`;
    const form = wrap.querySelector('form');
    const close = (v) => { wrap.remove(); resolve(v); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = form.term.value.trim();
      if (!t) return form.term.focus();
      close({ term: t, memo: form.memo.value.trim() });
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-r="0"]')) close(null); });
    document.body.appendChild(wrap);
    (term ? form.memo : form.term).focus();
  });
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
  if (a === 'note-filter') { state.noteFilter = id; return route(); }
  if (a === 'scroll-fig') { e.preventDefault(); document.getElementById(`fig-${id}`)?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (a === 'memo') {
    const pre = state.lastSel;
    state.lastSel = '';
    const r = await noteDialog({ term: pre });
    if (!r) return;
    S.addNote({ exam: ex.id, qid: id || null, term: r.term, memo: r.memo });
    toast('メモしました');
    if (location.hash.startsWith('#/notes') || location.hash.startsWith('#/menu')) route();
    return;
  }
  if (a === 'note-done') {
    const n = S.notes().find((x) => x.id === id);
    if (n) S.updateNote(id, { done: !n.done });
    return route();
  }
  if (a === 'note-edit') {
    const n = S.notes().find((x) => x.id === id);
    if (!n) return;
    const r = await noteDialog({ term: n.term, memo: n.memo, title: 'メモを編集' });
    if (r) { S.updateNote(id, r); route(); }
    return;
  }
  if (a === 'note-del') {
    if (await confirmDialog('このメモを削除しますか？', '削除する')) { S.deleteNote(id); route(); }
    return;
  }
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
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e); });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) hideTip(); });
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e); else hideTip(); });
  window.addEventListener('hashchange', hideTip);
  // 問題文などで選択した文字を、メモの初期値に使う
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const t = sel ? sel.toString().trim() : '';
    if (t && t.length <= 200 && sel.anchorNode && $app.contains(sel.anchorNode)) state.lastSel = t;
  });
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  try {
    state.exams = (await loadJSON('data/exams.json')).exams;
  } catch (e) {
    $app.innerHTML = `<p class="loading">データを読み込めませんでした。<br>${esc(e.message)}</p>`;
    return;
  }
  if (!location.hash && S.getExam()) go('/menu');
  else route();
  S.recordVisit();
  S.requestPersist();
  if (S.loadFailed()) toast('学習データを読み込めませんでした。データは退避済みです（設定画面を参照）');
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW登録失敗', err));
  }
}
init();
