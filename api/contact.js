function readBody(body) {
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body || {};
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function detectLanguage(text) {
  if (/[؀-ۿ]/.test(text)) return 'Arabic';
  if (/[一-鿿]/.test(text)) return 'Chinese';
  if (/[぀-ヿ]/.test(text)) return 'Japanese';
  if (/[가-힯]/.test(text)) return 'Korean';
  if (/[Ѐ-ӿ]/.test(text)) return 'Cyrillic language';
  return 'Auto-detected language';
}

async function getOriginalLanguage(text) {
  if (!process.env.LIBRETRANSLATE_URL) return detectLanguage(text);
  try {
    const detectUrl = process.env.LIBRETRANSLATE_URL.replace(/\/translate\/?$/, '/detect');
    const response = await fetch(detectUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}) })
    });
    const result = await response.json();
    const code = Array.isArray(result) ? result[0]?.language : result?.[0]?.language;
    const names = { ar: 'Arabic', en: 'English', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese', it: 'Italian', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa' };
    return names[code] || code || detectLanguage(text);
  } catch { return detectLanguage(text); }
}

async function translateToEnglish(text) {
  if (!process.env.LIBRETRANSLATE_URL) return text;
  const response = await fetch(process.env.LIBRETRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'auto', target: 'en', format: 'text', ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.translatedText !== 'string') throw new Error('Translation provider error.');
  return result.translatedText;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { name, email, phone, message } = readBody(req.body);
  if (![name, email, phone, message].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'Please complete every contact field.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (!process.env.BREVO_API_KEY || !process.env.CONTACT_RECIPIENT_EMAIL || !process.env.BREVO_SENDER_EMAIL) {
    console.error('[contact] Missing configuration:', {
      hasBrevoApiKey: Boolean(process.env.BREVO_API_KEY),
      hasRecipient: Boolean(process.env.CONTACT_RECIPIENT_EMAIL),
      hasSender: Boolean(process.env.BREVO_SENDER_EMAIL)
    });
    return res.status(503).json({ error: 'Email delivery is not configured yet.' });
  }

  try {
    const originalLanguage = await getOriginalLanguage(`${name} ${message}`);
    const [englishName, englishMessage] = await Promise.all([translateToEnglish(name.trim()), translateToEnglish(message.trim())]);
    const safe = Object.fromEntries(Object.entries({ name: englishName, email, phone, message: englishMessage }).map(([key, value]) => [key, escapeHtml(value.trim())]));
    const whatsappMessage = `Hello Bakari,\n\nNew portfolio enquiry (original language: ${originalLanguage}; translated to English).\n\nName: ${englishName}\nEmail: ${email.trim()}\nPhone: ${phone.trim()}\n\nMessage:\n${englishMessage}`;
    const logoUrl = process.env.EMAIL_LOGO_URL;
    const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="76" height="76" alt="BYA TECH & DESIGN" style="display:block;width:76px;height:76px;border:0;border-radius:50%;margin:0 auto 14px;">` : '';
    const emailHtml = `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f6fb;font-family:Arial,sans-serif;color:#172033;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;"><tr><td align="center" style="padding:32px;background:#1457bb;color:#fff;">${logo}<div style="font-size:20px;font-weight:700;">BYA TECH &amp; DESIGN</div><div style="margin-top:6px;font-size:13px;">New portfolio enquiry</div></td></tr><tr><td style="padding:30px 32px;"><div style="color:#1553a8;font-size:12px;font-weight:700;">ORIGINAL LANGUAGE: ${escapeHtml(originalLanguage)} · TRANSLATED TO ENGLISH</div><h1 style="margin:22px 0;font-size:24px;">New message from ${safe.name}</h1><p><strong>Email:</strong> <a href="mailto:${safe.email}" style="color:#1e63d5;">${safe.email}</a></p><p><strong>Phone:</strong> ${safe.phone}</p><div style="margin-top:24px;padding:18px;border-left:4px solid #1e63d5;background:#f7faff;"><div style="margin-bottom:8px;color:#667085;font-size:12px;font-weight:700;">MESSAGE</div><div style="line-height:1.65;">${safe.message.replace(/\n/g, '<br>')}</div></div></td></tr><tr><td align="center" style="padding:18px;background:#f8fafc;color:#8a94a6;font-size:12px;">Sent from your BYA TECH &amp; DESIGN portfolio contact form</td></tr></table></td></tr></table></body></html>`;
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || 'BYA TECH & DESIGN', email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: process.env.CONTACT_RECIPIENT_EMAIL }],
        replyTo: { name: name.trim(), email: email.trim() },
        subject: `New portfolio enquiry from ${englishName}`,
        textContent: whatsappMessage,
        htmlContent: emailHtml
      })
    });
    if (!brevoResponse.ok) {
      const brevoError = await brevoResponse.text();
      console.error('[contact] Brevo rejected the email:', { status: brevoResponse.status, body: brevoError });
      throw new Error(`Brevo returned HTTP ${brevoResponse.status}`);
    }
    return res.status(200).json({ ok: true, whatsappMessage });
  } catch (error) {
    console.error('[contact] Delivery failed:', error.message);
    return res.status(502).json({ error: 'We could not send your message. Please try again.', debug: error.message });
  }
};
