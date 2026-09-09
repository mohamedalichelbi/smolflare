---
"miniflare": minor
---

Support remote KV blob bodies

Use `kvBlobStorage` to select a file or custom blob backend for KV values. R2 and KV share the upload and error-handling code. Use separate prefixes for their remote objects. Remote SQLite alone does not store KV value bodies.
