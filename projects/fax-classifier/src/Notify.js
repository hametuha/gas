/**
 * 「不明」に仕分けられたFAXの通知。
 *
 * 通知先は NOTIFY_EMAIL プロパティ、未設定なら実行ユーザーのアドレス。
 * Slack にしたい場合はここを Webhook 送信に差し替える（1関数のみ）。
 */

/**
 * 不明ファイルをまとめてメール通知する。
 * @param {Array<{name: string, reason: string, url: string}>} unknownItems
 */
function notifyUnknown_(unknownItems) {
  if (!unknownItems.length) return;

  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
    || Session.getEffectiveUser().getEmail();

  const subject = '[FAX仕分け] 判別不能なFAXが ' + unknownItems.length + ' 件あります';
  const blocks = unknownItems.map(function (it) {
    return '・' + it.name + '\n  理由: ' + it.reason + '\n  ' + it.url;
  });
  const body = '以下のFAXは自動判別できず「不明」フォルダに入れました。手動で確認してください。\n\n'
    + blocks.join('\n\n');

  MailApp.sendEmail(to, subject, body);
}
