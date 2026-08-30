---
"wrangler": minor
---

Add a trusted Miniflare runtime configuration module for local development

Set `WRANGLER_MINIFLARE_CONFIG` to a JavaScript module that exports a default function. Wrangler calls the function with the process environment and adds its host options to Miniflare without allowing it to replace Workers.
