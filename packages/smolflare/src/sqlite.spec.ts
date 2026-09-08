import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import { RemoteLtxSqliteStorage } from "./sqlite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { force: true, recursive: true }))
	);
});

async function useTmp(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(tmpdir(), "smolflare-sqlite-"));
	temporaryDirectories.push(directory);
	return directory;
}

test("uses conservative remote SQLite defaults", async ({ expect }) => {
	const tmpPath = await useTmp();
	const backend = new RemoteLtxSqliteStorage({
		extensionPath: "/opt/lib/litestream-vfs.so",
		replicaUrl: "s3://database-bucket/root/",
	});

	const result = await backend.getStorage({
		localDiskServiceName: "r2:storage",
		pluginName: "r2",
		tmpPath,
	});

	expect(result.storage).toEqual({
		remoteLtx: {
			cacheDisk: "r2:sqlite-cache",
			cacheDirectory: path.join(tmpPath, "sqlite-cache", "r2"),
			extensionPath: "/opt/lib/litestream-vfs.so",
			replicaUrl: "s3://database-bucket/root/r2",
			vfsName: "litestream",
			syncInterval: "1s",
			pageCacheBytes: 10_485_760n,
		},
	});
	expect(
		(await fs.stat(path.join(tmpPath, "sqlite-cache", "r2"))).isDirectory()
	).toBe(true);
});

test("keeps explicit remote SQLite values", async ({ expect }) => {
	const tmpPath = await useTmp();
	const cacheRoot = path.join(tmpPath, "cache");
	const backend = new RemoteLtxSqliteStorage({
		cacheDirectory: cacheRoot,
		extensionPath: "/opt/lib/custom-vfs.so",
		pageCacheBytes: 4096,
		replicaUrl: "s3://database-bucket/root",
		syncInterval: "1s",
		vfsName: "custom",
	});

	const result = await backend.getStorage({
		localDiskServiceName: "r2:storage",
		pluginName: "r2",
		tmpPath,
	});

	expect(result.storage).toEqual({
		remoteLtx: {
			cacheDisk: "r2:sqlite-cache",
			cacheDirectory: path.join(cacheRoot, "r2"),
			extensionPath: "/opt/lib/custom-vfs.so",
			pageCacheBytes: 4096n,
			replicaUrl: "s3://database-bucket/root/r2",
			syncInterval: "1s",
			vfsName: "custom",
		},
	});
});

test("rejects an invalid page cache size", ({ expect }) => {
	expect(
		() =>
			new RemoteLtxSqliteStorage({
				extensionPath: "/opt/lib/litestream-vfs.so",
				pageCacheBytes: -1,
				replicaUrl: "s3://database-bucket/root",
			})
	).toThrow("pageCacheBytes must be a non-negative whole number.");
});
