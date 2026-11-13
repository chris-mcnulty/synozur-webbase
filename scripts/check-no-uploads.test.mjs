import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("./check-no-uploads.mjs", import.meta.url));
const zero = "0".repeat(40);

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "upload-exclusion-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Upload guard test");
  git("config", "user.email", "upload-guard@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  const write = (path) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), "Synthetic test fixture, not user intake.\n");
    // Model a caller bypassing ignore rules; fixtures exist only under tmpdir.
    git("add", "-f", "--", path);
  };
  const commit = () => {
    git("commit", "-qm", "Synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  write("safe.txt");
  const base = commit();
  const check = (input) => spawnSync(
    process.execPath,
    [checker, ...(input === undefined ? [] : ["--push"])],
    { cwd, encoding: "utf8", input },
  );
  const push = (head, before, ref = "refs/heads/test") =>
    check(`${ref} ${head} ${ref} ${before}\n`);
  return { git, write, commit, check, push, base };
}

test("clean index and ordinary changes pass", (t) => {
  const r = repository(t);
  assert.equal(r.check().status, 0);
  r.write("src/safe.txt");
  assert.equal(r.push(r.commit(), r.base).status, 0);
});

for (const path of ["attached_assets/file.txt", "nested/ATTACHED_ASSETS/file.txt"]) {
  test(`tracked intake is rejected: ${path}`, (t) => {
    const r = repository(t);
    r.write(path);
    assert.equal(r.check().status, 1);
  });
}

test("add-then-delete intake is rejected even when the final index is clean", (t) => {
  const r = repository(t);
  r.write("attached_assets/file.txt");
  r.commit();
  r.git("rm", "-qr", "attached_assets");
  const head = r.commit();
  assert.equal(r.check().status, 0);
  assert.equal(r.push(head, r.base).status, 1);
  assert.equal(r.push(head, zero).status, 1);
  r.git("tag", "-a", "fixture-tag", "-m", "Synthetic tag");
  assert.equal(r.push(r.git("rev-parse", "fixture-tag"), zero, "refs/tags/fixture-tag").status, 1);
});

test("old uploads outside an existing ref's incoming range do not block clean changes", (t) => {
  const r = repository(t);
  r.write("attached_assets/file.txt");
  r.commit();
  r.git("rm", "-qr", "attached_assets");
  const boundary = r.commit();
  r.write("new-safe.txt");
  const head = r.commit();
  assert.equal(r.push(head, boundary).status, 0);
  assert.equal(r.push(head, zero).status, 1);
});

test("clean new branches/tags and ref deletions pass", (t) => {
  const r = repository(t);
  assert.equal(r.push(r.base, zero).status, 0);
  assert.equal(r.push(r.base, zero, "refs/tags/safe").status, 0);
  assert.equal(r.push(zero, r.base).status, 0);
});

test("missing remote boundary fails closed", (t) => {
  const r = repository(t);
  assert.notEqual(r.push(r.base, "f".repeat(40)).status, 0);
});

test("every ref in a multi-ref push is inspected", (t) => {
  const r = repository(t);
  r.write("attached_assets/file.txt");
  r.commit();
  r.git("rm", "-qr", "attached_assets");
  const head = r.commit();
  const result = r.check(
    `refs/heads/safe ${r.base} refs/heads/safe ${zero}\n` +
    `refs/tags/unsafe ${head} refs/tags/unsafe ${zero}\n`,
  );
  assert.equal(result.status, 1);
});
