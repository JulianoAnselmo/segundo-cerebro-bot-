// Parser linguagem natural — fallback regex; LLM se disponível
import { llm, llmEnabled } from './llm.js';
import { matchCategoria, METODOS, DESPESA_CATEGORIAS, RECEITA_CATEGORIAS } from './categories.js';

const SYSTEM = `Você extrai dados financeiros de mensagens em português do usuário pra um bot que cria lançamentos.
Responda APENAS JSON válido (sem markdown), no formato:
{"acao":"despesa"|"receita"|"desconhecido","valor":number,"metodo":"cartao"|"pix"|"dinheiro"|"boleto"|"transferencia"|"","categoria":"<slug>","descricao":"<texto>"}
Categorias despesa: ${DESPESA_CATEGORIAS.join(', ')}
Categorias receita: ${RECEITA_CATEGORIAS.join(', ')}
Se não conseguir interpretar como financeiro, use acao="desconhecido".
Métodos quando não claro: pix.

REGRA descricao: extraia APENAS o objeto/motivo do gasto. Remova verbos (gastei, paguei, comprei, recebi), valor, palavra "reais", preposições (no, na, com, em, de), e método. Mantenha só substantivos relevantes.
Exemplos:
- "gastei 75 reais no cartao cabelo e sombrancelha" → descricao: "cabelo e sombrancelha"
- "paguei 30 pix mercado almoço" → descricao: "mercado almoço"
- "uber 20 reais" → descricao: "uber"
- "recebi 1000 freelance design" → descricao: "freelance design"`;

export async function parseNatural(text) {
  // Sem dígitos no texto = não é lançamento. Evita hallucination LLM.
  if (!/\d/.test(text)) return { acao: 'desconhecido' };
  if (llmEnabled) {
    try {
      const json = await llm(text, SYSTEM);
      const cleaned = json.replace(/^```json\n?|\n?```$/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.acao !== 'desconhecido' && typeof parsed.valor === 'number') {
        // Override metodo: regex texto cru sobrescreve LLM se citar cartao/credito/debito
        const lower = text.toLowerCase();
        if (lower.match(/\b(cartao|cartão|crédito|credito|débito|debito)\b/)) parsed.metodo = 'cartao';
        return parsed;
      }
    } catch (e) {
      console.error('LLM parse falhou, fallback regex:', e.message);
    }
  }
  return parseRegex(text);
}

function parseRegex(text) {
  const lower = text.toLowerCase();
  // valor: aceita 50, 50.30, 50,30, 1.234,56, R$ 50
  const valorMatch = lower.match(/r?\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)/);
  if (!valorMatch) return { acao: 'desconhecido' };
  const valor = parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(valor)) return { acao: 'desconhecido' };

  let metodo = '';
  for (const m of METODOS) if (lower.includes(m)) { metodo = m; break; }
  if (!metodo && lower.match(/\b(crédito|credito|débito|debito)\b/)) metodo = 'cartao';

  const acao = lower.match(/\b(receb|recebi|salário|salario|ganhei)\b/) ? 'receita' : 'despesa';

  const lista = acao === 'receita' ? RECEITA_CATEGORIAS : DESPESA_CATEGORIAS;
  let categoria = 'outros';
  for (const c of lista) if (lower.includes(c)) { categoria = c; break; }
  // heurísticas comuns
  if (categoria === 'outros') {
    if (lower.match(/\bmercado|comida|restaurante|lanche|café|cafe|almoço|jantar/)) categoria = 'alimentacao';
    else if (lower.match(/\buber|99|gasolina|combustivel|combustível|metro|metrô|onibus|ônibus/)) categoria = 'transporte';
    else if (lower.match(/\bremedio|remédio|farmacia|farmácia|medico|médico|consulta/)) categoria = 'saude';
    else if (lower.match(/\bcinema|netflix|spotify|jogo|bar/)) categoria = 'lazer';
  }

  return {
    acao,
    valor,
    metodo: metodo || 'pix',
    categoria,
    descricao: cleanDescricao(text, valor, metodo)
  };
}

function cleanDescricao(text, valor, metodo) {
  let s = ' ' + text.toLowerCase() + ' ';
  // Remove verbos comuns
  s = s.replace(/\b(gastei|gasto|paguei|pago|pagou|comprei|compra|gastou|gasto|recebi|recebido|recebimento|ganhei|ganho|salario|salário|investi|investido|transferi)\b/g, ' ');
  // Remove valor: aceita "R$ 1.234,56", "$50", "50 reais", "50,30", "50.30", "1000"
  s = s.replace(/\br?\$\s*[\d.,]+/g, ' ');
  s = s.replace(/\b[\d.,]+\s*(reais|real|conto|contos|pila|pilas)\b/g, ' ');
  s = s.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g, ' ');
  s = s.replace(/\b\d+[.,]\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d+\b/g, ' ');
  // Remove método
  if (metodo) s = s.replace(new RegExp(`\\b${metodo}\\b`, 'g'), ' ');
  s = s.replace(/\b(crédito|credito|débito|debito)\b/g, ' ');
  // Remove preposições isoladas (mantém "e"/"ou" pra não quebrar "cabelo e sombrancelha")
  s = s.replace(/\b(no|na|nos|nas|com|em|de|do|da|dos|das|pra|para|por|pelo|pela)\b/g, ' ');
  // Remove conectores que sobraram no início/fim
  s = s.replace(/\s+/g, ' ').trim();
  return s || text.trim();
}
