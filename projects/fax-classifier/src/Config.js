/**
 * FAX仕分け設定。
 *
 * フォルダID群は「どこに仕分けるか」という業務ルーティングなのでコードに置く。
 * これらは秘密ではない（ID を知っていてもアクセス権がなければ開けない）。
 * ただし GEMINI_API_KEY だけは秘匿情報なのでコードに書かず、
 * スクリプトプロパティに保存する（setup() 参照）。
 */
const CONFIG = {
  // true の間は「判定してログに記録するだけ」で、ファイルは一切移動しない。
  // 精度を数十件確認して納得したら false にする。
  DRY_RUN: false,

  // 使用する Gemini モデル。マルチモーダルでPDFを直接読める Flash 系。
  // エイリアス 'gemini-flash-latest' を使い、モデルのリタイア（新規キーでの
  // 提供打ち切り）で止まらないようにする。挙動を凍結したい場合は
  // 'gemini-3.6-flash' 等の具体バージョンにピン留めする（将来の打ち切り対応が必要）。
  MODEL: 'gemini-flash-latest',

  // 確信度がこの値未満なら order/return/sales でも「不明」に落とす。
  // 誤仕分け（例: 受注を返品と判定）は業務事故なので、迷ったら不明に寄せる。
  CONFIDENCE_THRESHOLD: 0.75,

  // 1回の実行で処理する最大件数（GASの6分制限対策）。
  // Gemini が 503 を返すとリトライのバックオフで1件に数十秒かかるため、
  // 欲張らない。取り切れなかった分は次回のトリガーで処理される。
  MAX_FILES_PER_RUN: 10,

  // Zapier がFAXを保存する親フォルダ（受信箱）。
  FAX_FOLDER_ID: '1yQV1cWYboS0WxPsBkBPZIujdyMMDEQDn',

  // 分類キー → 仕分け先フォルダID / 表示ラベル。
  // Gemini はこの4つのキーのいずれかを返す。
  CATEGORIES: {
    order:   { folderId: '1V6t653K_EqOVzuRq-nzDB0K9KlpLHPZE', label: '書籍の受注' },
    return:  { folderId: '11xYcgsBqFOSho4u0p6755U_OzxBTTUEx', label: '書籍の返品' },
    sales:   { folderId: '10I6epEWH4rbfnyCFcIiXMoYQVjzspDxa', label: 'その他営業FAX' },
    unknown: { folderId: '1-MvbKtPaMG1DYby60U-bnjyPS32sQWaj', label: '不明・判別不可' },
  },

  // --- ステージ2: 受注FAXからの明細抽出 ---
  // ステージ1（分類）が order フォルダへ入れたPDFを読み、注文明細を表にする。
  ORDER: {
    // 分類とは独立に立ち上げるため専用フラグ。
    // true の間は読み取ってシートに書くだけで、ファイルを移動しない。
    DRY_RUN: true,

    // 受注フォルダ直下 = 未抽出、この「抽出済み」フォルダへ移動 = 抽出済み。
    // ※「対応済み」ではない。発送などの業務完了は受注明細シートの
    //   ステータス列で人間が管理する（抽出完了と混同すると出荷漏れになる）。
    EXTRACTED_FOLDER_ID: '',

    // ログスプレッドシート内のシート名。
    MASTER_SHEET_NAME: '書籍マスタ',
    LINES_SHEET_NAME: '受注明細',

    // 破滅派のISBN出版社記号（978-4-905197）。書籍記号は2桁なので刊行物は最大100点。
    ISBN_PREFIX: '9784905197',

    // 明細の確信度がこれ未満なら「要確認」を立てる。
    CONFIDENCE_THRESHOLD: 0.75,

    // これを超える冊数は誤読を疑って「要確認」を立てる。
    MAX_QUANTITY: 100,
  },
};

/**
 * スクリプトプロパティを必須で取得する。未設定なら例外。
 * @param {string} key
 * @return {string}
 */
function getRequiredProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('スクリプトプロパティ「' + key + '」が未設定です。setup() を実行して設定してください。');
  }
  return value;
}

function getGeminiApiKey_() { return getRequiredProp_('GEMINI_API_KEY'); }
function getLogSheetId_()   { return getRequiredProp_('LOG_SHEET_ID'); }
