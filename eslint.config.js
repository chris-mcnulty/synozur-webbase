// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const a11yRules = {
  // jsx-a11y — must-have rules per task brief, set to "error".
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-is-valid": "error",
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/label-has-associated-control": "error",
  "jsx-a11y/no-noninteractive-element-interactions": "error",
  "jsx-a11y/no-static-element-interactions": "error",

  // Stylistic / advisory a11y rules — warn only.
  "jsx-a11y/anchor-has-content": "warn",
  "jsx-a11y/aria-proptypes": "warn",
  "jsx-a11y/aria-unsupported-elements": "warn",
  "jsx-a11y/click-events-have-key-events": "warn",
  "jsx-a11y/heading-has-content": "warn",
  "jsx-a11y/iframe-has-title": "warn",
  "jsx-a11y/img-redundant-alt": "warn",
  "jsx-a11y/interactive-supports-focus": "warn",
  "jsx-a11y/mouse-events-have-key-events": "warn",
  "jsx-a11y/no-autofocus": "warn",
  "jsx-a11y/no-redundant-roles": "warn",
  "jsx-a11y/role-has-required-aria-props": "warn",
  "jsx-a11y/role-supports-aria-props": "warn",
  "jsx-a11y/scope": "warn",
  "jsx-a11y/tabindex-no-positive": "warn",
};

const tsBaseRules = {
  // Disable base no-unused-vars / no-undef in TS files; TS handles them.
  "no-unused-vars": "off",
  "no-undef": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-useless-escape": "off",
  "no-prototype-builtins": "off",
  // Honour the `_`-prefix convention for intentionally-unused identifiers
  // (matches drizzle-style `({ _t, _w, ... })` placeholders + standard
  // `(_e) => ...` catch parameters).
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
};

// Packages whose source is React/browser code and should run the full a11y gate.
const reactPackageGlobs = [
  "artifacts/synozur/src/**/*.{ts,tsx,js,jsx}",
  "artifacts/galaxy/src/**/*.{ts,tsx,js,jsx}",
  "artifacts/mockup-sandbox/src/**/*.{ts,tsx,js,jsx}",
  "lib/api-client-react/src/**/*.{ts,tsx,js,jsx}",
  "lib/object-storage-web/src/**/*.{ts,tsx,js,jsx}",
  // auth-sdk has both a browser entry (browser.ts) and node entries; lint as
  // browser code since the strictest rules (no-undef globals) are a superset.
  "lib/auth-sdk/src/**/*.{ts,tsx,js,jsx}",
];

// Packages whose source is Node code (no jsx-a11y, no browser globals).
const nodePackageGlobs = [
  "artifacts/api-server/src/**/*.{ts,js}",
  "scripts/src/**/*.{ts,js}",
  "lib/db/src/**/*.{ts,js}",
  "lib/api-zod/src/**/*.{ts,js}",
  "lib/integrations-anthropic-ai/src/**/*.{ts,js}",
  "tools/*/src/**/*.{ts,js}",
];

// typescript-eslint recommended config blocks, retargeted to the Node packages
// only (we don't want type-aware rules on app code yet, just the recommended
// non-type-checked rules so we get TS-flavoured lint enforcement on the
// server/scripts/lib surfaces).
const tseslintRecommendedForNode = tseslint.configs.recommended.map((cfg) => ({
  ...cfg,
  files: nodePackageGlobs,
}));

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
      // Replit skill / bootstrap files — not workspace source code.
      ".local/**",
      // Generated codegen output — owned by orval / drizzle-kit / etc.
      "lib/api-client-react/src/generated/**",
      "lib/api-zod/src/generated/**",
      "lib/api-spec/**",
      // Integrations blueprints are vendored sources we don't author here.
      "lib/integrations/**",
      // Static assets / non-source build helpers we don't author as TS.
      "artifacts/*/public/**",
      "artifacts/*/build.mjs",
      "artifacts/*/server.mjs",
      "artifacts/*/scripts/**",
      "artifacts/*/vite.config.ts",
      "artifacts/*/mockupPreviewPlugin.ts",
      // Drizzle / orval config files at lib roots.
      "lib/*/drizzle.config.ts",
      "lib/*/orval.config.ts",
      "lib/*/scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslintRecommendedForNode,

  // React + browser + jsx-a11y config (artifacts that render UI + React libs).
  {
    files: reactPackageGlobs,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...tsBaseRules,
      ...a11yRules,
      // React basics
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-vars": "error",
    },
  },

  // Node-flavoured config (api-server, scripts, server libs, tools).
  {
    files: nodePackageGlobs,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      ...tsBaseRules,
    },
  },
];
