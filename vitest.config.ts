import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@melddb/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@melddb/providers": path.resolve(import.meta.dirname, "packages/providers/src/index.ts"),
      "@melddb/sdk": path.resolve(import.meta.dirname, "packages/sdk/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "e2e"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/**/*.ts", "src/lib/**/*.ts"],
    },
  },
});
