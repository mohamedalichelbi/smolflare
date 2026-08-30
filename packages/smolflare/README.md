# Smolflare

Smolflare keeps Miniflare's local R2 behavior and stores the blob bytes in a
real object store. R2 metadata remains in Miniflare's SQLite database, so the
existing R2 API, conditions, metadata, listing, and multipart behavior stay in
one place.

Smolflare has two parts:

- an external Miniflare plugin named `smolflare-r2`;
- an HTTP blob gateway with GCS, S3-compatible, and Azure Blob Storage backends.

The plugin is loaded through a Wrangler service binding with `dev.plugin`.
Wrangler turns that local binding into a Miniflare external plugin binding.
Smolflare receives Miniflare's own R2 plugin, keeps its SQLite metadata service,
and replaces only the internal blob service.

Use this shape in a local Wrangler configuration:

```jsonc
{
  "services": [
    {
      "binding": "BLUEPRINT_CONTENT",
      "service": "gadgets-blueprint-content",
      "dev": {
        "plugin": {
          "package": "smolflare",
          "name": "smolflare-r2"
        },
        "options": {
          "bucketName": "gadgets-blueprint-content",
          "blobServiceAddress": "smolflare:8788"
        }
      }
    }
  ]
}
```

Keep the normal `r2_buckets` entry in a configuration used for Cloudflare
deployment. Replace it only in the generated local configuration.

## Gateway

Common settings:

```text
SMOLFLARE_PROVIDER=gcs|s3|azure
SMOLFLARE_PREFIX=optional/object/prefix
SMOLFLARE_RETAIN_DELETED=true
SMOLFLARE_HOST=0.0.0.0
SMOLFLARE_PORT=8788
```

GCS:

```text
SMOLFLARE_PROVIDER=gcs
SMOLFLARE_BUCKET=my-bucket
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp.json
```

S3 and compatible services:

```text
SMOLFLARE_PROVIDER=s3
SMOLFLARE_BUCKET=my-bucket
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SMOLFLARE_S3_ENDPOINT=https://optional-endpoint
SMOLFLARE_S3_FORCE_PATH_STYLE=false
```

Azure:

```text
SMOLFLARE_PROVIDER=azure
SMOLFLARE_AZURE_CONTAINER=my-container
AZURE_STORAGE_CONNECTION_STRING=...
```

Retaining deleted blobs lets an older Litestream restore continue to read the
blob IDs referenced by its restored SQLite metadata. Remove old unreferenced
blobs with a separate retention policy after the database recovery window.
