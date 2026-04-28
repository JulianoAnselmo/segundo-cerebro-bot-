// Parser linguagem natural — fallback regex; LLM se disponível
import { llm, llmEnabled } from './llm.js';
import { METODOS, DESPESA_CATEGORIAS, RECEITA_CATEGORIAS } from './categories.js';
import { extrairNumero, parseNumeroBR } from './numbers.js';

const SYSTEM = `Você extrai dados financeiros de mensagens em português pra bot de lançamentos.
Responda APENAS JSON válido (sem markdown):
{"acao":"despesa"|"receita"|"desconhecido","valor":number,"metodo":"cartao"|"pix"|"dinheiro"|"boleto"|"transferencia"|"","categoria":"<slug>","descricao":"<texto>","conta":"<banco-ou-vazio>"}
Categorias despesa: ${DESPESA_CATEGORIAS.join(', ')}
Categorias receita: ${RECEITA_CATEGORIAS.join(', ')}
Métodos: pix, cartao (crédito/débito), dinheiro, boleto, transferencia (ted/doc).
Se não interpretar como financeiro, acao="desconhecido".

REGRA descricao: APENAS objeto/motivo. Remova verbos, valor, "reais", preposições, método, conta. Substantivos relevantes.

REGRA conta: banco/conta de onde saiu/entrou ("tirei do nubank", "no inter", "conta itau"). Lowercase, sem prefixo. Se não citar: "".

Exemplos:
- "gastei 75 cartao cabelo" → {"acao":"despesa","valor":75,"metodo":"cartao","categoria":"beleza","descricao":"cabelo","conta":""}
- "gastei 250 pix testosterona tirei do nubank" → {"acao":"despesa","valor":250,"metodo":"pix","categoria":"saude","descricao":"testosterona","conta":"nubank"}
- "recebi 1000 freelance no inter" → {"acao":"receita","valor":1000,"metodo":"transferencia","categoria":"freelance","descricao":"freelance","conta":"inter"}
- "ted 500 aluguel" → {"acao":"despesa","valor":500,"metodo":"transferencia","categoria":"moradia","descricao":"aluguel","conta":""}`;

const RE_CARTAO = /\b(cart[aã]o|cr[eé]dito|d[eé]bito)\b/i;
const RE_PIX = /\bpix\b/i;
const RE_DINHEIRO = /\b(dinheiro|esp[eé]cie|cash)\b/i;
const RE_BOLETO = /\bboleto\b/i;
const RE_TRANSF = /\b(transfer[eê]ncia|transferi|ted|doc)\b/i;

const RE_RECEITA = /\b(recebi|receb[oíi]|salário|salario|ganhei|ganho|vendi|venda|caiu|entrou|rendeu|rendimento|pagaram|recebimento)\b/i;

const BANCOS = ['nubank','inter','itau','bradesco','santander','caixa','c6','next','picpay','pagseguro','will','neon','original','bb','banco-do-brasil','mercado-pago','wise','sicoob','sicredi'];
const RE_CONTA_TRIGGER = new RegExp(
  `\\b(?:do|da|no|na|conta|banco|patrim[oô]nio|tirei\\s+do|tirei\\s+da|saiu\\s+do|saiu\\s+da)\\s+(${BANCOS.join('|').replace(/-/g,'[ -]?')})\\b|\\b(${BANCOS.join('|').replace(/-/g,'[ -]?')})\\b`,
  'i'
);

