import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function pad(n) { return String(n).padStart(2, '0'); }

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayFile() {
  const d = new Date();
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function slug(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function criarLancamento(vaultPath, { natureza, valor, categoria, metodo, conta, descricao, data: dataParam, origem }) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro', 'Lancamentos');
  await mkdir(dir, { recursive: true });

  const hojeISO = todayISO();
  const data = dataParam || hojeISO;
  const [yyyy, mm, dd] = data.split('-');
  const dataFile = `${dd}-${mm}-${yyyy}`;
  const baseName = slug(descricao || categoria || natureza);
  const fileName = `${dataFile}-${baseName}.md`;
  const filePath = join(dir, fileName);

  const tituloRaw = descricao || categoria || natureza;
  const titulo = tituloRaw.charAt(0).toLocaleUpperCase('pt-BR') + tituloRaw.slice(1);

  const tagsList = ['pessoal', 'financeiro', 'lancamento', natureza];
  if (metodo) tagsList.push(metodo);

  const content = `---
created: ${hojeISO}
modified: ${hojeISO}
tipo: lancamento
natureza: ${natureza}
valor: ${valor.toFixed(2)}
data: ${data}
categoria: ${categoria}
metodo: ${metodo || ''}
conta: ${conta || ''}
descricao: "${(descricao || '').replace(/"/g, '\\"')}"
origem: ${origem || 'avulso'}${metodo === 'cartao' ? '\npago: false\nvencimento_dia: 15' : ''}
tags: [${tagsList.join(', ')}]
---

# ${titulo}

- **Natureza:** ${natureza}
- **Valor:** R$ ${valor.toFixed(2)}
- **Data:** ${dataFile.split('-').reverse().join('/')}
- **Categoria:** ${categoria}
- **Método:** ${metodo || '—'}
- **Conta:** ${conta || '—'}
- **Descrição:** ${descricao || '—'}

> Criado via Telegram bot.
`;

  await writeFile(filePath, content, 'utf8');
  return { fileName, filePath };
}

export async function ajustarSaldoConta(vaultPath, { contaSlug, delta }) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro', 'Contas');
  const { readdir } = await import('node:fs/promises');
  const arquivos = await readdir(dir);
  const alvo = arquivos.find(f => f.toLowerCase().includes(contaSlug.toLowerCase()) && f.endsWith('.md'));
  if (!alvo) throw new Error(`Conta não encontrada: ${contaSlug}`);
  const fm = parseFrontmatter(await readFile(join(dir, alvo), 'utf8'));
  const atual = parseFloat(fm.saldo || 0);
  const novo = atual + delta;
  await atualizarSaldoConta(vaultPath, { contaSlug, novoSaldo: novo });
  return { fileName: alvo, saldoAnterior: atual, saldoNovo: novo };
}

export async function atualizarSaldoConta(vaultPath, { contaSlug, novoSaldo }) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro', 'Contas');
  const { readdir } = await import('node:fs/promises');
  const arquivos = await readdir(dir);
  const alvo = arquivos.find(f => f.toLowerCase().includes(contaSlug.toLowerCase()) && f.endsWith('.md'));
  if (!alvo) throw new Error(`Conta não encontrada: ${contaSlug}`);

  const filePath = join(dir, alvo);
  let txt = await readFile(filePath, 'utf8');

  const data = todayISO();
  txt = txt
    .replace(/^saldo:\s*.*$/m, `saldo: ${novoSaldo.toFixed(2)}`)
    .replace(/^modified:\s*.*$/m, `modified: ${data}`)
    .replace(/^ultimo_atualizado:\s*.*$/m, `ultimo_atualizado: ${data}`);

  const dataBr = data.split('-').reverse().join('/');
  const linhaHist = `| ${dataBr} | R$ ${novoSaldo.toFixed(2)} | — |`;
  txt = txt.replace(/(\| Data \| Saldo \| Variação \|\n\|---\|---:\|---:\|\n)/, `$1${linhaHist}\n`);

  await writeFile(filePath, txt, 'utf8');
  return { fileName: alvo };
}

