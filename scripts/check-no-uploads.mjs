// Upload intake must never enter commits or newly pushed GitHub history.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout;
};
const forbidden = (path) => /(^|\/)attached_assets\//i.test(path);
const tracked = git("ls-files", "-z").split("\0").filter(forbidden);
if (tracked.length) {
  console.error(`Blocked: ${tracked.length} uploaded files are tracked. Keep local originals, move required inputs to permanent paths, and untrack attached_assets.`);
  process.exit(1);
}
if (process.argv.includes("--push")) {
  const zero = /^0+$/;
  for (const line of readFileSync(0, "utf8").trim().split("\n").filter(Boolean)) {
    const [, local, , remote] = line.split(/\s+/);
    if (zero.test(local)) continue; // Ref deletion sends no upload content.
    const revisions = zero.test(remote) ? [local] : [local, `^${remote}`];
    // Fail closed if a remote boundary is unavailable locally.
    const commits = git("rev-list", ...revisions).trim().split("\n").filter(Boolean);
    for (const commit of commits) {
      if (git("ls-tree", "-r", "--name-only", "-z", commit).split("\0").some(forbidden)) {
        console.error("Blocked: outgoing history contains attached_assets. Removing files in the latest commit does not purge historical uploads. Coordinate a repository-history cleanup before pushing.");
        process.exit(1);
      }
    }
  }
}
console.log("Upload exclusion check passed.");
