import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Coverage is enforced on lib/ rather than the component tree. These are
      // the files where a bug is a privacy incident — privacy resolution,
      // role predicates, address normalisation. Highly visual components are
      // better covered by visual regression than by brittle markup assertions.
      include: ["src/lib/**/*.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
