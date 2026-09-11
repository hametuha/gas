/**
 * GAS本体は動かせないので、純粋ロジック（ISBN検算・書名照合・要確認判定・
 * ISBN列挙）だけを Node に持ち込んで検証する。
 * GASのグローバルスコープを模して、対象ファイルを連結して eval する。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const code = ['Config.js', 'Validate.js', 'BookMaster.js']
  .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n');

// 対象関数をグローバルへ引き上げる（GASの共有スコープを再現）。
const ctx = new Function(code + `
  return { isValidIsbn13_, normalizeIsbn_, normalizeTitle_, similarity_,
           validateLine_, enumerateOwnIsbns_, isbn13CheckDigit_, CONFIG };
`)();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// --- ISBN-13 チェックディジット ---
console.log('\n[ISBN-13 チェックディジット]');
// openBD が実在を確認した破滅派の5点
['9784905197027', '9784905197034', '9784905197041', '9784905197089', '9784905197096']
  .forEach((i) => ok('実在ISBN ' + i, ctx.isValidIsbn13_(i)));
ok('末尾1桁改変を検出', !ctx.isValidIsbn13_('9784905197028'));
ok('12桁は不正', !ctx.isValidIsbn13_('978490519702'));
ok('非数字は不正', !ctx.isValidIsbn13_('978490519702X'));

// OCRで最も起きやすいのは1文字の誤読。これを100%捕まえられることを全数で確認する
// （重み1,3では単一桁の変化が必ず総和を10の倍数から外すため）。
const singleDigitAllCaught = ['9784905197027', '9784905197041', '9784905197096'].every((isbn) => {
  for (let pos = 0; pos < 13; pos++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === isbn[pos]) continue;
      const broken = isbn.slice(0, pos) + d + isbn.slice(pos + 1);
      if (ctx.isValidIsbn13_(broken)) return false;
    }
  }
  return true;
});
ok('1文字の誤読は全パターン検出できる（全数確認）', singleDigitAllCaught);

// 既知の限界: 隣接2桁の入れ替えは、差が5のときチェックディジットをすり抜ける。
// これは仕様上の限界なので「検出できない」ことを明示しておく。
ok('隣接桁の入れ替えはすり抜けうる（既知の限界／マスタ照合で拾う）',
  ctx.isValidIsbn13_('9784905197027') && ctx.isValidIsbn13_('9784905197072'));

// --- ISBN列挙 ---
console.log('\n[ISBN列挙]');
const all = ctx.enumerateOwnIsbns_();
ok('100件生成される', all.length === 100, all.length);
ok('全件がチェックディジット妥当', all.every(ctx.isValidIsbn13_));
ok('実在5点をすべて含む',
  ['9784905197027', '9784905197034', '9784905197041', '9784905197089', '9784905197096']
    .every((i) => all.includes(i)));
ok('重複なし', new Set(all).size === 100);

// --- 書名の正規化と類似度 ---
console.log('\n[書名照合]');
ok('全角/記号/空白の揺れを吸収',
  ctx.normalizeTitle_('シン・サークルクラッシャー麻紀') === ctx.normalizeTitle_('シン　サークルクラッシャー 麻紀'));
ok('同一書名は類似度1',
  ctx.similarity_(ctx.normalizeTitle_('ギークに銃はいらない'), ctx.normalizeTitle_('ギークに銃はいらない')) === 1);
ok('1文字OCR誤読でも高類似（>0.5）',
  ctx.similarity_(ctx.normalizeTitle_('ギークに銃はいらない'), ctx.normalizeTitle_('ギークに銃はいらたい')) > 0.5);
ok('別書籍は低類似（<0.5）',
  ctx.similarity_(ctx.normalizeTitle_('ギークに銃はいらない'), ctx.normalizeTitle_('プルーストが読みきれない')) < 0.5,
  ctx.similarity_(ctx.normalizeTitle_('ギークに銃はいらない'), ctx.normalizeTitle_('プルーストが読みきれない')));

// --- 要確認判定 ---
console.log('\n[要確認判定]');
const master = {
  '9784905197041': { title: 'ギークに銃はいらない', author: '斧田小夜／著' },
  '9784905197096': { title: 'プルーストが読みきれない', author: '高橋文樹／著' },
};
const goodFax = { distributor: '日本出版販売', storeCode: '1234567', storeName: '○○書店' };
const V = (line, fax) => ctx.validateLine_(line, fax || goodFax, master).issues;

ok('完全に正しい明細は無指摘',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 }).length === 0,
  JSON.stringify(V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 })));
ok('ハイフン付きISBNを正規化して通す',
  V({ isbn: '978-4-905197-04-1', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 }).length === 0);
ok('チェックディジット不正を検出',
  V({ isbn: '9784905197042', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 })
    .includes('ISBNチェックディジット不正'));
ok('他社ISBNを検出',
  V({ isbn: '9784101010014', title: '何かの本', quantity: 3, confidence: 0.95 })
    .includes('自社刊行物のISBNではない'));
ok('マスタ未登録ISBNを検出',
  V({ isbn: '9784905197027', title: 'アウレリャーノがやってくる', quantity: 3, confidence: 0.95 })
    .includes('書籍マスタに存在しないISBN'));
ok('書名とISBNの食い違いを検出',
  V({ isbn: '9784905197041', title: 'プルーストが読みきれない', quantity: 3, confidence: 0.95 })
    .includes('書名がマスタと不一致'));
ok('ISBN未取得を検出',
  V({ isbn: null, title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 })
    .includes('ISBN未取得'));
ok('冊数未取得を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: null, confidence: 0.95 })
    .includes('冊数未取得'));
ok('冊数0を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 0, confidence: 0.95 })
    .includes('冊数が1未満'));
ok('冊数の異常値を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 999, confidence: 0.95 })
    .some((s) => s.startsWith('冊数が異常に多い')));
ok('低確信度を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.6 })
    .includes('確信度が低い'));
ok('confidence欠落を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: null })
    .includes('確信度が低い'));
ok('発送先不明を検出',
  V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 },
     { distributor: null, storeCode: null, storeName: null })
    .includes('発送先不明（書店コード・書店名とも未取得）'));
ok('書店名のみでも発送先はOK',
  !V({ isbn: '9784905197041', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.95 },
      { distributor: null, storeCode: null, storeName: '○○書店' })
    .includes('発送先不明（書店コード・書店名とも未取得）'));
ok('全滅の明細は複数の理由を返す',
  V({ isbn: null, title: null, quantity: null, confidence: 0.1 },
     { distributor: null, storeCode: null, storeName: null }).length >= 4);

// --- 返り値の付随情報 ---
console.log('\n[マスタ書名の引き当て]');
const r = ctx.validateLine_(
  { isbn: '978-4-905197-04-1', title: 'ギークに銃はいらない', quantity: 3, confidence: 0.9 },
  goodFax, master);
ok('ISBNが正規化されて返る', r.isbn === '9784905197041', r.isbn);
ok('マスタ書名が引かれる', r.masterTitle === 'ギークに銃はいらない', r.masterTitle);

console.log('\n=== ' + pass + ' passed / ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
