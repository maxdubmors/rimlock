#!/usr/bin/env node
// Part of pnpm check: one sentence per line in the Markdown files below (docs/spec/engineering.md
// § Checks), so two pull requests that edit neighbouring sentences touch different lines. With
// `--write`, part of pnpm format, it breaks the lines itself. A sentence ends at `.`, `?` or `!`,
// after any closing `)`, `"` or `**`, before a space and a capital letter, a digit, a backtick,
// `[` or `**`; never inside a code span, a link or parentheses, after `e.g.`, `i.e.`, `vs.` or
// `cf.`, or where the rest would read as a list item, heading, quote or table row. A wrapped
// sentence is indented to its list item's text. Headings, tables, quotes, HTML and fenced code
// stay as they are. Exits 1 on a line that holds two sentences.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = ['docs/spec/engineering.md'];
const write = process.argv.includes('--write');
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

const abbreviations = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf)\.$/;
const opensBlock = /^(?:[-*+]\s|\d+[.)]\s|#|>|\|)/;

/** The offsets in `text` where a new sentence starts. */
function sentenceStarts(text) {
  const starts = [];
  let code = false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '`') code = !code;
    if (code) continue;
    if (char === '[' || char === '(') depth += 1;
    if ((char === ']' || char === ')') && depth > 0) depth -= 1;
    if (char !== ' ' || depth > 0) continue;
    const before = text.slice(0, i).replace(/(?:\)|"|\*\*)+$/, '');
    const after = text.slice(i + 1);
    if (!/[.?!]$/.test(before) || abbreviations.test(before)) continue;
    if (!/^(?:[\p{Lu}\d`[]|\*\*)/u.test(after) || opensBlock.test(after)) continue;
    starts.push(i + 1);
  }
  return starts;
}

let found = 0;
for (const path of files) {
  const out = [];
  let fenced = false;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const [, indent, marker] = /^(\s*)([-*+]\s+|\d+[.)]\s+)?/.exec(line);
      const text = line.slice(indent.length + (marker ?? '').length);
      if (fenced || /^\s*(```|~~~)/.test(line) || /^(?:#|>|\||<)/.test(text) || text === '') {
        out.push(line);
        return;
      }
      const starts = sentenceStarts(text);
      if (starts.length === 0) {
        out.push(line);
        return;
      }
      found += 1;
      if (!write) console.log(`${path}:${index + 1}: ${starts.length + 1} sentences`);
      const continuation = ' '.repeat(indent.length + (marker ?? '').length);
      [0, ...starts].forEach((start, n) => {
        const sentence = text.slice(start, starts[n] ?? text.length).trimEnd();
        out.push(n === 0 ? `${indent}${marker ?? ''}${sentence}` : `${continuation}${sentence}`);
      });
    });
  if (write) writeFileSync(path, out.join('\n'));
}
if (found > 0 && !write) {
  console.log('One sentence per line: pnpm format breaks them.');
  process.exit(1);
}
