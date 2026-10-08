// Bundles ext/content.ts into ext/content.js, the test extension's content script.
import * as esbuild from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

for (const minify of [false, true]) {
  const outfile = minify ? "dist/content.min.js" : "ext/content.js";
  await esbuild.build({ entryPoints: ["ext/content.ts"], bundle: true, format: "iife", target: ["chrome120", "firefox128"], minify, outfile, logLevel: "warning" });
  if (minify) {
    const code = readFileSync(outfile);
    console.log(`content script: ${(code.length / 1024).toFixed(1)} KiB min, ${(gzipSync(code).length / 1024).toFixed(1)} KiB min+gz`);
  }
}
