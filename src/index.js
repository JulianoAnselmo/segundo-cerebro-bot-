import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import {
  criarLancamento, atualizarSaldoConta, marcarFixaPaga,
  criarCliente, criarLead, criarProposta, appendDiario,
  lerStatus, lerSaldos, lerResumo, removerLancamento,
  lerContasSlugs, lerFixasPendentesSlugs, criarSnapshotPatrimonio
} from './notes.js';
import { gitPullCommitPush } from './git.js';
import { log } from './lib/log.js';
import { rateLimit } from './lib/ratelimit.js';
import { matchCategoria, METODOS, DESPESA_CATEGORIAS, RECEITA_CATEGORIAS } from './lib/categories.js';
import { recordUndo, undoLast } from './lib/undo.js';
import { loadTemplates, saveTemplate, deleteTemplate } from './lib/templates.js';
import { categoriaKeyboard, metodoKeyboard, confirmKeyboard, descricaoKeyboard } from './lib/keyboards.js';
import { parseNatural } from './lib/parse.js';
import { extractDate, extractNaturalDate } from './lib/dateparse.js';
import { WIZARDS, stepKeyboard, confirmKb, renderResumo } from './lib/wizard.js';
import { llmEnabled, llmTranscribe, llmVisionParse } from './lib/llm.js';
import { scheduleNotifications } from './lib/notifications.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VAULT = process.env.VAULT_PATH;
const BRANCH = process.env.VAULT_BRANCH || 'main';
const AUTO_PUSH = (process.env.AUTO_PUSH || 'true') === 'true';
const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !VAULT) {
  console.error('Faltando TELEGRAM_BOT_TOKEN ou VAULT_PATH no .env');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// Helpers
const brl = n => {
  const [i, d] = Number(n).toFixed(2).split('.');
  return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};

// Estado em memória por user (pra fluxos multi-step inline)
const SESSION = new Map();
function setSess(id, data) { SESSION.set(String(id), { ...data, ts: Date.now() }); }
function getSess(id) {
  const s = SESSION.get(String(id));
  if (!s) return null;
  if (Date.now() - s.ts > 5 * 60 * 1000) { SESSION.delete(String(id)); return null; }
  return s;
}
function clearSess(id) { SESSION.delete(String(id)); }

// Auth + log + rate limit
bot.use(async (ctx, next) => {
  const id = String(ctx.from?.id || '');
  if (ALLOWED.length && !ALLOWED.includes(id)) {
    log.warn(`[BLOCK] user_id=${id} username=${ctx.from?.username}`);
    return ctx.reply(`Não autorizado. Seu ID: ${id}`);
  }
  log.info(`${ctx.from?.username || id}: ${ctx.message?.text || ctx.callbackQuery?.data || ctx.updateType}`);
  return next();
});
bot.use(rateLimit());

// Auto-push helper
async function commitIfNeeded(message) {
  if (!AUTO_PUSH) return { committed: false };
  try { return await gitPullCommitPush(VAULT, BRANCH, message); }
  catch (e) { log.error(`git push falhou: ${e.message}`); return { committed: false, error: e.message }; }
}

function pushSuffix(r) {
  if (!AUTO_PUSH) return '';
  if (r.error) return `\n⚠️ git falhou: ${r.error}`;
  return r.committed ? `\n☁️ git push ok` : '';
}

// ============ START / HELP ============

bot.start(ctx => ctx.reply(
  `Olá! Bot do Segundo Cérebro v2.\n\nSeu Telegram ID: \`${ctx.from.id}\`\n\n` +
  `*Linguagem natural:* manda "gastei 50 no mercado pix" — eu entendo${llmEnabled ? ' (com IA)' : ''}.\n\n` +
  `*Comandos:* /help`,
  { parse_mode: 'Markdown' }
));

bot.help(ctx => ctx.reply(
  `📒 *Comandos v2*\n\n` +
  `🪄 *Modo guiado:* manda comando sem args → bot pergunta passo a passo via botões.\nEx: \`/cliente\` · \`/lead\` · \`/proposta\` · \`/receita\` · \`/saldo\` · \`/pagar\` · \`/diario\` · \`/tarefa\`\n\n` +
  `*💸 Despesas:*\n` +
  `\`/cartao /pix /dinheiro /boleto <valor> [cat] [desc]\`\n` +
  `\`/gasto <valor> [met] [cat] [desc]\`\n` +
  `Sem args extras → escolho categoria/método via botões\n\n` +
  `*💰 Receita:* \`/receita <valor> [cat] [desc]\`\n\n` +
  `*🏦 Contas:*\n` +
  `\`/saldo <slug> <valor>\`  ·  \`/saldos\`  ·  \`/pagar <slug>\`\n` +
  `\`/patrimonio\` — soma contas e cria snapshot · \`/patrimonio <valor>\` — manual\n\n` +
  `*🏢 Empresa:*\n` +
  `\`/cliente <nome> <plano> [tel] [seg]\`\n` +
  `\`/lead <nome> <frio|morno|quente> <potencial> [seg]\`\n` +
  `\`/proposta <cliente> <mensal> <setup>\`\n\n` +
  `*📓 Diário:*  \`/diario <texto>\`  ·  \`/tarefa <texto>\`\n\n` +
  `*📊 Dashboards:*\n` +
  `\`/status\` · \`/resumo [hoje|semana|mes]\`\n\n` +
  `*⚡ Templates:*\n` +
  `\`/cafe\` · \`/almoco\` · \`/uber\` · \`/mercado\` · \`/gas\`\n` +
  `\`/template add <nome> <valor> <met> <cat> <desc>\`\n` +
  `\`/template list\` · \`/template del <nome>\`\n\n` +
  `*📅 Data:* adiciona \`@DD/MM\`, \`@DD/MM/YYYY\`, \`@hoje\`, \`@ontem\`, \`@anteontem\` em qualquer comando. Padrão: hoje.\n\n` +
  `*↩️ Outros:*  \`/undo\`\n\n` +
  `*🤖 Inteligência:*\n` +
  `• Texto natural: "gastei 50 mercado pix"\n` +
  `• Áudio: manda voice — eu transcrevo\n` +
  `• Foto cupom: manda imagem — eu extraio`,
  { parse_mode: 'Markdown' }
));

// ============ DESPESAS / RECEITAS ============

async function lancarComArgs(ctx, { natureza, valor, metodo, categoria, descricao, data, userId }) {
  // Valida categoria
  const lista = natureza === 'receita' ? RECEITA_CATEGORIAS : DESPESA_CATEGORIAS;
  const m = matchCategoria(categoria, lista);
  if (!m.match) {
    return ctx.reply(`❓ Categoria "${categoria}" não reconhecida.\nSugestões: ${m.sugestoes?.join(', ') || lista.slice(0, 5).join(', ')}`);
  }
  if (!m.exact) {
    log.info(`Categoria "${categoria}" → "${m.match}" (${m.reason})`);
  }
  categoria = m.match;

  const { fileName, filePath } = await criarLancamento(VAULT, {
    natureza, valor, categoria, metodo: metodo || '', conta: '', descricao, data
  });
  recordUndo(userId, { tipo: 'create_file', filePath });

  const r = await commitIfNeeded(`bot: ${natureza} ${metodo || ''} ${brl(valor)} ${categoria}`);
  const icon = natureza === 'receita' ? '💚' : '💸';
  const dataMsg = data ? ` 📅 ${data.split('-').reverse().join('/')}` : '';
  return ctx.reply(`${icon} ${natureza} ${brl(valor)}${metodo ? ` (${metodo})` : ''} — ${categoria}${dataMsg}\n📄 ${fileName}${pushSuffix(r)}`);
}

async function lancarDespesa(ctx, metodo) {
  const raw = ctx.message.text.split(' ').slice(1);
  const { dataISO, args } = extractDate(raw);
  const userId = String(ctx.from.id);
  if (args.length === 0) return ctx.reply(`Uso: /${metodo} <valor> [categoria] [descrição] [@DD/MM]`);
  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  if (args.length === 1) {
    setSess(userId, { fluxo: 'despesa', valor, metodo, data: dataISO });
    return ctx.reply(`💸 ${brl(valor)} (${metodo}) — escolha categoria:`, categoriaKeyboard('despesa', 'desp'));
  }

  const categoria = args[1];
  const descricao = args.slice(2).join(' ') || categoria;
  return lancarComArgs(ctx, { natureza: 'despesa', valor, metodo, categoria, descricao, data: dataISO, userId });
}

bot.command('gasto', async ctx => {
  const raw = ctx.message.text.split(' ').slice(1);
  const { dataISO, args } = extractDate(raw);
  const userId = String(ctx.from.id);
  if (args.length === 0) return ctx.reply(`Uso: /gasto <valor> [metodo] [categoria] [descrição] [@DD/MM]`);
  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  if (args.length === 1) {
    setSess(userId, { fluxo: 'despesa', valor, data: dataISO });
    return ctx.reply(`💸 ${brl(valor)} — escolha método:`, metodoKeyboard('desp'));
  }

  const metodo = args[1].toLowerCase();
  if (!METODOS.includes(metodo)) return ctx.reply(`Método inválido: ${metodo}\nUse: ${METODOS.join(', ')}`);

  if (args.length === 2) {
    setSess(userId, { fluxo: 'despesa', valor, metodo, data: dataISO });
    return ctx.reply(`💸 ${brl(valor)} (${metodo}) — escolha categoria:`, categoriaKeyboard('despesa', 'desp'));
  }

  const categoria = args[2];
  const descricao = args.slice(3).join(' ') || categoria;
  return lancarComArgs(ctx, { natureza: 'despesa', valor, metodo, categoria, descricao, data: dataISO, userId });
});

for (const m of METODOS) {
  bot.command(m, ctx => lancarDespesa(ctx, m));
}

bot.command('receita', async ctx => {
  const raw = ctx.message.text.split(' ').slice(1);
  const { dataISO, args } = extractDate(raw);
  const userId = String(ctx.from.id);
  if (args.length === 0) return startWizard(ctx, 'receita');
  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  if (args.length === 1) {
    setSess(userId, { fluxo: 'receita', valor, data: dataISO });
    return ctx.reply(`💚 ${brl(valor)} — escolha categoria:`, categoriaKeyboard('receita', 'rec'));
  }
  const categoria = args[1];
  const descricao = args.slice(2).join(' ') || categoria;
  return lancarComArgs(ctx, { natureza: 'receita', valor, categoria, descricao, data: dataISO, userId });
});

// ============ WIZARD ENGINE ============

async function buildChoicesData() {
  return {
    receita_cats: RECEITA_CATEGORIAS,
    despesa_cats: DESPESA_CATEGORIAS,
    metodos: METODOS,
    contas: await lerContasSlugs(VAULT),
    fixas_pendentes: await lerFixasPendentesSlugs(VAULT)
  };
}

async function startWizard(ctx, name) {
  const w = WIZARDS[name];
  if (!w) return ctx.reply(`Wizard ${name} não existe`);
  const userId = String(ctx.from.id);
  setSess(userId, { wizard: name, step: 0, data: {} });
  return askStep(ctx, name, 0);
}

async function askStep(ctx, name, idx) {
  const w = WIZARDS[name];
  const step = w.steps[idx];
  if (!step) return finalizeWizard(ctx, name);
  const choicesData = await buildChoicesData();
  const lista = step.choicesFrom ? choicesData[step.choicesFrom] : (step.choices || []);
  if (step.type === 'choice' && lista.length === 0) {
    await ctx.reply(`⚠️ Nenhuma opção disponível para "${step.key}"`);
    clearSess(String(ctx.from.id));
    return;
  }
  const txt = `${w.titulo} *(${idx + 1}/${w.steps.length})*\n\n${step.prompt}`;
  return ctx.reply(txt, { parse_mode: 'Markdown', ...stepKeyboard(step, choicesData) });
}

async function advanceWizard(ctx, value) {
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || !sess.wizard) return false;
  const w = WIZARDS[sess.wizard];
  const step = w.steps[sess.step];
  if (!step) return false;
  if (step.type === 'number') {
    const n = parseFloat(String(value).replace(',', '.'));
    if (Number.isNaN(n)) { await ctx.reply(`Valor inválido: ${value}`); return true; }
    sess.data[step.key] = n;
  } else if (step.key === 'data') {
    if (value === 'hoje' || value === 'ontem' || value === 'anteontem') {
      const { dataISO } = extractDate(['@' + value]);
      sess.data.data = dataISO;
    } else if (value === 'outra') {
      sess.data._aguardandoData = true;
      setSess(userId, sess);
      await ctx.reply('📅 Envie data no formato DD/MM ou DD/MM/YYYY:');
      return true;
    } else {
      const { dataISO } = extractDate(['@' + value]);
      if (!dataISO) { await ctx.reply('Data inválida. Tenta DD/MM ou DD/MM/YYYY'); return true; }
      sess.data.data = dataISO;
      delete sess.data._aguardandoData;
    }
  } else {
    sess.data[step.key] = String(value).trim();
  }
  sess.step++;
  setSess(userId, sess);
  return askStep(ctx, sess.wizard, sess.step);
}

