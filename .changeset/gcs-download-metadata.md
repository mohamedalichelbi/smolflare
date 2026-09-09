---
"smolflare": patch
---

Read GCS blob metadata from the download response.

Remove the duplicate metadata request. Validate response sizes and ranges, preserve stored bytes, and close rejected downloads without buffering the full blob.