export async function marcarFixaPaga(vaultPath, { despesaSlug }) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro');
  const { readdir } = await import('node:fs/promises');
  const arquivos = await readdir(dir);
  const alvo = arquivos.find(f => f.toLowerCase().includes(despesaSlug.toLowerCase()) && f.endsWith('.md'));
  if (!alvo) throw new Error(`Despesa fixa não encontrada: ${despesaSlug}`);

  const filePath = join(dir, alvo);
  let txt = await readFile(filePath, 'utf8');
  const data = todayISO();

  const fmFixa = parseFrontmatter(txt);
  txt = txt
    .replace(/^status:\s*.*$/m, `status: pago`)
    .replace(/^modified:\s*.*$/m, `modified: ${data}`)
    .replace(/^ultimo_pagamento:\s*.*$/m, `ultimo_pagamento: ${data}`);

  await writeFile(filePath, txt, 'utf8');

  const valor = parseFloat(fmFixa.valor_mensal || 0);
  const lanc = await criarLancamento(vaultPath, {
    natureza: 'despesa',
    valor,
    categoria: fmFixa.categoria || 'conta-fixa',
    metodo: fmFixa.metodo || 'pix',
    descricao: alvo.replace(/^\d{2}-\d{2}-\d{4}-/, '').replace(/\.md$/, '').replace(/-/g, ' '),
    data,
    origem: 'fixa'
  });

  return { fileName: alvo, lancamento: lanc };
}

function parseFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const obj = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w_-]+):\s*(.*)/);
    if (kv) obj[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return obj;
}

export async function criarCliente(vaultPath, { nome, planoMensal, telefone, segmento }) {
  const dir = join(vaultPath, 'Empresa', 'Clientes');
  await mkdir(dir, { recursive: true });
  const data = todayISO();
  const dataFile = todayFile();
  const fileName = `${dataFile}-${slug(nome)}.md`;
  const filePath = join(dir, fileName);
  const content = `---
created: ${data}
modified: ${data}
tipo: cliente
status: ativo
plano_mensal: ${planoMensal.toFixed(2)}
vencimento_dia: 1
dominio: ""
contrato_meses: 60
inicio: ${data}
renovacao_dominio: ""
pagamento: pendente
ultimo_pagamento: ""
contrato: ""
contato: "${nome}"
telefone: "${telefone || ''}"
segmento: "${segmento || ''}"
tags: [empresa/cliente/ativo]
---

# ${nome}

## Resumo
- **Status:** 🟢 Ativo
- **Plano:** R$ ${planoMensal.toFixed(2)}/mês
- **Vencimento:** dia 1
- **Desde:** ${data}

## Contato
- **Responsável:** ${nome}
- **Telefone:** ${telefone || '—'}

## Histórico de pagamentos
| Mês | Data pgto | Valor | Status |
|---|---|---:|:---:|

## Próximas ações
- [ ]

> Criado via Telegram bot.
`;
  await writeFile(filePath, content, 'utf8');
  return { fileName, filePath };
}

export async function criarLead(vaultPath, { nome, temperatura, potencial, segmento }) {
  const dir = join(vaultPath, 'Empresa', 'Clientes');
  await mkdir(dir, { recursive: true });
  const data = todayISO();
  const dataFile = todayFile();
  const fileName = `${dataFile}-${slug(nome)}.md`;
  const filePath = join(dir, fileName);
  const temp = ['frio', 'morno', 'quente'].includes(temperatura) ? temperatura : 'frio';
  const emoji = { quente: '🔥', morno: '🌡️', frio: '🧊' }[temp];
  const content = `---
created: ${data}
modified: ${data}
tipo: lead
status: ${temp}
prioridade: media
segmento: "${segmento || ''}"
origem: telegram
potencial_mensal: ${potencial.toFixed(2)}
proxima_acao: ""
proxima_acao_data: ""
contato: "${nome}"
telefone: ""
tags: [empresa/lead/${temp}, prioridade/media]
---

# ${nome}

## Resumo
- **Status:** ${emoji} Lead ${temp}
- **Segmento:** ${segmento || '—'}
- **Potencial:** R$ ${potencial.toFixed(2)}/mês
- **Origem:** Telegram

## Próxima ação
- **O que:**
- **Quando:**

## Histórico de contatos
-

> Criado via Telegram bot.
`;
  await writeFile(filePath, content, 'utf8');
  return { fileName, filePath };
}

