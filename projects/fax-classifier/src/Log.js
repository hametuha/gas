/**
 * 監査用ログ。判定結果を必ずスプレッドシートに残す。
 * DRY_RUN 中も本番中も全件記録し、あとから精度を検証できるようにする。
 */

const LOG_HEADER = ['日時', 'ファイル名', '判定', '確信度', '移動先', '理由', 'DRY_RUN', 'ファイルURL'];

/**
 * 分類ログ行をまとめて追記する。
 *
 * 記録先は先頭シート固定。名前引きに変えると運用開始済みの既存ログと
 * 分断されるため、後方互換のためあえて getSheets()[0] のままにしている。
 * ステージ2以降のシートは getSheetByName_() を使うこと。
 *
 * @param {Array[]} rows LOG_HEADER と同じ並びの配列の配列
 */
function appendLog_(rows) {
  if (!rows.length) return;
  const sheet = SpreadsheetApp.openById(getLogSheetId_()).getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADER);
  }
  // まとめて書き込む（appendRow の逐次呼び出しより速い）。
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADER.length).setValues(rows);
}

/**
 * ログスプレッドシート内の名前付きシートを取得する。無ければ作り、
 * 空ならヘッダ行を書いて固定表示にする。
 *
 * @param {string} name シート名
 * @param {string[]} header 1行目に置く見出し
 * @return {Sheet}
 */
function getSheetByName_(name, header) {
  const ss = SpreadsheetApp.openById(getLogSheetId_());
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 名前付きシートへ行をまとめて追記する。
 * @param {string} name シート名
 * @param {string[]} header ヘッダ（シート新規作成時に使う）
 * @param {Array[]} rows header と同じ並びの配列の配列
 */
function appendRows_(name, header, rows) {
  if (!rows.length) return;
  const sheet = getSheetByName_(name, header);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
}
