import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    fileParallelism: false,
    environmentMatchGlobs: [["src/**/*.ui.test.tsx", "jsdom"]],
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/globalSetup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/app/api/auth/**/route.ts",
        "src/app/api/companies/**/route.ts",
        "src/app/api/complaints/**/route.ts",
        "src/app/api/moderation/**/route.ts",
        "src/lib/**/*.{ts,tsx}",
        "src/components/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/generated/**",
        "src/**/generated/**",
      ],
    },
  },
});
