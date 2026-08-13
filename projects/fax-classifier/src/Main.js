/**
 * エントリポイントと運用ユーティリティ。
 *
 * 日常運転: processFaxFolder()（時間トリガーで自動実行）
 * 初期設定: setup() を1回実行 → ログシート自動作成 & プロパティ確認
 * 自動化ON: installTrigger() で15分毎トリガーを設置
 */

/**
 * FAXフォルダ直下のPDFを分類し、（DRY_RUN でなければ）子フォルダへ仕分ける。
 * 全件をログシートに記録する。
 */
function processFaxFolder() {
  const files = listUnprocessedFax_();
  if (!files.length) {
    console.log('処理対象のPDFはありません。');
    return;
  }

  const rows = [];
  files.forEach(function (file) {
    const now = new Date();
    let result;
    try {
      result = classifyFax_(file.getBlob());
    } catch (e) {
      console.error('分類失敗: ' + file.getName() + ' :: ' + e);
      rows.push([now, file.getName(), 'ERROR', '', '(移動せず)', String(e), CONFIG.DRY_RUN, file.getUrl()]);
      return;
    }

    // 分類キーの正規化と確信度による足切り。
    let key = CONFIG.CATEGORIES[result.category] ? result.category : 'unknown';
    if (key !== 'unknown' && Number(result.confidence) < CONFIG.CONFIDENCE_THRESHOLD) {
      key = 'unknown';
    }
    const category = CONFIG.CATEGORIES[key];

    let movedTo;
    if (CONFIG.DRY_RUN) {
      movedTo = '（DRY_RUN: ' + category.folder + ' へ移動予定）';
    } else {
      moveFile_(file, ensureSubfolder_(category.folder));
      movedTo = category.folder;
    }

    rows.push([now, file.getName(), category.label, result.confidence, movedTo, result.reason, CONFIG.DRY_RUN, file.getUrl()]);
  });

  appendLog_(rows);
  console.log(files.length + '件を処理しました（DRY_RUN=' + CONFIG.DRY_RUN + '）。ログを確認してください。');
}

/**
 * 初期設定。ログシートが無ければ作成し、必須プロパティの設定状況を表示する。
 * FAX_FOLDER_ID と GEMINI_API_KEY は、実行ログに出るURLの手順で手動設定すること。
 */
function setup() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('LOG_SHEET_ID')) {
    const ss = SpreadsheetApp.create('FAX仕分けログ');
    props.setProperty('LOG_SHEET_ID', ss.getId());
    console.log('ログシートを作成しました: ' + ss.getUrl());
  } else {
    console.log('ログシート: 設定済み');
  }

  ['FAX_FOLDER_ID', 'GEMINI_API_KEY'].forEach(function (key) {
    console.log(key + ': ' + (props.getProperty(key) ? 'OK' : '未設定 ← プロジェクトの設定 > スクリプトプロパティ で設定してください'));
  });
}

/**
 * 15分毎の時間トリガーを設置する（既存の同名トリガーは張り替える）。
 * DRY_RUN で精度を確認し、CONFIG.DRY_RUN を false にしてから実行するのが安全。
 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'processFaxFolder'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processFaxFolder').timeBased().everyMinutes(15).create();
  console.log('15分毎のトリガーを設置しました。');
}

/**
 * 時間トリガーを解除する（自動運転を止めたいとき）。
 */
function removeTrigger() {
  const targets = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'processFaxFolder'; });
  targets.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log(targets.length + '件のトリガーを解除しました。');
}
