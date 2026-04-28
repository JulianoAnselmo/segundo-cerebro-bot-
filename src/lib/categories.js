// Whitelist + fuzzy match
export const DESPESA_CATEGORIAS = [
  'alimentacao', 'transporte', 'moradia', 'saude', 'lazer', 'educacao',
  'vestuario', 'presente', 'assinatura', 'conta-fixa', 'pet', 'beleza',
  'tecnologia', 'investimento', 'imposto', 'outros'
];

export const RECEITA_CATEGORIAS = [
  'salario', 'freelance', 'empresa', 'investimento-rendimento',
  'presente-recebido', 'venda', 'outros'
];

export const METODOS = ['cartao', 'pix', 'dinheiro', 'boleto', 'transferencia'];

// Levenshtein distance simples
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function matchCategoria(input, lista = DESPESA_CATEGORIAS) {
  const n = normalize(input);
  if (lista.includes(n)) return { match: n, exact: true };
  // prefix match primeiro
  const prefix = lista.find(c => c.startsWith(n));
  if (prefix && n.length >= 3) return { match: prefix, exact: false, reason: 'prefix' };
  // fuzzy
  let best = null, bestDist = Infinity;
  for (const c of lista) {
    const d = lev(n, c);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (best && bestDist <= 2) return { match: best, exact: false, reason: 'fuzzy', dist: bestDist };
  return { match: null, sugestoes: lista.filter(c => lev(n, c) <= 4).slice(0, 5) };
}
