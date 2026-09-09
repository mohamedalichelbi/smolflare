---
"miniflare": patch
---

Reject failed remote R2 blob uploads

Check the upload response before storing the blob identifier in SQLite. A failed bucket upload must cause `R2Bucket.put()` to reject.
