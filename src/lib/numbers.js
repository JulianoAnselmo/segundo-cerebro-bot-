// Parsing robusto de números BR. Aceita "20.152.48", "20.152,48", "20152,48", "20152.48", "1.234", "50".
export function parseNumeroBR(s) {
  s = String(s).replace(/[R$\s]/gi, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  if (last === -1) return parseFloat(s);
  const intPart = s.slice(0, last).replace(/[.,]/g, '');
  const decPart = s.slice(last + 1);
  if (decPart.length === 0 || decPart.length > 2) return parseFloat(s.replace(/[.,]/g, ''));
  return parseFloat(intPart + '.' + decPart);
}

// Extrai primeiro número da string. Retorna { valor, raw, idx } ou null.
export function extrairNumero(text) {
  const m = String(text).match(/r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  if (!m) return null;
  const valor = parseNumeroBR(m[1]);
  if (Number.isNaN(valor)) return null;
  return { valor, raw: m[0], idx: m.index };
}
