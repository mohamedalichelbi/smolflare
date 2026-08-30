---
"miniflare": patch
---

Wait for custom R2 blob uploads before completing `R2Bucket.put()`

The custom blob bridge now finishes pumping the request body before it returns the storage response. This prevents an immediate read from racing a remote blob upload.
