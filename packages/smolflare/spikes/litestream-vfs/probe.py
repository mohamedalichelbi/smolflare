import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile


def files_below(root: Path) -> list[dict[str, int | str]]:
    return [
        {"path": str(path.relative_to(root)), "size": path.stat().st_size}
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension", required=True)
    parser.add_argument("--litestream", required=True)
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    root = Path(tempfile.mkdtemp(prefix="smolflare-litestream-vfs-"))
    replica = root / "replica"
    replica.mkdir()
    source = root / "source.sqlite"

    bootstrap = sqlite3.connect(source)
    bootstrap.execute("PRAGMA journal_mode=WAL")
    bootstrap.execute(
        "CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"
    )
    bootstrap.execute("INSERT INTO items(value) VALUES (?)", ("initial",))
    bootstrap.commit()
    bootstrap.close()

    subprocess.run(
        [
            args.litestream,
            "replicate",
            "-once",
            "-force-snapshot",
            str(source),
            replica.as_uri(),
        ],
        check=True,
    )
    for path in root.glob("source.sqlite*"):
        path.unlink()

    os.environ["LITESTREAM_HYDRATION_ENABLED"] = "false"
    loader = sqlite3.connect(":memory:")
    loader.enable_load_extension(True)
    loader.load_extension(args.extension)

    buffer = root / "write-buffer"
    uri = (
        "file:durable-object.sqlite?vfs=litestream"
        f"&replica_url={replica.as_uri()}"
        "&write_enabled=true"
        "&sync_interval=1h"
        "&hydration_enabled=false"
        f"&buffer_path={buffer}"
    )
    writer = sqlite3.connect(uri, uri=True)
    journal_mode = writer.execute("PRAGMA journal_mode").fetchone()[0]
    requested_wal_mode = writer.execute("PRAGMA journal_mode=WAL").fetchone()[0]
    writer.execute("INSERT INTO items(value) VALUES (?)", ("bucket-backed",))
    writer.commit()
    before_flush = files_below(root)
    writer.close()

    reader = sqlite3.connect(uri, uri=True)
    rows = reader.execute("SELECT id, value FROM items ORDER BY id").fetchall()
    reader.close()

    fresh_replica = root / "fresh-replica"
    fresh_replica.mkdir()
    fresh_buffer = root / "fresh-write-buffer"
    fresh_uri = (
        "file:fresh.sqlite?vfs=litestream"
        f"&replica_url={fresh_replica.as_uri()}"
        "&write_enabled=true"
        "&sync_interval=1h"
        "&hydration_enabled=false"
        f"&buffer_path={fresh_buffer}"
    )
    fresh = sqlite3.connect(fresh_uri, uri=True)
    fresh.execute("CREATE TABLE created (value TEXT NOT NULL)")
    fresh.execute("INSERT INTO created(value) VALUES ('from-empty-replica')")
    fresh.commit()
    fresh.close()
    fresh = sqlite3.connect(fresh_uri, uri=True)
    fresh_rows = fresh.execute("SELECT value FROM created").fetchall()
    fresh.close()
    loader.close()

    result = {
        "root": str(root),
        "journal_mode": journal_mode,
        "requested_wal_mode": requested_wal_mode,
        "rows": rows,
        "fresh_replica_rows": fresh_rows,
        "files_before_flush": before_flush,
        "files_after_reopen": files_below(root),
        "complete_local_database_exists": (root / "durable-object.sqlite").exists(),
    }
    print(json.dumps(result, indent=2))

    if not args.keep:
        shutil.rmtree(root)


if __name__ == "__main__":
    main()
