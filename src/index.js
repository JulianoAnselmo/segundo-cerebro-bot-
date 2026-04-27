import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { criarLancamento, atualizarSaldoConta, marcarFixaPaga, criarCliente, criarLead, criarProposta, appendDiario, lerStatus, lerSaldos } from './notes.js';
import { gitPullCommitPush } from './git.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VAULT = process.env.VAULT_PATH;
const BRANCH = process.env.VAULT_BRANCH || 'main';
const AUTO_PUSH = (process.env.AUTO_PUSH || 'true') === 'true';
const ALLOWED = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !VAULT) {
  console.error('Faltando TELEGRAM_BOT_TOKEN ou VAULT_PATH no .env');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

bot.use(async (ctx, next) => {
  const id = String(ctx.from?.id || '');
  if (ALLOWED.length && !ALLOWED.includes(id)) {
    console.log(`[BLOCK] user_id=${id} username=${ctx.from?.username}`);
    return ctx.reply(`Não autorizado. Seu ID: ${id}`);
  }
  console.log(`[${new Date().toISOString()}] ${ctx.from?.username || id}: ${ctx.message?.text || ctx.updateType}`);
  return next();
});

bot.start(ctx => ctx.reply(
  `Olá! Bot do Segundo Cérebro.\n\nSeu Telegram ID: \`${ctx.from.id}\`\n\n` +
  `*Finanças:* /cartao /pix /dinheiro /debito /boleto /gasto /receita /saldo /pagar /saldos /status\n` +
  `*Empresa:* /cliente /lead /proposta\n` +
  `*Diário:* /diario /tarefa\n\n/help — lista completa`,
  { parse_mode: 'Markdown' }
));

bot.help(ctx => ctx.reply(
  `📒 *Comandos:*\n\n` +
  `*💸 Despesas (atalho por método):*\n` +
  `\`/cartao <valor> <categoria> [desc]\`\n` +
  `\`/pix <valor> <categoria> [desc]\`\n` +
  `\`/dinheiro <valor> <categoria> [desc]\`\n` +
  `\`/debito <valor> <categoria> [desc]\`\n` +
  `\`/boleto <valor> <categoria> [desc]\`\n` +
  `Ex: \`/cartao 152.30 alimentacao mercado\`\n\n` +
  `*💸 Genérico:* \`/gasto <valor> <metodo> <cat> [desc]\`\n\n` +
  `*💰 Receita:* \`/receita <valor> <categoria> [desc]\`\n\n` +
  `*🏦 Contas:*\n` +
  `\`/saldo <conta-slug> <novo-valor>\`\n` +
  `\`/saldos\` — lista todas as contas\n` +
  `\`/pagar <despesa-slug>\` — marca pago\n\n` +
  `*🏢 Empresa:*\n` +
  `\`/cliente <nome> <plano_mensal> [tel] [segmento]\`\n` +
  `\`/lead <nome> <frio|morno|quente> <potencial> [segmento]\`\n` +
  `\`/proposta <cliente> <valor_mensal> <valor_setup>\`\n\n` +
  `*📓 Diário:*\n` +
  `\`/diario <texto>\` — append nota diária\n` +
  `\`/tarefa <texto>\` — append tarefa checkbox\n\n` +
  `*📊 Dashboard:* \`/status\``,
  { parse_mode: 'Markdown' }
));

const METODOS = ['cartao', 'pix', 'dinheiro', 'debito', 'boleto'];

async function lancarDespesa(ctx, metodo) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply(`Uso: /${metodo} <valor> <categoria> <descrição opcional>`);

  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  const categoria = args[1];
  const descricao = args.slice(2).join(' ') || categoria;

  try {
    const { fileName } = await criarLancamento(VAULT, {
      natureza: 'despesa', valor, categoria, metodo, conta: '', descricao
    });
    let msg = `✅ Gasto R$ ${valor.toFixed(2)} (${metodo}) — ${categoria}\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: despesa ${metodo} R$ ${valor.toFixed(2)} ${categoria}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ Erro: ${e.message}`);
  }
}

