# Bucket-backed SQLite feasibility

Status: integrated experimental prototype, not production-ready.

## Decision

Smolflare cannot add a writable Litestream VFS only at the Miniflare JavaScript
layer. Miniflare selects a directory for Durable Object storage, but workerd
creates and opens every SQLite connection. The current workerd configuration
does not have a remote SQLite or custom VFS option.

The practical boundary is:

```text
Smolflare and Miniflare control plane
  - configuration
  - credentials
  - cache and lease policy
  - metrics export
              |
              v
Smolflare workerd fork data plane
  - SQLite connection
  - SQLite VFS
  - LTX page index
  - remote page reads and transaction publication
```

The prototype adds an `ActorStorageBackend` interface to the Smolflare workerd
fork. Its existing implementation preserves local-disk behavior. A second
implementation opens databases through an operator-provided writable SQLite
VFS extension and forces rollback-journal mode. Miniflare selects the backend
and provides separate remote prefixes and disposable cache directories for
each supported product.

The extension is an integration seam, not a production endorsement of the
current Litestream implementation. Its per-database cache, lifecycle, delete,
facet, and ownership behavior still leaves the gaps listed below.

## Current storage path

Miniflare creates a writable disk service named `do:storage`. It passes that
service name to workerd as `durableObjectStorage.localDisk`. The configuration
type has only three choices: no storage, in-memory storage, or a local disk
service.

Workerd verifies that `localDisk` refers to a native writable
`DiskDirectoryService`. A Worker service or Fetcher cannot be used in its place.
Workerd then:

1. Opens a subdirectory for the Durable Object namespace.
2. Derives the database name from the Durable Object ID.
3. Creates `<id>.sqlite` itself.
4. Creates `<id>.sqlite-wal` and shared-memory state as needed.
5. Opens SQLite through workerd's own registered KJ VFS.
6. Runs `PRAGMA journal_mode=WAL` on open and after database reset.

The namespace directory name is the namespace `uniqueKey`. Miniflare normally
derives it as `<worker-name>-<class-name>`. The database filename is the
hexadecimal Durable Object ID followed by `.sqlite`. Facets add a numeric part
before `.sqlite`. A namespace also has `metadata.sqlite` for its alarm
scheduler.

This path applies to user Durable Objects and to Miniflare services implemented
as Durable Objects. KV, R2 metadata, D1, Cache, Rate Limit, and other plugins
configure their own local disk services. They do not send SQL or SQLite pages
back to the Miniflare host process.

R2 blob bodies are different. Miniflare's R2 Durable Object stores keys,
metadata, and opaque blob IDs in its workerd-owned SQLite database. Blob bodies
use a Fetcher binding. Smolflare replaces that Fetcher today. There is no
equivalent Fetcher binding below Durable Object SQLite.

## SQLite binding and VFS experiment

Miniflare does not use a Node SQLite package for Durable Object storage. The
SQLite library is linked into the workerd executable.

Workerd already registers a custom SQLite VFS. `SqliteDatabase` calls
`sqlite3_open_v2()` with the generated name of that VFS. The VFS is backed by a
`kj::Directory`; it delegates to SQLite's native filesystem VFS for a real disk
directory. Workerd exposes no configuration field for another VFS name and no
extension-loading operation for these internal connections.

Node 22.22.1 was tested separately:

- `node:sqlite` can load the Litestream extension.
- `node:sqlite` does not enable `SQLITE_OPEN_URI` and has no named-VFS option.
- Opening `file:durable-object.sqlite?vfs=litestream` therefore failed with
  `ERR_SQLITE_ERROR` after the extension loaded.

This result does not block workerd directly because workerd can name a VFS in
C++. It does rule out a simple Node sidecar based on the built-in Node binding.

The executable probes are in
[`../spikes/litestream-vfs`](../spikes/litestream-vfs).

## Standalone writable VFS result

The standalone probe used:

- Litestream CLI 0.5.15;
- the official `litestream-vfs` 0.5.17 Linux extension;
- Python's SQLite binding with URI support;
- a filesystem replica as a deterministic bucket substitute;
- hydration explicitly disabled;
- a one-hour sync interval so the dirty buffer could be measured before close.

The probe performed these operations:

1. Created a two-page SQLite database.
2. Replicated its initial state to LTX.
3. Deleted the complete source database, WAL, and SHM files.
4. Opened the database through `vfs=litestream`.
5. Inserted a row and committed it.
6. Measured the unsynchronized local state.
7. Closed the connection to force a flush.
8. Opened a new VFS connection and read both rows.
9. Created another database against an empty replica through the VFS.
10. Reopened it and read the synchronized row.

Observed files and sizes:

