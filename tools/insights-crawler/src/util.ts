import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";

export const USER_AGENT =
  "SynozurInsightsMigrator/1.0 (+https://www.synozur.com/insights migration; contact: ops@synozur.com)";

export const REQUEST_DELAY_MS = 300;
export const MAX_PARALLEL = 4;

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureParent(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureParent(path);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
export async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + REQUEST_DELAY_MS - now);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function fetchText(url: string, retries = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url}`);
}

export async function fetchBuffer(url: string, retries = 3): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      lastErr = err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url}`);
}

export async function pMap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  for (let i = 0; i < limit; i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          out[idx] = await worker(items[idx]!, idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return out;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
