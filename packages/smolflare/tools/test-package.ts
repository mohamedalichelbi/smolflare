import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 180_000;
const FETCH_TIMEOUT_MS = 5_000;

function run(command: string, args: string[], cwd: string): void {
	execFileSync(command, args, {
		cwd,
		stdio: "inherit",
		timeout: COMMAND_TIMEOUT_MS,
	});
}

async function main(): Promise<void> {
	const { removeDir } = await import("@cloudflare/workers-utils/fs-helpers");
	const root = path.resolve(__dirname, "..");
	const directory = await mkdtemp(path.join(tmpdir(), "smolflare-package-"));
	try {
		run("pnpm", ["pack", "--pack-destination", directory], root);
		const archives = (await readdir(directory)).filter((name) =>
			name.endsWith(".tgz")
		);
		assert.equal(archives.length, 1);
		const archive = archives[0];
		assert.ok(archive);
		const consumer = path.join(directory, "consumer");
		await mkdir(consumer);
		const typescript = JSON.parse(
			await readFile(require.resolve("typescript/package.json"), "utf8")
		) as {
			version: string;
		};
		const nodeTypes = JSON.parse(
			await readFile(require.resolve("@types/node/package.json"), "utf8")
		) as {
			version: string;
		};
		await writeFile(
			path.join(consumer, "package.json"),
			JSON.stringify({
				private: true,
				dependencies: {
					smolflare: `file:${path.join(directory, archive)}`,
					typescript: typescript.version,
					"@types/node": nodeTypes.version,
				},
			})
		);
		run(
			"pnpm",
			[
				"install",
				"--ignore-scripts",
				"--config.fetch-retries=0",
				`--config.fetch-timeout=${FETCH_TIMEOUT_MS}`,
			],
			consumer
		);
		await writeFile(
			path.join(consumer, "consumer.mts"),
			`
import { RemoteLtxSqliteStorage, R2FileSystem, createR2BlobFetcher } from 'smolflare';
import type { BlobStorage, RemoteLtxSqliteStorageOptions } from 'smolflare';
const options: RemoteLtxSqliteStorageOptions = {
  extensionPath: '/test/vfs.so', replicaUrl: 's3://test/database', pageCacheBytes: 1024,
};
const backend = new RemoteLtxSqliteStorage(options);
const type: 'custom' = backend.type;
const disk: 'fs' = new R2FileSystem().type;
const storage: BlobStorage = {
  async put() {}, async head() { return null; },
  async get() { return null; }, async delete() {},
};
const fetcher: (request: Request) => Promise<Response> = createR2BlobFetcher(storage);
// @ts-expect-error The page cache size must be a number.
new RemoteLtxSqliteStorage({ ...options, pageCacheBytes: '10MB' });
`
		);
		run(
			"pnpm",
			[
				"exec",
				"tsc",
				"consumer.mts",
				"--noEmit",
				"--strict",
				"--target",
				"ES2022",
				"--module",
				"Node16",
				"--moduleResolution",
				"Node16",
			],
			consumer
		);
		run(process.execPath, ["-e", "require('smolflare')"], consumer);
	} finally {
		await removeDir(directory);
	}
}

void main();
