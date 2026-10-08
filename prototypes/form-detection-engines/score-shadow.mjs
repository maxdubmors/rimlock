// Scores results/shadow/<browser>/*.json. Each variant is scored against the
// fields of its own page load (fixture `gt`, or corpus/labels.json for live pages).
// Usage: node score-shadow.mjs <browser> [fixtures|live]; writes results/shadow/scores-<browser>-<scope>.md.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const [browserName = "chrome", scope = "fixtures"] = process.argv.slice(2);
const VARIANTS = ["proton", "protonWalk", "protonGroup"];
const labels = JSON.parse(readFileSync("corpus/labels.json", "utf8"));
const dir = `results/shadow/${browserName}`;
const pages = readdirSync(dir).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))
  .filter((p) => (scope === "fixtures") === (p.kind === "fixture"));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const stats = Object.fromEntries(VARIANTS.map((v) => [v, { ok: 0, pages: 0, correct: 0, total: 0, invisible: 0, ms: [], walk: [], roots: [], errors: 0 }]));
const rows = [];
// Live pages change between loads (bot challenges, A/B layouts). Variants are
// compared only on pages where every load showed the same visible fields.
const visibleSet = (p, v) => (p.runs[v] ?? []).flatMap((f) => f.fields ?? []).filter((f) => f.visible).map((f) => `${f.id}/${f.name}/${f.type}`).join(",");
const skipped = [];
for (const p of pages) {
  if (p.kind !== "fixture" && !labels[p.name]) continue;
  if (new Set(VARIANTS.map((v) => visibleSet(p, v))).size > 1) { skipped.push(p.name); continue; }
  const row = { name: p.name };
  for (const v of VARIANTS) {
    const s = stats[v];
    const frames = p.runs[v] ?? [];
    const fields = frames.flatMap((f) => f.fields ?? []);
    const truth = new Map(fields.filter((f) => f.visible).map((f) => [f.id, (p.kind === "fixture" ? f.gt : labels[p.name][f.id]) ?? "none"]));
    const pred = new Map();
    let ms = 0, walk = 0, roots = 0, err = null;
    for (const f of frames) {
      if (f.error || f[v]?.error) { err = f.error ?? f[v].error; continue; }
      if (!f[v]) continue;
      ms += f[v].ms; walk += f[v].walkMs ?? 0; roots += f[v].roots ?? 1;
      for (const x of f[v].fields) if (x.id) pred.set(x.id, x.label);
    }
    if (err) { s.errors++; row[v] = `ERR ${err}`; continue; }
    if (!truth.size) { row[v] = "(nothing visible)"; continue; }
    s.ms.push(ms); s.walk.push(walk); s.roots.push(roots);
    const misses = [];
    for (const [id, t] of truth) {
      const g = pred.get(id) ?? "none";
      s.total++;
      if (g === t) s.correct++; else misses.push(`${id} ${t}→${g}`);
    }
    for (const [id] of pred) if (!truth.has(id)) s.invisible++;
    s.pages++;
    if (!misses.length) s.ok++;
    row[v] = (misses.length ? misses.join("; ") : "✓") + ` (${ms.toFixed(1)} ms${v !== "proton" ? `, ${roots} roots` : ""})`;
  }
  rows.push(row);
}

let md = `# Shadow-root check: ${browserName}, ${scope}\n\n| | ${VARIANTS.join(" | ")} |\n|---|${VARIANTS.map(() => "---").join("|")}|\n`;
md += `| Pages fully correct | ${VARIANTS.map((v) => `${stats[v].ok}/${stats[v].pages}`).join(" | ")} |\n`;
md += `| Visible fields correct | ${VARIANTS.map((v) => `${stats[v].correct}/${stats[v].total}`).join(" | ")} |\n`;
md += `| Predictions on invisible fields | ${VARIANTS.map((v) => stats[v].invisible).join(" | ")} |\n`;
md += `| Median / max detection per page | ${VARIANTS.map((v) => `${median(stats[v].ms).toFixed(1)} / ${Math.max(0, ...stats[v].ms).toFixed(1)} ms`).join(" | ")} |\n`;
md += `| … of which root walk, median / max | – | ${VARIANTS.slice(1).map((v) => `${median(stats[v].walk).toFixed(1)} / ${Math.max(0, ...stats[v].walk).toFixed(1)} ms`).join(" | ")} |\n`;
md += `| Roots with an input, median / max | – | ${VARIANTS.slice(1).map((v) => `${median(stats[v].roots)} / ${Math.max(0, ...stats[v].roots)}`).join(" | ")} |\n`;
md += `| Pages with an error | ${VARIANTS.map((v) => stats[v].errors).join(" | ")} |\n`;
if (skipped.length) md += `\nNot compared (visible fields differed between loads): ${skipped.join(", ")}\n`;
md += `\n## Per page (misses as \`field truth→predicted\`)\n\n| Page | ${VARIANTS.join(" | ")} |\n|---|${VARIANTS.map(() => "---").join("|")}|\n`;
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) md += `| ${r.name} | ${VARIANTS.map((v) => r[v] ?? "–").join(" | ")} |\n`;
writeFileSync(`results/shadow/scores-${browserName}-${scope}.md`, md);
console.log(md);
