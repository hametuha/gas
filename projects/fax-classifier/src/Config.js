/**
 * FAX仕分け設定。
 *
 * 秘匿値（APIキー・フォルダID）はコードに書かず、スクリプトプロパティに保存する。
 * 設定は Main.js の setup() を一度実行してから確認すること。
 */
const CONFIG = {
  // true の間は「判定してログに記録するだけ」で、ファイルは一切移動しない。
  // 精度を数十件確認して納得したら false にする。
  DRY_RUN: true,

  // 使用する Gemini モデル。マルチモーダルでPDFを直接読める Flash 系。
  MODEL: 'gemini-2.5-flash',

  // 確信度がこの値未満なら order/return/sales でも「不明」に落とす。
  // 誤仕分け（例: 注文を返品と判定）は業務事故なので、迷ったら不明に寄せる。
  CONFIDENCE_THRESHOLD: 0.75,

  // 1回の実行で処理する最大件数（GASの6分制限対策）。
  MAX_FILES_PER_RUN: 20,

  // 分類キー → 子フォルダ名 / 表示ラベル。
  // Gemini はこの4つのキーのいずれかを返す。
  CATEGORIES: {
    order:   { folder: '注文', label: '書籍の注文' },
    return:  { folder: '返品', label: '書籍の返品' },
    sales:   { folder: '営業', label: 'その他営業FAX' },
    unknown: { folder: '不明', label: '不明・判別不可' },
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

function getFaxFolderId_()  { return getRequiredProp_('FAX_FOLDER_ID'); }
function getGeminiApiKey_() { return getRequiredProp_('GEMINI_API_KEY'); }
function getLogSheetId_()   { return getRequiredProp_('LOG_SHEET_ID'); }
