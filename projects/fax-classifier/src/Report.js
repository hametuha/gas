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

  if (total === 0) {
    console.log('本日のFAXはありませんでした（メール送信なし）。');
    return;
  }

  MailApp.sendEmail(
    PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
      || Session.getEffectiveUser().getEmail(),
    '[FAX仕分け] ' + today + ' のFAX ' + total + '件',
    buildReportBody_(today, total, counts, unknowns)
  );
  console.log('日次サマリーを送信しました（' + total + '件）。');
}

/**
 * 日次サマリーの本文を組み立てる。
 * 件数は 受注/返品/営業/不明 の順に固定し、想定外ラベル(ERROR等)は末尾に付ける。
 * @param {string} today
 * @param {number} total
 * @param {Object} counts 判定ラベル → 件数
 * @param {Array<{name: string, reason: string, url: string}>} unknowns
 * @return {string}
 */
function buildReportBody_(today, total, counts, unknowns) {
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
  return body;
}
