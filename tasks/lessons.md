# 教訓 (lessons)

このリポジトリでの作業で、同じミスを繰り返さないための記録。

## Git / PR

### `gh pr create` の前に必ず `git push` する

- **2026-08-14**: PR #1 を作る前に、ローカルコミット（`gemini-flash-latest` へのモデル修正、
  `DRY_RUN: false` への本番化）を `git push` せずに `gh pr create` した。その結果、
  これらのコミットはPRに含まれず、mainにマージされなかった。
- 稼働中の Apps Script は各修正後に `clasp push` 済みだったため実害はゼロだったが、
  **リポジトリ(main)が本番より古い状態**になり、「リポジトリが真実」の前提が崩れた。
- **対策**: PR作成前に必ず以下を確認する。
  - `git push`（-u で upstream を設定）
  - `git log origin/<branch> --oneline` で、ローカルHEADと origin/HEAD が一致すること
- 復旧: 失われた2コミットを後続ブランチに `git cherry-pick` して次のPRで main に戻した。
