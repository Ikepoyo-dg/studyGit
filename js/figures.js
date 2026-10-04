// 図解（インラインSVG）。色は CSS 変数で指定しているのでダークモードにも対応。
// 問題データの "figure": "<id>" で解説に表示される。

const W = 340;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const defs = (id) => `<defs><marker id="ah-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ahp"/></marker></defs>`;
const svg = (id, h, body, label) =>
  `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${defs(id)}${body}</svg>`;

function box(x, y, w, h, title, sub, cls = '') {
  const cx = x + w / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="bx ${cls}"/>` +
    `<text x="${cx}" y="${y + (sub ? h / 2 - 3 : h / 2 + 5)}" text-anchor="middle" class="t">${esc(title)}</text>` +
    (sub ? `<text x="${cx}" y="${y + h / 2 + 13}" text-anchor="middle" class="s">${esc(sub)}</text>` : '');
}
const arrow = (id, x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ar" marker-end="url(#ah-${id})"/>`;
const label = (x, y, t, anchor = 'start', cls = 'lb') => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(t)}</text>`;
const commit = (x, y, t = '', cls = '') =>
  `<circle cx="${x}" cy="${y}" r="13" class="cm ${cls}"/>` + (t ? `<text x="${x}" y="${y + 4}" text-anchor="middle" class="ct ${cls}">${esc(t)}</text>` : '');
const line = (x1, y1, x2, y2, cls = 'ln') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
const path = (d, cls = 'ln') => `<path d="${d}" class="${cls}"/>`;
const dashed = (y, top, bottom) =>
  line(0, y, W, y, 'dash') + label(4, y - 6, top, 'start', 's') + label(4, y + 16, bottom, 'start', 's');

export const FIGURES = {
  areas: {
    title: 'Gitの3つの領域とリモート',
    exams: ['gh900'],
    caption: '編集した内容は git add でステージし、git commit で履歴に記録します。GitHubとのやり取りは push（送信）と fetch / pull（取得）です。',
    svg: () => svg('areas', 360,
      box(70, 10, 200, 50, '作業ディレクトリ', 'ファイルを編集する場所') +
      arrow('areas', 170, 60, 170, 98) + label(180, 84, 'git add') +
      box(70, 100, 200, 50, 'ステージングエリア', '次のコミットに含める候補') +
      arrow('areas', 170, 150, 170, 188) + label(180, 174, 'git commit') +
      box(70, 190, 200, 50, 'ローカルリポジトリ', '.git（コミットの履歴）', 'acc') +
      dashed(268, 'あなたのPC', 'GitHub') +
      arrow('areas', 130, 240, 130, 298) + label(122, 290, 'git push', 'end') +
      arrow('areas', 210, 300, 210, 242) + label(218, 290, 'git fetch / pull') +
      box(70, 300, 200, 50, 'リモートリポジトリ', 'origin', 'acc'),
      '作業ディレクトリ、ステージングエリア、ローカルリポジトリ、リモートリポジトリの関係'),
  },

  'branch-merge': {
    title: 'ブランチとマージ',
    exams: ['gh900'],
    caption: 'ブランチは main から分かれて独立して作業するための線です。作業が終わったらマージして main に取り込みます（M はマージコミット）。',
    svg: () => svg('branch-merge', 190,
      label(16, 28, 'main', 'start', 't') +
      line(30, 55, 290, 55) +
      path('M90,55 C120,55 130,125 160,125') + line(160, 125, 230, 125, 'ln br') +
      path('M230,125 C260,125 270,55 290,55', 'ln br') +
      commit(30, 55, 'C1') + commit(90, 55, 'C2') + commit(150, 55, 'C3') +
      commit(170, 125, 'F1', 'br') + commit(225, 125, 'F2', 'br') + commit(290, 55, 'M', 'm') +
      label(120, 158, 'feature', 'start', 't') +
      label(70, 100, '分岐', 'middle', 's') + label(70, 114, 'git switch -c feature', 'middle', 's') +
      label(290, 28, 'マージ', 'middle') +
      label(170, 182, 'feature の作業は main に影響しない', 'middle', 's'),
      'mainから分岐したfeatureブランチをmainにマージする図'),
  },

  'merge-methods': {
    title: 'Pull Requestの3つのマージ方法',
    exams: ['gh900'],
    caption: 'マージ後の main の履歴の違いです。Squash は複数のコミットを1つにまとめ、Rebase はマージコミットを作らずに一直線の履歴にします。',
    svg: () => svg('merge-methods', 330,
      label(10, 20, '① Create a merge commit', 'start', 't') +
      line(30, 55, 300, 55) + path('M90,55 C115,55 120,90 145,90') + line(145, 90, 215, 90, 'ln br') + path('M215,90 C245,90 250,55 280,55', 'ln br') +
      commit(30, 55, 'A') + commit(90, 55, 'B') + commit(150, 90, 'F1', 'br') + commit(210, 90, 'F2', 'br') + commit(280, 55, 'M', 'm') +
      label(170, 120, 'F1・F2 の履歴が残り、マージコミット M ができる', 'middle', 's') +
      label(10, 150, '② Squash and merge', 'start', 't') +
      line(30, 180, 160, 180) + commit(30, 180, 'A') + commit(90, 180, 'B') + commit(160, 180, 'S', 'm') +
      label(185, 184, '← F1+F2 を1つに', 'start', 's') +
      label(170, 212, '1つのコミット S にまとめて取り込む', 'middle', 's') +
      label(10, 242, '③ Rebase and merge', 'start', 't') +
      line(30, 272, 280, 272) + commit(30, 272, 'A') + commit(90, 272, 'B') + commit(160, 272, "F1'", 'br') + commit(230, 272, "F2'", 'br') +
      label(170, 304, 'マージコミットを作らず、一直線の履歴にする', 'middle', 's'),
      '3種類のマージ方法によるmainの履歴の違い'),
  },

  'fork-pr': {
    title: 'フォークとPull Requestによる貢献',
    exams: ['gh900'],
    caption: '書き込み権限がないリポジトリには、自分のフォークで作業し、Pull Requestで変更を提案します。',
    svg: () => svg('fork-pr', 320,
      label(4, 14, 'GitHub', 'start', 's') +
      box(85, 10, 170, 56, '元のリポジトリ', '他の人のもの（upstream）') +
      arrow('fork-pr', 130, 66, 130, 118) + label(122, 96, '① Fork', 'end') +
      arrow('fork-pr', 210, 118, 210, 68) + label(218, 96, '⑤ Pull Request') +
      box(85, 120, 170, 56, 'あなたのフォーク', 'GitHub上の自分のコピー', 'acc') +
      dashed(205, '', 'あなたのPC') +
      arrow('fork-pr', 130, 176, 130, 248) + label(122, 196, '② git clone', 'end') +
      arrow('fork-pr', 210, 248, 210, 178) + label(218, 196, '④ git push') +
      box(85, 250, 170, 56, 'ローカル', '③ ブランチで変更・コミット'),
      'フォーク、クローン、プッシュ、Pull Requestの流れ'),
  },

  'fetch-pull': {
    title: 'git fetch と git pull の違い',
    exams: ['gh900'],
    caption: 'fetch はリモートの変更を取得して origin/main を更新するだけです。pull は fetch のあとに merge まで行い、作業中のブランチに取り込みます。',
    svg: () => svg('fetch-pull', 300,
      box(60, 10, 190, 50, 'リモートの main', 'GitHub（origin）', 'acc') +
      dashed(90, '', 'あなたのPC') +
      arrow('fetch-pull', 155, 60, 155, 128) + label(165, 112, 'git fetch（取得のみ）') +
      box(60, 130, 190, 50, 'origin/main', 'リモート追跡ブランチ') +
      arrow('fetch-pull', 155, 180, 155, 238) + label(165, 216, 'git merge（統合）') +
      box(60, 240, 190, 50, 'main', '作業中のブランチ') +
      path('M290,62 L300,62 L300,238 L290,238', 'ln') +
      `<text x="322" y="150" text-anchor="middle" class="lb" transform="rotate(90 322 150)">git pull = fetch + merge</text>`,
      'git fetch と git pull の違い'),
  },

  'github-flow': {
    title: 'GitHub Flow',
    exams: ['gh900'],
    caption: 'main から作業用のブランチを作り、Pull Requestでレビューしてから main にマージする、シンプルな開発の流れです。',
    svg: () => svg('github-flow', 210,
      label(10, 28, 'main', 'start', 't') +
      line(20, 45, 320, 45) +
      path('M60,45 C80,45 85,110 105,110') + line(105, 110, 225, 110, 'ln br') + path('M225,110 C250,110 255,45 280,45', 'ln br') +
      commit(60, 45, '①') + commit(120, 110, '②', 'br') + commit(175, 110, '②', 'br') + commit(280, 45, '⑤', 'm') +
      `<rect x="180" y="128" width="140" height="26" rx="13" class="bx acc"/>` + label(250, 145, '③ PR ④ レビュー', 'middle', 'lb') +
      label(170, 180, '① ブランチ作成 → ② コミット → ③ PR作成', 'middle', 's') +
      label(170, 198, '→ ④ レビュー → ⑤ マージ → ⑥ ブランチ削除', 'middle', 's'),
      'GitHub Flowの流れ'),
  },

  conflict: {
    title: 'マージコンフリクト',
    exams: ['gh900'],
    caption: '同じ行を両方のブランチで変更すると、Gitは自動で決められません。ファイルを正しい内容に直してマーカーを消し、git add → git commit で解消します。',
    svg: () => svg('conflict', 270,
      box(95, 6, 150, 40, 'color = "green"', '共通の元', '') +
      arrow('conflict', 140, 46, 90, 76) + arrow('conflict', 200, 46, 250, 76) +
      box(10, 78, 150, 44, 'color = "blue"', 'main で変更') +
      box(180, 78, 150, 44, 'color = "red"', 'feature で変更') +
      arrow('conflict', 85, 122, 140, 148) + arrow('conflict', 255, 122, 200, 148) +
      `<rect x="30" y="150" width="280" height="112" rx="8" class="bx acc"/>` +
      [['<<<<<<< HEAD', 's'], ['color = "blue"', 'code'], ['=======', 's'], ['color = "red"', 'code'], ['>>>>>>> feature', 's']]
        .map(([t, c], i) => `<text x="46" y="${174 + i * 20}" class="${c} mono">${esc(t)}</text>`).join(''),
      'マージコンフリクトの発生とマーカーの例'),
  },

  'copilot-flow': {
    title: 'Copilotの提案ができるまで',
    exams: ['gh300'],
    caption: 'IDEが集めた文脈からプロンプトを作り、サービス側でフィルタリングとLLMによる生成を行ってから提案が表示されます。採用するかどうかは利用者が判断します。',
    svg: () => {
      const steps = [
        ['① 文脈を収集', '周辺のコード・開いているタブなど', ''],
        ['② プロンプトを構築', '関連する情報を選んでまとめる', ''],
        ['③ プロキシでフィルタリング', '有害な内容などをチェック', 'acc'],
        ['④ LLMが提案を生成', '次のトークンを確率的に予測', 'acc'],
        ['⑤ 後処理・フィルタリング', '品質・パブリックコード一致など', 'acc'],
        ['⑥ IDEに提案を表示', '受け入れるかは利用者が判断', ''],
      ];
      let body = '';
      steps.forEach(([t, s, c], i) => {
        const y = 10 + i * 56;
        body += box(60, y, 270, 42, t, s, c);
        if (i < steps.length - 1) body += arrow('copilot-flow', 195, y + 42, 195, y + 54);
      });
      body += label(30, 62, 'IDE', 'middle', 's') + label(30, 180, 'サービス', 'middle', 's') + label(30, 300, 'IDE', 'middle', 's');
      body += line(48, 10, 48, 108, 'dash') + line(48, 122, 48, 276, 'dash') + line(48, 290, 48, 332, 'dash');
      return svg('copilot-flow', 344, body, 'Copilotの提案が生成されるまでの流れ');
    },
  },
};

export function figureHtml(id, { withCaption = true } = {}) {
  const f = FIGURES[id];
  if (!f) return '';
  return `<figure class="fig"><figcaption class="fig-title">${esc(f.title)}</figcaption>${f.svg()}${withCaption ? `<p class="fig-cap">${esc(f.caption)}</p>` : ''}</figure>`;
}
