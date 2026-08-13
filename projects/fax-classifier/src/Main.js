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
  const unknownItems = [];
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
      movedTo = '（DRY_RUN: ' + category.label + ' へ移動予定）';
    } else {
      moveFile_(file, category.folderId);
      movedTo = category.label;
    }

    if (key === 'unknown') {
      unknownItems.push({ name: file.getName(), reason: result.reason, url: file.getUrl() });
    }

    rows.push([now, file.getName(), category.label, result.confidence, movedTo, result.reason, CONFIG.DRY_RUN, file.getUrl()]);
  });

  appendLog_(rows);

  // 実際に「不明」へ移動したときだけ通知する（DRY_RUN 中は移動していないので送らない）。
  if (!CONFIG.DRY_RUN) {
    notifyUnknown_(unknownItems);
  }

  console.log(files.length + '件を処理しました（DRY_RUN=' + CONFIG.DRY_RUN
    + '、うち不明 ' + unknownItems.length + '件）。ログを確認してください。');
}

/**
 * 初期設定。ログシートが無ければ作成し、APIキーの設定状況を表示する。
 * GEMINI_API_KEY は「プロジェクトの設定 > スクリプトプロパティ」で手動設定すること。
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

  console.log('GEMINI_API_KEY: '
    + (props.getProperty('GEMINI_API_KEY')
      ? 'OK'
      : '未設定 ← プロジェクトの設定 > スクリプトプロパティ で設定してください'));
}

/**
 * 1時間毎の時間トリガーを設置する（既存の同名トリガーは張り替える）。
 * DRY_RUN で精度を確認し、CONFIG.DRY_RUN を false にしてから実行するのが安全。
 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'processFaxFolder'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processFaxFolder').timeBased().everyHours(1).create();
  console.log('1時間毎のトリガーを設置しました。');
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
