// utils/nameTransliteration.js
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const hasArabic = (s="") => /[\u0600-\u06FF]/.test(s);
const hasLatin  = (s="") => /[A-Za-z]/.test(s);
const looksLikeName = (s="") => /^[\p{L}\s'.-]{2,60}$/u.test((s||"").trim());
const toTitleCase = (name="") =>
  name.trim().replace(/\s+/g," ").split(" ")
    .map(w => w ? w[0].toUpperCase()+w.slice(1).toLowerCase() : "")
    .join(" ");

async function transliterateArabicNameToEnglish(arName) {
  if (!arName || !hasArabic(arName) || !looksLikeName(arName)) return null;

  const system = `
You are an Arabic→English personal-name transliteration engine.
- Output ONLY the English transliteration of the PERSONAL NAME.
- No explanations.
- Use common spellings, Title Case each part (e.g., "Mohammad Ahmed", "Sara Al-Najjar").
- Max 60 chars.
If input isn't a name, output: UNKNOWN
`.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: process.env.NAME_TRANSLIT_MODEL || "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role:"system", content: system },
        { role:"user", content: arName }
      ]
    });
    const out = (resp.choices?.[0]?.message?.content || "").trim();
    if (!out || /unknown/i.test(out)) return null;

    const normalized = toTitleCase(out.replace(/[^\p{L}\s'.-]/gu,""));
    if (!hasLatin(normalized) || !looksLikeName(normalized)) return null;

    return { nameEn: normalized, confidence: 0.9 };
  } catch (e) {
    console.error("Transliteration error:", e.message);
    return null;
  }
}

module.exports = { transliterateArabicNameToEnglish, hasArabic, hasLatin, looksLikeName };
