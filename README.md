# Telegram → Obsidian Vault — Bot Segundo Cérebro

Bot Telegram que lança receitas, despesas, cria clientes/leads/propostas, append no diário e mostra dashboard — tudo no vault Obsidian via git.

## Comandos

### 💸 Despesas por método (atalhos)
| Comando | Exemplo |
|---|---|
| `/cartao <valor> <categoria> [desc]` | `/cartao 152.30 alimentacao mercado` |
| `/pix <valor> <categoria> [desc]` | `/pix 50 transporte uber` |
| `/dinheiro <valor> <categoria> [desc]` | `/dinheiro 30 lazer cafe` |
| `/boleto <valor> <categoria> [desc]` | `/boleto 200 educacao curso` |

### 💸 Genérico
| Comando | Exemplo |
|---|---|
| `/gasto <valor> <metodo> <cat> [desc]` | `/gasto 50 pix transporte uber` |
| `/receita <valor> <categoria> [desc]` | `/receita 5000 salario abril` |

### 🏦 Contas
| Comando | Exemplo |
|---|---|
| `/saldo <conta-slug> <novo-valor>` | `/saldo itau 8500` |
| `/saldos` | lista todas as contas com saldos |
| `/pagar <despesa-slug>` | `/pagar wellhub` |

### 🏢 Empresa
| Comando | Exemplo |
|---|---|
| `/cliente <nome> <plano_mensal> [tel] [segmento]` | `/cliente "Padaria Pão Quente" 350 11999990000 alimentacao` |
| `/lead <nome> <frio\|morno\|quente> <potencial> [segmento]` | `/lead "Farmácia Central" quente 400 saude` |
| `/proposta <cliente> <valor_mensal> <valor_setup>` | `/proposta "Farmácia Central" 350 800` |

### 📓 Diário
| Comando | Exemplo |
|---|---|
| `/diario <texto>` | `/diario reunião com cliente bem` |
| `/tarefa <texto>` | `/tarefa ligar pro fornecedor` |

### 📊 Dashboard
| Comando | Ação |
|---|---|
| `/status` | MRR, clientes, leads, receitas/despesas mês, patrimônio |

Após cada operação: `git pull --rebase + add + commit + push` (se `AUTO_PUSH=true`).

## Setup VPS (Ubuntu/Debian)

### 1. Pré-requisitos

```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# pm2 pra rodar como serviço
sudo npm i -g pm2
```

### 2. Clonar vault + bot

```bash
sudo mkdir -p /opt && cd /opt

# Vault (substitua pela URL do seu repo)
git clone git@github.com:JulianoAnselmo/segundo-cerebro.git vault

# Bot
git clone <URL-DESTE-REPO> telegram-financeiro-bot
cd telegram-financeiro-bot
npm install
```

### 3. Configurar git no VPS pra push

```bash
# Gerar chave SSH e adicionar no GitHub (Deploy Key com write access)
ssh-keygen -t ed25519 -C "vps-bot"
cat ~/.ssh/id_ed25519.pub
# Cole no GitHub → repo segundo-cerebro → Settings → Deploy keys → Add (allow write)

# Identidade git
cd /opt/vault
git config user.name "Telegram Bot"
git config user.email "bot@juliano.local"
git remote set-url origin git@github.com:JulianoAnselmo/segundo-cerebro.git
git pull
```

### 4. Criar bot no Telegram

1. No Telegram, abre [@BotFather](https://t.me/BotFather)
2. `/newbot` → escolhe nome + username (`xxx_bot`)
3. Copia token

### 5. .env

```bash
cd /opt/telegram-financeiro-bot
cp .env.example .env
nano .env
```

Preencher:
```
TELEGRAM_BOT_TOKEN=...token-do-botfather...
ALLOWED_USER_IDS=               # deixa vazio na 1ª vez
VAULT_PATH=/opt/vault
VAULT_BRANCH=main
AUTO_PUSH=true
```

### 6. Pegar seu user_id

```bash
node src/index.js
```

No Telegram manda `/start` pro bot. No log da VPS aparece:
```
[BLOCK] user_id=123456789 username=julianoanselmo
```

`Ctrl+C`. Edita `.env` → `ALLOWED_USER_IDS=123456789`.

### 7. Rodar com pm2 (serviço perpétuo)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # cole o comando que ele imprimir
```

Logs: `pm2 logs telegram-financeiro-bot`
Reiniciar: `pm2 restart telegram-financeiro-bot`

### 8. PC local — sync via Obsidian Git

No Obsidian → Settings → Obsidian Git:
- **Auto pull on startup:** ON
- **Pull updates on startup:** ON
- **Auto pull interval:** 5 min (ou menos)

Bot push na VPS → seu PC pulla a cada 5 min → Obsidian renderiza.

## Estrutura de arquivos gerados

**Lançamento (`/gasto`, `/receita`):** `Pessoal/Financeiro/Lancamentos/27-04-2026-mercado-semanal.md`
```yaml
---
tipo: lancamento
natureza: despesa
valor: 152.30
data: 2026-04-27
categoria: alimentacao
conta: ""
descricao: "mercado semanal"
tags: [pessoal, financeiro, lancamento, despesa]
---
```

**Saldo (`/saldo`):** atualiza `saldo:` no frontmatter da conta + linha no histórico.

**Pago (`/pagar`):** atualiza `status: pago` + `ultimo_pagamento` na despesa fixa.

## Limitações conhecidas

- `conta` no `/gasto` ainda não é parsed — adicionar depois (campo opcional)
- Sem categorias validadas — qualquer string aceita
- Sem desfazer operação — se errar valor, edite manual no Obsidian
- Conflito de merge no git: bot tenta `pull --rebase` antes de push, mas se editar mesmo arquivo simultaneamente em PC + VPS pode dar conflito

## Próximas melhorias sugeridas

- `/mes` — resumo mensal direto no Telegram
- `/saldos` — lista todas contas com saldos
- Inline keyboard pra escolher categoria
- Voice-to-text (Whisper) → parsing
