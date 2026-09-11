/**
 * Drive 操作。
 *
 * 設計方針: FAXフォルダ「直下」のPDF = 未処理の受信箱。
 * 子フォルダに移動した時点で「処理済み」とみなす。
 * getFilesByType は直下のみを返す（再帰しない）ため、
 * 一度仕分けたファイルは再処理されない。
 */

/**
 * FAXフォルダ直下の未処理PDFを最大 MAX_FILES_PER_RUN 件返す。
 * @return {File[]}
 */
function listUnprocessedFax_() {
  const folder = DriveApp.getFolderById(CONFIG.FAX_FOLDER_ID);
  const iter = folder.getFilesByType(MimeType.PDF);
  const files = [];
  while (iter.hasNext() && files.length < CONFIG.MAX_FILES_PER_RUN) {
    files.push(iter.next());
  }
  return files;
}

/**
 * ファイルを仕分け先フォルダへ移動する（FAXフォルダ直下から外す）。
 * @param {File} file
 * @param {string} targetFolderId 仕分け先フォルダのID
 */
function moveFile_(file, targetFolderId) {
  moveFileBetween_(file, CONFIG.FAX_FOLDER_ID, targetFolderId);
}

/**
 * ファイルを別のフォルダへ移動する。
 * 追加してから外す順序を守る（先に外すと、失敗時にマイドライブ直下へ迷子になる）。
 * @param {File} file
 * @param {string} fromFolderId 現在の親
 * @param {string} toFolderId 移動先
 */
function moveFileBetween_(file, fromFolderId, toFolderId) {
  DriveApp.getFolderById(toFolderId).addFile(file);
  DriveApp.getFolderById(fromFolderId).removeFile(file);
}

/**
 * 受注フォルダ直下の未抽出PDFを最大 MAX_FILES_PER_RUN 件返す。
 *
 * ステージ1と同じ考え方。受注フォルダ「直下」= まだ明細を抜いていない、
 * 「抽出済み」子フォルダへ移した時点で処理済みとみなす。
 * @return {File[]}
 */
function listUnextractedOrders_() {
  const folder = DriveApp.getFolderById(CONFIG.CATEGORIES.order.folderId);
  const iter = folder.getFilesByType(MimeType.PDF);
  const files = [];
  while (iter.hasNext() && files.length < CONFIG.MAX_FILES_PER_RUN) {
    files.push(iter.next());
  }
  return files;
}
