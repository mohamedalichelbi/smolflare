# Celld backend feasibility

Status: architecture investigation. No Celld integration is implemented.

Reviewed version: Celld `v0.4.0` at commit
`a52f9905425bc41134d817694bdc2c50bcc5e856`.

## Decision

Do not add Celld as a storage backend below Miniflare.

Celld is not a blob-and-SQLite storage service. It is a separate Workers
runtime and Durable Object data plane. It embeds V8, runs Worker bundles,
routes Durable Object requests, owns each object, opens its SQLite database,
replicates LTX data, and supplies KV, R2, D1, Queues, and Workflows.

If Smolflare adopts Celld, add it as an alternative runtime backend:

```text
                       Smolflare control plane
                    deploy, route, observe, bill
                              |
                +-------------+-------------+
                |                           |
                v                           v
       Miniflare/workerd mode          Celld fleet mode
       local development and           production data plane
       unsupported Celld APIs          for compatible apps
```

Do not use this shape:

```text
Miniflare/workerd execution -> Celld as remote SQLite/blob storage
```

That shape splits a Durable Object across two runtimes. Storage calls are
synchronous and local to the active object. Celld does not expose a generic
remote actor-storage protocol. A bridge would need to reproduce Durable Object
routing, ownership, input and output gates, transactions, alarms, RPC, streams,
and error behavior. It would be a second Durable Object implementation, not a
small storage adapter.

## What Celld replaces

Celld can replace the work that the proposed Litestream VFS design must still
build:

- one SQLite database for each Durable Object;
- a single owner and writer for each database;
- ownership records, compare-and-swap, leases, and fencing epochs;
- LTX replication and compaction;
- output gating until Celld proves that a write is durable;
- crash recovery and host migration from bucket state;
- idle-cell eviction and activation;
- pressure limits and a resident-cell limit;
- a bounded LRU cache of complete, evicted SQLite snapshots;
- deployment and routing across a fleet;
- Cloudflare-style Durable Objects, KV, R2, D1, Queues, and Workflows.

This is a much more complete distributed system than the current writable-VFS
prototype. In particular, Celld documents an RPO of zero for acknowledged
writes. The writable Litestream VFS prototype accepts a window in which an
acknowledged write can be lost.

## What Celld does not replace

Celld does not offer complete Cloudflare compatibility. Version 0.4.0 marks
Workers, Durable Objects, KV, R2, D1, Queues, and Workflows as partial. Examples
of current differences include:

- no shared edge cache;
- no Workers AI, Vectorize, Hyperdrive, Browser Rendering, Email Workers, or
  Python Workers;
- incomplete RPC, WebSocket, Node.js, and runtime API behavior;
- one writer for each KV namespace and queue;
- R2 multipart uploads cannot resume on another node or after restart;
- Workflows have replay and API differences;
- no managed TLS, custom domains, account service, multi-tenant scheduler, or
  managed ingress.

Celld implements these products itself. It does not run Miniflare's internal
service Workers. Moving an application to Celld therefore replaces
Miniflare/workerd behavior for all supported bindings. It does not preserve the
exact Miniflare implementation and only swap its persistence layer.

R2 also shows why “all services are only Durable Objects” is not exact. Celld
uses a shared SQLite cell for R2 keys and metadata, but stores immutable object
bodies directly in the fleet bucket. Smolflare's current split between SQLite
metadata and external blob bodies has the same basic reason.

## Local-disk result

Celld does not satisfy the original strict requirement that a complete active
database must never exist on local disk.

For an active cell, Celld creates this file:

```text
<CELLD_WATCH>/<cell>/ltx/e<epoch>/db.sqlite
```

On a cold activation, Celld reads the complete contiguous LTX history from the
bucket and restores a complete local SQLite database before it serves the
cell. On an orderly idle eviction, it can rename that complete file to
`db.evicted` for a fast local restart. It removes WAL, SHM, and replication
metadata. If local preservation is disabled, or the cache removes the file,
the next activation restores from the bucket.

The preserved snapshot cache is disposable and process-wide. It uses LRU and
has a byte limit through `CELLD_LOCAL_CACHE_MAX_BYTES`. The default is 2 GiB;
zero disables the cache. `CELLD_MAX_RESIDENT_CELLS` provides a hard admission
limit for live cells, and idle eviction can use `CELLD_IDLE_EVICT_S`.

The bucket is authoritative, so a node can start with an empty local directory.
However, disk demand for resident cells is the sum of their complete SQLite
files, WAL and temporary data. The snapshot-cache limit does not limit those
active files. Celld removes the persistent-volume dependency, but it does not
remove full-database local capacity planning.

This distinction gives two possible product requirements:

1. If local disk must be disposable but can contain full active databases,
   Celld is a strong candidate.
2. If no full database may exist locally, Celld v0.4.0 is not a match. Continue
   the page-fetching writable-VFS investigation.

## Bucket compatibility

