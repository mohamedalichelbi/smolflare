# Smolflare

Smolflare adds configurable storage backends to the Miniflare distribution in
this repository. It is experimental and is not affiliated with or supported by
Cloudflare.

## Experimental bucket-backed SQLite

The Smolflare workerd fork can open Durable Object databases through an
operator-provided writable SQLite VFS. Miniflare applies this backend to user
Durable Objects and to its KV, R2 metadata, D1, Cache, and observability
services.

Install the pinned runtime files in an image build or before Miniflare starts.
The installer verifies both SHA-256 values and reuses verified files:

```ts
import { installSmolflareRuntime } from "smolflare";

const runtime = await installSmolflareRuntime("/opt/smolflare/runtime");
process.env.MINIFLARE_WORKERD_PATH = runtime.workerdPath;
```

Then configure the Litestream extension and replica URL:

```ts
import { Miniflare } from "miniflare";

const mf = new Miniflare({
	sqliteStorage: {
		type: "remote-ltx",
		extensionPath: runtime.extensionPath,
		replicaUrl: "s3://database-bucket/smolflare",
		syncInterval: "1s",
		pageCacheBytes: 10 * 1024 * 1024,
		cacheDirectory: "/var/cache/smolflare/sqlite",
	},
	workers,
});
```

The backend always requests `hydration_enabled=false` and refuses to start when
`LITESTREAM_HYDRATION_ENABLED` enables hydration. It uses rollback journals
because Litestream's current writable VFS does not support WAL files. Local
database state consists of disposable buffers, journals, and page cache data;
the extension writes synchronized LTX state to the replica URL.

This integration is a narrow prototype. It does not yet provide a
process-wide cache limit, cross-host ownership leases, remote facet indexes,
or facet cloning. Database deletion also depends on support from the selected
VFS. See [the architecture and feasibility note](docs/bucket-backed-sqlite.md)
before using it with persistent data.

## Generic R2 blob storage

Miniflare's R2 implementation has two storage layers:

- Durable Object SQL stores keys, metadata, multipart state, and opaque blob
  identifiers in SQLite;
- a small Fetcher-compatible blob store handles immutable object bodies with
  `PUT`, `GET`, `HEAD`, `DELETE`, and byte-range requests.

Smolflare uses Miniflare's R2 API, Durable Object, SQLite schema, and blob
protocol. The blob-body implementation is configurable:

```text
R2 API and metadata
        |
Miniflare BlobStore
        |
        |-- R2FileSystem (default workerd disk service)
        |-- R2BucketS3
        |-- R2BucketGCS
        `-- R2BucketAzureBlobStorage
```

Remote implementations run in the Miniflare host process. They use the same
Fetcher contract as workerd's filesystem service.

## Usage

Pass one backend to the Smolflare Miniflare fork with `r2BlobStorage`. Normal R2
bindings remain normal R2 bindings.

Filesystem storage is the default and requires no option:

```ts
import { Miniflare } from "miniflare";

const mf = new Miniflare({ workers });
```

An explicit filesystem location can be selected with `R2FileSystem`:

```ts
import { Miniflare } from "miniflare";
import { R2FileSystem } from "smolflare";

const mf = new Miniflare({
	r2BlobStorage: new R2FileSystem("/var/lib/smolflare/r2-blobs"),
	workers,
});
```

S3 and compatible services:

```ts
import { R2BucketS3 } from "smolflare";

const r2BlobStorage = new R2BucketS3({
	bucket: "worker-blobs",
	region: "eu-central-1",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	// endpoint: "https://s3-compatible.example.com",
	// forcePathStyle: true,
});
```

Google Cloud Storage:

```ts
import { R2BucketGCS } from "smolflare";

const r2BlobStorage = new R2BucketGCS({
	bucket: "worker-blobs",
	projectId: "example-project",
	keyFilename: "/run/secrets/gcp-service-account.json",
});
```

Azure Blob Storage:

```ts
import { R2BucketAzureBlobStorage } from "smolflare";

const r2BlobStorage = new R2BucketAzureBlobStorage({
	container: "worker-blobs",
	connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
});
```

Use the selected instance in Miniflare:

```ts
const mf = new Miniflare({
	r2BlobStorage,
	workers: [
		{
			config: {
				// ...
				env: {
					BUCKET: { type: "r2", name: "application-data" },
				},
			},
		},
	],
});
```

## Backup and deletion

Remote object bodies are not a complete R2 backup. SQLite maps application keys
to opaque blob identifiers, so back up the local R2 SQLite directory and the
remote bucket as one recovery set.

All remote implementations accept `prefix` and `retainDeleted`. Retaining
deleted blobs allows an older SQLite point-in-time restore to resolve the blob
identifiers it references:

```ts
new R2BucketS3({
	bucket: "worker-blobs",
	retainDeleted: true,
	prefix: "production",
});
```

Retention grows without bound until a reachability-aware garbage collector is
added. A simple object-age lifecycle rule is unsafe because an old blob may
still be referenced by current SQLite metadata.
