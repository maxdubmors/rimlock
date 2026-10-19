#!/usr/bin/env node
// `pnpm grep:sections <pattern> [path…]`: `grep -rni` over the repository's files, each Markdown
// match named by its section, as a ticket's acceptance criterion names it ("matches only
// `sources.md` § Sync"). The section is the last `#` heading before the match, then the last
// paragraph's leading `**bold**` label under that heading, if any: `§ WebDAV, Writes`. A heading
// is cut as a `§` reference cites it: no trailing `.` or `:`, the part before `: ` or ` (`, and a
// number without its dot (`§ 11 Flows`). A match's line is cut to 80 characters. Exits 1 on no
// match, as grep does.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [pattern, ...paths] = process.argv.slice(2);
if (pattern === undefined) {
  console.error('Usage: pnpm grep:sections <pattern> [path…]');
  process.exit(2);
}
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

let output;
try {
  output = execFileSync(
    'git',
    ['grep', '-z', '-n', '-i', '--untracked', '-e', pattern, '--', ...paths],
    {
      encoding: 'utf8',
    },
  );
} catch (error) {
  process.exit(error.status ?? 2);
}

const shorten = (title) =>
  title
    .replaceAll('`', '')
    .replace(/[.:]$/, '')
    .replace(/^(.+?)(: | \().*$/, '$1')
    .replace(/^(\d+)\.\s/, '$1 ');

const sectionsCache = new Map();
// The section of each line of a Markdown file, by line index.
function sections(path) {
  if (sectionsCache.has(path)) return sectionsCache.get(path);
  let heading;
  let label;
  let fenced = false;
  const lines = readFileSync(path, 'utf8').split('\n');
  const result = lines.map((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const title = fenced ? undefined : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    const bold = fenced ? undefined : /^\*\*(.+?)\*\*/.exec(line)?.[1];
    if (title !== undefined) [heading, label] = [shorten(title), undefined];
    else if (bold !== undefined && (lines[index - 1] ?? '').trim() === '') label = shorten(bold);
    return [heading, label].filter((part) => part !== undefined).join(', ');
  });
  sectionsCache.set(path, result);
  return result;
}

for (const match of output.split('\n').filter(Boolean)) {
  const [path, line, text] = match.split('\0');
  const section = path.endsWith('.md') ? sections(path)[line - 1] : '';
  const excerpt = text.trim().length > 80 ? `${text.trim().slice(0, 80)}…` : text.trim();
  console.log(`${path}:${line}${section === '' ? '' : ` § ${section}`}: ${excerpt}`);
}
