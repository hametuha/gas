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
  DriveApp.getFolderById(targetFolderId).addFile(file);
  DriveApp.getFolderById(CONFIG.FAX_FOLDER_ID).removeFile(file);
}
