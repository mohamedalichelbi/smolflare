import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PAGE_CACHE_BYTES = 10 * 1024 * 1024;
const DEFAULT_SYNC_INTERVAL = "1m";
const DEFAULT_VFS_NAME = "litestream";

function requireValue(value: string, name: string): void {
	if (value.length === 0) {
		throw new Error(`${name} must not be empty.`);
	}
}

interface SqliteStorageContext {
	readonly localDiskServiceName: string;
	readonly pluginName: string;
	readonly tmpPath: string;
}

/** Options for the remote LTX SQLite backend. */
export interface RemoteLtxSqliteStorageOptions {
	readonly cacheDirectory?: string;
	readonly extensionPath: string;
	readonly pageCacheBytes?: number;
	readonly replicaUrl: string;
	readonly syncInterval?: string;
	readonly vfsName?: string;
}

/** Stores Durable Object SQLite databases as remote LTX data. */
export class RemoteLtxSqliteStorage {
	readonly type = "custom" as const;

	readonly #options: Required<
		Omit<RemoteLtxSqliteStorageOptions, "cacheDirectory">
	> &
		Pick<RemoteLtxSqliteStorageOptions, "cacheDirectory">;

	constructor(options: RemoteLtxSqliteStorageOptions) {
		requireValue(options.extensionPath, "extensionPath");
		requireValue(options.replicaUrl, "replicaUrl");
		if (
			options.pageCacheBytes !== undefined &&
			(!Number.isSafeInteger(options.pageCacheBytes) ||
				options.pageCacheBytes < 0)
		) {
			throw new Error("pageCacheBytes must be a non-negative whole number.");
		}
		if (options.syncInterval !== undefined) {
			requireValue(options.syncInterval, "syncInterval");
		}
		if (options.vfsName !== undefined) {
			requireValue(options.vfsName, "vfsName");
		}
		this.#options = {
			...options,
			pageCacheBytes: options.pageCacheBytes ?? DEFAULT_PAGE_CACHE_BYTES,
			syncInterval: options.syncInterval ?? DEFAULT_SYNC_INTERVAL,
			vfsName: options.vfsName ?? DEFAULT_VFS_NAME,
		};
	}

	async getStorage(context: SqliteStorageContext) {
		const cacheRoot =
			this.#options.cacheDirectory ??
			path.join(context.tmpPath, "sqlite-cache");
		const cacheDirectory = path.join(cacheRoot, context.pluginName);
		const cacheServiceName = `${context.pluginName}:sqlite-cache`;
		await fs.mkdir(cacheDirectory, { recursive: true });

		return {
			storage: {
				remoteLtx: {
					cacheDisk: cacheServiceName,
					cacheDirectory,
					extensionPath: this.#options.extensionPath,
					replicaUrl: `${this.#options.replicaUrl.replace(/\/$/, "")}/${encodeURIComponent(context.pluginName)}`,
					vfsName: this.#options.vfsName,
					syncInterval: this.#options.syncInterval,
					pageCacheBytes: BigInt(this.#options.pageCacheBytes),
				},
			},
			cacheService: {
				name: cacheServiceName,
				disk: { path: cacheDirectory, writable: true },
			},
		};
	}
}
