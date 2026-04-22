/**
 * #107: one-shot scrape of the legacy Wix FAQ page at
 * https://www.synozur.com/faq. Writes `output/faq.json` in the shape
 * consumed by `artifacts/api-server/src/scripts/seedFaq.ts`.
 *
 * Usage: `pnpm --filter @workspace/insights-crawler exec tsx src/faq.ts`
 * (or via the `faq` npm script).
 *
 * This file is intentionally separate from crawl.ts so a one-off FAQ
 * pull doesn't have to negotiate the post-crawl pipeline or its image
 * handling. The output is plain JSON that seedFaq.ts turns into DB rows.
 */
import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { resolve } from "node:path";
import { fetchText, writeJson } from "./util.js";

const SITE = "https://www.synozur.com";
const FAQ_URL = `${SITE}/faq`;
const OUTPUT_DIR = resolve(import.meta.dirname, "../output");

// Keep the allowed HTML tight — FAQ answers should survive lifting into
// SERP snippets and AI citations without surprises. Links and basic
// formatting are kept; images/scripts/iframes are dropped.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
];

export interface ScrapedFaqItem {
  question: string;
  answerHtml: string;
}

export interface ScrapedFaqCategory {
  slug: string;
  name: string;
  description: string | null;
  items: ScrapedFaqItem[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function cleanAnswerHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  }).trim();
}

/**
 * Parse the Wix FAQ HTML. Wix renders each category as a group with a
 * heading, followed by question/answer pairs. The exact markup varies
 * across Wix templates, so we try a couple of structural hints and fall
 * back to a flat "General" bucket.
 */
export function parseFaqHtml(html: string): ScrapedFaqCategory[] {
  const $ = load(html);
  const categories: ScrapedFaqCategory[] = [];

  // Strategy 1: Wix's accordion widget uses role="group" with a child
  // role="heading" for the question and a sibling panel for the answer.
  const groups = $('[role="group"], [data-hook="faq-group"], .faq-group');
  if (groups.length > 0) {
    let currentCategory: ScrapedFaqCategory | null = null;
    groups.each((_, el) => {
      const $g = $(el);
      const heading = $g.find('[role="heading"], h2, h3').first().text().trim();
      const questionEl = $g.find('[data-hook="faq-question"], .faq-question').first();
      const answerEl = $g.find('[data-hook="faq-answer"], .faq-answer').first();

      if (heading && !questionEl.length) {
        currentCategory = {
          slug: slugify(heading),
          name: heading,
          description: null,
          items: [],
        };
        categories.push(currentCategory);
        return;
      }
      if (questionEl.length) {
        if (!currentCategory) {
          currentCategory = {
            slug: "general",
            name: "General",
            description: null,
            items: [],
          };
          categories.push(currentCategory);
        }
        const question = questionEl.text().trim();
        const answerHtml = cleanAnswerHtml(answerEl.html() ?? "");
        if (question) {
          currentCategory.items.push({ question, answerHtml });
        }
      }
    });
  }

  // Strategy 2 (fallback): look for <details>/<summary> pairs.
  if (categories.length === 0) {
    const details = $("details");
    if (details.length > 0) {
      const bucket: ScrapedFaqCategory = {
        slug: "general",
        name: "General",
        description: null,
        items: [],
      };
      details.each((_, el) => {
        const $d = $(el);
        const q = $d.find("summary").first().text().trim();
        $d.find("summary").remove();
        const a = cleanAnswerHtml($d.html() ?? "");
        if (q) bucket.items.push({ question: q, answerHtml: a });
      });
      if (bucket.items.length) categories.push(bucket);
    }
  }

  return categories.filter((c) => c.items.length > 0);
}

async function main() {
  console.log(`Fetching FAQ: ${FAQ_URL}`);
  const html = await fetchText(FAQ_URL);
  const categories = parseFaqHtml(html);
  const outPath = `${OUTPUT_DIR}/faq.json`;
  await writeJson(outPath, { source: FAQ_URL, categories });
  const totalItems = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(
    `Parsed ${categories.length} categories, ${totalItems} questions -> ${outPath}`,
  );
  if (totalItems === 0) {
    console.warn(
      "No questions were extracted. Inspect the fetched HTML — the Wix markup may have changed.",
    );
  }
}

// When invoked directly (via `tsx src/faq.ts`), run the scrape. Importing
// this file from tests or other scripts is a no-op.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
