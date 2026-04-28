import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { withLock } from './lib/lock.js';

const pexec = promisify(exec);

async function retry(fn, attempts = 3, baseMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, baseMs * Math.pow(2, i))); }
  }
  throw lastErr;
}

export async function gitPullCommitPush(vaultPath, branch, message) {
  return withLock(async () => {
    const opts = { cwd: vaultPath };
    await retry(() => pexec(`git pull --rebase origin ${branch}`, opts), 2);
    await pexec(`git add .`, opts);
    try {
      await pexec(`git commit -m "${message.replace(/"/g, '\\"')}"`, opts);
    } catch (e) {
      if (!String(e.stdout || '').includes('nothing to commit')) throw e;
      return { committed: false };
    }
    await retry(() => pexec(`git push origin ${branch}`, opts), 3);
    return { committed: true };
  });
}
