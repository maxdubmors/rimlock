import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import type { Linter, Rule } from 'eslint';
import globals from 'globals';
import ts from 'typescript-eslint';

import { noAsyncEventHandler } from './eslint-rules/no-async-event-handler';

/** The page side: it runs in, or next to, a hostile web page (security.md). */
export const contentSide = [
  'src/autofill',
  'src/entrypoints/content',
  'src/entrypoints/inline-menu',
];

/**
 * Modules that content-side code may import besides its own. They obey the
 * content-side rules too: the boundary rule checks one import at a time, so a
 * re-export through one of them would otherwise carry `background/` into the
 * content bundle.
 */
export const sharedWithContent = [
  'src/protocol',
  'src/shared',
  'src/generator',
  'src/matching',
  'src/vendor',
];

/**
 * Everything under `src/` outside `allowed` is off limits to `target`. An
 * allowlist, so another entrypoint or a new folder cannot open a path to
 * `background/`, `sources/`, `core-bindings/` or `settings/`.
 */
function onlyFrom(target: string[], allowed: string[], message: string) {
  return {
    target,
    from: ['src'],
    except: allowed.map((dir) => `./${dir.replace(/^src\//, '')}`),
    message,
  };
}

const storageMessage =
  'Content code never touches storage (engineering.md § TypeScript modules); ask the background through protocol/.';

/** The whole rule set, rooted at `root` so the lint fixture tests can run it on a fixture tree. */
export function createConfig(root: string): Linter.Config[] {
  const globsUnder = (dirs: string[]) => dirs.map((dir) => `${dir}/**`);

  return defineConfig(
    js.configs.recommended,
    ts.configs.strictTypeChecked,
    svelte.configs.recommended,
    {
      languageOptions: {
        globals: globals.browser,
        parserOptions: {
          projectService: true,
          tsconfigRootDir: root,
          extraFileExtensions: ['.svelte'],
        },
      },
      rules: {
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
      },
    },
    {
      files: ['**/*.svelte', '**/*.svelte.ts'],
      languageOptions: { parserOptions: { parser: ts.parser } },
    },
    {
      files: ['**/*.svelte'],
      plugins: {
        rimlock: {
          // @typescript-eslint/utils still types rules against ESLint 9's RuleContext.
          rules: { 'no-async-event-handler': noAsyncEventHandler as unknown as Rule.RuleModule },
        },
      },
      rules: { 'rimlock/no-async-event-handler': 'error' },
    },
    {
      // Boundaries on resolved paths, so neither aliases (`@/…`) nor relative
      // spellings get around them.
      plugins: { 'import-x': importX },
      settings: {
        'import-x/resolver-next': [
          createTypeScriptImportResolver({ project: `${root}/tsconfig.json` }),
        ],
      },
      rules: {
        'import-x/no-restricted-paths': [
          'error',
          {
            basePath: root,
            zones: [
              onlyFrom(
                contentSide,
                [...contentSide, ...sharedWithContent],
                'Content-side code imports only content-side code and protocol/, shared/, generator/, matching/, vendor/ (engineering.md § TypeScript modules).',
              ),
              onlyFrom(
                sharedWithContent,
                sharedWithContent,
                'Content-side code imports this module, so it obeys the content-side boundary too.',
              ),
              {
                // Only background/ and its entrypoint import background/; every
                // other context, ui/ included, reaches it through protocol/ messages.
                target: [
                  'src/*',
                  'src/!(background|entrypoints)/**',
                  'src/entrypoints/!(background)/**',
                  'src/entrypoints/!(background).*',
                ],
                from: ['src/background'],
                message:
                  'Only background/ and the background entrypoint import background/; send a message through protocol/.',
              },
            ],
          },
        ],
      },
    },
    {
      files: globsUnder([...contentSide, ...sharedWithContent]),
      rules: {
        // Any `.storage`, so `const { storage } = browser` and aliases of `browser` are caught too.
        'no-restricted-properties': ['error', { property: 'storage', message: storageMessage }],
        'no-restricted-globals': ['error', { name: 'storage', message: storageMessage }],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'wxt/utils/storage', message: storageMessage },
              { name: '@wxt-dev/storage', message: storageMessage },
            ],
            patterns: [
              { group: ['wxt/utils/storage/*', '@wxt-dev/storage/*'], message: storageMessage },
            ],
          },
        ],
      },
    },
    {
      // A Secret's bytes leave it only where it is encoded for a message or unwrapped at a Core
      // call (core-api.md § 2, § 9; security.md § Leaks).
      files: ['src/**'],
      ignores: [
        'src/shared/secret.ts',
        'src/protocol/secret-codec.ts',
        'src/background/core-client.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: [
              "ImportSpecifier[imported.name='exposeSecret']",
              "ExportSpecifier[local.name='exposeSecret']",
              "MemberExpression[property.name='exposeSecret']",
              "MemberExpression[property.value='exposeSecret']",
              "ObjectPattern > Property[key.name='exposeSecret']",
            ].join(', '),
            message:
              "Only the protocol codec and CoreClient read a Secret's bytes; everything else uses reveal().",
          },
        ],
      },
    },
    {
      files: ['*.config.ts', 'tests/**'],
      languageOptions: { globals: globals.node },
    },
    {
      // Every WXT build regenerates the same .wxt/ folder, and only tests/manifest/ runs its
      // files one at a time (vitest.config.ts); the e2e global setup runs once, before the tests.
      files: ['tests/**'],
      ignores: ['tests/manifest/**', 'tests/e2e/global-setup.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '(^|/)build-bundle(\\.ts)?$',
                importNames: ['buildBundle'],
                message:
                  'A test that runs a WXT build goes in tests/manifest/, which runs one file at a time.',
              },
            ],
          },
        ],
      },
    },
  );
}

export default defineConfig(
  globalIgnores(['.output/', '.wxt/', 'src/core-bindings/', 'tests/lint/fixtures/']),
  createConfig(import.meta.dirname),
);