export async function criarProposta(vaultPath, { cliente, valorMensal, valorSetup }) {
  const dir = join(vaultPath, 'Empresa', 'Propostas');
  await mkdir(dir, { recursive: true });
  const data = todayISO();
  const dataFile = todayFile();
  const fileName = `${dataFile}-proposta-${slug(cliente)}.md`;
  const filePath = join(dir, fileName);
  const totalAno1 = (valorSetup + valorMensal * 12).toFixed(2);
  const content = `---
created: ${data}
modified: ${data}
tipo: proposta
status: rascunho
cliente: "${cliente}"
valor_mensal: ${valorMensal.toFixed(2)}
valor_setup: ${valorSetup.toFixed(2)}
contrato_meses: 60
escopo_resumo: ""
enviada_em: ""
validade_dias: 15
tags: [empresa/proposta/rascunho]
---

# Proposta — ${cliente}

## Resumo executivo
- **Cliente:** ${cliente}
- **Investimento mensal:** R$ ${valorMensal.toFixed(2)}
- **Setup (one-shot):** R$ ${valorSetup.toFixed(2)}
- **Contrato:** 60 meses
- **Validade da proposta:** 15 dias

## Investimento
| Item | Valor |
|---|---:|
| Setup inicial | R$ ${valorSetup.toFixed(2)} |
| Mensalidade | R$ ${valorMensal.toFixed(2)}/mês |
| Contrato | 60 meses |
| **Total ano 1** | R$ ${totalAno1} |

## Próximos passos
1. Aceite via WhatsApp / e-mail
2. Reunião de briefing (30min)
3. Apresentação do layout em até 7 dias
4. Ajustes + aprovação
5. Site no ar em até 14 dias

---
*Proposta válida por 15 dias.*

> Criado via Telegram bot.
`;
  await writeFile(filePath, content, 'utf8');
  return { fileName, filePath };
}

export async function appendDiario(vaultPath, { texto, tipo }) {
  const d = new Date();
  const isoDate = todayISO();
  const dir = join(vaultPath, 'Pessoal', 'Diario');
  await mkdir(dir, { recursive: true });
  const fileName = `${isoDate}.md`;
  const filePath = join(dir, fileName);

  let existing = '';
  try { existing = await readFile(filePath, 'utf8'); } catch {}

  if (!existing) {
    existing = `---\ncreated: ${isoDate}\nmodified: ${isoDate}\ntipo: diario\ndata: ${isoDate}\ntags: [pessoal/diario]\n---\n\n# 📓 Diário — ${isoDate}\n\n`;
  }

  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const linha = tipo === 'tarefa'
    ? `- [ ] ${texto} *(${hora})*`
    : `- ${hora} ${texto}`;

  await writeFile(filePath, existing.trimEnd() + '\n' + linha + '\n', 'utf8');
  return { fileName, linha };
}

