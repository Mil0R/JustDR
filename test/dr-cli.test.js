const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");

const drScript = path.resolve(__dirname, "../dr");

function runDr(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [drScript, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({
          code: error ? error.code : 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      }
    );
  });
}

test("CLI helper dr arguments and version support", async (t) => {
  await t.test("shows usage when domain is missing", async () => {
    const result = await runDr([]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: dr <domain> \[version \(dr3\|dr4\)\]/);
  });

  await t.test("shows error when domain is invalid", async () => {
    const result = await runDr(["://bad-url"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid domain/);
  });
});
