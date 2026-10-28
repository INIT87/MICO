// Renders the causes page the way the desk layout and CauseTable render it.
// Numbers come from the export. Nothing in the table is typed by hand.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'src/lib/data');
const signature = 'Michał Nitsze';
const reviewed = '2026-10-28';
const ticket = 4471;

const tenants = readdirSync(join(data, 'tenants'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(data, 'tenants', f), 'utf8')));
const byHandle = new Map(tenants.map((t) => [t.handle, t]));
const reports = JSON.parse(readFileSync(join(data, 'reports-4471.json'), 'utf8'));
const notes = JSON.parse(readFileSync(join(data, 'desk-notes.json'), 'utf8'));

const DATE_HINT = { 'booking-v2': 'DD/MM/YYYY', 'booking-v3': 'MM/DD/YYYY' };

function dayFirst(locale) {
  const order = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.UTC(2026, 0, 2, 12)))
    .map((p) => p.type);
  return order.indexOf('day') < order.indexOf('month');
}

function causeOf(r, t) {
  if (!t || !dayFirst(t.locale)) return null;
  return r.channel === 'form' && DATE_HINT[t.form].startsWith('MM') ? 'hint' : 'parser';
}

function uniqueById(rows) {
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

function groupByCause(rows) {
  const byCause = new Map();
  for (const r of rows) {
    const cause = causeOf(r, byHandle.get(r.tenant)) ?? 'unplaced';
    byCause.set(cause, [...(byCause.get(cause) ?? []), r]);
  }
  return [...byCause.entries()]
    .map(([cause, rs]) => {
      const days = rs.map((r) => r.receivedAt.slice(0, 10)).sort();
      return {
        cause,
        reports: rs,
        taggedAs: rs.reduce((n, r) => ({ ...n, [r.meta.intakeTag]: (n[r.meta.intakeTag] ?? 0) + 1 }), {}),
        tenants: new Set(rs.map((r) => r.tenant)).size,
        firstSeen: days[0],
        lastSeen: days[days.length - 1],
        mergedInto: [...new Set(rs.flatMap((r) => (r.mergedInto ? [r.mergedInto] : [])))],
      };
    })
    .sort((a, b) => b.reports.length - a.reports.length);
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function deskRef(sig) {
  const t = sig.trim();
  const a = fnv1a(t, 0x811c9dc5);
  const b = fnv1a(t, 0x9e3779b9);
  let bits = (BigInt(a) << 8n) | BigInt(b & 0xff);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `DR-${out.slice(0, 4)}-${out.slice(4)}`;
}

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const merged = uniqueById(reports).filter((r) => r.mergedInto === ticket);
const groups = groupByCause(merged);
const owner = groups.find((g) => g.mergedInto.includes(ticket))?.cause ?? null;
const tags = (g) =>
  Object.entries(g.taggedAs)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => `${tag} ×${n}`)
    .join(' · ');

const age = Math.floor((Date.now() - new Date(reviewed).getTime()) / 86_400_000);
const rows = groups
  .map((g) => {
    const wrong = g.cause !== owner;
    const where = g.cause === owner ? `#${ticket}` : 'not this ticket — no ticket of its own';
    return `<tr class="${wrong ? 'wrong' : ''}"><td><code>${esc(g.cause)}</code></td><td>${g.reports.length}</td><td class="tags">${esc(tags(g))}</td><td>${g.tenants}</td><td>${esc(g.firstSeen)} → ${esc(g.lastSeen)}</td><td>${esc(where)}</td></tr>`;
  })
  .join('\n');
const notesHtml = groups
  .map((g) => {
    const moved = g.reports.filter((r) => notes.oneDayMove.includes(r.id)).length;
    return moved ? `<p class="note">${moved} reports read as a one-day move; filed under <code>${esc(g.cause)}</code> by tenant.</p>` : '';
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>#4471 holds two problems · support kb</title>
<style>
  :root {
    --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8;
    --accent: #2f6f5e; --warn: #b4501f; --warn-bg: #fbeee6; --note-bg: #eef5f2;
    --mono: ui-monospace, 'Cascadia Code', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171716; --fg: #ecebe6; --muted: #9c9a93; --line: #34332f;
      --accent: #6fbfa6; --warn: #f0905d; --warn-bg: #3a2418; --note-bg: #1d2c27;
    }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  .kb table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  .kb th, .kb td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.5rem; text-align: left; }
  .kb code { font-family: var(--mono); font-size: 0.88em; }
  .kb a { color: var(--accent); }
  .kb { max-width: 760px; margin: 0 auto; padding: 2rem 16px 4rem; }
  .crumb { font: 0.8rem var(--mono); text-decoration: none; color: var(--muted); }
  h1 { margin: 0.25rem 0 0.5rem; line-height: 1.2; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--muted); font-size: 0.85rem; margin: 0; }
  .status { border: 1px solid var(--line); border-radius: 99px; padding: 0 0.6rem; }
  .stale { color: var(--warn); font-weight: 600; }
  .banner { background: var(--warn-bg); color: var(--warn); padding: 0.6rem 1rem; border-radius: 6px; }
  footer { margin-top: 3rem; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  aside { border-left: 4px solid var(--warn); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--warn-bg); }
  .sum { font-size: 1.1rem; }
  .tags { color: var(--muted); font-size: 0.85em; }
  .note { color: var(--muted); font-size: 0.85em; }
  .wrong td { background: var(--warn-bg); }
  .wrong td:last-child { color: var(--warn); font-weight: 600; }
  .stamp { margin: 2rem 0 0; font: 0.85rem var(--mono); color: var(--muted); }
  .stamp b { color: var(--accent); letter-spacing: 0.04em; }
</style>
</head>
<body>
<div class="kb">
  <header>
    <a class="crumb" href="/kb">support desk · kb</a>
    <h1>#4471 holds two problems</h1>
    <p class="meta">
      <span>owner <b>Michał Nitsze</b></span>
      <span class="status open">open</span>
      <span${age > 180 ? ' class="stale"' : ''}>reviewed ${reviewed} · ${age} days ago${age > 180 ? ' · stale' : ''}</span>
    </p>
  </header>
  ${age > 180 ? `<p class="banner">Nobody has re-read this page in ${age} days. Check it against the live views before you rely on it.</p>` : ''}
  <main>
    <p>#4471 merged every date report into one known issue. The cause is not the subject line, and it is not the tag intake guessed from the browser. It is the tenant: the locale they write dates in, and which booking form they run.</p>
    <p>The ticket's own cause is the one most of its reports share. Anything else in the table was merged into the wrong place.</p>
    <h2>parser</h2>
    <p>The shared parser reads every date month first. A day-first tenant's dates come out flipped. Reports that arrived through the app, by email, or through a form whose hint already says DD/MM/YYYY are this bug. This is #4471.</p>
    <h2>hint</h2>
    <p>booking-v3 prints MM/DD/YYYY under the date field. On a day-first tenant the form still reads the day first, so people type the month first, the way the hint tells them, and the day and month swap for a different reason. Those reports came in through the form. They need a ticket of their own.</p>
    <aside class="warn"><p>The desk marked #4471 known, as one issue with one fix. The table shows a second cause.</p></aside>
    <p class="sum"><strong>${merged.length}</strong> reports merged into #${ticket} · <strong>${groups.length}</strong> ${groups.length === 1 ? 'cause' : 'causes'}</p>
    <table>
      <thead><tr><th>cause</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th></th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${notesHtml}
    <p>A few reports were read as a one-day move. They stay in the count of the cause they are filed under. The table footnotes them.</p>
    <p class="stamp">desk ref <b>${esc(deskRef(signature))}</b></p>
  </main>
  <footer>Pages are written by people. Tables and charts are built from data at render time.</footer>
</div>
</body>
</html>
`;

const out = join(root, 'src/routes/kb/incidents/4471/causes/as-the-desk-sees-it.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(JSON.stringify({
  uniqueMerged: merged.length,
  raw: reports.length,
  groups: groups.map((g) => ({ cause: g.cause, n: g.reports.length, tenants: g.tenants, seen: `${g.firstSeen} → ${g.lastSeen}`, tags: tags(g) })),
  owner,
  deskRef: deskRef(signature),
  out,
}, null, 2));
