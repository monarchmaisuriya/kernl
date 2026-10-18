// Runs every bundled unit test. The tracing test runs twice (control, untraced) against a local fake LangSmith.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

let failed = 0;
const run = (file, env = {}) => {
  const r = spawnSync(process.execPath, ["--test", `out/test/${file}`], { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) failed++;
};

const unitFiles = readdirSync("test/unit").filter((f) => f.endsWith(".test.ts")).map((f) => f.replace(/\.ts$/, ".cjs"));
for (const file of unitFiles) {
  if (file !== "tracing.test.cjs") {
    run(file);
    continue;
  }
  for (const mode of ["control", "untraced"]) {
    const port = String(47000 + Math.floor(Math.random() * 1000));
    run(file, {
      TRACING_TEST_MODE: mode,
      FAKE_LANGSMITH_PORT: port,
      LANGSMITH_TRACING: "true",
      LANGCHAIN_TRACING_V2: "true",
      LANGSMITH_API_KEY: "fake-test-key",
      LANGSMITH_ENDPOINT: `http://127.0.0.1:${port}`,
    });
  }
}
if (failed) {
  console.error(`\n${failed} unit test file(s) failed`);
  process.exit(1);
}
console.log("\nall unit test files passed");
