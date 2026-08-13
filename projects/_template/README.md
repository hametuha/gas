# _template — 新規プロジェクトのひな形

このディレクトリをコピーして、GAS プロジェクト1つ = 1ディレクトリで管理する。

## 構造

```
projects/<project-name>/
├── .clasp.json      # scriptId と rootDir。追跡する（.clasp.json.example を参照）
├── src/
│   ├── appsscript.json   # マニフェスト（タイムゾーン・依存・ランタイム）
│   └── *.js              # GAS のコード
└── README.md        # そのスクリプトの用途・トリガー・関連スプレッドシート等
```

- `.clasp.json` は **scriptId を含むだけで秘匿情報ではない** ので Git 追跡する。
  これによりリポジトリを clone した人がそのまま `clasp push`/`pull` できる。
- `rootDir: "src"` にすることで、clasp が扱うのは `src/` 配下だけになり、
  README や設定ファイルが push 対象に混ざらない。

## 新規プロジェクトの作り方

### パターンA: 既存のスクリプトを取り込む（コンテナバインド含む）

すでにスプレッドシート等に紐づく既存スクリプトを取り込む場合：

```bash
# Script ID は Apps Script エディタ → プロジェクトの設定 → 「スクリプト ID」から取得
mkdir -p projects/<project-name>
cd projects/<project-name>
npx clasp clone <SCRIPT_ID> --rootDir src
```

### パターンB: 新規スタンドアロンを作る

```bash
mkdir -p projects/<project-name>
cd projects/<project-name>
npx clasp create --type standalone --title "<表示名>" --rootDir src
```

`--type` は `standalone` / `sheets` / `docs` / `forms` / `slides` / `webapp` / `api` など。

## 日常の同期

```bash
cd projects/<project-name>
npx clasp push    # ローカル → クラウド（GAS）へ反映
npx clasp pull    # クラウド → ローカルへ取り込み（Web エディタで直した分を回収）
npx clasp open    # ブラウザで Apps Script エディタを開く
```
