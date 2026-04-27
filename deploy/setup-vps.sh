#!/bin/bash
# Bootstrap VPS Oracle Linux 9 — bot Segundo Cérebro
# Roda como user `opc` na VM Oracle.
set -e

echo "==> [1/6] Instalando git, Node 20, pm2"
sudo dnf install -y git
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pm2

echo ""
echo "==> [2/6] Gerando deploy key SSH pro GitHub"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ ! -f ~/.ssh/github ]; then
  ssh-keygen -t ed25519 -f ~/.ssh/github -N "" -C "oracle-bot-vault"
fi

cat > ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github
  StrictHostKeyChecking accept-new
  User git
EOF
chmod 600 ~/.ssh/config

echo ""
echo "==> [3/6] Configurando identidade git"
git config --global user.name "Bot Segundo Cerebro"
git config --global user.email "bot@segundocerebro.local"
git config --global init.defaultBranch main
git config --global pull.rebase true

echo ""
echo "==> [4/6] Clonando repo do bot (publico)"
mkdir -p ~/code && cd ~/code
[ ! -d bot ] && git clone https://github.com/JulianoAnselmo/segundo-cerebro-bot-.git bot
cd ~/code/bot && npm install

echo ""
echo "==> [5/6] Criando .env template"
if [ ! -f ~/code/bot/.env ]; then
  cat > ~/code/bot/.env <<'EOF'
TELEGRAM_BOT_TOKEN=PREENCHER_AQUI
ALLOWED_USER_IDS=978607165
VAULT_PATH=/home/opc/code/vault
VAULT_BRANCH=main
AUTO_PUSH=true
EOF
fi

echo ""
echo "==> [6/6] Setup base concluido"
echo ""
echo "================================================================"
echo "PROXIMOS PASSOS MANUAIS:"
echo "================================================================"
echo ""
echo "A) DEPLOY KEY — cola este conteudo no GitHub:"
echo "   Repo: segundo-cerebro -> Settings -> Deploy keys -> Add"
echo "   Marca 'Allow write access'"
echo ""
echo "----- BEGIN DEPLOY KEY -----"
cat ~/.ssh/github.pub
echo "----- END DEPLOY KEY -----"
echo ""
echo "B) Apos adicionar a deploy key, roda na VM:"
echo "   cd ~/code"
echo "   git clone git@github.com:JulianoAnselmo/segundo-cerebro.git vault"
echo ""
echo "C) Cria o bot no Telegram via @BotFather:"
echo "   - Manda /newbot"
echo "   - Nome amigavel + username terminado em _bot"
echo "   - Copia o token"
echo "   - Edita ~/code/bot/.env -> TELEGRAM_BOT_TOKEN=<token>"
echo ""
echo "D) Inicia bot com pm2:"
echo "   cd ~/code/bot"
echo "   pm2 start ecosystem.config.cjs"
echo "   pm2 save"
echo "   pm2 startup    # cola o comando que ele imprimir"
echo ""
echo "================================================================"