export async function lerStatus(vaultPath) {
  const { readdir } = await import('node:fs/promises');
  const d = new Date();
  const mesAtual = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  let mrr = 0, qtdClientes = 0, qtdLeads = 0;
  try {
    const clientesDir = join(vaultPath, 'Empresa', 'Clientes');
    const arquivos = (await readdir(clientesDir)).filter(f => f.endsWith('.md') && !f.includes('Clientes.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(clientesDir, a), 'utf8'));
      if (fm.tipo === 'cliente' && fm.status === 'ativo') { mrr += parseFloat(fm.plano_mensal || 0); qtdClientes++; }
      else if (fm.tipo === 'lead') qtdLeads++;
    }
  } catch {}

  let patrimonio = 0;
  try {
    const contasDir = join(vaultPath, 'Pessoal', 'Financeiro', 'Contas');
    const arquivos = (await readdir(contasDir)).filter(f => f.endsWith('.md') && !f.includes('Contas.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(contasDir, a), 'utf8'));
      if (fm.tipo === 'conta') patrimonio += parseFloat(fm.saldo || 0);
    }
  } catch {}

  let receitaMes = 0, despesaMes = 0, qtdLanc = 0;
  try {
    const lancDir = join(vaultPath, 'Pessoal', 'Financeiro', 'Lancamentos');
    const arquivos = (await readdir(lancDir)).filter(f => f.endsWith('.md') && !f.includes('Lancamentos.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(lancDir, a), 'utf8'));
      if (fm.tipo === 'lancamento' && (fm.data || '').startsWith(mesAtual)) {
        const v = parseFloat(fm.valor || 0);
        if (fm.natureza === 'receita') receitaMes += v;
        else if (fm.natureza === 'despesa') despesaMes += v;
        qtdLanc++;
      }
    }
  } catch {}

  return { mrr, qtdClientes, qtdLeads, patrimonio, receitaMes, despesaMes, qtdLanc };
}

export async function lerResumo(vaultPath, periodo = 'mes') {
  const { readdir } = await import('node:fs/promises');
  const lancDir = join(vaultPath, 'Pessoal', 'Financeiro', 'Lancamentos');
  const finDir = join(vaultPath, 'Pessoal', 'Financeiro');
  const cliDir = join(vaultPath, 'Empresa', 'Clientes');
  const hoje = new Date();
  let inicio, fim;
  if (periodo === 'hoje') {
    inicio = todayISO();
    fim = inicio;
  } else if (periodo === 'semana') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    inicio = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    fim = todayISO();
  } else {
    inicio = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-01`;
    const last = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    fim = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
  }
  const inRange = d => d && d >= inicio && d <= fim;

  let receita = 0, despesa = 0, qtd = 0;
  const cat = {}, met = {};

  // Lancamentos avulsos (ignora espelhos de fixas pra evitar dupla contagem)
  try {
    const arquivos = (await readdir(lancDir)).filter(f => f.endsWith('.md') && !f.includes('Lancamentos.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(lancDir, a), 'utf8'));
      if (fm.tipo !== 'lancamento') continue;
      if (fm.origem === 'fixa') continue;
      if (!inRange(fm.data || '')) continue;
      const v = parseFloat(fm.valor || 0);
      qtd++;
      if (fm.natureza === 'receita') receita += v;
      else if (fm.natureza === 'despesa') {
        despesa += v;
        cat[fm.categoria || '—'] = (cat[fm.categoria || '—'] || 0) + v;
        met[fm.metodo || '—'] = (met[fm.metodo || '—'] || 0) + v;
      }
    }
  } catch {}

  // Fixas (esperado mensal) — só conta se periodo cobre o mes inteiro (mes/semana intersecta)
  // Pra match com dashboard: soma TODAS recorrentes independente de pago, mas só se mes atual
  const isMesPeriodo = periodo === 'mes';
  if (isMesPeriodo) {
    try {
      const arquivos = (await readdir(finDir)).filter(f => f.endsWith('.md'));
      for (const a of arquivos) {
        const fm = parseFrontmatter(await readFile(join(finDir, a), 'utf8'));
        if (fm.recorrente !== 'true' && fm.recorrente !== true) continue;
        if (fm.tipo === 'despesa') {
          const v = parseFloat(fm.valor_mensal || 0);
          despesa += v;
          cat[fm.categoria || '—'] = (cat[fm.categoria || '—'] || 0) + v;
          met[fm.metodo || '—'] = (met[fm.metodo || '—'] || 0) + v;
        } else if (fm.tipo === 'receita') {
          receita += parseFloat(fm.valor_mensal || 0);
        }
      }
    } catch {}

    try {
      const arquivos = (await readdir(cliDir)).filter(f => f.endsWith('.md') && !f.includes('Clientes.md'));
      for (const a of arquivos) {
        const fm = parseFrontmatter(await readFile(join(cliDir, a), 'utf8'));
        if (fm.tipo !== 'cliente' || fm.status !== 'ativo') continue;
        receita += parseFloat(fm.plano_mensal || 0);
      }
    } catch {}
  }

  const topCat = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMet = Object.entries(met).sort((a, b) => b[1] - a[1]);
  return { periodo, inicio, fim, receita, despesa, sobra: receita - despesa, qtd, topCat, topMet };
}

export async function removerLancamento(vaultPath, fileName) {
  const { unlink } = await import('node:fs/promises');
  const filePath = join(vaultPath, 'Pessoal', 'Financeiro', 'Lancamentos', fileName);
  await unlink(filePath);
  return { fileName };
}

export async function lerSaldos(vaultPath) {
  const { readdir } = await import('node:fs/promises');
  const contas = [];
  try {
    const contasDir = join(vaultPath, 'Pessoal', 'Financeiro', 'Contas');
    const arquivos = (await readdir(contasDir)).filter(f => f.endsWith('.md') && !f.includes('Contas.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(contasDir, a), 'utf8'));
      if (fm.tipo === 'conta') {
        const nome = a.replace(/^\d{2}-\d{2}-\d{4}-/, '').replace('.md', '').replace(/-/g, ' ');
        contas.push({ nome, banco: fm.banco || '—', saldo: parseFloat(fm.saldo || 0), natureza: fm.natureza || '' });
      }
    }
  } catch {}
  return contas.sort((a, b) => b.saldo - a.saldo);
}

export async function lerContasSlugs(vaultPath) {
  const { readdir } = await import('node:fs/promises');
  const slugs = [];
  try {
    const dir = join(vaultPath, 'Pessoal', 'Financeiro', 'Contas');
    const arquivos = (await readdir(dir)).filter(f => f.endsWith('.md') && !f.includes('Contas.md'));
    for (const a of arquivos) {
      const slug = a.replace(/^\d{2}-\d{2}-\d{4}-/, '').replace('.md', '');
      slugs.push(slug);
    }
  } catch {}
  return slugs;
}

export async function criarSnapshotPatrimonio(vaultPath, { valor, contas }) {
  const dir = join(vaultPath, 'Pessoal', 'Financeiro', 'Snapshots');
  await mkdir(dir, { recursive: true });
  const data = todayISO();
  const fileName = `${data}.md`;
  const filePath = join(dir, fileName);
  const dataBr = data.split('-').reverse().join('/');
  const contasYaml = (contas || []).map(c => `  - { banco: "${c.banco || c.nome}", saldo: ${c.saldo.toFixed(2)} }`).join('\n');
  const contasMd = (contas || []).map(c => `- **${c.banco || c.nome}:** R$ ${c.saldo.toFixed(2).replace('.', ',')}`).join('\n');
  const content = `---
created: ${data}
tipo: snapshot
patrimonio: ${valor.toFixed(2)}
contas:
${contasYaml || '  []'}
tags: [pessoal/financeiro/snapshot]
---

# Snapshot — ${dataBr}

- **Patrimônio total:** R$ ${valor.toFixed(2).replace('.', ',')}
${contasMd}

> Criado via Telegram bot.
`;
  await writeFile(filePath, content, 'utf8');
  return { fileName, filePath };
}

export async function lerFixasPendentesSlugs(vaultPath) {
  const { readdir } = await import('node:fs/promises');
  const slugs = [];
  try {
    const dir = join(vaultPath, 'Pessoal', 'Financeiro');
    const arquivos = (await readdir(dir)).filter(f => f.endsWith('.md'));
    for (const a of arquivos) {
      const fm = parseFrontmatter(await readFile(join(dir, a), 'utf8'));
      if (fm.tipo === 'despesa' && fm.recorrente === 'true' && fm.status !== 'pago') {
        slugs.push(a.replace(/^\d{2}-\d{2}-\d{4}-/, '').replace('.md', ''));
      }
    }
  } catch {}
  return slugs;
}
