/**
 * 抽出結果の機械検算。
 *
 * 設計方針: 抽出した明細は「発注データ」ではなく「人間が検算する下書き」。
 * 機械で検算できるもの（ISBN・書名・書店）は自動で潰し、
 * 検算しようのないもの（冊数）は必ず人間の目に載せる。
 * 迷ったら「要確認」に寄せる（ステージ1の「迷ったら不明」と同じ思想）。
 */

/**
 * ISBN-13 のチェックディジットを検証する。
 * 奇数桁×1 + 偶数桁×3 の総和が10で割り切れれば正しい。
 * @param {string} isbn ハイフンなし13桁
 * @return {boolean}
 */
function isValidIsbn13_(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(isbn[i]) * (i % 2 ? 3 : 1);
  }
  return sum % 10 === 0;
}

/**
 * ISBNを比較用に正規化する（ハイフン・空白・全角を除去）。
 * @param {*} value
 * @return {string} 数字のみ。取れなければ空文字。
 */
function normalizeIsbn_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^0-9]/g, '');
}

/**
 * 書名を比較用に正規化する。全角英数を半角に落とし、記号・空白を除去する。
 * @param {*} value
 * @return {string}
 */
function normalizeTitle_(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .toLowerCase()
    .replace(/[\s　・･、。，．！？!?"'“”‘’「」『』（）()\[\]【】〜~ー\-—_/／:：;；]/g, '');
}

/**
 * 2文字組（bigram）の Dice 係数で文字列の近さを測る。
 * 日本語の書名は表記ゆれ・OCR誤読で1〜2文字ずれることが多いので、
 * 完全一致ではなく類似度で判定する。
 * @param {string} a
 * @param {string} b
 * @return {number} 0.0〜1.0
 */
function similarity_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = function (s) {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  };
  const left = bigrams(a);
  const right = bigrams(b);
  const pool = right.slice();

  let hit = 0;
  left.forEach(function (g) {
    const at = pool.indexOf(g);
    if (at >= 0) {
      hit++;
      pool.splice(at, 1); // 同じ組を二重にカウントしない
    }
  });
  return (2 * hit) / (left.length + right.length);
}

/** 書名がマスタと「大きく食い違う」とみなす閾値。 */
const TITLE_SIMILARITY_THRESHOLD = 0.5;

/**
 * 明細1行を検算し、「要確認」の理由を列挙する。
 * 空配列が返れば機械的には問題なし（＝冊数の目視だけで済む）。
 *
 * @param {{isbn: *, title: *, quantity: *, confidence: *}} line Geminiが返した明細
 * @param {{distributor: *, storeCode: *, storeName: *}} fax FAX単位の情報
 * @param {Object.<string, {title: string}>} master ISBN → 書籍マスタ
 * @return {{issues: string[], isbn: string, masterTitle: string}}
 */
function validateLine_(line, fax, master) {
  const issues = [];
  const isbn = normalizeIsbn_(line.isbn);
  const entry = isbn && master[isbn] ? master[isbn] : null;

  // --- ISBN ---
  if (!isbn) {
    issues.push('ISBN未取得');
  } else if (!isValidIsbn13_(isbn)) {
    issues.push('ISBNチェックディジット不正');
  } else if (isbn.indexOf(CONFIG.ORDER.ISBN_PREFIX) !== 0) {
    issues.push('自社刊行物のISBNではない');
  } else if (!entry) {
    issues.push('書籍マスタに存在しないISBN');
  }

  // --- 書名 ---
  // マスタが引けたときだけ突き合わせる。引けない場合は上でISBN側を指摘済み。
  if (entry) {
    const faxTitle = normalizeTitle_(line.title);
    if (!faxTitle) {
      issues.push('書名未取得');
    } else if (similarity_(faxTitle, normalizeTitle_(entry.title)) < TITLE_SIMILARITY_THRESHOLD) {
      issues.push('書名がマスタと不一致');
    }
  } else if (!normalizeTitle_(line.title)) {
    issues.push('書名未取得');
  }

  // --- 冊数 ---
  // 機械的に検算する術がない項目。異常値だけは弾き、あとは人間の目に委ねる。
  const qty = Number(line.quantity);
  if (line.quantity === null || line.quantity === undefined || line.quantity === '') {
    issues.push('冊数未取得');
  } else if (!isFinite(qty) || !Number.isInteger(qty)) {
    issues.push('冊数が整数でない');
  } else if (qty < 1) {
    issues.push('冊数が1未満');
  } else if (qty > CONFIG.ORDER.MAX_QUANTITY) {
    issues.push('冊数が異常に多い（' + qty + '）');
  }

  // --- 発送先 ---
  // 書店コードと書店名がどちらも取れないと、そもそもどこへ送るか分からない。
  if (!fax.storeCode && !fax.storeName) {
    issues.push('発送先不明（書店コード・書店名とも未取得）');
  }

  // --- 確信度 ---
  const conf = Number(line.confidence);
  if (!isFinite(conf) || conf < CONFIG.ORDER.CONFIDENCE_THRESHOLD) {
    issues.push('確信度が低い');
  }

  return {
    issues: issues,
    isbn: isbn,
    masterTitle: entry ? entry.title : '',
  };
}
