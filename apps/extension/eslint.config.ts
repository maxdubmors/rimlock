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
 * Modules that content-side code may import. They obey the content-side rules
 * too: the boundary rule checks one import at a time, so a re-export through
 * one of them would otherwise carry `background/` into the content bundle.
 */
export const sharedWithContent = [
  'src/protocol',
  'src/shared',
  'src/generator',
  'src/matching',
  'src/vendor',
];

/** What the content side never reaches, directly or through a shared module. */
const offLimitsToContent = [
  'src/background',
  'src/sources',
  'src/core-bindings',
  'src/settings',
  // ui/ may import settings/, so a path through it would bypass the rule above.
  'src/ui',
];

const storageMessage =
  'Content code never touches storage (engineering.md § TypeScript modules); ask the background through protocol/.';

/** The whole rule set, rooted at `root` so the lint fixture tests can run it on a fixture tree. */
export function createConfig(root: string): Linter.Config[] {
  const under = (dirs: string[]) => dirs.map((dir) => `${dir}/**`);

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
              {
                target: contentSide,
                from: offLimitsToContent,
                message:
                  'Content-side code never imports this (engineering.md § TypeScript modules).',
              },
              {
                target: sharedWithContent,
                from: offLimitsToContent,
                message:
                  'Content-side code imports this module, so it obeys the content-side boundary too.',
              },
              {
                target: ['src/ui'],
                from: ['src/background'],
                message: 'ui/ reaches the background only through protocol/.',
              },
            ],
          },
        ],
      },
    },
    {
      files: under([...contentSide, ...sharedWithContent]),
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
      files: ['*.config.ts', 'tests/**'],
      languageOptions: { globals: globals.node },
    },
  );
}

export default defineConfig(
  globalIgnores(['.output/', '.wxt/', 'src/core-bindings/', 'tests/lint/fixtures/']),
  createConfig(import.meta.dirname),
);
