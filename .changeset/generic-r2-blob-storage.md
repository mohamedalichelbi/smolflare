---
"miniflare": patch
"smolflare": patch
---

Make Miniflare R2 blob storage configurable

Miniflare accepts one `r2BlobStorage` implementation for each instance. The filesystem is the default. Smolflare provides `R2FileSystem`, `R2BucketS3`, `R2BucketGCS`, and `R2BucketAzureBlobStorage`.
