/**
 * 日次サマリー通知。
 *
 * ログシートから「今日」の判定を集計し、1件以上あれば1通のメールにまとめて送る。
 * FAXが0件の日は送らない（メールを減らす方針）。
 * 通知先は NOTIFY_EMAIL プロパティ、未設定なら実行ユーザー。
 * Slack にしたい場合はメール送信部分を Webhook 送信に差し替える。
 *
 * 1時間毎の processFaxFolder とは別に、毎日1回トリガーで実行する
 *（installDailyReport() 参照）。
 */
function dailyReport() {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const sheet = SpreadsheetApp.openById(getLogSheetId_()).getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log('ログが空です。');
    return;
  }

  // 列: 日時, ファイル名, 判定, 確信度, 移動先, 理由, DRY_RUN, ファイルURL
  const values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADER.length).getValues();

  const counts = {};    // 判定ラベル → 件数
  const unknowns = [];  // 不明の詳細
  let total = 0;

  values.forEach(function (row) {
    const when = row[0];
    if (!(when instanceof Date)) return;
    if (Utilities.formatDate(when, tz, 'yyyy-MM-dd') !== today) return;

    total++;
    const label = row[2];
    counts[label] = (counts[label] || 0) + 1;
    if (label === CONFIG.CATEGORIES.unknown.label) {
      unknowns.push({ name: row[1], reason: row[5], url: row[7] });
    }
  });

  const orders = summarizeOrders_(today, tz);

  // 分類も抽出も動きが無かった日は送らない。
  // 過去分の再抽出だけが走った日は、FAX 0件でも報告する価値がある。
  if (total === 0 && orders.lineCount === 0) {
    console.log('本日のFAXも受注抽出もありませんでした（メール送信なし）。');
    return;
  }

  MailApp.sendEmail(
    PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
      || Session.getEffectiveUser().getEmail(),
    '[FAX仕分け] ' + today + ' のFAX ' + total + '件'
      + (orders.flagged.length ? '（受注に要確認 ' + orders.flagged.length + '件）' : ''),
    buildReportBody_(today, total, counts, unknowns, orders)
  );
  console.log('日次サマリーを送信しました（FAX ' + total + '件 / 受注明細 '
    + orders.lineCount + '件）。');
}

/**
 * 当日分の受注明細を集計する。
 *
 * @param {string} today yyyy-MM-dd
 * @param {string} tz タイムゾーン
 * @return {{lineCount: number, faxCount: number,
 *           flagged: Array<{name: string, title: string, reason: string, url: string}>}}
 */
function summarizeOrders_(today, tz) {
  const sheet = getSheetByName_(CONFIG.ORDER.LINES_SHEET_NAME, ORDER_HEADER);
  const lastRow = sheet.getLastRow();
  const empty = { lineCount: 0, faxCount: 0, flagged: [] };
  if (lastRow < 2) return empty;

  const values = sheet.getRange(2, 1, lastRow - 1, ORDER_HEADER.length).getValues();
  const faxNames = {};
  const flagged = [];
  let lineCount = 0;

  values.forEach(function (row) {
    const when = row[0];
    if (!(when instanceof Date)) return;
    if (Utilities.formatDate(when, tz, 'yyyy-MM-dd') !== today) return;

    lineCount++;
    faxNames[row[1]] = true;
    if (row[14] === '要確認') {
      flagged.push({ name: row[1], title: row[10], reason: row[15], url: row[2] });
    }
  });

  return { lineCount: lineCount, faxCount: Object.keys(faxNames).length, flagged: flagged };
}

/**
 * 日次サマリーの本文を組み立てる。
 * 件数は 受注/返品/営業/不明 の順に固定し、想定外ラベル(ERROR等)は末尾に付ける。
 * @param {string} today
 * @param {number} total
 * @param {Object} counts 判定ラベル → 件数
 * @param {Array<{name: string, reason: string, url: string}>} unknowns
 * @param {{lineCount: number, faxCount: number, flagged: Array}} orders 受注抽出の集計
 * @return {string}
 */
function buildReportBody_(today, total, counts, unknowns, orders) {
  const ordered = [
    CONFIG.CATEGORIES.order.label,
    CONFIG.CATEGORIES.return.label,
    CONFIG.CATEGORIES.sales.label,
    CONFIG.CATEGORIES.unknown.label,
  ];
  const lines = ordered.map(function (label) {
    return '  ' + label + ': ' + (counts[label] || 0) + '件';
  });
  Object.keys(counts).forEach(function (label) {
    if (ordered.indexOf(label) === -1) {
      lines.push('  ' + label + ': ' + counts[label] + '件');
    }
  });

  let body = today + ' に処理したFAX: ' + total + '件\n\n' + lines.join('\n');

  if (unknowns.length) {
    body += '\n\n― 要確認（不明） ' + unknowns.length + '件 ―\n'
      + unknowns.map(function (it) {
          return '・' + it.name + '\n  理由: ' + it.reason + '\n  ' + it.url;
        }).join('\n\n');
  }

  if (orders && orders.lineCount) {
    body += '\n\n― 受注抽出 ―\n'
      + '  FAX ' + orders.faxCount + '件から ' + orders.lineCount + '明細を抽出\n'
      + '  うち要確認: ' + orders.flagged.length + '件';

    if (orders.flagged.length) {
      // 冊数は機械で検算できない。要確認は必ず人がPDFと突き合わせること。
      body += '\n\n― 受注の要確認 ' + orders.flagged.length + '件 ―\n'
        + orders.flagged.map(function (it) {
            return '・' + it.name + (it.title ? '「' + it.title + '」' : '')
              + '\n  理由: ' + it.reason + '\n  ' + it.url;
          }).join('\n\n');
    }
    body += '\n\n※ 受注明細シートは「人間が検算する下書き」です。'
      + '\n   とくに冊数は機械で検算できません。発送前に必ずPDFと突き合わせてください。';
  }
  return body;
}
