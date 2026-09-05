import fs from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { getSqliteStorage } from "../../../src/plugins/shared/sqlite-storage";
import { useTmp } from "../../test-shared";
import type { ParsedInstanceOptions } from "../../../src/config/schema";

test("uses the existing disk service by default", async ({ expect }) => {
	const tmpPath = await useTmp();
	const sharedOptions = {
		sqliteStorage: { type: "local-disk" },
	} as ParsedInstanceOptions;
	const result = await getSqliteStorage(
		"r2",
		"r2:storage",
		tmpPath,
		sharedOptions
	);

	expect(result).toEqual({ storage: { localDisk: "r2:storage" } });
});

test("creates an isolated remote LTX cache service", async ({ expect }) => {
	const tmpPath = await useTmp();
	const cacheRoot = path.join(tmpPath, "cache");
	const sharedOptions = {
		sqliteStorage: {
			type: "remote-ltx",
			extensionPath: "/opt/lib/litestream-vfs.so",
			replicaUrl: "s3://database-bucket/root/",
			cacheDirectory: cacheRoot,
			pageCacheBytes: 4096,
			vfsName: "litestream",
			syncInterval: "1s",
		},
	} as ParsedInstanceOptions;
	const result = await getSqliteStorage(
		"r2",
		"r2:storage",
		tmpPath,
		sharedOptions
	);

	expect(result.storage).toEqual({
		remoteLtx: {
			cacheDisk: "r2:sqlite-cache",
			cacheDirectory: path.join(cacheRoot, "r2"),
			extensionPath: "/opt/lib/litestream-vfs.so",
			replicaUrl: "s3://database-bucket/root/r2",
			vfsName: "litestream",
			syncInterval: "1s",
			pageCacheBytes: 4096n,
		},
	});
	expect(result.cacheService).toEqual({
		name: "r2:sqlite-cache",
		disk: { path: path.join(cacheRoot, "r2"), writable: true },
	});
	expect((await fs.stat(path.join(cacheRoot, "r2"))).isDirectory()).toBe(true);
});
