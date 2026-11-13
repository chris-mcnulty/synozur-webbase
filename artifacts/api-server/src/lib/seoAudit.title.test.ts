import assert from "node:assert/strict";
import test from "node:test";
import {
  isGeneratedSeoTitle,
  shortenSeoTitle,
  shouldRefreshGeneratedSeoTitle,
} from "./seoAudit";

test("shortenSeoTitle drops a trailing colon subtitle", () => {
  assert.equal(
    shortenSeoTitle(
      "Synozur at TechCon 365 Seattle 2025: Transforming Business Together",
    ),
    "Synozur at TechCon 365 Seattle 2025",
  );
});

test("shortenSeoTitle favors the later spaced-dash subtitle break", () => {
  assert.equal(
    shortenSeoTitle(
      "Polaris Podcast: Company Operating Systems - CoS It's Thanksgiving",
    ),
    "Polaris Podcast: Company Operating Systems",
  );
});

test("isGeneratedSeoTitle recognizes the legacy word-boundary title format", () => {
  const original =
    "Polaris Podcast: Company Operating Systems - CoS It's Thanksgiving";
  assert.equal(
    isGeneratedSeoTitle(
      "Polaris Podcast: Company Operating Systems - CoS It's…",
      original,
    ),
    true,
  );
});

test("isGeneratedSeoTitle does not treat custom SEO copy as automatic", () => {
  assert.equal(
    isGeneratedSeoTitle(
      "How Company Operating Systems Change Enterprise Strategy",
      "Polaris Podcast: Company Operating Systems - CoS It's Thanksgiving",
    ),
    false,
  );
});

test("shouldRefreshGeneratedSeoTitle refreshes an unchanged field from the post editor", () => {
  const previousTitle =
    "Polaris Podcast: Company Operating Systems - CoS It's Thanksgiving";
  assert.equal(
    shouldRefreshGeneratedSeoTitle({
      priorPostTitle: previousTitle,
      priorSeoTitle: "Polaris Podcast: Company Operating Systems - CoS It's…",
      requestedSeoTitle: "Polaris Podcast: Company Operating Systems - CoS It's…",
    }),
    true,
  );
});

test("shouldRefreshGeneratedSeoTitle protects an intentional SEO edit", () => {
  assert.equal(
    shouldRefreshGeneratedSeoTitle({
      priorPostTitle:
        "Polaris Podcast: Company Operating Systems - CoS It's Thanksgiving",
      priorSeoTitle: "Polaris Podcast: Company Operating Systems - CoS It's…",
      requestedSeoTitle: "Company Operating Systems: A Polaris Podcast",
    }),
    false,
  );
});