| State                  |            Local disposable data |                      Remote representation |
| ---------------------- | -------------------------------: | -----------------------------------------: |
| Before VFS write       |                             none | 657-byte L0 plus 657-byte level-9 snapshot |
| Dirty, before flush    |          8,192-byte write buffer |                                  unchanged |
| After close and reopen | no database or write-buffer file |                new 496-byte L0 transaction |

The VFS did not create `durable-object.sqlite` locally. The second connection
returned both the initial and new rows from LTX state. This proves the desired
storage model in isolation. It does not prove compatibility with workerd.

## Journal-mode incompatibility

Workerd explicitly sets WAL mode for every Durable Object database. Its VFS has
WAL locking and shared-memory support.

The Litestream writable VFS handles main rollback journals as local temporary
files. Its `Access()` implementation always reports that a WAL file is absent,
and it does not open main WAL files. In the executable probe:

```text
PRAGMA journal_mode        -> delete
PRAGMA journal_mode=WAL    -> delete
```

Therefore, replacing workerd's current VFS with Litestream's extension would
also require one of these changes:

1. Add correct WAL and shared-memory support to the Litestream-derived VFS.
2. Change workerd's local Durable Object implementation to use rollback-journal
   mode and validate all Durable Object transaction and recovery behavior.

Option 1 preserves workerd behavior but is substantially more work. Option 2 is
the better first spike because it changes less storage code, but it is not safe
to ship without the full Durable Object test suite and crash testing.

## Litestream VFS behavior

The inspected VFS has these relevant properties:

- It reconstructs a page-to-LTX-offset index from remote LTX metadata.
- It uses range reads for individual remote pages.
- Dirty pages take priority over cached and remote pages.
- It stores dirty pages in a disposable local write-buffer file.
- `Close()` synchronizes dirty pages before it removes the buffer.
- It detects a newer remote TXID before publication and returns a conflict.
- LTX files are immutable. Publication is complete only after
  `WriteLTXFile()` succeeds.
- Hydration is off by default, but environment and URI settings can enable it.
- The page cache is an in-memory Hashicorp LRU.
- `CacheSize` is applied independently to each opened VFS file.
- SQLite journals, temporary databases, and transient files use an unbounded
  temporary directory.

The current implementation does not meet Smolflare's global-cache requirement.
One thousand open databases with the 10 MiB default can reserve a large amount
of memory as pages become hot. There is no process-wide byte limit, item limit,
per-database accounting, or global eviction policy. The write buffer is
correctly separate from the page cache, but temporary-file growth is also not
globally controlled.

## Lifecycle and ownership

Workerd keeps one live actor instance for a Durable Object ID in one server
process. Requests enter through the actor input gate. SQLite writes are grouped
into implicit transactions, and the output gate waits for confirmed commits.
Requests can interleave at JavaScript awaits, so storage serialization is an
actor and SQLite concern rather than a Miniflare host concern.

After the actor becomes inactive, workerd starts a ten-second eviction timer.
It then shuts down the actor and its `ActorSqlite` object. Miniflare is not told
that an individual database became idle. `ActorSqlite::shutdown()` prevents new
flushes, but the local workerd commit callback is immediately ready because the
filesystem write has already completed.

A remote VFS needs a different contract: the workerd commit callback must
represent successful remote synchronization when the write requires
confirmation, or it must deliberately implement the accepted asynchronous
durability window. Actor eviction must explicitly flush the VFS before the
connection is destroyed, with a bounded timeout.

Workerd does not coordinate Durable Object ownership across processes or hosts.
Its configuration contains a TODO for distributed object placement. Two
Smolflare processes that share one bucket can open the same database. The
Litestream TXID conflict check detects some overlap after writes begin, but it
is not an ownership protocol.

A deployment needs a lease with these properties:

- key namespace: `<database-prefix>/<namespace-key>/<object-id>/owner`;
- conditional create and renewal using a provider generation, ETag, or version;
- a short expiry with fencing tokens;
- the fencing token recorded in every published head or transaction;
- no write after lease loss;
- release on graceful close, with expiry as the crash path.

Do not rely only on a time-based object value without conditional writes and a
fencing token.

## Bucket adapter assessment

Smolflare's current `BlobStorage` interface supplies PUT, HEAD, GET with an
optional byte range, and DELETE. A Litestream replica client also needs prefix
LIST and bulk LTX deletion. Production use additionally needs cancellation,
timeouts, retry policy, integrity metadata, and conditional operations for
leases and safe head publication.

The upstream Litestream extension cannot call the TypeScript `BlobStorage`
object. The extension contains Go storage clients and reads credentials and a
replica URL from the environment or SQLite URI. The fastest real-bucket spike
is therefore to use Litestream's existing S3 or GCS client directly.

Reusing Smolflare's exact bucket object requires a process boundary or a new
native bridge:

