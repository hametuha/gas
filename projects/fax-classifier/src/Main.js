/**
 * エントリポイントと運用ユーティリティ。
 *
 * 日常運転: runPipeline()（1時間毎トリガーで自動実行）
 *           = ステージ1 分類 → ステージ2 受注明細の抽出
 * 日次通知: dailyReport()（毎日1回トリガーで当日分をメール）
 * 初期設定: setup() を1回実行 → ログシート自動作成 & プロパティ確認
 *           その後 refreshBookMaster() で書籍マスタを取り込む
 * 自動化ON: installTrigger() + installDailyReport() でトリガーを設置
 */

/**
 * 日常運転の本体。分類してから、受注に落ちたものの明細を抽出する。
 *
 * 抽出が落ちても分類の結果は残したいので、ステージ2の失敗は握って
 * ログに出すだけにする（次回の実行でリトライされる）。
 */
function runPipeline() {
  processFaxFolder();
  try {
    extractOrders();
  } catch (e) {
    console.error('受注明細の抽出に失敗しました（分類は完了しています）: ' + e);
  }
}

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

  let unknownCount = 0;
  let processed = 0;
  const startedAt = Date.now();

  files.forEach(function (file) {
    // 実行時間の予算を超えたら打ち切る（残りは次回のトリガーで処理される）。
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      console.warn('実行時間の予算を超えたため分類を中断します。');
      return;
    }

    const now = new Date();
    let result;
    try {
      result = classifyFax_(file.getBlob());
    } catch (e) {
      console.error('分類失敗: ' + file.getName() + ' :: ' + e);
      appendLog_([[now, file.getName(), 'ERROR', '', '(移動せず)', String(e), CONFIG.DRY_RUN, file.getUrl()]]);
      return;
    }

    // 分類キーの正規化と確信度による足切り。
    let key = CONFIG.CATEGORIES[result.category] ? result.category : 'unknown';
    if (key !== 'unknown' && Number(result.confidence) < CONFIG.CONFIDENCE_THRESHOLD) {
      key = 'unknown';
    }
    const category = CONFIG.CATEGORIES[key];

    const movedTo = CONFIG.DRY_RUN
      ? '（DRY_RUN: ' + category.label + ' へ移動予定）'
      : category.label;

    if (key === 'unknown') {
      unknownCount++;
    }

    // 記録してから移動する。逆順だと、書き込み前に打ち切られたとき
    // ファイルだけ仕分け済みになり監査ログに残らない。
    appendLog_([[now, file.getName(), category.label, result.confidence, movedTo,
      result.reason, CONFIG.DRY_RUN, file.getUrl()]]);
    processed++;

    if (!CONFIG.DRY_RUN) {
      moveFile_(file, category.folderId);
    }
  });

  // 通知は dailyReport() が当日分をまとめて送る（ここでは即時送信しない）。
  console.log(processed + '/' + files.length + '件を処理しました（DRY_RUN=' + CONFIG.DRY_RUN
    + '、うち不明 ' + unknownCount + '件）。ログを確認してください。');
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

  // ステージ2（受注明細の抽出）の準備状況。
  console.log('ORDER.EXTRACTED_FOLDER_ID: '
    + (CONFIG.ORDER.EXTRACTED_FOLDER_ID
      ? 'OK'
      : '未設定 ← 受注フォルダ内に「抽出済み」フォルダを作り Config.js に設定してください'));

  const master = getBookMaster_();
  const count = Object.keys(master).length;
  console.log('書籍マスタ: ' + count + '件'
    + (count ? '' : ' ← refreshBookMaster() を実行して openBD から取り込んでください'));
}

/**
 * 指定ハンドラのトリガーをすべて削除する。
 * @param {string} handlerName
 * @return {number} 削除した数
 */
function deleteTriggersFor_(handlerName) {
  const targets = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === handlerName; });
  targets.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return targets.length;
}

/**
 * 1時間毎のパイプライン（分類→受注抽出）トリガーを設置する。
 * 既存の同名トリガー、および旧構成の processFaxFolder 単体トリガーは張り替える。
 * DRY_RUN で精度を確認してから実行するのが安全。
 */
function installTrigger() {
  deleteTriggersFor_('runPipeline');
  deleteTriggersFor_('processFaxFolder'); // 旧構成のトリガーが残っていれば剥がす
  ScriptApp.newTrigger('runPipeline').timeBased().everyHours(1).create();
  console.log('1時間毎のパイプライン（分類→受注抽出）トリガーを設置しました。');
}

/**
 * 毎日18時（JST）の日次サマリートリガーを設置する。
 * 時刻を変えたい場合は atHour(18) の数字を変更する。
 */
function installDailyReport() {
  deleteTriggersFor_('dailyReport');
  ScriptApp.newTrigger('dailyReport').timeBased().atHour(18).everyDays(1).create();
  console.log('毎日18時の日次サマリートリガーを設置しました。');
}

/**
 * この仕組みに関わるトリガー（パイプライン・日次サマリー）をすべて解除する。
 */
function removeTrigger() {
  const n = deleteTriggersFor_('runPipeline')
    + deleteTriggersFor_('processFaxFolder')
    + deleteTriggersFor_('dailyReport');
  console.log(n + '件のトリガーを解除しました。');
}
