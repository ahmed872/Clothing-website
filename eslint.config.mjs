import js from '@eslint/js';
import next from 'eslint-config-next';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Module dependency graph (ADR section 04).
 *
 * `allow` lists are exhaustive: anything not listed is a lint error, so a new
 * cross-module import has to be a deliberate change to this file rather than
 * something that quietly appears in a pull request.
 */
const MODULE_DEPENDENCIES = {
  core: [],
  identity: ['core'],
  media: ['core'],
  catalog: ['core', 'media'],
  search: ['core', 'catalog'],
  inventory: ['core', 'catalog'],
  pricing: ['core', 'catalog'],
  // `media` joins cart's dependencies in P09: a cart line shows the
  // product's image, and resolving a storage key to a URL is `media`'s job —
  // the same reason `catalog` depends on it. Duplicating that resolution
  // inside `cart` would be a second way to build an image URL.
  cart: ['core', 'catalog', 'media', 'pricing', 'inventory'],
  customers: ['core', 'identity', 'catalog'],
  payments: ['core'],
  notifications: ['core', 'settings'],
  settings: ['core', 'media'],
  content: ['core', 'media', 'catalog'],
  analytics: ['core'],
  orders: [
    'core',
    // P10: orders write audit entries and name the staff member who moved a
    // status, both of which identity owns. Adding the edge here rather than
    // reaching around it keeps the graph the honest description of the code.
    'identity',
    'catalog',
    'pricing',
    'inventory',
    'cart',
    'customers',
    'payments',
    'notifications',
  ],
};

const moduleRules = Object.entries(MODULE_DEPENDENCIES).map(([name, allowed]) => ({
  from: [['module', { name }]],
  allow: [
    // A module may always import within itself.
    ['module', { name }],
    ...allowed.map((dependency) => ['module', { name: dependency }]),
  ],
}));

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,

  {
    files: ['**/*.{ts,tsx,mjs}'],
    // `import` is already registered by eslint-config-next; redefining a
    // plugin is a hard error in flat config, so only `boundaries` is added.
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*', capture: ['name'], mode: 'folder' },
        { type: 'app', pattern: 'src/app/**/*', mode: 'file' },
        { type: 'components', pattern: 'src/components/**/*', mode: 'file' },
        { type: 'lib', pattern: 'src/lib/**/*', mode: 'file' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      // Circular dependencies are forbidden outright (P01 requirement).
      'import/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],

      // The module graph above is the contract.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            ...moduleRules,
            // Presentation layers may use any module's public surface, and
            // may compose freely among themselves.
            { from: ['app', 'components', 'lib'], allow: ['module', 'app', 'components', 'lib'] },
          ],
        },
      ],

      // Cross-module imports go through the module's index, never a deep path.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*'],
              message:
                'Import a module through its public surface (@/modules/<name>), not a file inside it.',
            },
          ],
        },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Type-aware rules are deliberately not enabled: they require
      // `parserOptions.project`, which roughly triples lint time, and none of
      // the boundary or correctness rules above need type information.

      // No raw colour in application code (P02 requirement): every colour is
      // a design token defined once in `src/app/globals.css`. A hex code, an
      // `rgb()`/`hsl()` function, or a bare CSS named colour typed into a
      // component is either a duplicate of a token that already exists, or a
      // one-off nobody else can find and fix consistently later. Tokens are
      // consumed as `bg-(--color-brand)` (Tailwind v4 CSS-variable shorthand)
      // or `var(--color-brand)`, never spelled out.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#(?:[0-9a-fA-F]{3,4}\\b|[0-9a-fA-F]{6}\\b|[0-9a-fA-F]{8}\\b)/]',
          message:
            'No raw hex colour in component code — use a design token (`var(--color-*)` / `bg-(--color-*)`) from src/app/globals.css instead.',
        },
        {
          selector: 'Literal[value=/\\b(?:rgba?|hsla?)\\(/i]',
          message:
            'No raw rgb/hsl colour function in component code — use a design token (`var(--color-*)` / `bg-(--color-*)`) from src/app/globals.css instead.',
        },
        {
          selector:
            'TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}\\b|[0-9a-fA-F]{6}\\b|[0-9a-fA-F]{8}\\b)/]',
          message:
            'No raw hex colour in component code — use a design token (`var(--color-*)` / `bg-(--color-*)`) from src/app/globals.css instead.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\b(?:rgba?|hsla?)\\(/i]',
          message:
            'No raw rgb/hsl colour function in component code — use a design token (`var(--color-*)` / `bg-(--color-*)`) from src/app/globals.css instead.',
        },
      ],
    },
  },

  // The presentation layer legitimately reaches into module files that are not
  // re-exported yet (for example `@/modules/core/env.client` in a client
  // component, which must not pull the server-only barrel).
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // P13's design-token rule exemption: an email's HTML is rendered by a
  // recipient's mail client, which never loads this app's `globals.css` —
  // `var(--color-brand)` would simply fail to resolve there, unlike in a
  // browser rendering this app's own pages. Literal, inlined hex values are
  // not a style lapse in `templates.ts`; they are the only thing email HTML
  // actually supports.
  {
    files: ['src/modules/notifications/templates.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vitest.config.mts'],
    rules: { 'no-restricted-imports': 'off', 'boundaries/element-types': 'off' },
  },
);