- A Go sidecar can implement `ReplicaClient` and expose database RPC, but then
  workerd's synchronous Durable Object storage API must be proxied. This is a
  large reimplementation.
- A workerd-native VFS can use a C++ object client or an internal asynchronous
  I/O bridge. SQLite VFS calls are synchronous, so remote misses must block a
  dedicated storage thread rather than the JavaScript event-loop thread.
- A local HTTP adapter from the Go extension to Smolflare is possible, but it
  adds another protocol and still requires the extension inside workerd.

For the first integrated spike, use an S3-compatible bucket directly. Design a
narrow shared object-store contract only after the workerd VFS path is proven.

## Required configuration

Smolflare now exposes this initial `sqliteStorage` object:

```ts
interface RemoteLtxSqliteStorage {
	type: "remote-ltx";
	extensionPath: string;
	replicaUrl: string;
	vfsName?: string;
	syncInterval?: string;
	pageCacheBytes?: number;
	cacheDirectory?: string;
}
```

Smolflare must reject all hydration settings, including inherited
`LITESTREAM_HYDRATION_ENABLED=true`. It should construct explicit per-database
configuration instead of relying on process-wide Litestream environment
variables.

## Integration options

### 1. Workerd fork with an external writable VFS — implemented prototype

Add a new workerd Durable Object storage variant. Keep configuration and
operator controls in Smolflare and Miniflare. Implement page reads, LTX writes,
leases, cache accounting, and flush lifecycle below `SqliteDatabase`.

Advantages:

- preserves the Worker and Durable Object APIs;
- covers user Durable Objects and SQLite-backed Miniflare services;
- keeps SQLite transaction boundaries authoritative;
- avoids a POSIX or FUSE compatibility layer.

Costs:

- maintains a workerd patch;
- requires rollback-journal validation or new WAL support;
- requires a synchronous native bucket client or storage thread;
- needs a new global cache manager.

### 2. External Durable Object storage service — not recommended

Move SQL and KV operations to a sidecar that owns Litestream SQLite
connections. This avoids changing SQLite inside workerd, but workerd does not
have a configuration hook for remote local-Durable-Object storage. It would
require a new actor-storage protocol and would need to preserve alarms,
transactions, bookmarks, facets, and output-gate behavior.

### 3. Restore and replicate local databases — fallback only

Continue to restore full SQLite files before workerd starts and replicate their
WAL with normal Litestream. This is compatible today, but it retains the full
local database and does not meet the objective.

## Production-readiness gaps

The standalone proof validates lazy LTX access. The integrated prototype adds
the workerd storage configuration, VFS-selection hook, rollback-journal mode,
alarm database handling, and Miniflare routing. The following items remain
unresolved:

- asynchronous bucket I/O below synchronous SQLite calls;
- process-wide cache and temporary-space enforcement;
- explicit VFS flush tied to actor eviction and server shutdown;
- a cross-host lease with fencing;
- facets and database clone/delete behavior;
- compaction safety with active readers;
- atomic publication on each supported bucket provider;
- corrupt, missing, and truncated LTX recovery;
- crash injection at every upload and publication step;
- memory and latency measurements with hundreds or thousands of databases.

Do not claim production readiness until these are tested with the workerd
Durable Object suite and a real object store.

## Next validation work

1. Run the integrated backend against an S3-compatible test bucket.
2. Run workerd's Durable Object tests in rollback-journal mode.
3. Make actor shutdown call a bounded VFS flush.
4. Delete all local state and restart on a second process.
5. Record remote operations and all local files during the test.
6. Add crash points before upload, after upload, and before head publication.
7. Implement process-wide clean-cache accounting and eviction.
8. Add a fenced ownership lease before permitting cross-host scheduling.
9. Define remote facet-index and clone/delete semantics.
10. Decide whether rollback mode is acceptable or WAL support is required.

## Primary sources

- [Miniflare Durable Object plugin](../../miniflare/src/plugins/do/index.ts)
- [Miniflare worker storage configuration](../../miniflare/src/plugins/core/index.ts)
- [Miniflare runtime configuration types](../../miniflare/src/runtime/config/workerd.ts)
- [Smolflare blob-storage contract](../src/blob-storage.ts)
- [Litestream VFS source](https://github.com/benbjohnson/litestream/blob/main/vfs.go)
- [Litestream VFS documentation](https://github.com/benbjohnson/litestream/blob/main/docs/VFS.md)
- [Litestream replica-client interface](https://github.com/benbjohnson/litestream/blob/main/replica_client.go)
- [Workerd server storage construction](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/server.c%2B%2B)
- [Workerd SQLite VFS](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c%2B%2B)
- [Workerd SQLite API](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.h)
