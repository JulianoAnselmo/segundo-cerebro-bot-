// Stack de operações desfazíveis por user
import { unlink, writeFile, readFile } from 'node:fs/promises';

const STACK = new Map();
const MAX_PER_USER = 10;

export function recordUndo(userId, op) {
  // op = { tipo: 'create_file'|'edit_file', filePath, prevContent? }
  const arr = STACK.get(userId) || [];
  arr.push({ ...op, ts: Date.now() });
  if (arr.length > MAX_PER_USER) arr.shift();
  STACK.set(userId, arr);
}

export async function undoLast(userId) {
  const arr = STACK.get(userId) || [];
  const op = arr.pop();
  if (!op) return null;
  STACK.set(userId, arr);

  if (op.tipo === 'create_file') {
    await unlink(op.filePath).catch(() => {});
  } else if (op.tipo === 'edit_file' && op.prevContent != null) {
    await writeFile(op.filePath, op.prevContent, 'utf8');
  }
  return op;
}

export async function snapshot(filePath) {
  try { return await readFile(filePath, 'utf8'); } catch { return null; }
}
