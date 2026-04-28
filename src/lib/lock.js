// Mutex serial pra ops git — evita race condition entre comandos simultâneos
let queue = Promise.resolve();
export function withLock(fn) {
  const next = queue.then(() => fn(), () => fn());
  queue = next.catch(() => {});
  return next;
}
