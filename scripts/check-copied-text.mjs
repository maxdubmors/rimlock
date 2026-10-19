#!/usr/bin/env node
// `pnpm check:copied-text <issue>`: checks that a documentation ticket's Desired behavior text is in
// the repository word for word. It reads the ticket's last Agent Brief (a comment, or else the
// body), takes each `>` quote block under **Desired behavior:**, and looks for its lines, in order,
// as consecutive lines of one Markdown file in the working tree. Lines compare without their
// leading and trailing spaces, so a quoted `- ` bullet matches a sub-bullet. Prints where each
// block is; exits 1 if one is missing, 2 if the ticket has no quoted Desired behavior.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [issue] = process.argv.slice(2);
if (!/^\d+$/.test(issue ?? '')) {
  console.error('Usage: pnpm check:copied-text <issue>');
  process.exit(2);
}
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

const ticket = JSON.parse(
  execFileSync('gh', ['issue', 'view', issue, '--json', 'body,comments'], { encoding: 'utf8' }),
);
const brief = [ticket.body, ...ticket.comments.map((comment) => comment.body)]
  .filter((text) => text.includes('## Agent Brief'))
  .at(-1);
if (brief === undefined) {
  console.error(`#${issue} has no Agent Brief.`);
  process.exit(2);
}

// The `>` quote blocks between **Desired behavior:** and the next `**Label:**` line.
const quoteBlocks = [];
let inDesired = false;
let block;
for (const line of brief.split(/\r?\n/)) {
  if (/^\*\*[^*]+:\*\*/.test(line)) inDesired = line.startsWith('**Desired behavior:**');
  const quoted = inDesired ? /^\s*>\s?(.*)$/.exec(line)?.[1] : undefined;
  if (quoted === undefined) block = undefined;
  else if (block === undefined) quoteBlocks.push((block = [quoted.trim()]));
  else block.push(quoted.trim());
}
// A block's `>` lines with no text, at its start or end, are not copied.
const blocks = quoteBlocks
  .map((lines) => lines.slice(lines.findIndex((line) => line !== '')))
  .map((lines) => lines.slice(0, lines.findLastIndex((line) => line !== '') + 1))
  .filter((lines) => lines.length > 0);
if (blocks.length === 0) {
  console.error(`#${issue} has no quoted text under **Desired behavior:**.`);
  process.exit(2);
}

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path !== '' && existsSync(path))
  .map((path) => [
    path,
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim()),
  ]);

let missing = 0;
for (const lines of blocks) {
  const found = files.flatMap(([path, fileLines]) =>
    fileLines.flatMap((_, start) =>
      lines.every((line, offset) => fileLines[start + offset] === line)
        ? [`${path}:${start + 1}`]
        : [],
    ),
  );
  const excerpt = lines[0].length > 80 ? `${lines[0].slice(0, 80)}…` : lines[0];
  if (found.length === 0) missing += 1;
  console.log(`${found.length === 0 ? 'missing' : found.join(', ')}: ${excerpt}`);
}
if (missing > 0) process.exit(1);
console.log('pnpm check:copied-text: green');
