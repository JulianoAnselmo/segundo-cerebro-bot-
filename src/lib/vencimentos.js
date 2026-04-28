import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

function parseFM(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const obj = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w_-]+):\s*(.*)/);
    if (kv) obj[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return obj;
}

export async function lerVencimentosProximos(vaultPath, dias = 3) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro');
  const arquivos = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.md'));
  const hoje = new Date();
  const diaAtual = hoje.getDate();
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const result = [];
  for (const a of arquivos) {
    const fm = parseFM(await readFile(join(dir, a), 'utf8'));
    if (fm.tipo !== 'despesa' || fm.recorrente !== 'true') continue;
    if (fm.status === 'pago') continue;
    const dia = parseInt(fm.vencimento_dia || fm.dia || 0);
    if (!dia) continue;
    let diff = dia - diaAtual;
    if (diff < 0) diff += ultimoDia;
    if (diff <= dias) {
      const nome = a.replace(/^\d{2}-\d{2}-\d{4}-/, '').replace('.md', '').replace(/-/g, ' ');
      result.push({
        nome,
        dia,
        dias: diff,
        valor: parseFloat(fm.valor_mensal || fm.valor || 0)
      });
    }
  }
  return result.sort((a, b) => a.dias - b.dias);
}