async function finalizeWizard(ctx, name) {
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess) return;
  const resumo = renderResumo(name, sess.data);
  return ctx.reply(resumo, { parse_mode: 'Markdown', ...confirmKb() });
}

async function executeWizard(ctx, name, data) {
  const userId = String(ctx.from.id);
  if (name === 'receita') {
    const lista = RECEITA_CATEGORIAS;
    const m = matchCategoria(data.categoria, lista);
    if (!m.match) return ctx.reply(`❓ Categoria inválida`);
    const { fileName, filePath } = await criarLancamento(VAULT, {
      natureza: 'receita', valor: data.valor, categoria: m.match,
      metodo: '', conta: '', descricao: data.descricao || m.match, data: data.data
    });
    recordUndo(userId, { tipo: 'create_file', filePath });
    const r = await commitIfNeeded(`bot: receita ${brl(data.valor)} ${m.match}`);
    return ctx.reply(`✅ 💚 Receita ${brl(data.valor)} — ${m.match}\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'cliente') {
    const { fileName, filePath } = await criarCliente(VAULT, {
      nome: data.nome, planoMensal: data.planoMensal, telefone: data.telefone || '', segmento: data.segmento || ''
    });
    recordUndo(userId, { tipo: 'create_file', filePath });
    const r = await commitIfNeeded(`bot: cliente ${data.nome}`);
    return ctx.reply(`✅ 🏢 Cliente: ${data.nome}\n💰 ${brl(data.planoMensal)}/mês\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'lead') {
    const { fileName, filePath } = await criarLead(VAULT, {
      nome: data.nome, temperatura: data.temperatura, potencial: data.potencial, segmento: data.segmento || ''
    });
    recordUndo(userId, { tipo: 'create_file', filePath });
    const r = await commitIfNeeded(`bot: lead ${data.temperatura} ${data.nome}`);
    const e = { quente: '🔥', morno: '🌡️', frio: '🧊' }[data.temperatura] || '❓';
    return ctx.reply(`✅ ${e} Lead: ${data.nome}\n💰 ${brl(data.potencial)}/mês\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'proposta') {
    const { fileName, filePath } = await criarProposta(VAULT, {
      cliente: data.cliente, valorMensal: data.valorMensal, valorSetup: data.valorSetup
    });
    recordUndo(userId, { tipo: 'create_file', filePath });
    const r = await commitIfNeeded(`bot: proposta ${data.cliente}`);
    return ctx.reply(`✅ 📋 Proposta: ${data.cliente}\n💰 ${brl(data.valorMensal)}/mês + setup ${brl(data.valorSetup)}\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'saldo') {
    const { fileName } = await atualizarSaldoConta(VAULT, { contaSlug: data.contaSlug, novoSaldo: data.novoSaldo });
    const r = await commitIfNeeded(`bot: saldo ${data.contaSlug} ${brl(data.novoSaldo)}`);
    return ctx.reply(`✅ 💰 Saldo atualizado: ${brl(data.novoSaldo)}\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'pagar') {
    const { fileName } = await marcarFixaPaga(VAULT, { despesaSlug: data.despesaSlug });
    const r = await commitIfNeeded(`bot: pago ${data.despesaSlug}`);
    return ctx.reply(`✅ Marcado como pago\n📄 ${fileName}${pushSuffix(r)}`);
  }
  if (name === 'diario' || name === 'tarefa') {
    const { fileName, linha } = await appendDiario(VAULT, { texto: data.texto, tipo: name === 'tarefa' ? 'tarefa' : 'texto' });
    const r = await commitIfNeeded(`bot: ${name}`);
    return ctx.reply(`✅ ${name === 'tarefa' ? '✅ Tarefa' : '📓'} em ${fileName}\n${linha}${pushSuffix(r)}`);
  }
}

bot.action(/^wiz:val:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  return advanceWizard(ctx, ctx.match[1]);
});
bot.action(/^wiz:skip$/, async ctx => {
  await ctx.answerCbQuery('Pulado');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  return advanceWizard(ctx, '');
});
bot.action(/^wiz:cancel$/, async ctx => {
  clearSess(String(ctx.from.id));
  await ctx.answerCbQuery('Cancelado');
  await ctx.editMessageText('❌ Cancelado.');
});
bot.action(/^wiz:confirm$/, async ctx => {
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || !sess.wizard) return ctx.answerCbQuery('Sessão expirada');
  await ctx.answerCbQuery('Salvando...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const name = sess.wizard, data = sess.data;
  clearSess(userId);
  try {
    return await executeWizard(ctx, name, data);
  } catch (e) {
    log.error(`wizard ${name} falhou: ${e.message}`);
    return ctx.reply(`❌ ${e.message}`);
  }
});

// ============ INLINE CALLBACKS ============

bot.action(/^desp:met:(.+)$/, async ctx => {
  const metodo = ctx.match[1];
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || sess.fluxo !== 'despesa') return ctx.answerCbQuery('Sessão expirada');
  setSess(userId, { ...sess, metodo });
  await ctx.answerCbQuery(`Método: ${metodo}`);
  await ctx.editMessageText(`💸 ${brl(sess.valor)} (${metodo}) — escolha categoria:`, categoriaKeyboard('despesa', 'desp'));
});

function renderConfirm(sess, prefix) {
  const natureza = prefix === 'rec' ? 'receita' : 'despesa';
  const icon = natureza === 'receita' ? '💚' : '💸';
  const met = sess.metodo ? ` (${sess.metodo})` : '';
  const desc = sess.descricao && sess.descricao !== sess.categoria ? `\n_"${sess.descricao}"_` : '';
  return `${icon} ${brl(sess.valor)}${met} — *${sess.categoria}*${desc}\n\nConfirmar?`;
}

bot.action(/^(desp|rec):cat:(.+)$/, async ctx => {
  const prefix = ctx.match[1], categoria = ctx.match[2];
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess) return ctx.answerCbQuery('Sessão expirada');
  setSess(userId, { ...sess, categoria, aguardando: 'descricao', prefix });
  await ctx.answerCbQuery(`Categoria: ${categoria}`);
  const natureza = prefix === 'rec' ? 'receita' : 'despesa';
  const icon = natureza === 'receita' ? '💚' : '💸';
  const met = sess.metodo ? ` (${sess.metodo})` : '';
  await ctx.editMessageText(
    `${icon} ${brl(sess.valor)}${met} — *${categoria}*\n\n✏️ Envie descrição ou pule:`,
    { parse_mode: 'Markdown', ...descricaoKeyboard(prefix) }
  );
});

bot.action(/^(desp|rec):skipdesc$/, async ctx => {
  const prefix = ctx.match[1];
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || !sess.categoria) return ctx.answerCbQuery('Sessão expirada');
  const next = { ...sess, descricao: sess.descricao || sess.categoria, aguardando: null };
  setSess(userId, next);
  await ctx.answerCbQuery('Sem descrição');
  await ctx.editMessageText(renderConfirm(next, prefix), { parse_mode: 'Markdown', ...confirmKeyboard(prefix) });
});

bot.action(/^(desp|rec):ok$/, async ctx => {
  const prefix = ctx.match[1];
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || !sess.categoria) return ctx.answerCbQuery('Sessão expirada');
  await ctx.answerCbQuery('Salvando...');
  const natureza = prefix === 'rec' ? 'receita' : 'despesa';
  const { fileName, filePath } = await criarLancamento(VAULT, {
    natureza, valor: sess.valor, categoria: sess.categoria,
    metodo: sess.metodo || '', conta: '', descricao: sess.descricao || sess.categoria,
    data: sess.data
  });
  recordUndo(userId, { tipo: 'create_file', filePath });
  clearSess(userId);
  const r = await commitIfNeeded(`bot: ${natureza} ${sess.metodo || ''} ${brl(sess.valor)} ${sess.categoria}`);
  const icon = natureza === 'receita' ? '💚' : '💸';
  await ctx.editMessageText(`✅ ${icon} ${natureza} ${brl(sess.valor)}${sess.metodo ? ` (${sess.metodo})` : ''} — ${sess.categoria}\n📄 ${fileName}${pushSuffix(r)}`);
});

bot.action(/^(desp|rec):no$/, async ctx => {
  clearSess(String(ctx.from.id));
  await ctx.answerCbQuery('Cancelado');
  await ctx.editMessageText('❌ Cancelado.');
});

// ============ /undo ============

bot.command('undo', async ctx => {
  const userId = String(ctx.from.id);
  const op = await undoLast(userId);
  if (!op) return ctx.reply('Nada pra desfazer.');
  const r = await commitIfNeeded(`bot: undo ${op.tipo}`);
  return ctx.reply(`↩️ Desfeito: ${op.tipo}\n📄 ${op.filePath.split(/[\\/]/).pop()}${pushSuffix(r)}`);
});

// ============ /resumo ============

bot.command('resumo', async ctx => {
  const arg = ctx.message.text.split(' ')[1] || 'mes';
  const periodo = ['hoje', 'semana', 'mes'].includes(arg) ? arg : 'mes';
  const r = await lerResumo(VAULT, periodo);
  const sinal = r.sobra >= 0 ? '📈' : '📉';
  const titulos = { hoje: 'hoje', semana: 'últimos 7 dias', mes: 'mês atual' };
  let msg = `📊 *Resumo — ${titulos[periodo]}*\n` +
    `\n💚 Receitas: ${brl(r.receita)}\n` +
    `💸 Despesas: ${brl(r.despesa)}\n` +
    `${sinal} Sobra: *${brl(r.sobra)}*\n` +
    `📝 Lançamentos: ${r.qtd}`;
  if (r.topCat.length) {
    msg += `\n\n*Top categorias:*\n` + r.topCat.map(([c, v]) => `• ${c}: ${brl(v)}`).join('\n');
  }
  if (r.topMet.length) {
    msg += `\n\n*Por método:*\n` + r.topMet.map(([m, v]) => `• ${m}: ${brl(v)}`).join('\n');
  }
  return ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ EMPRESA ============

bot.command('cliente', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = String(ctx.from.id);
  if (args.length === 0) return startWizard(ctx, 'cliente');
  if (args.length < 2) return ctx.reply(`Uso: /cliente <nome> <plano_mensal> [telefone] [segmento]\nOu mande /cliente sem args pra modo guiado`);
  const planoMensal = parseFloat(args[1].replace(',', '.'));
  if (Number.isNaN(planoMensal)) return ctx.reply(`Plano inválido: ${args[1]}`);
  const { fileName, filePath } = await criarCliente(VAULT, {
    nome: args[0], planoMensal, telefone: args[2] || '', segmento: args.slice(3).join(' ') || ''
  });
  recordUndo(userId, { tipo: 'create_file', filePath });
  const r = await commitIfNeeded(`bot: cliente ${args[0]} ${brl(planoMensal)}/mês`);
  return ctx.reply(`✅ Cliente: ${args[0]}\n💰 ${brl(planoMensal)}/mês\n📄 ${fileName}${pushSuffix(r)}`);
});

bot.command('lead', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = String(ctx.from.id);
  if (args.length === 0) return startWizard(ctx, 'lead');
  if (args.length < 3) return ctx.reply(`Uso: /lead <nome> <frio|morno|quente> <potencial> [segmento]\nOu /lead sem args pra modo guiado`);
  const potencial = parseFloat(args[2].replace(',', '.'));
  if (Number.isNaN(potencial)) return ctx.reply(`Potencial inválido: ${args[2]}`);
  const { fileName, filePath } = await criarLead(VAULT, {
    nome: args[0], temperatura: args[1].toLowerCase(), potencial, segmento: args.slice(3).join(' ') || ''
  });
  recordUndo(userId, { tipo: 'create_file', filePath });
  const r = await commitIfNeeded(`bot: lead ${args[1]} ${args[0]}`);
  const emoji = { quente: '🔥', morno: '🌡️', frio: '🧊' }[args[1].toLowerCase()] || '❓';
  return ctx.reply(`${emoji} Lead: ${args[0]}\n💰 ${brl(potencial)}/mês\n📄 ${fileName}${pushSuffix(r)}`);
});

bot.command('proposta', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = String(ctx.from.id);
  if (args.length === 0) return startWizard(ctx, 'proposta');
  if (args.length < 3) return ctx.reply(`Uso: /proposta <cliente> <valor_mensal> <valor_setup>\nOu /proposta sem args pra modo guiado`);
  const valorMensal = parseFloat(args[1].replace(',', '.'));
  const valorSetup = parseFloat(args[2].replace(',', '.'));
  if (Number.isNaN(valorMensal) || Number.isNaN(valorSetup)) return ctx.reply(`Valores inválidos`);
  const { fileName, filePath } = await criarProposta(VAULT, { cliente: args[0], valorMensal, valorSetup });
  recordUndo(userId, { tipo: 'create_file', filePath });
  const r = await commitIfNeeded(`bot: proposta ${args[0]}`);
  return ctx.reply(`📋 Proposta: ${args[0]}\n💰 ${brl(valorMensal)}/mês + setup ${brl(valorSetup)}\n📄 ${fileName}${pushSuffix(r)}`);
});

// ============ DIÁRIO / TAREFA ============

bot.command('diario', async ctx => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  if (!texto) return startWizard(ctx, 'diario');
  const { fileName, linha } = await appendDiario(VAULT, { texto, tipo: 'texto' });
  const r = await commitIfNeeded(`bot: diario`);
  return ctx.reply(`📓 Anotado em ${fileName}\n${linha}${pushSuffix(r)}`);
});

bot.command('tarefa', async ctx => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  if (!texto) return startWizard(ctx, 'tarefa');
  const { fileName, linha } = await appendDiario(VAULT, { texto, tipo: 'tarefa' });
  const r = await commitIfNeeded(`bot: tarefa`);
  return ctx.reply(`✅ Tarefa em ${fileName}\n${linha}${pushSuffix(r)}`);
});

// ============ CONTAS ============

bot.command('saldo', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = String(ctx.from.id);
  if (args.length === 0) return startWizard(ctx, 'saldo');
  if (args.length < 2) return ctx.reply(`Uso: /saldo <conta-slug> <novo-valor>\nOu /saldo sem args pra modo guiado`);
  const novoSaldo = parseFloat(args[1].replace(',', '.'));
  if (Number.isNaN(novoSaldo)) return ctx.reply(`Valor inválido`);
  const { fileName } = await atualizarSaldoConta(VAULT, { contaSlug: args[0], novoSaldo });
  const r = await commitIfNeeded(`bot: saldo ${args[0]} ${brl(novoSaldo)}`);
  return ctx.reply(`💰 Saldo: ${brl(novoSaldo)}\n📄 ${fileName}${pushSuffix(r)}`);
});

bot.command('saldos', async ctx => {
  const contas = await lerSaldos(VAULT);
  if (!contas.length) return ctx.reply(`Nenhuma conta encontrada.`);
  const total = contas.reduce((a, c) => a + c.saldo, 0);
  const linhas = contas.map(c => `• ${c.nome} (${c.banco}): *${brl(c.saldo)}*`).join('\n');
  return ctx.reply(`🏦 *Saldos*\n\n${linhas}\n\n*Total: ${brl(total)}*`, { parse_mode: 'Markdown' });
});

bot.command('pagar', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) return startWizard(ctx, 'pagar');
  const { fileName } = await marcarFixaPaga(VAULT, { despesaSlug: args[0] });
  const r = await commitIfNeeded(`bot: pago ${args[0]}`);
  return ctx.reply(`✅ Pago\n📄 ${fileName}${pushSuffix(r)}`);
});

// ============ PATRIMÔNIO ============

bot.command('patrimonio', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = String(ctx.from.id);

  // /patrimonio <valor> → snapshot manual com valor
  if (args.length >= 1 && !Number.isNaN(parseFloat(args[0].replace(',', '.')))) {
    const valor = parseFloat(args[0].replace(',', '.'));
    const contas = await lerSaldos(VAULT);
    const { fileName, filePath } = await criarSnapshotPatrimonio(VAULT, { valor, contas });
    recordUndo(userId, { tipo: 'create_file', filePath });
    const r = await commitIfNeeded(`bot: snapshot patrimonio ${brl(valor)}`);
    return ctx.reply(`📸 Snapshot patrimônio: *${brl(valor)}*\n📄 ${fileName}${pushSuffix(r)}`, { parse_mode: 'Markdown' });
  }

  // /patrimonio (sem args) → soma contas, pede confirmação
  const contas = await lerSaldos(VAULT);
  if (!contas.length) return ctx.reply(`Nenhuma conta encontrada. Use /saldo pra criar/atualizar.`);
  const total = contas.reduce((a, c) => a + c.saldo, 0);
  const linhas = contas.map(c => `• ${c.nome} (${c.banco}): ${brl(c.saldo)}`).join('\n');
  setSess(userId, { fluxo: 'patrimonio_snapshot', total, contas });
  const msg = `🏦 *Patrimônio atual:* *${brl(total)}*\n\n${linhas}\n\nCriar snapshot agora?`;
  return ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback('📸 Sim, snapshot', 'patr:ok'),
      Markup.button.callback('❌ Cancelar', 'patr:no')
    ]])
  });
});

bot.action(/^patr:ok$/, async ctx => {
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  if (!sess || sess.fluxo !== 'patrimonio_snapshot') return ctx.answerCbQuery('Sessão expirada');
  await ctx.answerCbQuery('Salvando...');
  const { fileName, filePath } = await criarSnapshotPatrimonio(VAULT, { valor: sess.total, contas: sess.contas });
  recordUndo(userId, { tipo: 'create_file', filePath });
  clearSess(userId);
  const r = await commitIfNeeded(`bot: snapshot patrimonio ${brl(sess.total)}`);
  await ctx.editMessageText(`✅ 📸 Snapshot: *${brl(sess.total)}*\n📄 ${fileName}${pushSuffix(r)}`, { parse_mode: 'Markdown' });
});

bot.action(/^patr:no$/, async ctx => {
  clearSess(String(ctx.from.id));
  await ctx.answerCbQuery('Cancelado');
  await ctx.editMessageText('❌ Cancelado.');
});

// ============ STATUS ============

bot.command('status', async ctx => {
  const s = await lerStatus(VAULT);
  const sobra = s.receitaMes - s.despesaMes;
  const msg =
    `📊 *Dashboard*\n\n` +
    `*🏢 Empresa:*\n` +
    `• MRR: *${brl(s.mrr)}/mês*\n` +
    `• Clientes ativos: ${s.qtdClientes}\n` +
    `• Leads: ${s.qtdLeads}\n\n` +
    `*💰 Mês:*\n` +
    `• Receitas: ${brl(s.receitaMes)}\n` +
    `• Despesas: ${brl(s.despesaMes)}\n` +
    `• Sobra: *${brl(sobra)}*\n` +
    `• Lançamentos: ${s.qtdLanc}\n\n` +
    `*🏦 Patrimônio:* ${brl(s.patrimonio)}`;
  return ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ TEMPLATES ============

async function lancarTemplate(ctx, nome) {
  const tpls = await loadTemplates();
  const t = tpls[nome];
  if (!t) return ctx.reply(`Template "${nome}" não existe. /template list`);
  const userId = String(ctx.from.id);
  const raw = ctx.message.text.split(' ').slice(1);
  const { dataISO } = extractDate(raw);
  const { fileName, filePath } = await criarLancamento(VAULT, {
    natureza: t.tipo, valor: t.valor, categoria: t.categoria,
    metodo: t.metodo, conta: '', descricao: t.descricao, data: dataISO
  });
  recordUndo(userId, { tipo: 'create_file', filePath });
  const r = await commitIfNeeded(`bot: tpl ${nome} ${brl(t.valor)}`);
  const dataMsg = dataISO ? ` 📅 ${dataISO.split('-').reverse().join('/')}` : '';
  return ctx.reply(`⚡ ${nome} — ${brl(t.valor)} ${t.metodo} ${t.categoria}${dataMsg}\n📄 ${fileName}${pushSuffix(r)}`);
}

bot.command('template', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  const sub = args[0];
  if (sub === 'list') {
    const tpls = await loadTemplates();
    const linhas = Object.entries(tpls).map(([n, t]) => `• /${n} — ${brl(t.valor)} ${t.metodo} ${t.categoria}`).join('\n');
    return ctx.reply(`⚡ *Templates:*\n\n${linhas || 'nenhum'}`, { parse_mode: 'Markdown' });
  }
  if (sub === 'add') {
    if (args.length < 6) return ctx.reply(`Uso: /template add <nome> <valor> <metodo> <categoria> <desc>`);
    const [_, nome, valorStr, metodo, categoria, ...rest] = args;
    const valor = parseFloat(valorStr.replace(',', '.'));
    if (Number.isNaN(valor)) return ctx.reply(`Valor inválido`);
    await saveTemplate(nome, { tipo: 'despesa', valor, metodo, categoria, descricao: rest.join(' ') });
    return ctx.reply(`✅ Template /${nome} salvo.`);
  }
  if (sub === 'del') {
    if (!args[1]) return ctx.reply(`Uso: /template del <nome>`);
    await deleteTemplate(args[1]);
    return ctx.reply(`🗑️ Template /${args[1]} removido.`);
  }
  return ctx.reply(`Uso: /template <list|add|del>`);
});

// Registra templates dinâmicos como comandos
const templates = await loadTemplates();
for (const nome of Object.keys(templates)) {
  bot.command(nome, ctx => lancarTemplate(ctx, nome));
}

// ============ NATURAL LANGUAGE / VOICE / FOTO ============

async function processarNatural(ctx, text) {
  const userId = String(ctx.from.id);

  // 0. Intent shortcuts: atualizar saldo / patrimônio
  const intent = text.toLowerCase().trim();
  const valorMatch = intent.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)/);
  const intentKw = intent.match(/^(atualiza(?:r)?|saldo|patrim[oô]nio)\s+(.+)/);
  if (intentKw) {
    const tail = intentKw[2];
    const kw = intentKw[1];
    const valStr = valorMatch ? valorMatch[1] : null;
    const valor = valStr ? parseFloat(valStr.replace(/\./g, '').replace(',', '.')) : null;
    const contas = await lerContasSlugs(VAULT);
    const tailSemValor = tail.replace(valorMatch ? valorMatch[0] : '', '').trim();
    const conta = contas.find(c => tailSemValor.includes(c) || c.includes(tailSemValor));
    if (conta && valor) {
      const { fileName } = await atualizarSaldoConta(VAULT, { contaSlug: conta, novoSaldo: valor });
      const r = await commitIfNeeded(`bot: saldo ${conta} ${brl(valor)}`);
      return ctx.reply(`🏦 Saldo *${conta}*: ${brl(valor)}\n📄 ${fileName}${pushSuffix(r)}`, { parse_mode: 'Markdown' });
    }
    if (kw.startsWith('patrim') && !conta && valor) {
      const { fileName } = await criarSnapshotPatrimonio(VAULT, { valor, contas: [] });
      const r = await commitIfNeeded(`bot: patrimonio snapshot ${brl(valor)}`);
      return ctx.reply(`📊 Snapshot patrimônio: ${brl(valor)}\n📄 ${fileName}${pushSuffix(r)}`, { parse_mode: 'Markdown' });
    }
  }

  // 1. tenta @-tokens explícitos
  const fromAt = extractDate(text.split(/\s+/));
  let dataISO = fromAt.dataISO;
  let working = fromAt.args.join(' ');
  // 2. fallback: data em linguagem natural (ontem, dia 25/04, 25/04)
  if (!dataISO) {
    const nat = extractNaturalDate(working);
    if (nat.dataISO) { dataISO = nat.dataISO; working = nat.cleanText; }
  }
  const parsed = await parseNatural(working);
  if (parsed.acao === 'desconhecido' || !parsed.valor) {
    return ctx.reply(`🤔 Não entendi. Tenta:\n• "gastei 50 no mercado pix"\n• /help`);
  }
  setSess(userId, { fluxo: parsed.acao, valor: parsed.valor, metodo: parsed.metodo, categoria: parsed.categoria, descricao: parsed.descricao, data: dataISO });
  const icon = parsed.acao === 'receita' ? '💚' : '💸';
  const prefix = parsed.acao === 'receita' ? 'rec' : 'desp';
  const met = parsed.metodo ? ` (${parsed.metodo})` : '';
  const dataMsg = dataISO ? ` 📅 ${dataISO.split('-').reverse().join('/')}` : '';
  return ctx.reply(
    `${icon} ${parsed.acao} ${brl(parsed.valor)}${met} — *${parsed.categoria}*${dataMsg}\n_"${parsed.descricao}"_\n\nConfirmar?`,
    { parse_mode: 'Markdown', ...confirmKeyboard(prefix) }
  );
}

bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();
  const userId = String(ctx.from.id);
  const sess = getSess(userId);
  // Wizard ativo: roteia input
  if (sess && sess.wizard) {
    return advanceWizard(ctx, text);
  }
  if (sess && sess.aguardando === 'descricao' && sess.categoria) {
    const prefix = sess.prefix || (sess.fluxo === 'receita' ? 'rec' : 'desp');
    const updated = { ...sess, descricao: text.trim(), aguardando: null };
    setSess(userId, updated);
    return ctx.reply(renderConfirm(updated, prefix), { parse_mode: 'Markdown', ...confirmKeyboard(prefix) });
  }
  return processarNatural(ctx, text);
});

bot.on('voice', async ctx => {
  if (!llmEnabled || !process.env.OPENAI_API_KEY) {
    return ctx.reply('🎤 Voice precisa de OPENAI_API_KEY no .env (Whisper).');
  }
  await ctx.reply('🎤 Transcrevendo...');
  try {
    const fileId = ctx.message.voice.file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = await llmTranscribe(buf);
    await ctx.reply(`📝 _"${text}"_`, { parse_mode: 'Markdown' });
    return processarNatural(ctx, text);
  } catch (e) {
    log.error(`voice falhou: ${e.message}`);
    return ctx.reply(`❌ Falha transcrição: ${e.message}`);
  }
});

bot.on('photo', async ctx => {
  if (!llmEnabled) {
    return ctx.reply('📷 Foto precisa de ANTHROPIC_API_KEY no .env (Vision).');
  }
  await ctx.reply('📷 Lendo cupom...');
  try {
    const photos = ctx.message.photo;
    const big = photos[photos.length - 1];
    const link = await ctx.telegram.getFileLink(big.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await llmVisionParse(buf);
    if (!data || !data.valor_total) return ctx.reply('❌ Não consegui extrair valor.');
    const userId = String(ctx.from.id);
    setSess(userId, {
      fluxo: 'despesa',
      valor: parseFloat(data.valor_total),
      metodo: 'cartao',
      categoria: data.categoria_sugerida || 'outros',
      descricao: data.estabelecimento || 'cupom'
    });
    await ctx.reply(
      `📷 *Cupom*\n💸 ${brl(data.valor_total)} — ${data.estabelecimento || '—'}\n_${data.categoria_sugerida || 'outros'}_\n\nConfirmar?`,
      { parse_mode: 'Markdown', ...confirmKeyboard('desp') }
    );
  } catch (e) {
    log.error(`foto falhou: ${e.message}`);
    return ctx.reply(`❌ ${e.message}`);
  }
});

// ============ ERROR HANDLER ============

bot.catch((err, ctx) => {
  log.error(`update ${ctx.updateType} falhou: ${err.message}`, { stack: err.stack });
  ctx.reply(`❌ Erro interno: ${err.message}`).catch(() => {});
});

// ============ LAUNCH ============

scheduleNotifications(bot, VAULT, ALLOWED);

bot.launch().then(() => log.info(`Bot v2 online. Vault=${VAULT}. AutoPush=${AUTO_PUSH}. LLM=${llmEnabled}.`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
