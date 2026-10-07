// Scores results/raw/*.json against ground truth: `gt` captured from fixtures'
// data-gt, or corpus/labels.json for live pages ({ "<page>": { "<field id>": label } },
// unlisted visible fields are "none"). Only visible fields are scored; predictions
// on invisible fields are counted separately (hidden-form harvesting surface).
// Usage: node score.mjs [live|fixtures]; writes results/scores-<scope>.md and prints it.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const LABELS = ["username", "current-password", "new-password", "signup-username", "otp"];
const ENGINES = ["bitwarden", "proton"];
const labels = existsSync("corpus/labels.json") ? JSON.parse(readFileSync("corpus/labels.json", "utf8")) : {};
delete labels._rules;
const scope = process.argv[2] ?? "all";
const pages = readdirSync("results/raw").filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`results/raw/${f}`, "utf8")));

const stats = Object.fromEntries(ENGINES.map((e) => [e, {
  cls: Object.fromEntries(LABELS.map((l) => [l, { tp: 0, fp: 0, fn: 0 }])),
  correct: 0, total: 0, invisible: 0, pagesOk: 0, pages: 0, ms: [], errors: 0,
  groups: {},
}]));
const rows = [];

for (const p of pages) {
  if (!p.frames) continue;
  if ((scope === "live" && p.kind === "fixture") || (scope === "fixtures" && p.kind !== "fixture")) continue;
  const pageLabels = labels[p.name];
  const isFixture = p.kind === "fixture";
  if (!isFixture && !pageLabels) continue; // not labelled yet
  const group = p.kind === "fixture" ? "fixture" : p.kind;
  const fields = p.frames.flatMap((f) => f.fields ?? []);
  const truth = new Map();
  if (!fields.some((f) => f.visible)) continue; // nothing on screen at capture time
  for (const f of fields) {
    if (!f.visible) continue;
    truth.set(f.id, (isFixture ? f.gt : pageLabels[f.id]) ?? "none");
  }
  const row = { name: p.name, group };
  for (const e of ENGINES) {
    const s = stats[e];
    const pred = new Map();
    let ms = 0, err = false;
    for (const fr of p.frames) {
      const d = fr[e];
      if (!d) continue;
      if (d.error) { err = true; continue; }
      ms += d.ms;
      for (const x of d.fields) if (x.id) pred.set(x.id, x.label);
    }
    if (err) s.errors++;
    s.ms.push(ms);
    const misses = [];
    for (const [id, t] of truth) {
      const g = pred.get(id) ?? "none";
      s.total++;
      if (g === t) s.correct++;
      else misses.push(`${id} ${t}→${g}`);
      if (t !== "none") (g === t ? s.cls[t].tp++ : s.cls[t].fn++);
      if (g !== "none" && g !== t) s.cls[g].fp++;
    }
    for (const [id] of pred) if (!truth.has(id)) s.invisible++;
    const ok = misses.length === 0;
    s.pages++;
    if (ok) s.pagesOk++;
    s.groups[group] ??= { ok: 0, n: 0 };
    s.groups[group].n++;
    if (ok) s.groups[group].ok++;
    row[e] = ok ? "✓" : misses.join("; ");
  }
  rows.push(row);
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "–");
const f1 = ({ tp, fp, fn }) => (tp ? (2 * tp) / (2 * tp + fp + fn) : 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
let md = `# Scores (${scope})\n\n`;
md += "| | " + ENGINES.join(" | ") + " |\n|---|" + ENGINES.map(() => "---").join("|") + "|\n";
md += `| Pages fully correct | ${ENGINES.map((e) => `${stats[e].pagesOk}/${stats[e].pages} (${pct(stats[e].pagesOk, stats[e].pages)})`).join(" | ")} |\n`;
const groups = [...new Set(rows.map((r) => r.group))];
for (const g of groups) md += `| … ${g} | ${ENGINES.map((e) => `${stats[e].groups[g]?.ok ?? 0}/${stats[e].groups[g]?.n ?? 0}`).join(" | ")} |\n`;
md += `| Visible fields correct | ${ENGINES.map((e) => `${stats[e].correct}/${stats[e].total} (${pct(stats[e].correct, stats[e].total)})`).join(" | ")} |\n`;
for (const l of LABELS) {
  md += `| ${l}: P / R / F1 | ${ENGINES.map((e) => { const c = stats[e].cls[l]; return `${pct(c.tp, c.tp + c.fp)} / ${pct(c.tp, c.tp + c.fn)} / ${f1(c).toFixed(2)} (n=${c.tp + c.fn})`; }).join(" | ")} |\n`;
}
md += `| Predictions on invisible fields | ${ENGINES.map((e) => stats[e].invisible).join(" | ")} |\n`;
md += `| Median detection time per page | ${ENGINES.map((e) => `${median(stats[e].ms).toFixed(1)} ms`).join(" | ")} |\n`;
md += `| Max detection time per page | ${ENGINES.map((e) => `${Math.max(...stats[e].ms).toFixed(0)} ms`).join(" | ")} |\n`;
md += `| Pages where the engine threw | ${ENGINES.map((e) => stats[e].errors).join(" | ")} |\n`;
md += "\n## Per page (misses as `field truth→predicted`)\n\n| Page | " + ENGINES.join(" | ") + " |\n|---|" + ENGINES.map(() => "---").join("|") + "|\n";
for (const r of rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))) md += `| ${r.name} | ${ENGINES.map((e) => r[e]).join(" | ")} |\n`;
writeFileSync(`results/scores-${scope}.md`, md);
console.log(md);
