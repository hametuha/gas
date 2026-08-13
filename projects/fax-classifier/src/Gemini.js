/**
 * Gemini によるFAX分類。
 *
 * PDFを base64 で inlineData に載せ、構造化出力(JSON)で
 * {category, confidence, reason} を得る。
 */

/** システムプロンプト。分類基準と「迷ったら不明」の方針を明示する。 */
const FAX_SYSTEM_PROMPT = [
  'あなたは出版社「破滅派」に届くFAXを仕分ける専門アシスタントです。',
  '与えられたPDFのFAXを読み取り、次の4分類のいずれか1つに判定してください。',
  '',
  '- order:  書籍の注文書。書店・取次からの注文で、書名と数量が並び「注文」「御注文」等の語がある。',
  '- return: 書籍の返品。「返品」「返本」の語や返品伝票の様式を持つもの。',
  '- sales:  その他の営業・宣伝FAX。広告・セールス・案内など、注文でも返品でもないもの。',
  '- unknown: 上記のいずれとも判別できない、または情報不足で自信を持てないもの。',
  '',
  '判断の指針:',
  '- confidence は 0.0〜1.0 で、判定への自信を表す。少しでも迷いがあれば 0.7 未満にすること。',
  '- 注文を返品と取り違えるような誤分類は重大な業務事故になる。無理に order/return へ寄せず、確信が持てなければ unknown を選ぶこと。',
  '- reason は日本語で、判定根拠（読み取れた見出しや文言）を1〜2文で簡潔に述べること。',
].join('\n');

/**
 * PDF Blob を分類する。
 * @param {Blob} blob application/pdf の Blob
 * @return {{category: string, confidence: number, reason: string}}
 */
function classifyFax_(blob) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + CONFIG.MODEL + ':generateContent?key=' + encodeURIComponent(getGeminiApiKey_());

  const payload = {
    systemInstruction: { parts: [{ text: FAX_SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        { text: 'このFAXを分類してください。' },
        { inlineData: { mimeType: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          category:   { type: 'string', enum: ['order', 'return', 'sales', 'unknown'] },
          confidence: { type: 'number' },
          reason:     { type: 'string' },
        },
        required: ['category', 'confidence', 'reason'],
      },
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
  return JSON.parse(text);
}
