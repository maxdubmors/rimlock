// Bundles each engine into an IIFE that exposes window.__rl_<engine>.detect().
// Prints minified and gzipped sizes, the yardstick for content-script cost.
import * as esbuild from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const bw = path.resolve("vendor/bitwarden");
const engines = ["bitwarden", "proton"];
mkdirSync("dist", { recursive: true });

// Every Bitwarden module replaced by a local stand-in. The length of this list
// is the extraction cost the ticket asks about.
const shims = {
  "services/autofill.service": "engines/shims/autofill.service.ts",
};
const shimPlugin = {
  name: "bitwarden-shims",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer.includes("vendor/bitwarden")) return;
      const full = path.resolve(args.resolveDir, args.path);
      for (const [from, to] of Object.entries(shims)) {
        if (full === `${bw}/apps/browser/src/autofill/${from}`) return { path: path.resolve(to) };
      }
    });
  },
};

for (const engine of engines) {
  for (const minify of [false, true]) {
    const outfile = `dist/${engine}${minify ? ".min" : ""}.js`;
    const result = await esbuild.build({
      entryPoints: [`engines/${engine}.ts`],
      bundle: true,
      format: "iife",
      globalName: `__rl_${engine}`,
      target: "chrome120",
      minify,
      metafile: true,
      outfile,
      logLevel: "warning",
      plugins: [shimPlugin],
      alias: {
        bw: `${bw}/apps/browser/src/autofill`,
        "@bitwarden/common": `${bw}/libs/common/src`,
      },
    });
    if (minify) {
      const code = readFileSync(outfile);
      const inputs = Object.keys(result.metafile.inputs);
      const lines = inputs
        .filter((f) => !f.startsWith("engines/"))
        .reduce((n, f) => n + readFileSync(f, "utf8").split("\n").length, 0);
      console.log(
        `${engine}: ${inputs.length} modules, ${lines} source lines, ` +
          `${(code.length / 1024).toFixed(1)} KiB min, ${(gzipSync(code).length / 1024).toFixed(1)} KiB min+gz`,
      );
    }
  }
}
