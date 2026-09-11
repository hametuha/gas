/**
 * Gemini 呼び出しの共通処理と、FAX分類。
 *
 * PDFを base64 で inlineData に載せ、構造化出力(JSON)を得る。
 * 受注明細の抽出は OrderGemini.js（プロンプトもスキーマも別物）。
 */

/** 一時的な障害とみなしてリトライするHTTPステータス。 */
const GEMINI_RETRIABLE = [429, 500, 502, 503, 504];

/** リトライ回数と初回待機(ms)。待機は倍々に伸ばす。 */
const GEMINI_MAX_ATTEMPTS = 4;
const GEMINI_BACKOFF_MS = 2000;

/**
 * Gemini の generateContent を叩き、構造化出力のJSONを返す。
 *
 * 503（モデル過負荷）は実運用で普通に起きる。ここで諦めると
 * その回のFAXが丸ごと未処理になるため、指数バックオフで粘る。
 * 恒久的なエラー（400番台の設定ミス等）は即座に投げる。
 *
 * @param {Object} payload generateContent のリクエストボディ
 * @return {Object} パース済みの構造化出力
 */
function callGemini_(payload) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + CONFIG.MODEL + ':generateContent?key=' + encodeURIComponent(getGeminiApiKey_());

  let lastError = '';
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();

    if (code === 200) {
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

    lastError = 'Gemini API エラー (' + code + '): ' + res.getContentText();
    if (GEMINI_RETRIABLE.indexOf(code) === -1) {
      throw new Error(lastError); // 設定ミス等。粘っても直らない。
    }
    if (attempt < GEMINI_MAX_ATTEMPTS) {
      const wait = GEMINI_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn('Gemini が ' + code + ' を返したので ' + wait + 'ms 待って再試行します（'
        + attempt + '/' + (GEMINI_MAX_ATTEMPTS - 1) + '）。');
      Utilities.sleep(wait);
    }
  }
  throw new Error(lastError + '（' + GEMINI_MAX_ATTEMPTS + '回試行しても復旧せず）');
}

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
  return callGemini_({
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
  });
}
