import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedInstanceOptions } from "../../config/schema";
import type { Service, Worker_DurableObjectStorage } from "../../runtime";

export async function getSqliteStorage(
	pluginName: string,
	localDiskServiceName: string,
	tmpPath: string,
	sharedOptions: ParsedInstanceOptions
): Promise<{
	storage: Worker_DurableObjectStorage;
	cacheService?: Service;
}> {
	const configured = sharedOptions.sqliteStorage;
	if (configured.type === "local-disk") {
		return { storage: { localDisk: localDiskServiceName } };
	}

	const cacheRoot =
		configured.cacheDirectory ?? path.join(tmpPath, "sqlite-cache");
	const cacheDirectory = path.join(cacheRoot, pluginName);
	const cacheServiceName = `${pluginName}:sqlite-cache`;
	await fs.mkdir(cacheDirectory, { recursive: true });

	return {
		storage: {
			remoteLtx: {
				cacheDisk: cacheServiceName,
				cacheDirectory,
				extensionPath: configured.extensionPath,
				replicaUrl: `${configured.replicaUrl.replace(/\/$/, "")}/${encodeURIComponent(pluginName)}`,
				vfsName: configured.vfsName,
				syncInterval: configured.syncInterval,
				pageCacheBytes: BigInt(configured.pageCacheBytes),
			},
		},
		cacheService: {
			name: cacheServiceName,
			disk: { path: cacheDirectory, writable: true },
		},
	};
}