async function lancarReceita(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply(`Uso: /receita <valor> <categoria> <descrição opcional>`);

  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  const categoria = args[1];
  const descricao = args.slice(2).join(' ') || categoria;

  try {
    const { fileName } = await criarLancamento(VAULT, {
      natureza: 'receita', valor, categoria, metodo: '', conta: '', descricao
    });
    let msg = `✅ Receita R$ ${valor.toFixed(2)} — ${categoria}\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: receita R$ ${valor.toFixed(2)} ${categoria}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ Erro: ${e.message}`);
  }
}

async function lancarGastoGenerico(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply(`Uso: /gasto <valor> <metodo> <categoria> <descrição>\nMétodos: ${METODOS.join(', ')}`);

  const valor = parseFloat(args[0].replace(',', '.'));
  if (Number.isNaN(valor)) return ctx.reply(`Valor inválido: ${args[0]}`);

  const metodo = args[1].toLowerCase();
  if (!METODOS.includes(metodo)) return ctx.reply(`Método inválido: ${metodo}\nUse: ${METODOS.join(', ')}`);

  const categoria = args[2];
  const descricao = args.slice(3).join(' ') || categoria;

  try {
    const { fileName } = await criarLancamento(VAULT, {
      natureza: 'despesa', valor, categoria, metodo, conta: '', descricao
    });
    let msg = `✅ Gasto R$ ${valor.toFixed(2)} (${metodo}) — ${categoria}\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: despesa ${metodo} R$ ${valor.toFixed(2)} ${categoria}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ Erro: ${e.message}`);
  }
}

bot.command('gasto', lancarGastoGenerico);
bot.command('receita', lancarReceita);
for (const m of METODOS) {
  bot.command(m, ctx => lancarDespesa(ctx, m));
}

