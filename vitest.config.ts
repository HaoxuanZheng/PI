import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    // Integration tests migrate the same database in beforeAll: parallel
    // files race on drizzle bookkeeping and query half-applied policies,
    // so files run serially. Unit suites stay fast regardless.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: { reporter: ["text", "json", "html"] }
  }
});
