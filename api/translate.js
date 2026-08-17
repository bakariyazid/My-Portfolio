const SUPPORTED_LANGUAGES = new Set(['en', 'de', 'fr', 'pt', 'it', 'ar', 'zh-CN', 'ja', 'es', 'ko', 'pl']);

function readBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body || {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { texts, target } = readBody(req.body);
  if (!SUPPORTED_LANGUAGES.has(target) || !Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string')) {
    return res.status(400).json({ error: 'Invalid translation request.' });
  }

  const endpoint = process.env.LIBRETRANSLATE_URL;
  if (!endpoint) {
    return res.status(503).json({ error: 'Translation service is not configured.' });
  }

  try {
    const payload = { q: texts, source: 'en', target, format: 'text' };
    if (process.env.LIBRETRANSLATE_API_KEY) payload.api_key = process.env.LIBRETRANSLATE_API_KEY;

    const translateResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const translateResult = await translateResponse.json().catch(() => ({}));

    if (!translateResponse.ok || !Array.isArray(translateResult.translatedText)) {
      throw new Error(translateResult.error || 'Translation provider error.');
    }

    return res.status(200).json({ translations: translateResult.translatedText });
  } catch (error) {
    console.error('LibreTranslate request failed:', error.message);
    return res.status(502).json({ error: 'Translation provider is unavailable.' });
  }
}