bot.command('saldo', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply(`Uso: /saldo <conta-slug> <novo-valor>`);
  const contaSlug = args[0];
  const novoSaldo = parseFloat(args[1].replace(',', '.'));
  if (Number.isNaN(novoSaldo)) return ctx.reply(`Valor inválido`);

  try {
    const { fileName } = await atualizarSaldoConta(VAULT, { contaSlug, novoSaldo });
    let msg = `💰 Saldo atualizado: R$ ${novoSaldo.toFixed(2)}\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: saldo ${contaSlug} R$ ${novoSaldo.toFixed(2)}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('pagar', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) return ctx.reply(`Uso: /pagar <despesa-slug>  (ex: /pagar wellhub)`);
  const despesaSlug = args[0];

  try {
    const { fileName } = await marcarFixaPaga(VAULT, { despesaSlug });
    let msg = `✅ Marcado pago\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: pago ${despesaSlug}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

const brl = n => {
  const [i, d] = Number(n).toFixed(2).split('.');
  return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};

bot.command('cliente', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply(`Uso: /cliente <nome> <plano_mensal> [telefone] [segmento]\nEx: /cliente "Padaria Pão Quente" 350 11999990000 alimentacao`);
  const planoMensal = parseFloat(args[1].replace(',', '.'));
  if (Number.isNaN(planoMensal)) return ctx.reply(`Plano inválido: ${args[1]}`);
  const nome = args[0];
  const telefone = args[2] || '';
  const segmento = args.slice(3).join(' ') || '';
  try {
    const { fileName } = await criarCliente(VAULT, { nome, planoMensal, telefone, segmento });
    let msg = `✅ Cliente criado: ${nome}\n💰 Plano: ${brl(planoMensal)}/mês\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: cliente ${nome} ${brl(planoMensal)}/mês`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('lead', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply(`Uso: /lead <nome> <frio|morno|quente> <potencial> [segmento]\nEx: /lead "Farmácia Central" quente 400 saude`);
  const nome = args[0];
  const temperatura = args[1].toLowerCase();
  const potencial = parseFloat(args[2].replace(',', '.'));
  if (Number.isNaN(potencial)) return ctx.reply(`Potencial inválido: ${args[2]}`);
  const segmento = args.slice(3).join(' ') || '';
  try {
    const { fileName } = await criarLead(VAULT, { nome, temperatura, potencial, segmento });
    const emoji = { quente: '🔥', morno: '🌡️', frio: '🧊' }[temperatura] || '❓';
    let msg = `${emoji} Lead criado: ${nome}\n💰 Potencial: ${brl(potencial)}/mês\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: lead ${temperatura} ${nome}`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('proposta', async ctx => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply(`Uso: /proposta <cliente> <valor_mensal> <valor_setup>\nEx: /proposta "Farmácia Central" 350 800`);
  const cliente = args[0];
  const valorMensal = parseFloat(args[1].replace(',', '.'));
  const valorSetup = parseFloat(args[2].replace(',', '.'));
  if (Number.isNaN(valorMensal) || Number.isNaN(valorSetup)) return ctx.reply(`Valores inválidos`);
  try {
    const { fileName } = await criarProposta(VAULT, { cliente, valorMensal, valorSetup });
    let msg = `📋 Proposta criada: ${cliente}\n💰 ${brl(valorMensal)}/mês + setup ${brl(valorSetup)}\n📄 ${fileName}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: proposta ${cliente} ${brl(valorMensal)}/mês`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('diario', async ctx => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  if (!texto) return ctx.reply(`Uso: /diario <texto>`);
  try {
    const { fileName, linha } = await appendDiario(VAULT, { texto, tipo: 'texto' });
    let msg = `📓 Anotado em ${fileName}\n${linha}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: diario`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('tarefa', async ctx => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  if (!texto) return ctx.reply(`Uso: /tarefa <texto>`);
  try {
    const { fileName, linha } = await appendDiario(VAULT, { texto, tipo: 'tarefa' });
    let msg = `✅ Tarefa criada em ${fileName}\n${linha}`;
    if (AUTO_PUSH) {
      const r = await gitPullCommitPush(VAULT, BRANCH, `bot: tarefa`);
      msg += r.committed ? `\n☁️ git push ok` : `\n(sem mudanças)`;
    }
    return ctx.reply(msg);
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('status', async ctx => {
  try {
    const { mrr, qtdClientes, qtdLeads, patrimonio, receitaMes, despesaMes, qtdLanc } = await lerStatus(VAULT);
    const sobra = receitaMes - despesaMes;
    const msg =
      `📊 *Dashboard — Segundo Cérebro*\n\n` +
      `*🏢 Empresa:*\n` +
      `• MRR: *${brl(mrr)}/mês*\n` +
      `• Clientes ativos: ${qtdClientes}\n` +
      `• Leads: ${qtdLeads}\n\n` +
      `*💰 Finanças pessoais (mês):*\n` +
      `• Receitas: ${brl(receitaMes)}\n` +
      `• Despesas: ${brl(despesaMes)}\n` +
      `• Sobra: *${brl(sobra)}*\n` +
      `• Lançamentos: ${qtdLanc}\n\n` +
      `*🏦 Patrimônio:* ${brl(patrimonio)}`;
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.command('saldos', async ctx => {
  try {
    const contas = await lerSaldos(VAULT);
    if (!contas.length) return ctx.reply(`Nenhuma conta encontrada.`);
    const total = contas.reduce((a, c) => a + c.saldo, 0);
    const linhas = contas.map(c => `• ${c.nome} (${c.banco}): *${brl(c.saldo)}*`).join('\n');
    return ctx.reply(`🏦 *Saldos*\n\n${linhas}\n\n*Total: ${brl(total)}*`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    return ctx.reply(`❌ ${e.message}`);
  }
});

bot.launch().then(() => console.log(`Bot online. Vault: ${VAULT}. AutoPush: ${AUTO_PUSH}.`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
