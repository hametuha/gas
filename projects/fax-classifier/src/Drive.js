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
  const folder = DriveApp.getFolderById(getFaxFolderId_());
  const iter = folder.getFilesByType(MimeType.PDF);
  const files = [];
  while (iter.hasNext() && files.length < CONFIG.MAX_FILES_PER_RUN) {
    files.push(iter.next());
  }
  return files;
}

/**
 * 分類名の子フォルダを取得する（なければ作成）。
 * @param {string} name 子フォルダ名（例: '注文'）
 * @return {Folder}
 */
function ensureSubfolder_(name) {
  const parent = DriveApp.getFolderById(getFaxFolderId_());
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

/**
 * ファイルを子フォルダへ移動する（FAXフォルダ直下から外す）。
 * @param {File} file
 * @param {Folder} targetFolder
 */
function moveFile_(file, targetFolder) {
  targetFolder.addFile(file);
  DriveApp.getFolderById(getFaxFolderId_()).removeFile(file);
}
