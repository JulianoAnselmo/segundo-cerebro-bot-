// Wizard genérico pra fluxos multi-step via Telegram inline.
// Cada flow define steps; engine guia user por cada um.
import { Markup } from 'telegraf';

export const WIZARDS = {
  receita: {
    titulo: '💚 Nova receita',
    steps: [
      { key: 'valor', prompt: '💰 Qual o valor?', type: 'number' },
      { key: 'categoria', prompt: '🏷️ Categoria?', type: 'choice', choicesFrom: 'receita_cats' },
      { key: 'descricao', prompt: '✏️ Descrição (ou pule):', type: 'text', optional: true },
      { key: 'data', prompt: '📅 Data?', type: 'choice', choices: ['hoje', 'ontem', 'anteontem', 'outra'], optional: true }
    ]
  },
  cliente: {
    titulo: '🏢 Novo cliente',
    steps: [
      { key: 'nome', prompt: '👤 Nome do cliente?', type: 'text' },
      { key: 'planoMensal', prompt: '💰 Plano mensal (R$)?', type: 'number' },
      { key: 'telefone', prompt: '📱 Telefone (ou pule):', type: 'text', optional: true },
      { key: 'segmento', prompt: '🏷️ Segmento (ou pule):', type: 'text', optional: true }
    ]
  },
  lead: {
    titulo: '🎯 Novo lead',
    steps: [
      { key: 'nome', prompt: '👤 Nome do lead?', type: 'text' },
      { key: 'temperatura', prompt: '🌡️ Temperatura?', type: 'choice', choices: ['frio', 'morno', 'quente'] },
      { key: 'potencial', prompt: '💰 Potencial mensal (R$)?', type: 'number' },
      { key: 'segmento', prompt: '🏷️ Segmento (ou pule):', type: 'text', optional: true }
    ]
  },
  proposta: {
    titulo: '📋 Nova proposta',
    steps: [
      { key: 'cliente', prompt: '🏢 Nome do cliente?', type: 'text' },
      { key: 'valorMensal', prompt: '💰 Valor mensal (R$)?', type: 'number' },
      { key: 'valorSetup', prompt: '🛠️ Valor setup (R$)?', type: 'number' }
    ]
  },
  saldo: {
    titulo: '🏦 Atualizar saldo',
    steps: [
      { key: 'contaSlug', prompt: '🏦 Qual conta?', type: 'choice', choicesFrom: 'contas' },
      { key: 'novoSaldo', prompt: '💰 Novo saldo (R$)?', type: 'number' }
    ]
  },
  pagar: {
    titulo: '✅ Marcar como paga',
    steps: [
      { key: 'despesaSlug', prompt: '💸 Qual despesa fixa?', type: 'choice', choicesFrom: 'fixas_pendentes' }
    ]
  },
  diario: {
    titulo: '📓 Diário',
    steps: [
      { key: 'texto', prompt: '✏️ Escreva sua nota:', type: 'text' }
    ]
  },
  tarefa: {
    titulo: '✅ Tarefa',
    steps: [
      { key: 'texto', prompt: '✏️ Descreva a tarefa:', type: 'text' }
    ]
  }
};

function chunk(arr, n) {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
}

export function stepKeyboard(step, choicesData) {
  const rows = [];
  if (step.type === 'choice') {
    let lista = step.choices;
    if (step.choicesFrom && choicesData[step.choicesFrom]) {
      lista = choicesData[step.choicesFrom];
    }
    rows.push(...chunk(lista.map(c => Markup.button.callback(c, `wiz:val:${c}`)), 3));
  }
  if (step.optional) {
    rows.push([Markup.button.callback('⏭️ Pular', 'wiz:skip')]);
  }
  rows.push([Markup.button.callback('❌ Cancelar', 'wiz:cancel')]);
  return Markup.inlineKeyboard(rows);
}

export function confirmKb() {
  return Markup.inlineKeyboard([[
    Markup.button.callback('✅ Confirmar', 'wiz:confirm'),
    Markup.button.callback('❌ Cancelar', 'wiz:cancel')
  ]]);
}

export function renderResumo(wizName, data) {
  const w = WIZARDS[wizName];
  const linhas = w.steps.map(s => {
    const v = data[s.key];
    if (v == null || v === '') return null;
    const display = s.type === 'number' ? `R$ ${Number(v).toFixed(2)}` : v;
    return `• *${s.prompt.replace(/[💰📱✏️🏷️👤🌡️🏦💸🛠️🏢📅]/g, '').replace(/\?$/, '').trim()}:* ${display}`;
  }).filter(Boolean);
  return `${w.titulo}\n\n${linhas.join('\n')}\n\nConfirmar?`;
}
