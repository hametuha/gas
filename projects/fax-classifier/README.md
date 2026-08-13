# fax-classifier — FAX を Gemini で自動仕分け

Drive の「FAX」フォルダに Zapier が保存したPDFを、Gemini で読み取って
**注文 / 返品 / 営業 / 不明** の子フォルダへ自動仕分けする GAS。

```
[Zapier] FAX添付メール → Drive「FAX」フォルダに保存 + Gmail に "FAX" ラベル
                                │
                                ▼
[この GAS: 1時間毎トリガー]
  1. FAXフォルダ直下のPDFを列挙（子フォルダ内=処理済みは対象外）
  2. 各PDFを Gemini(gemini-2.5-flash) で分類 → {category, confidence, reason}
  3. 確信度 >= 0.75 のものだけ該当フォルダへ移動。低いものは「不明」へ
  4. 全件を「FAX仕分けログ」スプレッドシートに記録

フォルダID（親=受信箱・子=受注/返品/営業/不明）は Config.js に直書き。
このリポジトリは非公開のため、業務ルーティングとしてコードに置く。
```

## 設計上の安全策

- **DRY_RUN**: 初期は `Config.js` の `DRY_RUN: true`。判定してログに残すだけで**移動しない**。
  精度を数十件確認してから `false` にする。
- **確信度で足切り**: `CONFIDENCE_THRESHOLD`(0.75) 未満は order/return/sales でも「不明」に落とす。
  注文を返品と取り違える誤仕分けを避けるため、迷ったら不明に寄せる。
- **監査ログ**: DRY_RUN でも本番でも全件を記録。判定理由(reason)も残すので後から検証できる。
- **不明の通知**: 本番運転で「不明」に入ったFAXがあれば、実行ユーザー（または
  `NOTIFY_EMAIL` プロパティ宛）にまとめてメール通知する。DRY_RUN 中は移動しないので送らない。

## セットアップ

### 1. Apps Script プロジェクトを用意

```bash
cd projects/fax-classifier
npx clasp create --type standalone --title "FAX Classifier" --rootDir src
npx clasp push
```

### 2. Gemini APIキーを取得

[Google AI Studio](https://aistudio.google.com/apikey) でAPIキーを発行する。
**顧客の注文情報を扱うため、課金を有効にした（有料枠の）キーを使うこと**
（有料枠は入力がモデル学習に使われない）。

### 3. スクリプトプロパティを設定

Apps Script エディタ → プロジェクトの設定 → スクリプトプロパティ で以下を登録：

| プロパティ名 | 値 |
| --- | --- |
| `GEMINI_API_KEY` | AI Studio で発行したキー（**秘匿。コードには書かない**） |
| `NOTIFY_EMAIL` | （任意）不明通知の宛先。未設定なら実行ユーザー宛 |

`LOG_SHEET_ID` は `setup()` が自動作成する。フォルダIDは `Config.js` に直書き済み。

### 4. 初期化 & 権限承認

エディタで `setup()` を実行。初回は Drive/Sheets/外部通信の権限承認を求められる。
実行ログに「ログシートを作成しました: ...」とURLが出れば成功。
`GEMINI_API_KEY: OK` と表示されることを確認する。

### 5. ドライランで精度確認

`processFaxFolder()` を手動実行 → 「FAX仕分けログ」シートを見て判定精度を確認する。
納得できたら `Config.js` の `DRY_RUN` を `false` にして `npx clasp push`。

### 6. 自動運転ON

`installTrigger()` を実行すると1時間毎に自動処理が走る。
止めたいときは `removeTrigger()`。

## 関数一覧

| 関数 | 用途 |
| --- | --- |
| `setup()` | 初期化（ログシート作成・プロパティ確認） |
| `processFaxFolder()` | 本体。分類して仕分け（DRY_RUN 尊重） |
| `installTrigger()` | 15分毎トリガーを設置 |
| `removeTrigger()` | トリガー解除 |

## 注意

- DRY_RUN 中はファイルを移動しないため、同じPDFが毎回再処理されログが重複する。
  精度確認のための一時的な状態と割り切る（本番=移動ありにすれば解消）。
- `drive` スコープ（フルアクセス）を使う。Zapier が作ったファイルを移動するため
  `drive.file`（自作ファイルのみ）では不足するため。
