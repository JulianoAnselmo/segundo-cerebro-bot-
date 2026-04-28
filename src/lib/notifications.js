import cron from 'node-cron';
import { lerStatus } from '../notes.js';
import { lerVencimentosProximos } from './vencimentos.js';

const brl = n => {
  const [i, d] = Number(n).toFixed(2).split('.');
  return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};

export function scheduleNotifications(bot, vault, allowedIds) {
  if (!allowedIds.length) return;

  // Relatório diário 21h America/Sao_Paulo
  cron.schedule('0 21 * * *', async () => {
    try {
      const s = await lerStatus(vault);
      const sobra = s.receitaMes - s.despesaMes;
      const sinal = sobra >= 0 ? '📈' : '📉';
      const msg = `🌙 *Relatório do dia*\n\n` +
        `🏢 MRR: ${brl(s.mrr)}\n` +
        `💚 Receitas mês: ${brl(s.receitaMes)}\n` +
        `💸 Despesas mês: ${brl(s.despesaMes)}\n` +
        `${sinal} Sobra: *${brl(sobra)}*\n` +
        `🏦 Patrimônio: ${brl(s.patrimonio)}`;
      for (const id of allowedIds) {
        await bot.telegram.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    } catch (e) { console.error('cron diario:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });

  // Alerta vencimentos próximos — todo dia 9h
  cron.schedule('0 9 * * *', async () => {
    try {
      const venc = await lerVencimentosProximos(vault, 3);
      if (!venc.length) return;
      const linhas = venc.map(v => `• *${v.nome}* — vence ${v.dias === 0 ? 'hoje' : `em ${v.dias}d`} (dia ${v.dia}) — ${brl(v.valor)}`).join('\n');
      const msg = `⚠️ *Vencimentos próximos*\n\n${linhas}`;
      for (const id of allowedIds) {
        await bot.telegram.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    } catch (e) { console.error('cron vencimentos:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });
}
