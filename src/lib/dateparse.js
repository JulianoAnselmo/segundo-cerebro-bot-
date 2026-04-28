function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function offsetISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Extrai token de data dos args. Suporta:
//   @hoje, @ontem, @anteontem
//   @DD/MM, @DD/MM/YYYY, @DD-MM, @DD-MM-YYYY
//   @YYYY-MM-DD
// Retorna { dataISO, args } com token removido. Se não achar, dataISO=null.
export function extractDate(args) {
  const out = [];
  let dataISO = null;
  for (const a of args) {
    if (!a.startsWith('@')) { out.push(a); continue; }
    const tok = a.slice(1).toLowerCase();
    if (tok === 'hoje') { dataISO = todayISO(); continue; }
    if (tok === 'ontem') { dataISO = offsetISO(-1); continue; }
    if (tok === 'anteontem') { dataISO = offsetISO(-2); continue; }
    // YYYY-MM-DD
    let m = tok.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) { dataISO = `${m[1]}-${m[2]}-${m[3]}`; continue; }
    // DD/MM ou DD-MM (com ou sem ano)
    m = tok.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
    if (m) {
      const dd = pad(m[1]), mm = pad(m[2]);
      let yyyy = m[3] || String(new Date().getFullYear());
      if (yyyy.length === 2) yyyy = '20' + yyyy;
      dataISO = `${yyyy}-${mm}-${dd}`;
      continue;
    }
    // não bateu — devolve token como arg
    out.push(a);
  }
  return { dataISO, args: out };
}

// Extrai data de texto natural ("ontem", "dia 25/04", "25/04") sem precisar @.
// Retorna { dataISO, cleanText } com tokens removidos.
export function extractNaturalDate(text) {
  let s = ' ' + text + ' ';
  let dataISO = null;
  // hoje/ontem/anteontem
  const m1 = s.match(/\b(hoje|ontem|anteontem)\b/i);
  if (m1) {
    const tok = m1[1].toLowerCase();
    if (tok === 'hoje') dataISO = todayISO();
    else if (tok === 'ontem') dataISO = offsetISO(-1);
    else dataISO = offsetISO(-2);
    s = s.replace(m1[0], ' ');
  }
  // "dia DD" ou "dia DD/MM"
  const m2 = s.match(/\bdia\s+(\d{1,2})(?:[\/-](\d{1,2})(?:[\/-](\d{2,4}))?)?\b/i);
  if (m2 && !dataISO) {
    const dd = pad(m2[1]);
    const now = new Date();
    const mm = m2[2] ? pad(m2[2]) : pad(now.getMonth() + 1);
    let yyyy = m2[3] || String(now.getFullYear());
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    dataISO = `${yyyy}-${mm}-${dd}`;
    s = s.replace(m2[0], ' ');
  }
  // DD/MM ou DD/MM/YYYY (ou - como separador)
  const m3 = s.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (m3 && !dataISO) {
    const dd = pad(m3[1]);
    const mm = pad(m3[2]);
    let yyyy = m3[3] || String(new Date().getFullYear());
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    dataISO = `${yyyy}-${mm}-${dd}`;
    s = s.replace(m3[0], ' ');
  }
  return { dataISO, cleanText: s.replace(/\s+/g, ' ').trim() };
}
