// 問題データの検証スクリプト
// 使い方: node scripts/validate.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const { exams } = read('data/exams.json');
const errors = [];
const ids = new Set();

for (const ex of exams) {
  const qs = read(`data/questions/${ex.id}.json`);
  const domainIds = new Set(ex.domains.map((d) => d.id));
  const count = Object.fromEntries(ex.domains.map((d) => [d.id, 0]));

  for (const q of qs) {
    const where = `${ex.id}:${q.id ?? '(idなし)'}`;
    if (!q.id) errors.push(`${where} id がありません`);
    if (ids.has(q.id)) errors.push(`${where} id が重複しています`);
    ids.add(q.id);
    if (!domainIds.has(q.domain)) errors.push(`${where} 不明な分野 ${q.domain}`);
    else count[q.domain]++;
    if (!q.question?.trim()) errors.push(`${where} 問題文が空です`);
    if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${where} 選択肢は2つ以上必要です`);
    if (new Set(q.choices).size !== q.choices.length) errors.push(`${where} 選択肢が重複しています`);
    if (!Array.isArray(q.answer) || !q.answer.length) errors.push(`${where} answer が空です`);
    else if (q.answer.some((a) => !Number.isInteger(a) || a < 0 || a >= q.choices.length)) errors.push(`${where} answer が範囲外です`);
    else if (new Set(q.answer).size !== q.answer.length) errors.push(`${where} answer が重複しています`);
    if (q.answer?.length > 1 && !/[2-9２-９]つ選/.test(q.question)) errors.push(`${where} 複数正解なのに「○つ選んで」の記載がありません`);
    if (!q.explanation?.trim()) errors.push(`${where} 解説が空です`);
    if (q.ref && !/^https:\/\//.test(q.ref)) errors.push(`${where} ref はhttpsのURLにしてください`);
  }

  console.log(`${ex.code}: ${qs.length}問`);
  for (const d of ex.domains) console.log(`  - ${d.name}: ${count[d.id]}問`);
}

if (errors.length) {
  console.error(`\n✖ ${errors.length}件のエラー`);
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log('\n✔ 問題データに問題はありません');
