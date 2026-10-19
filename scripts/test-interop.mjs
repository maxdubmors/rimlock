#!/usr/bin/env node
// `pnpm test:interop [DIR]`: KeePassXC → rimlock (docs/spec/engineering.md § Tests). Creates
// Databases with keepassxc-cli in a container (scripts/interop.Dockerfile), writes them into DIR
// with a manifest.json in the interop corpus's shape, then runs rimlock-core's corpus tests on DIR
// (crates/rimlock-core/tests/corpus.rs). DIR must be empty or missing; by default it is a fresh
// temporary directory, kept so a file can be copied into the corpus. Needs Docker and Rust.
// Exits 1 when a step or a test fails, 2 when DIR is not empty.
//
// keepassxc-cli creates only KDBX 3.1 with AES-KDF at 1,000,000 rounds, so the other settings
// start from the test-Database generator's low-KDF files, opened with their Master password:
// KeePassXC edits each one, sets a Key file of its own where the setting has one, and writes the
// whole file again itself. The expected headers are what KeePassXC 2.7 writes: every KDF and its
// parameters kept; the oldest format that holds the contents, so a 4.1 file is saved as 4.0; 4.1
// once an Entry is in the Recycle Bin, since KeePassXC then records the Group it came from.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [dirArg] = process.argv.slice(2);
const dir =
  dirArg === undefined
    ? mkdtempSync(join(tmpdir(), 'rimlock-interop-'))
    : // pnpm runs the script from the root; DIR is relative to where it was typed.
      resolve(process.env.INIT_CWD ?? '.', dirArg);
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`${dir} is not empty.`);
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    ...options,
  });

// The generator's KDFs (crates/rimlock-core/examples/fixtures).
const argon2 = { iterations: 2, memoryBytes: 1024 * 1024, parallelism: 2, version: 0x13 };
const lowAesKdf = { kind: 'aesKdf', rounds: 1000 };
// What keepassxc-cli db-create writes.
const created = { formatVersion: '3.1', kdf: { kind: 'aesKdf', rounds: 1_000_000 } };

// Each setting: a file db-create makes, or one KeePassXC saves from the generator's `seed`. Every
// file has a Master password unless `noPassword`, and a Key file KeePassXC writes if `keyFile`;
// `deleteEntry` also moves an Entry to the Recycle Bin.
const argon2d = { kind: 'argon2d', ...argon2 };
const settings = [
  { name: 'created-password', header: created },
  { name: 'created-key-file', keyFile: true, noPassword: true, header: created },
  { name: 'created-password-key-file', keyFile: true, header: created },
  {
    name: 'created-entry-deleted',
    deleteEntry: true,
    header: { ...created, formatVersion: '4.1' },
  },
  {
    name: 'argon2d',
    seed: 'scenario-4.0-argon2d.kdbx',
    header: { formatVersion: '4.0', kdf: argon2d },
  },
  {
    name: 'argon2id',
    seed: 'scenario-4.1-argon2id.kdbx',
    header: { formatVersion: '4.0', kdf: { kind: 'argon2id', ...argon2 } },
  },
  {
    name: 'aes-kdf',
    seed: 'scenario-4.0-aes-kdf.kdbx',
    header: { formatVersion: '4.0', kdf: lowAesKdf },
  },
  { name: '3.1', seed: 'scenario-3.1.kdbx', header: { formatVersion: '3.1', kdf: lowAesKdf } },
  {
    name: '3.1-entry-deleted',
    seed: 'scenario-3.1.kdbx',
    deleteEntry: true,
    header: { formatVersion: '4.1', kdf: lowAesKdf },
  },
  { name: 'from-4.1', seed: 'scenario.kdbx', header: { formatVersion: '4.0', kdf: argon2d } },
  {
    name: 'password-key-file',
    seed: 'scenario-4.0-argon2d.kdbx',
    keyFile: true,
    header: { formatVersion: '4.0', kdf: argon2d },
  },
  {
    name: 'key-file',
    seed: 'scenario-4.0-argon2d.kdbx',
    keyFile: true,
    noPassword: true,
    header: { formatVersion: '4.0', kdf: argon2d },
  },
];

