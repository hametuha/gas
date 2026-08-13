/**
 * 監査用ログ。判定結果を必ずスプレッドシートに残す。
 * DRY_RUN 中も本番中も全件記録し、あとから精度を検証できるようにする。
 */

const LOG_HEADER = ['日時', 'ファイル名', '判定', '確信度', '移動先', '理由', 'DRY_RUN', 'ファイルURL'];

/**
 * ログ行をまとめて追記する。
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
