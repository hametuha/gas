# hametuha-gas

hametuha.co.jp の Google Workspace に追加する **Google Apps Script (GAS)** を
一元管理するリポジトリ。[clasp](https://github.com/google/clasp)（Google 公式 CLI）で
ローカルのコードとクラウド上の Apps Script プロジェクトを同期する。

- GAS 1つ = `projects/<name>/` の1ディレクトリ（各自 `.clasp.json` に scriptId を持つ）
- 言語は **JavaScript**（ビルド不要）
- デプロイは当面 **手動 `clasp push`**（CI/CD は未導入）

## セットアップ

### 1. Node（miseで20系に固定）

`.node-version` で 20 を指定済み。mise が古い Node を掴む事故を防ぐため、
リポジトリに入ったら `node -v` が 20 以上になっていることを確認する。

### 2. 依存インストール

```bash
npm install        # @google/clasp が devDependencies に入る
```

### 3. direnv（gcloud のワークスペース隔離）

```bash
direnv allow       # 初回のみ。以後このディレクトリで gcloud 設定が .gcloud/ に隔離される
```

複数ワークスペース（hametuha / tarosky 等）の取り違えを防ぐため、
`CLOUDSDK_CONFIG` をリポジトリ配下の `.gcloud/`（gitignore 済み）に固定している。

> **注意:** clasp の認証はこれとは別系統（`~/.clasprc.json`）。
> gcloud の隔離は Apps Script の裏側の GCP プロジェクトを操作する場合に効く。

### 4. clasp ログイン

```bash
npm run login      # = clasp login。ブラウザで hametuha.co.jp のアカウントを選ぶ
```

> clasp のログイン情報はデフォルトでホーム（`~/.clasprc.json`）に保存される。
> アカウントを厳密にプロジェクト固定したい場合は、生成された `.clasprc.json` を
> リポジトリ直下に置くと clasp がそちらを優先する（**gitignore 済み。絶対にコミットしない**）。

## 使い方

新規プロジェクトの作り方・日常の push/pull は
[projects/_template/README.md](projects/_template/README.md) を参照。

```
hametuha-gas/
├── .envrc              # gcloud を .gcloud/ に隔離（direnv）
├── .node-version       # 20
├── package.json        # clasp を固定
└── projects/
    ├── _template/      # 新規プロジェクトのひな形（コピー元）
    └── <各GASプロジェクト>/
```

## 管理対象の種類

| 種類 | 取り込み方 |
| --- | --- |
| スタンドアロン | `clasp create --type standalone` |
| コンテナバインド（スプレッドシート等に紐づく） | 既存の Script ID を `clasp clone` |
| 共有ライブラリ | スタンドアロンとして作成し、Apps Script 側でライブラリ公開 |

## やらないこと（現時点）

- CI/CD による自動 push（将来 GitHub Actions + Service Account で検討）
- TypeScript 化（JS のまま運用）
