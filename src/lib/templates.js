import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_FILE = join(__dirname, '..', 'data', 'templates.json');

export async function loadTemplates() {
  try {
    return JSON.parse(await readFile(TEMPLATES_FILE, 'utf8'));
  } catch { return {}; }
}

export async function saveTemplate(nome, dados) {
  const t = await loadTemplates();
  t[nome] = dados;
  await writeFile(TEMPLATES_FILE, JSON.stringify(t, null, 2));
}

export async function deleteTemplate(nome) {
  const t = await loadTemplates();
  delete t[nome];
  await writeFile(TEMPLATES_FILE, JSON.stringify(t, null, 2));
}
