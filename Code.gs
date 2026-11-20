// 會議資料庫：上傳代理（Google Apps Script）
// 指令碼屬性（專案設定 → 指令碼屬性）需設定：
//   PASSWORD = 你的管理密碼
//   TOKEN    = GitHub token（只限 sel-archive，Contents: Read and write）
//   GEMINI_KEY   = （選填）Gemini API 金鑰，開啟 AI 判讀分類時使用
//   GEMINI_MODEL = （選填）模型名稱，預設 gemini-2.5-flash
const REPO = 'cyysongyy/sel-archive';

function out(status, body) {
  return ContentService.createTextOutput(JSON.stringify({ status: status, body: body }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return out(200, { message: 'ok' }); }

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    if (!p.pw || p.pw !== props.getProperty('PASSWORD')) return out(401, { message: '密碼錯誤' });
    if (p.action === 'classify') return classify_(p, props);
    const path = String(p.path || '');
    if (!/^contents\/(files\/[^\/?]+|data\/index\.json)(\?.*)?$/.test(path)) return out(403, { message: '路徑不允許' });
    const method = (p.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') return out(403, { message: '方法不允許' });
    if (method === 'DELETE' && path.indexOf('contents/files/') !== 0) return out(403, { message: '只能刪除 files 內的檔案' });
    const opt = {
      method: method.toLowerCase(),
      headers: {
        Authorization: 'Bearer ' + props.getProperty('TOKEN'),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'sel-archive-proxy'
      },
      muteHttpExceptions: true
    };
    if (method === 'PUT' || method === 'DELETE') { opt.contentType = 'application/json'; opt.payload = p.body; }
    const res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/' + path, opt);
    let body = null;
    try { body = JSON.parse(res.getContentText()); } catch (err) {}
    return out(res.getResponseCode(), body);
  } catch (err) {
    return out(500, { message: String(err) });
  }
}

// AI 判讀：輸入辨識出的文字，回傳 { category, summary, themes[], date }
function classify_(p, props) {
  const key = props.getProperty('GEMINI_KEY');
  if (!key) return out(412, { message: '尚未設定 GEMINI_KEY' });
  const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const cats = (p.categories || []).map(String);
  const themes = (p.themes || []).map(String);
  const prompt =
    '你是學校會議資料庫的整理助理。以下是一份簡報的檔名與辨識出的文字（可能有錯字、雜訊，請自行修正理解）。\n' +
    '請只回傳 JSON，欄位：\n' +
    '- category：必須是這些之一：' + JSON.stringify(cats) + '\n' +
    '- summary：繁體中文，50~90 字，說明這份簡報的重點，不要照抄雜訊\n' +
    '- themes：1~4 個主題標籤，優先從這份參考清單挑選：' + JSON.stringify(themes) + '；清單沒有合適的才可自創（每個 2~8 字）\n' +
    '- date：簡報內容裡明確出現的日期（YYYY-MM-DD），沒有就給空字串\n\n' +
    '檔名：' + String(p.name || '') + '\n文字：\n' + String(p.text || '').slice(0, 6000);
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return out(502, { message: 'AI 服務錯誤 ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 200) });
  try {
    const j = JSON.parse(res.getContentText());
    const t = j.candidates[0].content.parts[0].text;
    return out(200, JSON.parse(t));
  } catch (err) {
    return out(502, { message: 'AI 回傳格式無法解析' });
  }
}
