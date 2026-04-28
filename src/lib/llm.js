// Wrapper Claude API — opcional, ativa se ANTHROPIC_API_KEY definida
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

export const llmEnabled = !!KEY;

export async function llm(prompt, system = '') {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export async function llmTranscribe(audioBuffer) {
  // Anthropic não tem Whisper; usar OpenAI Whisper se OPENAI_API_KEY definida
  const OK = process.env.OPENAI_API_KEY;
  if (!OK) throw new Error('OPENAI_API_KEY não configurada (necessária pra transcrição voice)');
  const fd = new FormData();
  fd.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  fd.append('model', 'whisper-1');
  fd.append('language', 'pt');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OK}` },
    body: fd
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.text || '';
}

export async function llmVisionParse(imageBuffer, mimeType = 'image/jpeg') {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const b64 = Buffer.from(imageBuffer).toString('base64');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
          { type: 'text', text: 'Extraia desta foto de cupom fiscal os campos: valor_total (number), estabelecimento (string), categoria_sugerida (alimentacao|transporte|saude|lazer|outros), data (YYYY-MM-DD se visível). Responda APENAS JSON válido, sem markdown.' }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`Vision ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try { return JSON.parse(text.replace(/^```json\n?|\n?```$/g, '')); }
  catch { return null; }
}