export async function parseNatural(text) {
  if (!/\d/.test(text)) return { acao: 'desconhecido' };
  if (llmEnabled) {
    try {
      const json = await llm(text, SYSTEM);
      const cleaned = json.replace(/^```json\n?|\n?```$/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.acao !== 'desconhecido' && parsed.valor != null) {
        // Normalize valor (string ou number)
        const v = typeof parsed.valor === 'number' ? parsed.valor : parseNumeroBR(parsed.valor);
        if (Number.isNaN(v) || v <= 0) return parseRegex(text);
        parsed.valor = v;
        // Override metodo via regex texto cru (LLM erra muito aqui)
        const metodoRaw = detectarMetodo(text);
        if (metodoRaw) parsed.metodo = metodoRaw;
        // Override conta se LLM deu vazio
        if (!parsed.conta) {
          const c = detectarConta(text);
          if (c) parsed.conta = c;
        } else {
          parsed.conta = String(parsed.conta).toLowerCase().trim();
        }
        return parsed;
      }
    } catch (e) {
      console.error('LLM parse falhou, fallback regex:', e.message);
    }
  }
  return parseRegex(text);
}

function detectarMetodo(text) {
  if (RE_CARTAO.test(text)) return 'cartao';
  if (RE_PIX.test(text)) return 'pix';
  if (RE_TRANSF.test(text)) return 'transferencia';
  if (RE_BOLETO.test(text)) return 'boleto';
  if (RE_DINHEIRO.test(text)) return 'dinheiro';
  return '';
}

function detectarConta(text) {
  const lower = text.toLowerCase();
  // Match com gatilho
  for (const b of BANCOS) {
    const re = new RegExp(`\\b(?:do|da|no|na|conta|banco|patrim[oô]nio|tirei|saiu|debitei)\\s+(?:do\\s+|da\\s+|no\\s+|na\\s+|conta\\s+|banco\\s+|patrim[oô]nio\\s+)?${b.replace(/-/g, '[ -]?')}\\b`, 'i');
    if (re.test(lower)) return b;
  }
  // Match isolado (só pra bancos não-ambíguos — exclui "caixa" que pode ser palavra comum)
  const naoAmbiguos = BANCOS.filter(b => !['caixa','bb','original','will','next'].includes(b));
  for (const b of naoAmbiguos) {
    const re = new RegExp(`\\b${b.replace(/-/g, '[ -]?')}\\b`, 'i');
    if (re.test(lower)) return b;
  }
  return '';
}

function parseRegex(text) {
  const num = extrairNumero(text);
  if (!num) return { acao: 'desconhecido' };

  const lower = text.toLowerCase();
  const metodo = detectarMetodo(text) || 'pix';
  const acao = RE_RECEITA.test(text) ? 'receita' : 'despesa';

  const lista = acao === 'receita' ? RECEITA_CATEGORIAS : DESPESA_CATEGORIAS;
  let categoria = 'outros';
  for (const c of lista) if (lower.includes(c)) { categoria = c; break; }
  if (categoria === 'outros') categoria = heuristicaCategoria(lower, acao);

  return {
    acao,
    valor: num.valor,
    metodo,
    categoria,
    descricao: cleanDescricao(text, metodo),
    conta: detectarConta(text)
  };
}

