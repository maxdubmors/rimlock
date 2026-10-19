#!/usr/bin/env node
// `pnpm test:interop [DIR]`: KeePassXC → rimlock (docs/spec/engineering.md § Tests). Creates
// Databases with keepassxc-cli in a container (scripts/interop.Dockerfile), writes them into DIR
// with a manifest.json in the interop corpus's shape, then runs rimlock-core's corpus tests on DIR
// (crates/rimlock-core/tests/corpus.rs). DIR must be empty or missing; by default it is a fresh
// temporary directory, kept so a file can be copied into the corpus. Needs Docker and Rust.
//
// keepassxc-cli creates only KDBX 3.1 with AES-KDF at 1,000,000 rounds, so the other settings
// start from the test-Database generator's low-KDF files: KeePassXC edits each one and writes the
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

// Each setting: a file db-create makes (`create`), or a generator file KeePassXC saves (`seed`);
// `deleteEntry` also moves an Entry to the Recycle Bin.
const argon2d = { kind: 'argon2d', ...argon2 };
const settings = [
  { name: 'created-password', create: { password: true, keyFile: false }, header: created },
  { name: 'created-key-file', create: { password: false, keyFile: true }, header: created },
  { name: 'created-password-key-file', create: { password: true, keyFile: true }, header: created },
  {
    name: 'created-entry-deleted',
    create: { password: true, keyFile: false },
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
    seed: 'scenario-password-key-file.kdbx',
    header: { formatVersion: '4.0', kdf: argon2d },
  },
  {
    name: 'key-file',
    seed: 'scenario-key-file.kdbx',
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
    const keyFileFor = () => file.replace(/\.kdbx$/, '.keyx');
    let masterPassword = null;
    let keyFile = null;
    let made;
    let name;
    if (setting.create) {
      if (setting.create.password) masterPassword = `interop ${setting.name}`;
      if (setting.create.keyFile) keyFile = keyFileFor();
      const options = [
        ...(keyFile ? ['--set-key-file', keyFile] : []),
        ...(masterPassword ? ['--set-password'] : []),
      ];
      // With --set-key-file, db-create writes a new Key file there.
      cli(
        ['db-create', '--quiet', ...options, file],
        ...(masterPassword ? [masterPassword, masterPassword] : []),
      );
      made = `keepassxc-cli db-create ${options.join(' ')}`;
      // db-create gives a Database no name.
      name = '';
    } else {
      const seed = seedKeys.find((database) => database.file === setting.seed);
      copyFileSync(join(seeds, seed.file), join(dir, file));
      masterPassword = seed.masterPassword;
      if (seed.keyFile) {
        keyFile = keyFileFor();
        copyFileSync(join(seeds, seed.keyFile), join(dir, keyFile));
      }
      made = `the test-Database generator's ${seed.file}`;
      name = 'rimlock scenario';
    }

    // keepassxc-cli saves the file after each edit.
    const open = [
      ...(keyFile ? ['--key-file', keyFile] : []),
      ...(masterPassword ? [] : ['--no-password']),
    ];
    const unlock = masterPassword ? [masterPassword] : [];
    const addEntry = (title) =>
      cli(
        [
          'add',
          '--quiet',
          ...open,
          '--username',
          'someone',
          '--url',
          'https://login.example.test',
          '--password-prompt',
          file,
          `Saved by KeePassXC/${title}`,
        ],
        ...unlock,
        `entry password ${title}`,
      );
    cli(['mkdir', '--quiet', ...open, file, 'Saved by KeePassXC'], ...unlock);
    addEntry('Login');
    made += ', then keepassxc-cli mkdir and add';
    if (setting.deleteEntry) {
      addEntry('Old login');
      // Creates the Recycle Bin if the Database has none.
      cli(['rm', '--quiet', ...open, file, 'Saved by KeePassXC/Old login'], ...unlock);
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
      // The generator's Databases have a Recycle Bin.
      contents: { name, recycleBin: Boolean(setting.seed || setting.deleteEntry) },
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
