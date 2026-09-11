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
    '【番線印の読み方】',
    '注文書には「番線印」というスタンプが押されている。ここに取次・番線・書店が入る。',
    '- 番線: アルファベットと数字の記号（例: D68-03、B36-17、93L80）。',
    '- 書店コード: 書店を示す数字（例: 147-640、125-000、12368）。これが作業コードでもある。',
    '- 取次: 社名の文字（日販・トーハン等）が無くても、**番線印の中のロゴマーク**で',
    '        判別できることが多い。ロゴからも判定してよい。それでも不明なら null。',
    '',
    '【各項目の説明】',
    '- faxDate:     FAXまたは伝票に記載された日付。YYYY-MM-DD 形式。年が無ければ null。',
    '- distributor: 取次会社名（日本出版販売／トーハン／楽天ブックスネットワーク 等）。',
    '               社名の記載が無くても番線印のロゴから判別できればそれを答える。',
    '- banselCode:  番線印の記号部分（例: D68-03、B36-17、93L80）。無ければ null。',
    '- storeCode:   番線印の書店を示す数字（＝作業コード）。ハイフンは残してよい。',
    '- storeName:   注文元の書店名。',
    '- staff:       担当者名。記載がなければ null。',
    '- lines[].isbn:       13桁のISBN（ハイフンなし）。',
    '- lines[].isbnSource: ISBNをどう得たか。文書に印字・記載されていたなら "document"、',
    '                      書名から上記リストを引いて補ったなら "inferred"、',
    '                      どちらでもなく特定できなければ null。**正直に申告すること**。',
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
    banselCode:  { type: 'string', nullable: true },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          isbn:       { type: 'string', nullable: true },
          isbnSource: { type: 'string', nullable: true, enum: ['document', 'inferred'] },
          title:      { type: 'string', nullable: true },
          quantity:   { type: 'integer', nullable: true },
          confidence: { type: 'number' },
        },
        required: ['isbn', 'isbnSource', 'title', 'quantity', 'confidence'],
      },
    },
    note: { type: 'string' },
  },
  required: ['faxDate', 'distributor', 'banselCode', 'storeCode', 'storeName', 'staff', 'lines', 'note'],
};

/**
 * 受注FAXのPDFから注文明細を抽出する。
 *
 * @param {Blob} blob application/pdf の Blob
 * @param {Object.<string, {title: string, author: string}>} master 書籍マスタ
 * @return {{faxDate: ?string, distributor: ?string, banselCode: ?string, storeCode: ?string,
 *           storeName: ?string, staff: ?string, lines: Object[], note: string}}
 */
function extractOrder_(blob, master) {
  const parsed = callGemini_({
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
  });

  if (!Array.isArray(parsed.lines)) parsed.lines = [];
  return parsed;
}