function heuristicaCategoria(lower, acao) {
  if (acao === 'receita') {
    if (/\b(sal[aá]rio|holerite|contracheque)\b/.test(lower)) return 'salario';
    if (/\b(freelance|freela|projeto|servi[cç]o)\b/.test(lower)) return 'freelance';
    if (/\b(cliente|empresa|mensalidade|mrr)\b/.test(lower)) return 'empresa';
    if (/\b(rendeu|rendimento|cdb|tesouro|dividendo|juros|cripto)\b/.test(lower)) return 'investimento-rendimento';
    if (/\b(vendi|venda)\b/.test(lower)) return 'venda';
    if (/\b(presente|gift|deram)\b/.test(lower)) return 'presente-recebido';
    return 'outros';
  }
  if (/\b(mercado|supermercado|padaria|feira|comida|restaurante|lanche|caf[eé]|almo[cç]o|jantar|ifood|rappi|pizza|hamburguer|hambúrguer|açai|açaí)\b/.test(lower)) return 'alimentacao';
  if (/\b(uber|99|taxi|gasolina|combust[ií]vel|metr[oô]|onibus|ônibus|estacionamento|pneu|oficina|carro|moto)\b/.test(lower)) return 'transporte';
  if (/\b(rem[eé]dio|farm[aá]cia|m[eé]dico|consulta|exame|dentista|psic[oó]logo|terapia|hospital|plano de sa[uú]de|wellhub|gympass|academia|suplemento|whey|testosterona|vitamina)\b/.test(lower)) return 'saude';
  if (/\b(cinema|netflix|spotify|youtube|disney|prime|hbo|jogo|game|steam|playstation|xbox|bar|festa|show|ingresso)\b/.test(lower)) return 'lazer';
  if (/\b(curso|livro|udemy|alura|mentoria|aula|faculdade)\b/.test(lower)) return 'educacao';
  if (/\b(roupa|cal[cç]a|camisa|tenis|tênis|sapato|jaqueta)\b/.test(lower)) return 'vestuario';
  if (/\b(presente|aniversario|anivers[aá]rio)\b/.test(lower)) return 'presente';
  if (/\b(icloud|apple|google|chatgpt|claude|github|spotify|netflix|prime|disney|youtube)\b/.test(lower)) return 'assinatura';
  if (/\b(luz|energia|[aá]gua|g[aá]s|internet|aluguel|condom[ií]nio|iptu|telefone|celular)\b/.test(lower)) return 'conta-fixa';
  if (/\b(ra[cç][aã]o|veterin[aá]rio|pet|cachorro|gato)\b/.test(lower)) return 'pet';
  if (/\b(cabelo|barbeiro|manicure|sobrancelha|sobrancelhas|sombrancelha|maquiagem|estética|estetica|spa)\b/.test(lower)) return 'beleza';
  if (/\b(notebook|celular|monitor|teclado|mouse|fone|cabo|hd|ssd|pc|computador)\b/.test(lower)) return 'tecnologia';
  if (/\b(investimento|aplica[cç][aã]o|cdb|tesouro|a[cç][aã]o|cripto)\b/.test(lower)) return 'investimento';
  if (/\b(imposto|ipva|iptu|ir|leão|leao|darf)\b/.test(lower)) return 'imposto';
  return 'outros';
}

function cleanDescricao(text, metodo) {
  let s = ' ' + text.toLowerCase() + ' ';
  s = s.replace(/\b(gastei|gasto|gastou|paguei|pago|pagou|comprei|compra|recebi|recebido|recebimento|ganhei|ganho|sal[aá]rio|investi|investido|transferi|tirei|saquei|debitei|paguei|caiu|entrou|rendeu|vendi)\b/g, ' ');
  s = s.replace(/\br?\$\s*[\d.,]+/g, ' ');
  s = s.replace(/\b[\d.,]+\s*(reais|real|conto|contos|pila|pilas)\b/g, ' ');
  s = s.replace(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b/g, ' ');
  s = s.replace(/\b\d+[.,]\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d+\b/g, ' ');
  if (metodo) s = s.replace(new RegExp(`\\b${metodo}\\b`, 'g'), ' ');
  s = s.replace(/\b(cart[aã]o|cr[eé]dito|d[eé]bito|ted|doc|esp[eé]cie|boleto)\b/g, ' ');
  // Remove bancos
  for (const b of BANCOS) s = s.replace(new RegExp(`\\b${b.replace(/-/g, '[ -]?')}\\b`, 'g'), ' ');
  s = s.replace(/\bpatrim[oô]nio\b/g, ' ');
  // Preposições
  s = s.replace(/\b(no|na|nos|nas|com|em|de|do|da|dos|das|pra|para|por|pelo|pela|ao|aos|à|às)\b/g, ' ');
  // Conjunções de transição (preserva "e"/"ou" pra frases compostas)
  s = s.replace(/\b(tirei|saquei)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s || text.trim();
}