Celld requires:

- conditional object creation;
- conditional overwrite against an ETag or generation;
- read-after-write consistency;
- correct range reads;
- a supervisor that restarts a self-fenced node.

Celld qualifies Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage, and
Azure Blob Storage. Its documentation explicitly states that Hetzner Object
Storage, Backblaze B2, and DigitalOcean Spaces do not provide the required
conditional writes and are unsafe for ownership coordination.

Therefore, Hetzner Object Storage cannot safely host a Celld fleet. Running
Celld on Hetzner VMs is fine, but the fleet state must use a qualified bucket,
such as Cloudflare R2. Run `celld diagnose` against the exact provider before
deployment. Do not disable the storage probe in production.

## Scale and isolation

Celld is designed for many independent databases. One process runs many cells;
each cell has its own SQLite database and one active owner. Idle cells can be
evicted, and a hard resident-cell cap prevents unbounded live databases. Celld
also limits concurrent activation and eviction work.

This model is a better fit for thousands of mostly idle Durable Objects than
creating one process or one Litestream daemon for each database.

The deployment boundary is important: one Celld fleet runs one application.
Celld does not include a multi-tenant scheduler. If each Smolflare workspace is
an unrelated application with its own trust boundary and dependencies, the
simple safe model is one fleet and one bucket prefix or bucket for each
workspace. That model can be too expensive operationally for many small
workspaces. Sharing a fleet requires Smolflare to package the workloads as one
Celld application and to define isolation that Celld does not supply as a
managed multi-tenant feature.

## Proposed Smolflare integration

Add a runtime interface above Miniflare, not a Celld adapter below its storage
plugins:

```ts
interface WorkspaceRuntime {
	deploy(input: DeploymentInput): Promise<Deployment>;
	start(): Promise<void>;
	stop(options: StopOptions): Promise<void>;
	status(): Promise<RuntimeStatus>;
	getIngress(): Promise<IngressTarget>;
}

class MiniflareRuntime implements WorkspaceRuntime {}
class CelldRuntime implements WorkspaceRuntime {}
```

`CelldRuntime` would:

1. Convert or validate the workspace's Wrangler configuration.
2. Reject every unsupported binding and compatibility feature before deploy.
3. Deploy the Worker bundle to an isolated Celld fleet bucket.
4. Start one or more Celld nodes with a disposable `CELLD_WATCH` directory.
5. Route the workspace ingress to the fleet.
6. Export cell, replication, ownership, cache, and durability metrics.
7. Preserve Smolflare's workspace lifecycle without claiming that Miniflare is
   still the runtime.

The first spike should use one non-production workspace and Cloudflare R2. It
must compare the same test program on Miniflare/workerd and Celld. Test user
Durable Objects plus each binding that the product exposes.

## Required spike gates

Do not replace the current path until the spike proves:

- the product's generated Worker bundle deploys without source changes;
- every required compatibility flag works;
- user Durable Objects, KV, R2, D1, Queues, Workflows, alarms, RPC, and
  WebSockets behave as the product needs;
- an empty node restores state after deletion of all local files;
- the active full-database disk cost fits a configured ephemeral-disk budget;
- the resident-cell limit and eviction policy work under realistic load;
- a node crash cannot lose an acknowledged write;
- two nodes cannot write one cell during a partition or restart;
- a fleet upgrade does not interrupt the user-visible workflow beyond the
  accepted limit;
- Smolflare can isolate workspaces and credentials at the selected fleet
  boundary;
- the qualified bucket request cost is acceptable.

## Recommendation

Keep the current Litestream branches as a narrow, reviewable experiment. Do
not extend them while the Celld runtime spike is evaluated.

Prefer Celld when all of these statements are true:

- disposable local full-database files are acceptable;
- a qualified object store is available;
- the application stays inside Celld's compatibility surface;
- Smolflare can operate the one-application-per-fleet boundary;
- replacing workerd is acceptable.

Prefer the workerd VFS path when any of these statements are true:

- active databases must use lazy remote page reads and must not exist in full
  on local disk;
- exact workerd behavior is required;
- a required Cloudflare API is absent or incompatible in Celld;
- Miniflare's current service implementations must remain authoritative.

Do not build a remote “Celld storage backend for Miniflare.” It combines both
runtimes while retaining the difficult parts of each.

## Sources

- [Celld repository](https://github.com/denoland/celld)
- [Celld documentation](https://celld.dev/docs/)
- [Cloudflare compatibility](https://celld.dev/docs/cloudflare-compat/)
- [Data and ownership guarantees](https://celld.dev/docs/guarantees/)
- [Operational limitations](https://celld.dev/docs/limitations/)
- [`ltx_repl.rs` activation and eviction implementation](https://github.com/denoland/celld/blob/main/crates/celld/ltx_repl.rs)
- [`replication.rs` preserved snapshot cache](https://github.com/denoland/celld/blob/main/crates/celld/replication.rs)
