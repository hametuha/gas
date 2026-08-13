/**
 * FAX仕分け設定。
 *
 * フォルダID群は「どこに仕分けるか」という業務ルーティングそのものなので
 * コードに置く（このリポジトリは非公開）。
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
  MAX_FILES_PER_RUN: 20,

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
