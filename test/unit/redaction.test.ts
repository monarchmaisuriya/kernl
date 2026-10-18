import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Logger, Redactor } from "../../src/log";

test("log lines never contain a registered key, including inside error messages", () => {
  const lines: string[] = [];
  const redactor = new Redactor();
  const key = "sk-ant-api03-SECRETSECRETSECRET";
  redactor.register(key);
  const log = new Logger({ appendLine: (l) => lines.push(l) }, redactor);
  log.info(`calling provider with ${key}`);
  log.error("request failed", new Error(`401 for key ${key}`));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(!line.includes(key), `leaked: ${line}`);
    assert.match(line, /\[redacted\]/);
  }
});

test("forgotten keys are no longer scrubbed, and short strings are never treated as secrets", () => {
  const redactor = new Redactor();
  redactor.register("abc");
  redactor.register("long-secret-value");
  redactor.forget("long-secret-value");
  assert.equal(redactor.scrub("abc long-secret-value"), "abc long-secret-value");
});
