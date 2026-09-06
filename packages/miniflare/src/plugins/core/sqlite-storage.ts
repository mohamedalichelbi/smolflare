import { DURABLE_OBJECTS_PLUGIN_NAME } from "../do/constants";

export function getDurableObjectStoragePluginName(workerName: string): string {
	return `${DURABLE_OBJECTS_PLUGIN_NAME}-${workerName}`;
}
