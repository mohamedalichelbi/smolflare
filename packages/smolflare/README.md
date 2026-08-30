# Smolflare

Smolflare runs Worker applications on common infrastructure. It uses Miniflare
and Workerd for isolated Workers and Durable Objects. It uses standard VPS,
disk, database, and bucket services for infrastructure.

Use a restricted container and a VM as the outer security boundary.

## R2 blob storage

The R2 adapter stores metadata in Miniflare SQLite. It stores blob data in GCS,
S3, or Azure Blob Storage. The R2 API and behavior stay unchanged.

The adapter has two parts:

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
					"name": "smolflare-r2",
				},
				"options": {
					"bucketName": "gadgets-blueprint-content",
					"blobServiceAddress": "smolflare:8788",
				},
			},
		},
	],
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
