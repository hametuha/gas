/**
 * refreshBookMaster() の upsert を実データで検証する。
 * 手動行を壊さない・削除しない・二重登録しないことが要点。
 * SpreadsheetApp と UrlFetchApp は最小限の偽物で差し替える。
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/** スプレッドシートの偽物。rows[0] はヘッダ。 */
function FakeSheet(rows) {
  this.rows = rows;
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.appendRow = function (r) { this.rows.push(r.slice()); };
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  const self = this;
  return {
    getValues: function () {
      const out = [];
      for (let i = 0; i < numRows; i++) {
        const src = self.rows[row - 1 + i] || [];
        out.push(src.slice(col - 1, col - 1 + numCols));
      }
      return out;
    },
    setValues: function (values) {
      values.forEach(function (v, i) {
        while (self.rows.length < row - 1 + i) self.rows.push([]);
        self.rows[row - 1 + i] = v.slice();
      });
    },
  };
};

(function () {
  // openBD の実レスポンスを summary だけに絞って固定したもの。
  // テストをネットワークとJPRO登録状況から切り離すため。
  const fixture = fs.readFileSync(path.join(__dirname, 'openbd.fixture.json'), 'utf8');

  const code = ['Config.js', 'Validate.js', 'BookMaster.js']
    .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');

  /** シートを与えて refreshBookMaster を1回走らせ、ログと最終状態を返す。 */
  function run(sheet) {
    const logs = [];
    const build = new Function(
      'getSheetByName_', 'UrlFetchApp', 'console',
      code + '\nreturn { refreshBookMaster, getBookMaster_, MASTER_HEADER };'
    );
    const api = build(
      () => sheet,
      { fetch: () => ({ getResponseCode: () => 200, getContentText: () => fixture }) },
      { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) }
    );
    api.refreshBookMaster();
    return { logs: logs.join('\n'), master: api.getBookMaster_() };
  }

  const HEADER = ['ISBN', '書名', '著者', '出版日', '出典', '更新日時'];

  console.log('\n[初回取り込み]');
  const sheet = new FakeSheet([HEADER]);
  let r = run(sheet);
  ok('openBD の5点が取り込まれる', sheet.rows.length === 6, sheet.rows.length + '行');
  ok('ログに追加5件が出る', /追加 5件/.test(r.logs), r.logs);
  ok('マスタとして5点引ける', Object.keys(r.master).length === 5);
  ok('書名が入っている', r.master['9784905197041'] &&
    r.master['9784905197041'].title === 'ギークに銃はいらない',
    JSON.stringify(r.master['9784905197041']));

  console.log('\n[再実行（冪等性）]');
  r = run(sheet);
  ok('行数が増えない（二重登録しない）', sheet.rows.length === 6, sheet.rows.length + '行');
  ok('ログは追加0件・更新5件', /追加 0件 \/ 更新 5件/.test(r.logs), r.logs);

  console.log('\n[手動行の保護]');
  // 電子書籍など openBD に載らないものを手で足した状況
  sheet.rows.push(['9784905197010', '手で足した本', '誰か', '20130101', '手動', new Date()]);
  // openBD にも存在する行の書名を手で直し、出典を「手動」にした状況
  const idx = sheet.rows.findIndex((row) => row[0] === '9784905197041');
  sheet.rows[idx] = ['9784905197041', '人が直した書名', '斧田小夜', '20220620', '手動', new Date()];

  r = run(sheet);
  ok('openBD に無い手動行が消えない',
    sheet.rows.some((row) => row[0] === '9784905197010'));
  ok('手動で直した書名が上書きされない',
    sheet.rows[idx][1] === '人が直した書名', sheet.rows[idx][1]);
  ok('ログに据え置き1件が出る', /据え置き 1件/.test(r.logs), r.logs);
  ok('手動行もマスタとして引ける',
    r.master['9784905197010'] && r.master['9784905197010'].title === '手で足した本');
  ok('openBD由来の他の行は更新される', /更新 4件/.test(r.logs), r.logs);
  ok('総数は6点', Object.keys(r.master).length === 6, Object.keys(r.master).length);

  console.log('\n=== ' + pass + ' passed / ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
})();
