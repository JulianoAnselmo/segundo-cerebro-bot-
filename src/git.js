import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(exec);

export async function gitPullCommitPush(vaultPath, branch, message) {
  const opts = { cwd: vaultPath };
  await pexec(`git pull --rebase origin ${branch}`, opts);
  await pexec(`git add .`, opts);
  try {
    await pexec(`git commit -m "${message.replace(/"/g, '\\"')}"`, opts);
  } catch (e) {
    if (!String(e.stdout || '').includes('nothing to commit')) throw e;
    return { committed: false };
  }
  await pexec(`git push origin ${branch}`, opts);
  return { committed: true };
}
