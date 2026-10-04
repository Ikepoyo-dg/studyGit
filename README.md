# Git Study

GitHub認定試験 **GH-900（GitHub Foundations）** と **GH-300（GitHub Copilot）** の対策用の学習アプリです。
Androidのブラウザで開いて「ホーム画面に追加」すると、アプリのように使えます（オフラインでも動作）。

## 機能

- **試験の選択：** 最初の画面でGH-900とGH-300を切り替え
- **分野別に学習：** 出題分野ごとに1問ずつ解き、すぐに正誤と解説を表示
- **模擬試験：** 本番形式（GH-900 50問・GH-300 65問、各100分）とハーフを用意。分野の比重に合わせて出題し、最後にまとめて採点（1000点換算）
- **苦手を学習：** 「☆ 苦手」でマークした問題、または前回まちがえた問題だけを出題
- **学習履歴：** 問題ごとの過去の正誤、分野別の正答率、模擬試験の結果
- **図解で理解：** マージ、フォーク、fetch/pullなどの仕組みを図で確認（関連する問題の解説にも表示）
- **用語メモ：** 解いている最中に気になった用語を記録し、あとからGoogle・GitHub Docs・Claudeで調べられる
- **Claudeに質問：** 解説の下のボタンから、問題・正解・解説を入れた質問文つきでClaudeを開ける（送信前に内容を確認・追記できる）
- **試験ガイド：** 出題範囲や受験ステップ（`content/exam-info.md`）
- **バックアップ：** 学習データをJSONで保存・復元

学習データ（正誤・苦手マーク）は端末のブラウザ内（localStorage）にだけ保存され、リポジトリには含まれません。

## フォルダー構成

```
index.html              画面の入口
css/style.css           見た目
js/app.js               画面と操作のロジック
js/storage.js           学習データの保存
js/md.js                試験ガイド用のMarkdown表示
js/figures.js           図解（SVG）
data/exams.json         試験と出題分野の定義
data/questions/*.json   問題データ
content/exam-info.md    試験ガイド
sw.js, manifest.webmanifest, icons/   オフライン対応・ホーム画面アイコン
scripts/validate.mjs    問題データのチェック
.github/workflows/      GitHub Actions（push時に問題データを自動チェック）
```

## 手元で動かす

```bash
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## 問題を追加する

`data/questions/gh900.json` または `gh300.json` に次の形式で追加します。

```json
{
  "id": "gh900-d1-013",
  "domain": "d1",
  "question": "問題文（`コード` も使えます）",
  "choices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  "answer": [0],
  "explanation": "解説",
  "ref": "https://docs.github.com/ja/...",
  "figure": "fork-pr"
}
```

- `domain` は `data/exams.json` の分野ID
- `figure`（任意）は `js/figures.js` の図解ID。解説に図が表示されます
- `answer` は正解の選択肢の番号（0始まり）。複数正解なら `[0, 2]` とし、問題文に「2つ選んでください」と書く
- 追加したら `node scripts/validate.mjs --update-ids` でチェックし、公開済みID一覧（`data/published-ids.txt`）に追記

### 学習履歴を消さないためのルール

- 一度公開した問題の `id` は変更・削除しない（履歴は `id` に紐づいています）。問題文の修正はOK
- `js/storage.js` の保存先の名前（`KEY`）は変更しない
- 保存データの形式を変えるときは `VERSION` を上げ、`MIGRATIONS` に変換処理を書く（古いデータは捨てない）
- 通常の更新（push）では学習履歴は消えません

問題はすべて公式の出題範囲をもとに作ったオリジナル問題です。出題範囲は改訂されることがあるため、受験前に公式の学習ガイドで最新版を確認してください。

## 公開（GitHub Pages）

1. GitHubにpublicリポジトリを作ってpush
2. リポジトリの Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `(root)` にする
3. 表示されたURLをAndroidのChromeで開き、メニューから「ホーム画面に追加」

ルートの `.nojekyll` は、GitHub Pagesが `.md` ファイルをHTMLに変換しないようにするためのファイルです（削除しないでください）。

通信できるときは常に最新版を取得するので、更新はpushするだけで反映されます（`sw.js` の `ASSETS` にファイルを追加した場合は `CACHE` の番号も上げてください）。
