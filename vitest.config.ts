import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic only (fee rule, Book gate, share cap, IBAN).
// No test here may call a live vendor API or Stripe — use fixtures.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
