import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  server: {
    port: 3000,
  },
  // @ts-expect-error -- vitest 3.2.4 vendors its own older vite typings (pnpm keeps
  // them as a separate nested install from this project's vite@8), so `defineConfig`
  // from 'vite' doesn't structurally recognize vitest's `test` config key here. The
  // value itself is still read correctly at runtime by the Vitest CLI.
  test: {
    // Playwright's own e2e specs live under e2e/ and match Vitest's default
    // *.spec.ts glob too -- exclude them so each runner only picks up its own.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    external: ['firebase-admin', 'firebase-admin/app', 'firebase-admin/database'],
  },
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          external: ['firebase-admin', 'firebase-admin/app', 'firebase-admin/database'],
        },
      },
    },
  },
  // Under Vitest none of the app's build plugins are needed, and TanStack Start's gives the jsdom render checks two
  // copies of React (react-dom sets the hooks dispatcher on the copy the components never import).
  plugins: process.env.VITEST
    ? []
    : [
        tanstackStart(),
        tailwindcss(),
        viteReact(),
        nitro({
          rolldownConfig: {
            external: [/^firebase-admin(?:\/|$)/],
          },
        }),
      ],
});
