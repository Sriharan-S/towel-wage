import { defineConfig } from "vitest/config";
import path from "node:path";

// Deliberately separate from vite.config.ts: the Cloudflare plugin spins up a
// workerd environment we don't need here. Everything under shared/ is pure.
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "./shared"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
