import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = (f: string) => fileURLToPath(new URL(`./apps/api/test/stubs/${f}`, import.meta.url));

// Modul khusus runtime Cloudflare diganti stub supaya Workflow bisa dites di Node.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": stub("cloudflare-workers.ts"),
      "cloudflare:workflows": stub("cloudflare-workflows.ts"),
    },
  },
  test: { include: ["apps/**/*.test.ts", "packages/**/*.test.ts"] },
});