const seeds = mkdtempSync(join(tmpdir(), 'rimlock-interop-seeds-'));
let container;
try {
  run(
    'cargo',
    ['run', '--locked', '--quiet', '-p', 'rimlock-core', '--example', 'fixtures', '--', seeds],
    {
      stdio: 'inherit',
    },
  );
  const seedKeys = JSON.parse(readFileSync(join(seeds, 'databases.json'), 'utf8'));

  const image = run('docker', [
    'build',
    '--quiet',
    '--file',
    'scripts/interop.Dockerfile',
    'scripts',
  ]).trim();
  // The sleep ends a container this script failed to remove.
  container = run('docker', [
    'run',
    '--detach',
    '--rm',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--env',
    'HOME=/tmp',
    '--volume',
    `${dir}:/corpus`,
    '--workdir',
    '/corpus',
    image,
    'sleep',
    '600',
  ]).trim();
  // Secrets go in on stdin, one per prompt, never as arguments. The prompts go to stderr, which is
  // shown only when a command fails.
  const cli = (args, ...answers) => {
    try {
      return run('docker', ['exec', '--interactive', container, 'keepassxc-cli', ...args], {
        input: answers.map((answer) => `${answer}\n`).join(''),
        stdio: 'pipe',
      });
    } catch (error) {
      console.error(`keepassxc-cli ${args.join(' ')}:\n${error.stderr ?? ''}`);
      throw error;
    }
  };
  const version = cli(['--version']).trim();

  const manifest = [];
  for (const setting of settings) {
    const file = `keepassxc-${version}-${setting.name}.kdbx`;
    // With --set-key-file, db-create and db-edit write a new Key file there.
    const keyFile = setting.keyFile ? file.replace(/\.kdbx$/, '.keyx') : null;
    let masterPassword;
    let made;
    let contents;
    if (setting.seed === undefined) {
      masterPassword = setting.noPassword ? null : `interop ${setting.name}`;
      const options = [
        ...(keyFile ? ['--set-key-file', keyFile] : []),
        ...(masterPassword ? ['--set-password'] : []),
      ];
      cli(
        ['db-create', '--quiet', ...options, file],
        ...(masterPassword ? [masterPassword, masterPassword] : []),
      );
      made = `keepassxc-cli db-create ${options.join(' ')}`;
      // db-create gives a Database no name and no Recycle Bin Group.
      contents = { name: '', recycleBin: Boolean(setting.deleteEntry) };
    } else {
      const seed = seedKeys.find((database) => database.file === setting.seed);
      copyFileSync(join(seeds, seed.file), join(dir, file));
      made = `the test-Database generator's ${seed.file}`;
      if (keyFile) {
        const options = [
          '--set-key-file',
          keyFile,
          ...(setting.noPassword ? ['--unset-password'] : []),
        ];
        cli(['db-edit', '--quiet', ...options, file], seed.masterPassword);
        made += `, then keepassxc-cli db-edit ${options.join(' ')}`;
      }
      masterPassword = setting.noPassword ? null : seed.masterPassword;
      contents = { name: 'rimlock scenario', recycleBin: true };
    }

    // keepassxc-cli saves the file after each edit.
    const open = [
      ...(keyFile ? ['--key-file', keyFile] : []),
      ...(masterPassword ? [] : ['--no-password']),
    ];
    const edit = (command, options, path, ...answers) =>
      cli(
        [command, '--quiet', ...open, ...options, file, path],
        ...(masterPassword ? [masterPassword] : []),
        ...answers,
      );
    const addEntry = (title) =>
      edit(
        'add',
        ['--username', 'someone', '--url', 'https://login.example.test', '--password-prompt'],
        `Saved by KeePassXC/${title}`,
        `entry password ${title}`,
      );
    edit('mkdir', [], 'Saved by KeePassXC');
    addEntry('Login');
    made += ', then keepassxc-cli mkdir and add';
    if (setting.deleteEntry) {
      addEntry('Old login');
      // Creates the Recycle Bin if the Database has none.
      edit('rm', [], 'Saved by KeePassXC/Old login');
      made += ', add and rm';
    }

    manifest.push({
      file,
      client: 'KeePassXC',
      version,
      made: `${made} (scripts/test-interop.mjs)`,
      masterPassword,
      keyFile,
      header: setting.header,
      contents,
    });
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  run('cargo', ['test', '--locked', '-p', 'rimlock-core', '--test', 'corpus'], {
    stdio: 'inherit',
    env: { ...process.env, RIMLOCK_CORPUS: dir },
  });
  console.log(
    `pnpm test:interop: green (${manifest.length} Databases from KeePassXC ${version} in ${dir})`,
  );
} catch (error) {
  console.error(`pnpm test:interop: failed, files in ${dir}`);
  process.exitCode = 1;
  if (!(error && 'status' in error)) throw error;
} finally {
  if (container) run('docker', ['rm', '--force', container]);
  rmSync(seeds, { recursive: true, force: true });
}
