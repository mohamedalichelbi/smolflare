# Smolflare

Smolflare is an experimental self-hosting toolkit for Cloudflare Worker
applications. It is maintained as a downstream distribution of Cloudflare's
[`workers-sdk`](https://github.com/cloudflare/workers-sdk) and uses Miniflare
and workerd as its runtime foundation.

Smolflare is not affiliated with or supported by Cloudflare.

## Project status

Smolflare is under active development and is not yet a supported production
platform.

Implemented today:

- the native R2 API backed by Miniflare's SQLite metadata implementation;
- R2 blob bodies stored in Amazon S3 and compatible services, Google Cloud
  Storage, or Azure Blob Storage;
- first-class `R2FileSystem`, `R2BucketS3`, `R2BucketGCS`, and
  `R2BucketAzureBlobStorage` implementations behind one Miniflare interface.

Planned work includes portable observability export, Durable Object backup and
lifecycle management, hot/cold project storage, and production runtime
orchestration.

## Architecture

Smolflare uses Miniflare's R2 implementation for the Worker-facing API. The
internal blob storage is configurable:

```text
Worker R2 binding
       |
Miniflare R2 Durable Object
       |-- SQLite metadata and multipart state --> local disk
       `-- immutable blob bytes -----------------> R2 blob storage interface
                                                       |-- R2FileSystem
                                                       |-- R2BucketS3
                                                       |-- R2BucketGCS
                                                       `-- R2BucketAzureBlobStorage
```

Keeping metadata on local disk preserves Miniflare's transaction and indexing
behavior. Moving immutable object bodies to bucket storage removes the largest
source of local disk growth.

See [`packages/smolflare`](packages/smolflare/README.md) for configuration and
usage.

## Security model

Miniflare is designed primarily as a local development runtime. Smolflare does
not turn it into a hardened multi-tenant security boundary by itself.

Run Smolflare inside a restricted container and use a VM or equivalent sandbox
as the outer isolation boundary. Remote bucket credentials live in the
Miniflare host process and should be scoped to the configured bucket and prefix.

## Data durability

R2 metadata remains in local SQLite and must be backed up alongside the remote
blob bucket. The blob objects alone are not sufficient to reconstruct an R2
namespace because SQLite maps user-visible keys to opaque blob identifiers.

Deleted blob retention is deliberately conservative by default so that an
older SQLite backup does not reference already-removed blob data. This is safe
for recovery but grows without bound until a reachability-aware garbage
collector is added. Do not apply a simple object-age lifecycle rule: an old
object may still be live.

## Upstream relationship

This repository contains the full Workers SDK monorepo so Smolflare can make
small runtime integration changes while merging Cloudflare's upstream releases.
Upstream package documentation is in the
[Cloudflare Workers SDK repository](https://github.com/cloudflare/workers-sdk).

Smolflare-specific code lives primarily in
[`packages/smolflare`](packages/smolflare). Runtime integration changes are
kept narrow to reduce the cost and risk of upstream synchronization.

## License

Smolflare and the upstream Workers SDK code are available under the repository's
MIT or Apache 2.0 licenses. See [`LICENSE-MIT`](LICENSE-MIT) and
[`LICENSE-APACHE`](LICENSE-APACHE).
