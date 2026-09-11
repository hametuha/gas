#!/usr/bin/env node
/**
 * 受注FAXの抽出精度をローカルで試すためのツール。
 *
 * GASにデプロイする前に「そもそもGeminiがこのFAXを読めるのか」を確かめる。
 * 本番と同じ src/OrderGemini.js のプロンプト・スキーマ、同じ src/Validate.js の
 * 検算ロジックをそのまま読み込んで使う（コピーを試しても意味がないため）。
 *
 *   export GEMINI_API_KEY='...'      # Apps Script のスクリプトプロパティと同じ値
 *   node tools/try-extract.js sample1.pdf [sample2.pdf ...]
 *
 * Drive等には一切触らない。読み取って表示するだけ。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const FIXTURE = path.join(__dirname, '..', 'tests', 'openbd.fixture.json');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY が未設定です。\n  export GEMINI_API_KEY=\'...\'');
  process.exit(1);
}
const pdfs = process.argv.slice(2);
if (!pdfs.length) {
  console.error('使い方: node tools/try-extract.js <FAXのPDF> [...]');
  process.exit(1);
}

// --- 本番コードをそのまま読み込む（GASのグローバルスコープを再現） ---
const code = ['Config.js', 'Validate.js', 'OrderGemini.js']
  .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n');
const gas = new Function(
  'return (function(){' + code +
  '\nreturn { CONFIG, buildOrderPrompt_, ORDER_RESPONSE_SCHEMA, validateLine_ };})()'
)();

// --- 書籍マスタは openBD フィクスチャから作る（本番のシートと同じ形） ---
const master = {};
JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).forEach((b, i) => {
  if (!b || !b.summary) return;
  // フィクスチャは列挙順なので ISBN を作り直す
  const twelve = gas.CONFIG.ORDER.ISBN_PREFIX + String(i).padStart(2, '0');
  let s = 0;
  for (let k = 0; k < 12; k++) s += Number(twelve[k]) * (k % 2 ? 3 : 1);
  master[twelve + String((10 - (s % 10)) % 10)] =
    { title: b.summary.title || '', author: b.summary.author || '' };
});

const dim = (s) => '\x1b[2m' + s + '\x1b[0m';
const red = (s) => '\x1b[31m' + s + '\x1b[0m';
const grn = (s) => '\x1b[32m' + s + '\x1b[0m';
const yel = (s) => '\x1b[33m' + s + '\x1b[0m';
const show = (v) => (v === null || v === undefined || v === '') ? dim('(null)') : String(v);

/** インライン送信の上限は約20MB。base64で4/3に膨らむので、そこを見越して警告する。 */
const INLINE_LIMIT_BYTES = 14 * 1024 * 1024;

async function extract(pdfPath) {
  const bytes = fs.statSync(pdfPath).size;
  if (bytes > INLINE_LIMIT_BYTES) {
    throw new Error('PDFが大きすぎます（' + (bytes / 1024 / 1024).toFixed(1)
      + 'MB）。インライン送信は約20MBが上限で、base64で1.33倍に膨らみます。'
      + '本番(GAS)でも同じ制限にかかるので、Zapier側の解像度設定を見直すか'
      + 'Files APIへの切り替えが要ります。');
  }

  const body = {
    systemInstruction: { parts: [{ text: gas.buildOrderPrompt_(master) }] },
    contents: [{
      role: 'user',
      parts: [
        { text: 'この注文FAXから注文内容を抽出してください。読み取れない項目は null にしてください。' },
        { inlineData: { mimeType: 'application/pdf', data: fs.readFileSync(pdfPath).toString('base64') } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: gas.ORDER_RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/'
      + gas.CONFIG.MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0, 500));
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('想定外の応答: ' + JSON.stringify(json).slice(0, 500));
  return JSON.parse(text);
}

(async () => {
  console.log(dim('モデル: ' + gas.CONFIG.MODEL + ' / 書籍マスタ: '
    + Object.keys(master).length + '点'));

  let totalLines = 0, totalFlagged = 0;

  for (const pdfPath of pdfs) {
    console.log('\n' + '='.repeat(70) + '\n' + path.basename(pdfPath) + '\n' + '='.repeat(70));
    const t0 = Date.now();
    let r;
    try {
      r = await extract(pdfPath);
    } catch (e) {
      console.log(red('抽出失敗: ' + e.message));
      continue;
    }
    console.log(dim((Date.now() - t0) + 'ms / '
      + (fs.statSync(pdfPath).size / 1024).toFixed(0) + 'KB'));

    console.log('\n[FAX単位]');
    [['日付', r.faxDate], ['取次', r.distributor], ['書店コード', r.storeCode],
     ['書店名', r.storeName], ['担当者', r.staff], ['作業コード', r.workCode]]
      .forEach(([k, v]) => console.log('  ' + k.padEnd(12, '　').slice(0, 6) + ' : ' + show(v)));

    const fax = { storeCode: r.storeCode, storeName: r.storeName };
    console.log('\n[明細 ' + (r.lines || []).length + '件]');
    (r.lines || []).forEach((line, i) => {
      const v = gas.validateLine_(line, fax, master);
      totalLines++;
      if (v.issues.length) totalFlagged++;
      console.log('  ' + (i + 1) + '. ' + show(line.title));
      console.log('     ISBN ' + show(line.isbn)
        + (v.masterTitle ? dim('  → マスタ: ' + v.masterTitle) : '')
        + '   冊数 ' + show(line.quantity)
        + '   確信度 ' + show(line.confidence));
      console.log('     ' + (v.issues.length
        ? yel('要確認: ') + v.issues.join(' / ')
        : grn('検算OK（冊数は要目視）')));
    });

    if (r.note) console.log('\n[備考] ' + r.note);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('合計 ' + totalLines + '明細 / 機械検算で要確認 ' + totalFlagged + '件');
  console.log(dim('※ 冊数は機械では検算できません。必ず現物と突き合わせてください。'));
})();
