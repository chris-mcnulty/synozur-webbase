import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { restorationPreflight } from "./restore-preflight.js";
import { PostsFileSchema, type Post } from "./schema.js";

const fixtureDir = resolve(import.meta.dirname, "fixtures/missing-image");
const fixture = PostsFileSchema.parse(JSON.parse(await readFile(resolve(fixtureDir, "posts.json"), "utf8")));

async function dataset(run: (dir: string, post: Post) => Promise<void>) {
  const dir = await mkdtemp(resolve(tmpdir(), "restore-preflight-"));
  try {
    const post = structuredClone(fixture[0]);
    await mkdir(resolve(dir, "images"));
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    await writeFile(resolve(dir, "images/missing.png"), image);
    post.heroImage!.bytes = image.length;
    await writeFile(resolve(dir, "posts.json"), JSON.stringify([post]));
    await run(dir, post);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("negative fixture reports the missing image with post and path", async () => {
  const report = await restorationPreflight(fixtureDir);
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].code, "image_missing");
  assert.match(report.errors[0].location, /images\/missing.png.*historical-missing-image/);
});

test("valid restoration input passes without modifying it", async () => {
  await dataset(async (dir) => {
    const before = await readFile(resolve(dir, "posts.json"));
    const report = await restorationPreflight(dir);
    assert.equal(report.ok, true);
    assert.equal(report.posts, 1);
    assert.equal(report.imageFiles, 1);
    assert.deepEqual(await readFile(resolve(dir, "posts.json")), before);
  });
});

test("missing, malformed, schema-invalid and empty posts fail explicitly", async () => {
  await dataset(async (dir) => {
    for (const [contents, code] of [
      ["{", "posts_unreadable"], ['[{"slug":42}]', "schema_invalid"], ["[]", "posts_empty"],
    ]) {
      await writeFile(resolve(dir, "posts.json"), contents);
      const report = await restorationPreflight(dir);
      assert.equal(report.ok, false);
      assert.ok(report.errors.some((issue) => issue.code === code));
    }
    await rm(resolve(dir, "posts.json"));
    assert.equal((await restorationPreflight(dir)).errors[0].code, "posts_unreadable");
  });
});

test("valid posts are still checked when another post fails schema validation", async () => {
  await dataset(async (dir, post) => {
    await writeFile(resolve(dir, "posts.json"), JSON.stringify([{}, post]));
    await rm(resolve(dir, "images/missing.png"));
    const report = await restorationPreflight(dir);
    assert.ok(report.errors.some((issue) => issue.code === "schema_invalid"));
    assert.ok(report.errors.some((issue) => issue.code === "image_missing"));
  });
});

test("byte mismatches and same-length corrupt images fail", async () => {
  await dataset(async (dir, post) => {
    await writeFile(resolve(dir, "images/missing.png"), Buffer.alloc(post.heroImage!.bytes, 0));
    let report = await restorationPreflight(dir);
    assert.ok(report.errors.some((issue) => issue.code === "image_unreadable"));
    await writeFile(resolve(dir, "images/missing.png"), "truncated");
    report = await restorationPreflight(dir);
    assert.ok(report.errors.some((issue) => issue.code === "image_size_mismatch"));
  });
});

test("HTML, srcset, Markdown, SEO and body-image references are checked offline", async () => {
  await dataset(async (dir, post) => {
    post.bodyHtml = '<img src="images/html.png"><source srcset="images/srcset.png 2x"><img src="https://example.invalid/never-fetch.png">';
    post.bodyMarkdown = "![alt](images/markdown.png)";
    post.seo.ogImage = "images/seo.png";
    post.bodyImages = [{ ...post.heroImage!, localPath: "images/body.png" }];
    await writeFile(resolve(dir, "posts.json"), JSON.stringify([post]));
    const report = await restorationPreflight(dir);
    assert.equal(report.imageFiles, 6);
    assert.equal(report.errors.filter((issue) => issue.code === "image_missing").length, 5);
  });
});

test("path escapes, absolute paths and escaping symlinks are rejected", async () => {
  await dataset(async (dir, post) => {
    await symlink(process.execPath, resolve(dir, "images/escape"));
    for (const path of ["../outside.png", resolve(dir, "images/missing.png"), "images/escape", ""]) {
      post.heroImage!.localPath = path;
      await writeFile(resolve(dir, "posts.json"), JSON.stringify([post]));
      assert.equal((await restorationPreflight(dir)).errors[0].code, "image_path_invalid");
    }
  });
});

test("duplicate slugs fail and partial/failed status is reported, not silently ignored", async () => {
  await dataset(async (dir, post) => {
    post.status = "failed";
    await writeFile(resolve(dir, "posts.json"), JSON.stringify([post, post]));
    const report = await restorationPreflight(dir);
    assert.ok(report.errors.some((issue) => issue.code === "duplicate_slug"));
    assert.match(report.warnings[0].message, /ingest skips this post/);
  });
});

test("CLI negative fixture exits nonzero with JSON, no DB credentials required", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.PRIVATE_OBJECT_DIR;
  const result = spawnSync(process.execPath, [
    "--import", "tsx", resolve(import.meta.dirname, "restore-preflight-cli.ts"),
    "--json", `--output-dir=${fixtureDir}`,
  ], { encoding: "utf8", env });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "image_missing");
});
