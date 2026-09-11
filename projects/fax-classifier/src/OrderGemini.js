/**
 * Gemini による受注FAXの明細抽出。
 *
 * 分類（Gemini.js）とは責務もプロンプトも別物なので分けている。
 *
 * 最悪の失敗モードは「読めない欄を埋めようとして捏造すること」なので、
 * プロンプトでは一貫して「読めなければ null」「推測するな」を強制する。
 * 空欄は人が補える。もっともらしい嘘は補えない。
 */

/**
 * 抽出プロンプトを組み立てる。自社刊行物の一覧を候補として与え、
 * ISBN・書名の読み取り精度を上げる。
 *
 * @param {Object.<string, {title: string, author: string}>} master
 * @return {string}
 */
function buildOrderPrompt_(master) {
  const catalog = Object.keys(master).map(function (isbn) {
    return '- ' + isbn + ' : ' + master[isbn].title
      + (master[isbn].author ? '（' + master[isbn].author + '）' : '');
  });

  return [
    'あなたは出版社「破滅派」に届いた書籍の注文FAXを読み取る専門アシスタントです。',
    '与えられたPDFから注文内容を構造化して抽出してください。',
    '',
    '【最重要の原則】',
    '- 読み取れない項目は必ず null にすること。推測・補完・それらしい値の創作は厳禁。',
    '- 空欄は人間があとから補える。誤った値は業務事故（誤出荷）になる。迷ったら null。',
    '- FAXは手書き・低解像度のことが多い。少しでも判読に迷った項目は confidence を下げること。',
    '',
    '【明細の粒度】',
    '- 注文書には複数の書名が並ぶ。1つの書名につき1件の明細として lines に列挙すること。',
    '- 同じ書名が複数行に分かれて記載されていても、統合せずFAXの記載どおりに列挙すること。',
    '',
    '【自社刊行物リスト】',
    '注文されるのは通常この中のいずれかです。書名から特定できる場合は、',
    'ここに載っている正しいISBNを返してください。',
    catalog.length ? catalog.join('\n') : '（マスタ未取得。refreshBookMaster() を実行してください）',
    '',
    'ただし、リストにない書籍が注文されている場合もあります。その場合は',
    '**リストの書籍に無理に寄せず**、FAXに書かれている書名・ISBNをそのまま返してください。',
    '',
    '【各項目の説明】',
    '- faxDate:     FAXまたは伝票に記載された日付。YYYY-MM-DD 形式。年が無ければ null。',
    '- distributor: 取次会社名（日本出版販売／トーハン／楽天ブックスネットワーク 等）。',
    '- storeCode:   取次の書店コード（帳合コード）。数字列をそのまま。',
    '- storeName:   注文元の書店名。',
    '- staff:       担当者名。記載がなければ null。',
    '- workCode:    伝票上の「作業コード」欄の値。記載がなければ null。',
    '- lines[].isbn:       13桁のISBN（ハイフンなし）。読めなければ null。',
    '- lines[].title:      FAXに書かれている書名。',
    '- lines[].quantity:   注文冊数。**手書き数字の誤読が最も危険な項目**。',
    '                      1と7、3と5、0と6などが紛らわしい場合は confidence を必ず下げること。',
    '- lines[].confidence: この明細1行の読み取りへの自信（0.0〜1.0）。',
    '- note:        読み取り上の注意点（判読困難な箇所、備考欄の記載など）を日本語で簡潔に。',
  ].join('\n');
}

/** 抽出結果のJSONスキーマ。読めない項目は null を許す。 */
const ORDER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    faxDate:     { type: 'string', nullable: true },
    distributor: { type: 'string', nullable: true },
    storeCode:   { type: 'string', nullable: true },
    storeName:   { type: 'string', nullable: true },
    staff:       { type: 'string', nullable: true },
    workCode:    { type: 'string', nullable: true },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          isbn:       { type: 'string', nullable: true },
          title:      { type: 'string', nullable: true },
          quantity:   { type: 'integer', nullable: true },
          confidence: { type: 'number' },
        },
        required: ['isbn', 'title', 'quantity', 'confidence'],
      },
    },
    note: { type: 'string' },
  },
  required: ['faxDate', 'distributor', 'storeCode', 'storeName', 'staff', 'workCode', 'lines', 'note'],
};

/**
 * 受注FAXのPDFから注文明細を抽出する。
 *
 * @param {Blob} blob application/pdf の Blob
 * @param {Object.<string, {title: string, author: string}>} master 書籍マスタ
 * @return {{faxDate: ?string, distributor: ?string, storeCode: ?string, storeName: ?string,
 *           staff: ?string, workCode: ?string, lines: Object[], note: string}}
 */
function extractOrder_(blob, master) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + CONFIG.MODEL + ':generateContent?key=' + encodeURIComponent(getGeminiApiKey_());

  const payload = {
    systemInstruction: { parts: [{ text: buildOrderPrompt_(master) }] },
    contents: [{
      role: 'user',
      parts: [
        { text: 'この注文FAXから注文内容を抽出してください。読み取れない項目は null にしてください。' },
        { inlineData: { mimeType: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: ORDER_RESPONSE_SCHEMA,
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Gemini API エラー (' + code + '): ' + res.getContentText());
  }

  const body = JSON.parse(res.getContentText());
  const text = body.candidates
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts[0].text;
  if (!text) {
    throw new Error('Gemini から想定外の応答: ' + res.getContentText());
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.lines)) parsed.lines = [];
  return parsed;
}
