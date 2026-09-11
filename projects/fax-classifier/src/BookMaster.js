/**
 * 書籍マスタ（openBD 由来 + 手動補完）。
 *
 * 破滅派のISBNは 978-4-905197-XX-C。出版社記号が6桁なので書籍記号は2桁、
 * つまり刊行物は最大100点しか存在しえない。よって全パターンを列挙して
 * openBD に一括照会すれば、探索なしで完全なマスタが1リクエストで手に入る。
 *
 * openBD は JPRO 登録ベースなので電子書籍などは載らない。載らないものは
 * マスタシートに手で足せるようにしてあり、refreshBookMaster() は
 * 出典が「手動」の行を上書きも削除もしない。
 */

const MASTER_HEADER = ['ISBN', '書名', '著者', '出版日', '出典', '更新日時'];

/** 出典の値。手動行を保護するための目印として使う。 */
const MASTER_SOURCE_OPENBD = 'openBD';
const MASTER_SOURCE_MANUAL = '手動';

/** openBD の一括取得API。カンマ区切りで複数ISBNを一度に引ける。 */
const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get?isbn=';

/**
 * ISBN-13 のチェックディジットを計算する。
 * @param {string} twelve 先頭12桁
 * @return {string} 1桁
 */
function isbn13CheckDigit_(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(twelve[i]) * (i % 2 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * 破滅派のISBNとして成立しうる13桁を全列挙する（書籍記号 00〜99）。
 * @return {string[]} 100件
 */
function enumerateOwnIsbns_() {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const twelve = CONFIG.ORDER.ISBN_PREFIX + ('0' + i).slice(-2);
    out.push(twelve + isbn13CheckDigit_(twelve));
  }
  return out;
}

/**
 * openBD に一括照会する。
 * @param {string[]} isbns
 * @return {Array<Object|null>} isbns と同じ並び。未登録は null。
 */
function fetchOpenBd_(isbns) {
  const res = UrlFetchApp.fetch(OPENBD_ENDPOINT + isbns.join(','), {
    method: 'get',
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('openBD エラー (' + code + '): ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

/**
 * openBD から自社刊行物を取り込み、書籍マスタシートを更新する。
 * 新刊を出したときに手動実行する（自動トリガーは張らない）。
 *
 * 既存行は ISBN で突き合わせ、出典が「手動」の行はいっさい触らない。
 * 削除も行わないので、openBD から消えてもマスタは痩せない。
 */
function refreshBookMaster() {
  const isbns = enumerateOwnIsbns_();
  const found = fetchOpenBd_(isbns);
  const sheet = getSheetByName_(CONFIG.ORDER.MASTER_SHEET_NAME, MASTER_HEADER);

  // 既存行を ISBN → 行番号 で引けるようにする。
  const lastRow = sheet.getLastRow();
  const existing = {};
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, MASTER_HEADER.length).getValues();
    values.forEach(function (row, i) {
      const isbn = normalizeIsbn_(row[0]);
      if (isbn) existing[isbn] = { rowIndex: i + 2, source: row[4] };
    });
  }

  const now = new Date();
  const appends = [];
  let updated = 0;
  let skipped = 0;

  found.forEach(function (book, i) {
    if (!book || !book.summary) return;
    const s = book.summary;
    const isbn = isbns[i];
    const row = [isbn, s.title || '', s.author || '', s.pubdate || '', MASTER_SOURCE_OPENBD, now];

    const hit = existing[isbn];
    if (!hit) {
      appends.push(row);
      return;
    }
    if (hit.source === MASTER_SOURCE_MANUAL) {
      // 人が直した行は正とみなす。openBD で上書きしない。
      skipped++;
      return;
    }
    sheet.getRange(hit.rowIndex, 1, 1, MASTER_HEADER.length).setValues([row]);
    updated++;
  });

  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, MASTER_HEADER.length).setValues(appends);
  }

  console.log('書籍マスタを更新しました: 追加 ' + appends.length
    + '件 / 更新 ' + updated + '件 / 手動行につき据え置き ' + skipped + '件'
    + '（openBD 照会 ' + isbns.length + '件中ヒット '
    + found.filter(function (b) { return !!b; }).length + '件）');
}

/**
 * 書籍マスタを読み込む。
 * @return {Object.<string, {title: string, author: string}>} ISBN（13桁数字）→ 書誌
 */
function getBookMaster_() {
  const sheet = getSheetByName_(CONFIG.ORDER.MASTER_SHEET_NAME, MASTER_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, MASTER_HEADER.length).getValues();
  const master = {};
  values.forEach(function (row) {
    const isbn = normalizeIsbn_(row[0]);
    if (isbn) master[isbn] = { title: String(row[1] || ''), author: String(row[2] || '') };
  });
  return master;
}
