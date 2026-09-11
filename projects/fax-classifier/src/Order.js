/**
 * ステージ2: 受注FAXから注文明細を抽出して表にする。
 *
 * ステージ1（分類）が受注フォルダへ入れたPDFを読み、1行1明細で
 * 「受注明細」シートへ書き出し、PDFを「抽出済み」フォルダへ退避する。
 *
 * 重要: このシートは発注データそのものではなく「人間が検算する下書き」。
 * 冊数だけは機械的に検算する術がないため、必ず人の目を通す前提で運用する。
 * 「ステータス」列は人間専用で、GASは新規行に空値を置く以外いっさい触らない。
 */

const ORDER_HEADER = [
  '抽出日時', 'ファイル名', 'ファイルURL', 'FAX日付', '取次', '書店コード', '書店名',
  '担当者', '作業コード', 'ISBN', '書名(FAX)', '書名(マスタ)', '冊数',
  'confidence', '要確認', '要確認理由', '備考', 'ステータス',
];

/**
 * 受注フォルダ直下のPDFから明細を抽出し、シートに追記する。
 * CONFIG.ORDER.DRY_RUN が false のときだけファイルを「抽出済み」へ移動する。
 */
function extractOrders() {
  const opts = CONFIG.ORDER;

  // 本番運転なのに退避先が未設定だと、移動できず毎回同じPDFを再処理してしまう。
  // 課金の無駄と重複行を生むので、走り出す前に落とす。
  if (!opts.DRY_RUN && !opts.EXTRACTED_FOLDER_ID) {
    throw new Error('CONFIG.ORDER.EXTRACTED_FOLDER_ID が未設定です。'
      + '受注フォルダ内に「抽出済み」フォルダを作り、そのIDを設定してください。');
  }

  const files = listUnextractedOrders_();
  if (!files.length) {
    console.log('抽出対象の受注PDFはありません。');
    return;
  }

  const master = getBookMaster_();
  if (!Object.keys(master).length) {
    console.warn('書籍マスタが空です。ISBN・書名の照合ができません。'
      + 'refreshBookMaster() を先に実行することを強く推奨します。');
  }

  const rows = [];
  let lineCount = 0;
  let flaggedCount = 0;

  files.forEach(function (file) {
    const now = new Date();

    let result;
    try {
      result = extractOrder_(file.getBlob(), master);
    } catch (e) {
      console.error('抽出失敗: ' + file.getName() + ' :: ' + e);
      rows.push(errorRow_(now, file, String(e)));
      flaggedCount++;
      return; // 移動しない。次回リトライさせる。
    }

    const fax = {
      date:        result.faxDate || '',
      distributor: result.distributor || '',
      storeCode:   result.storeCode || '',
      storeName:   result.storeName || '',
      staff:       result.staff || '',
      workCode:    result.workCode || '',
    };
    const note = result.note || '';

    if (!result.lines.length) {
      // 受注に分類されたのに明細が1件も取れないのは異常。空振りさせず1行残す。
      rows.push(faxRow_(now, file, fax).concat(
        ['', '', '', '', '', '要確認', '明細を1件も抽出できず', note, '']
      ));
      flaggedCount++;
    }

    result.lines.forEach(function (line) {
      const v = validateLine_(line, fax, master);
      const flagged = v.issues.length > 0;
      if (flagged) flaggedCount++;
      lineCount++;

      rows.push(faxRow_(now, file, fax).concat([
        v.isbn,
        line.title || '',
        v.masterTitle,
        (line.quantity === null || line.quantity === undefined) ? '' : line.quantity,
        line.confidence,
        flagged ? '要確認' : 'OK',
        v.issues.join(' / '),
        note,
        '', // ステータス: 人間が埋める
      ]));
    });

    if (!opts.DRY_RUN) {
      moveFileBetween_(file, CONFIG.CATEGORIES.order.folderId, opts.EXTRACTED_FOLDER_ID);
    }
  });

  appendRows_(opts.LINES_SHEET_NAME, ORDER_HEADER, rows);

  console.log(files.length + '件のFAXから ' + lineCount + '明細を抽出しました'
    + '（DRY_RUN=' + opts.DRY_RUN + '、要確認 ' + flaggedCount + '件）。'
    + '「' + opts.LINES_SHEET_NAME + '」シートを確認してください。');
}

/**
 * FAX単位の共通列（先頭9列）を作る。
 * @param {Date} now
 * @param {File} file
 * @param {Object} fax
 * @return {Array}
 */
function faxRow_(now, file, fax) {
  return [now, file.getName(), file.getUrl(), fax.date, fax.distributor,
    fax.storeCode, fax.storeName, fax.staff, fax.workCode];
}

/**
 * 抽出そのものが失敗したときの1行。
 * @param {Date} now
 * @param {File} file
 * @param {string} message
 * @return {Array}
 */
function errorRow_(now, file, message) {
  return [now, file.getName(), file.getUrl(), '', '', '', '', '', '',
    '', '', '', '', '', '要確認', '抽出エラー: ' + message, '', ''];
}
