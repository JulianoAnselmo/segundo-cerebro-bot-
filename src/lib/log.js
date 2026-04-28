import { appendFile, stat, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_FILE = join(LOG_DIR, 'bot.log');
const MAX_BYTES = 5 * 1024 * 1024;

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});

async function rotateIfNeeded() {
  try {
    const s = await stat(LOG_FILE);
    if (s.size > MAX_BYTES) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(LOG_FILE, join(LOG_DIR, `bot-${ts}.log`));
    }
  } catch {}
}

function sanitize(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\d{8,}:[A-Za-z0-9_-]{30,}/g, '<token>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <token>');
}

async function write(level, msg, meta) {
  await rotateIfNeeded();
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: sanitize(msg),
    ...(meta && { meta })
  }) + '\n';
  await appendFile(LOG_FILE, line, 'utf8').catch(() => {});
  const tag = { info: '📒', warn: '⚠️', error: '❌', debug: '🔍' }[level] || '·';
  console.log(`${tag} ${msg}`);
}

export const log = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  debug: (m, meta) => process.env.DEBUG && write('debug', m, meta)
};
