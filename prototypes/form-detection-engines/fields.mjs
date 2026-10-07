// Prints the visible fields of live pages compactly, for writing corpus/labels.json
// by hand. Engine output is printed after the fields, so labels are decided from
// the field summary and screenshot first. Usage: node fields.mjs [name-filter]
import { readFileSync, readdirSync } from "node:fs";
const filter = process.argv[2];
for (const f of readdirSync("results/raw").sort()) {
  const p = JSON.parse(readFileSync(`results/raw/${f}`, "utf8"));
  if (p.kind === "fixture" || (filter && !p.name.includes(filter))) continue;
  console.log(`\n## ${p.name} (${p.kind}) ${p.finalUrl ?? ""} ${p.error ?? ""}`);
  for (const fr of p.frames ?? []) {
    const vis = (fr.fields ?? []).filter((x) => x.visible);
    if (!vis.length) continue;
    console.log(` frame ${fr.url.slice(0, 90)} "${(fr.title ?? "").slice(0, 50)}"`);
    for (const x of vis) {
      const attrs = [x.type, x.name && `name=${x.name}`, x.htmlId && `id=${x.htmlId}`, x.autocomplete && `ac=${x.autocomplete}`,
        x.placeholder && `ph="${x.placeholder}"`, x.aria && `aria="${x.aria}"`, x.maxlength && `max=${x.maxlength}`, x.shadow && "shadow", x.form ? `form=${x.form.slice(0, 30)}` : "noform"].filter(Boolean).join(" ");
      console.log(`  ${x.id.padEnd(6)} ${attrs} | ${x.label.slice(0, 60)}`);
    }
    for (const e of ["bitwarden", "proton"]) {
      const d = fr[e];
      console.log(`   ${e.slice(0, 2)}: ${d?.error ?? (d?.fields ?? []).map((y) => `${y.id}=${y.label}`).join(" ")}`);
    }
  }
}
