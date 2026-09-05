# Litestream writable VFS probe

This probe verifies lazy LTX reads and writes without a complete local database.
It does not run inside Miniflare or workerd.

## Requirements

- Python 3 with loadable SQLite extensions enabled.
- The `litestream` CLI.
- The official `litestream-vfs` shared library.

For example, install `litestream-vfs` in a temporary npm project and use its
`getLoadablePath()` function to find the shared library.

## Run

```sh
python3 probe.py \
  --litestream /path/to/litestream \
  --extension /path/to/litestream-vfs.so
```

The script creates all state in a new temporary directory. It tests both an
existing LTX replica and a new database created through the VFS. It prints:

- the journal mode;
- rows read after a clean reopen;
- files and sizes before flush;
- files and sizes after reopen.

The expected result is rollback-journal mode, an 8 KiB dirty buffer for the
small test transaction, a new LTX delta after close, and no complete local
database file.

Use `probe-node-sqlite.mjs` to verify the separate Node binding limitation:

```sh
node probe-node-sqlite.mjs /path/to/litestream-vfs.so file:///empty/replica
```

The extension load must succeed. On Node 22, the named-VFS open must fail
because `node:sqlite` does not expose `SQLITE_OPEN_URI` or a VFS option.
