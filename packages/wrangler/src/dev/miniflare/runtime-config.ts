import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UserError } from "@cloudflare/workers-utils";
import type { InstanceOptions, MiniflareOptions } from "miniflare";

type RuntimeOptions = Partial<InstanceOptions>;

interface RuntimeConfigContext {
	env: Readonly<NodeJS.ProcessEnv>;
}

interface RuntimeConfigModule {
	default?: (
		context: RuntimeConfigContext
	) => RuntimeOptions | Promise<RuntimeOptions>;
}

/** Adds trusted host options from the configured local runtime module. */
export async function applyRuntimeConfig(
	options: MiniflareOptions,
	configPath = process.env.WRANGLER_MINIFLARE_CONFIG,
	env: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<MiniflareOptions> {
	if (configPath === undefined || configPath.trim() === "") return options;

	const url = pathToFileURL(resolve(configPath)).href;
	const module = (await import(url)) as RuntimeConfigModule;
	if (typeof module.default !== "function") {
		throw new UserError(
			"The Miniflare runtime config must export a default function.",
			{ telemetryMessage: "miniflare runtime config export missing" }
		);
	}

	const runtimeOptions = await module.default({ env });
	if (
		typeof runtimeOptions !== "object" ||
		runtimeOptions === null ||
		"workers" in runtimeOptions
	) {
		throw new UserError(
			"The Miniflare runtime config must return options without workers.",
			{ telemetryMessage: "miniflare runtime config result invalid" }
		);
	}

	return { ...options, ...runtimeOptions };
}
