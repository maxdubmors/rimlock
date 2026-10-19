#!/usr/bin/env node
// `pnpm check:required-checks`: every job of .github/workflows/pull-request.yml is a required
// status check of the rules on `main`, and every required check is such a job
// (docs/spec/engineering.md § CI). A job left out lets a pull request merge with it red; a
// required check no job reports blocks every pull request. Reads the rules with
// `gh ruleset check main`, which needs `gh` signed in. Exits 1 on a difference.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

// A job's `name:` sits at four spaces, under `jobs:`; a step's is deeper.
const jobs = readFileSync('.github/workflows/pull-request.yml', 'utf8')
  .split('\n')
  .flatMap((line) => /^ {4}name: (.+)$/.exec(line)?.[1] ?? [])
  .map((name) => name.trim().replace(/^(['"])(.*)\1$/, '$2'));

// `gh ruleset check` prints no JSON: the required checks are its `context:` values, each up to
// the ` integration_id:` that follows it.
const rules = execFileSync('gh', ['ruleset', 'check', 'main'], { encoding: 'utf8' });
const required = [...rules.matchAll(/context:(.+?) integration_id:/g)].map((match) => match[1]);

const notRequired = jobs.filter((job) => !required.includes(job));
const noJob = required.filter((check) => !jobs.includes(check));
for (const job of notRequired) console.log(`not a required check: ${job}`);
for (const check of noJob) console.log(`required, but no job reports it: ${check}`);
if (notRequired.length > 0 || noJob.length > 0) {
  console.log('The owner changes the required checks of the ruleset `main` on GitHub.');
  process.exit(1);
}
console.log(`pnpm check:required-checks: green (${jobs.length} jobs)`);
