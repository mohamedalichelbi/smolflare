import type { ParsedInstanceOptions } from "../../config/schema";
import type { SqliteStorageBackendResult } from "../../config/schema";

export async function getSqliteStorage(
	pluginName: string,
	localDiskServiceName: string,
	tmpPath: string,
	sharedOptions: ParsedInstanceOptions
): Promise<SqliteStorageBackendResult> {
	const configured = sharedOptions.sqliteStorage;
	if (configured === undefined) {
		return { storage: { localDisk: localDiskServiceName } };
	}

	return configured.getStorage({
		localDiskServiceName,
		pluginName,
		tmpPath,
	});
}
