import { createSmolflareR2Plugin, SMOLFLARE_PLUGIN_NAME } from "./plugin-core";
import type { R2Plugin } from "./plugin-core";

interface ExternalPluginContext {
	plugins: Readonly<Record<string, R2Plugin>>;
	sharedBindings: Readonly<Record<string, string>>;
}

/** Creates Smolflare plugins from the Miniflare instance that loaded us. */
export function createPlugins(context: ExternalPluginContext) {
	const r2Plugin = context.plugins.r2;
	if (r2Plugin === undefined) {
		throw new Error("Miniflare did not provide its R2 plugin");
	}
	const blobBindingName = context.sharedBindings.MAYBE_SERVICE_BLOBS;
	if (blobBindingName === undefined) {
		throw new Error("Miniflare did not provide its blob service binding");
	}
	return {
		[SMOLFLARE_PLUGIN_NAME]: createSmolflareR2Plugin(r2Plugin, blobBindingName),
	};
}
