#!/usr/bin/env node
// Part of pnpm check: one sentence per line in the Markdown files below (docs/spec/engineering.md
// § Checks), so two pull requests that edit neighbouring sentences touch different lines. With
// `--write`, part of pnpm format, it breaks the lines itself. A sentence ends at `.`, `?` or `!`,
// after any closing `)`, `"`, `*` or `_`, before spaces and a capital letter, a digit, a
// backtick, `[` or `**`; never inside a code span, a link or parentheses, after `e.g.`, `i.e.`,
// `vs.`, `cf.` or `approx.`, or where the rest would open a block. A wrapped sentence is indented
// to its list item's text. Headings, tables, quotes, HTML and code stay as they are; indented code
// is told apart only outside lists. Exits 1 on a line that holds two sentences.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fence, opensBlock } from './markdown.mjs';

// `[--write] [FILE…]`; the files default to those that keep the rule so far.
const args = process.argv.slice(2);
const write = args.includes('--write');
const named = args.filter((arg) => arg !== '--write').map((file) => resolve(file));
const files = named.length > 0 ? named : ['docs/spec/engineering.md'];
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

const abbreviation = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|approx)\.$/i;

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
    // A run of spaces splits at its last one.
    if (char !== ' ' || depth > 0 || text[i + 1] === ' ') continue;
    const before = text
      .slice(0, i)
      .trimEnd()
      .replace(/[)"*_]+$/, '');
    const after = text.slice(i + 1);
    if (!/[.?!]$/.test(before) || abbreviation.test(before)) continue;
    if (!/^(?:[\p{Lu}\d`[]|\*\*)/u.test(after) || opensBlock.test(after)) continue;
    starts.push(i + 1);
  }
  return starts;
}

let found = 0;
for (const path of files) {
  const out = [];
  let fenced = false;
  let inList = false;
  let previousBlank = true;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const isFence = fence.test(line);
      if (isFence) fenced = !fenced;
      const [, indent, marker = ''] = /^(\s*)([-*+]\s+|\d+[.)]\s+)?/.exec(line);
      const text = line.slice(indent.length + marker.length);
      if (marker !== '') inList = true;
      else if (indent === '' && text !== '') inList = false;
      const indentedCode = indent.length >= 4 && previousBlank && !inList;
      previousBlank = line.trim() === '';
      const starts =
        fenced || isFence || indentedCode || /^(?:#|>|\||<)/.test(text) ? [] : sentenceStarts(text);
      if (starts.length === 0) {
        out.push(line);
        return;
      }
      found += 1;
      if (!write) console.error(`${path}:${index + 1}: ${starts.length + 1} sentences`);
      const continuation = ' '.repeat(indent.length + marker.length);
      out.push(`${indent}${marker}${text.slice(0, starts[0]).trimEnd()}`);
      starts.forEach((start, n) => {
        const end = starts[n + 1];
        const sentence = end === undefined ? text.slice(start) : text.slice(start, end).trimEnd();
        out.push(`${continuation}${sentence}`);
      });
    });
  if (write) writeFileSync(path, out.join('\n'));
}
if (found > 0 && !write) {
  console.error('One sentence per line: pnpm format breaks them.');
  process.exit(1);
}
