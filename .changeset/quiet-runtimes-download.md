---
"miniflare": patch
"smolflare": minor
---

Add the experimental remote-LTX SQLite backend and its pinned runtime installer

Miniflare can now configure a Workerd external SQLite VFS for all Durable Object-backed local services. Smolflare provides an explicit installer that downloads the compatible Workerd and Litestream release files and verifies their SHA-256 values before use.
