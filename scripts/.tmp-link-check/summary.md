## Broken-link check

- Base URL: `http://127.0.0.1:5123`
- Seed pages: 13 (sitemap: 2, well-known: 11)
- Baseline: _not available — gating on any non-allowlisted broken link_
- Started: 2026-05-03T11:27:46.162Z
- Finished: 2026-05-03T11:27:46.199Z

### Totals

| Total | 200 | 30x | 4xx | 5xx | Skipped | Allowlisted | Pre-existing | New |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | 3 | 0 | 10 | 0 | 0 | 0 | 0 | 10 |


### Per-page totals (pages with non-200 results)

| Page | 200 | 30x | 4xx | 5xx | Skipped |
| --- | --- | --- | --- | --- | --- |
| http://127.0.0.1:5123 | 3 | 0 | 10 | 0 | 0 |


### ❌ New broken links vs. baseline (10)

| Status | Bucket | Source page | Broken target |
| --- | --- | --- | --- |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/about |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/services |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/solutions |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/applications |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/case-studies |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/insights |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/library |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/contact |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/privacy |
| 404 | client_error | _(root)_ | http://127.0.0.1:5123/terms |

