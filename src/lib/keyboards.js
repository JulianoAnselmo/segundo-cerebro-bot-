// Inline keyboards Telegraf
import { Markup } from 'telegraf';
import { DESPESA_CATEGORIAS, RECEITA_CATEGORIAS, METODOS } from './categories.js';

export function categoriaKeyboard(natureza, prefix) {
  const lista = natureza === 'receita' ? RECEITA_CATEGORIAS : DESPESA_CATEGORIAS;
  const rows = [];
  for (let i = 0; i < lista.length; i += 3) {
    rows.push(lista.slice(i, i + 3).map(c => Markup.button.callback(c, `${prefix}:cat:${c}`)));
  }
  return Markup.inlineKeyboard(rows);
}

export function metodoKeyboard(prefix) {
  return Markup.inlineKeyboard([METODOS.map(m => Markup.button.callback(m, `${prefix}:met:${m}`))]);
}

export function confirmKeyboard(prefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `${prefix}:ok`), Markup.button.callback('❌ Cancelar', `${prefix}:no`)]
  ]);
}

export function descricaoKeyboard(prefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏭️ Pular', `${prefix}:skipdesc`), Markup.button.callback('❌ Cancelar', `${prefix}:no`)]
  ]);
}
