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

// A job is a key at two spaces under `jobs:`; GitHub names its check by the job's `name:`, at four
// spaces (a step's is deeper), or else by the key.
const jobs = [];
let inJobs = false;
for (const line of readFileSync('.github/workflows/pull-request.yml', 'utf8').split('\n')) {
  if (/^\S/.test(line)) inJobs = line.startsWith('jobs:');
  const key = inJobs ? /^ {2}([\w-]+):\s*$/.exec(line)?.[1] : undefined;
  const name = inJobs ? /^ {4}name: (.+)$/.exec(line)?.[1] : undefined;
  if (key !== undefined) jobs.push(key);
  if (name !== undefined && jobs.length > 0) {
    jobs[jobs.length - 1] = name.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

// `gh ruleset check` prints no JSON: each required check is a `map[context:… integration_id:…]`,
// the integration only when the check names its source.
const rules = execFileSync('gh', ['ruleset', 'check', 'main'], { encoding: 'utf8' });
const required = [...rules.matchAll(/map\[context:(.*?)(?: integration_id:\d+)?\]/g)].map(
  (match) => match[1],
);

const notRequired = jobs.filter((job) => !required.includes(job));
const noJob = required.filter((check) => !jobs.includes(check));
for (const job of notRequired) console.error(`not a required check: ${job}`);
for (const check of noJob) console.error(`required, but no job reports it: ${check}`);
if (notRequired.length > 0 || noJob.length > 0) {
  console.error('The owner changes the required checks of the ruleset `main` on GitHub.');
  process.exit(1);
}
console.log(`pnpm check:required-checks: green (${jobs.length} jobs)`);
