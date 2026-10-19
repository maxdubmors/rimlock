#!/usr/bin/env node
// Part of pnpm check: every `§` reference names a heading that exists (docs/spec/engineering.md
// § Checks). A `§` refers to the last Markdown file named before it on its line, and `[§ X](#x)`
// to its own file. In Markdown with no file named on the line, it refers to its own file if that
// has the heading, else to the last file named earlier in the paragraph. Code comments and config
// cite sections only after a file name, on the line or, for a line that starts with `§`, on the
// line before. The text
// after `§ ` must start with a heading of that file (a `#` heading or a paragraph's leading
// `**bold**` label, without a trailing `.` or `:`; the number of a numbered heading; a heading's
// part before `: ` or ` (`) and end there on a non-word character. Only that first heading is
// checked, not a subsection after a comma. A wrapped line is read on into the next one. A code
// span holding a `§` is an example, not a reference. `§` takes a space before a number or a word,
// as in `§ 10`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const files = git('ls-files', '--cached', '--others', '--exclude-standard')
  .split('\n')
  .filter(Boolean);
const markdown = files.filter((path) => path.endsWith('.md'));
const citing = git('grep', '--untracked', '-l', '§', '--', ':!apps/extension/src/core-bindings/')
  .split('\n')
  .filter(Boolean);

const headingsCache = new Map();
function headings(path) {
  if (headingsCache.has(path)) return headingsCache.get(path);
  const keys = [];
  let fenced = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const title = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1] ?? /^\*\*(.+?)\*\*/.exec(line)?.[1];
    if (title === undefined) continue;
    const text = title.replaceAll('`', '').replace(/[.:]$/, '');
    keys.push({ key: text, short: false });
    const number = /^(\d+)\.\s/.exec(text)?.[1];
    if (number !== undefined) keys.push({ key: number, short: false });
    for (const part of [/^(.+?): /.exec(text)?.[1], /^(.+?) \(/.exec(text)?.[1]]) {
      if (part !== undefined) keys.push({ key: part, short: true });
    }
  }
  headingsCache.set(path, keys);
  return keys;
}

// A file name as written: a relative link, a repository path, a GitHub URL or a bare name.
// Returns the path, `undefined` for a name two files share or another repository's URL, and
// `null` for a file the repository does not have.
function resolve(name, from) {
  const ours = /github\.com\/maxdubmors\/rimlock\/blob\/[^/]+\/(.+)$/.exec(name);
  if (ours === null && name.includes('//')) return undefined;
  const candidates = ours
    ? [ours[1]]
    : [posix.join(posix.dirname(from), name), posix.normalize(name)];
  for (const path of candidates) if (markdown.includes(path) && existsSync(path)) return path;
  const sameName = markdown.filter((path) => posix.basename(path) === posix.basename(name));
  if (sameName.length > 1) return undefined;
  return sameName.length === 1 ? sameName[0] : null;
}

const stripComment = (line) => line.replace(/^\s*(\/\/+|\/?\*+|#+|<!--|-)?\s*/, '');
const fileName = /[\w./:-]*?([\w.-]+\/)*[\w.-]+\.md\b/g;
const lastFileName = (text) => [...text.matchAll(fileName)].at(-1)?.[0];
const failures = [];

function hasHeading(target, text) {
  return headings(target).some(({ key, short }) => {
    if (!text.startsWith(key)) return false;
    const next = text.charAt(key.length);
    return next === '' || (/\W/.test(next) && !(short && next === ':'));
  });
}

// The files a `§` may refer to, in the order tried.
function targets(path, lines, index, before, after, startsWithSection) {
  const isMarkdown = path.endsWith('.md');
  if (before.endsWith('[')) {
    const link = /^[^\]]*\]\(([^)#]*)/.exec(after)?.[1];
    if (link !== undefined) return link === '' ? [path] : [resolve(link, path)];
  }
  const named = lastFileName(before);
  if (named !== undefined) return [resolve(named, path)];
  if (!isMarkdown) {
    const wrapped = startsWithSection ? lastFileName(lines[index - 1] ?? '') : undefined;
    return wrapped === undefined ? [] : [resolve(wrapped, path)];
  }
  let earlier;
  for (let i = index - 1; i >= 0 && lines[i].trim() !== '' && earlier === undefined; i -= 1) {
    earlier = lastFileName(lines[i]);
  }
  const other = earlier === undefined ? undefined : resolve(earlier, path);
  return typeof other === 'string' ? [path, other] : [path];
}

for (const path of citing) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((raw, index) => {
    const line = raw.replaceAll(/`[^`]*§[^`]*`/g, (span) => ' '.repeat(span.length));
    const where = `${path}:${index + 1}`;
    const startsWithSection = stripComment(line.slice(0, line.indexOf('§'))) === '';
    for (const match of line.matchAll(/§[\p{L}\p{N}]\S*/gu)) {
      failures.push(`${where}: "${match[0]}": write a space after §`);
    }
    for (const match of line.matchAll(/§+ /g)) {
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + match[0].length);
      const tried = targets(path, lines, index, before, after, startsWithSection);
      if (tried.includes(null)) {
        failures.push(
          `${where}: "§ ${after.slice(0, 40)}" cites a file the repository does not have`,
        );
        continue;
      }
      // Another repository, a name two files share, or a comment with no file named.
      if (tried.length === 0 || tried.includes(undefined)) continue;
      const text = `${after} ${stripComment(lines[index + 1] ?? '')}`.replaceAll('`', '');
      if (!tried.some((target) => hasHeading(target, text))) {
        failures.push(`${where}: "§ ${after.slice(0, 40)}" names no heading of ${tried.at(-1)}`);
      }
    }
  });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(
    'Each § reference above names a missing file or heading, or lacks the space after §: fix the reference or the heading.',
  );
  process.exit(1);
}
