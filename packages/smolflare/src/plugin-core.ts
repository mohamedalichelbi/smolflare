interface UnsafeBinding {
	type: string;
	dev?: {
		plugin?: { name?: string };
		options?: Record<string, unknown>;
	};
	[key: string]: unknown;
}

interface WorkerOptions {
	config: {
		env?: Record<string, UnsafeBinding>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface WorkerBinding {
	name?: string;
	service?: { name?: string; [key: string]: unknown };
	[key: string]: unknown;
}

interface Service {
	name?: string;
	external?: {
		address?: string;
		http: Record<string, never>;
	};
	worker?: {
		bindings?: WorkerBinding[];
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface PluginServicesResult {
	services: Service[];
	extensions: unknown[];
}

interface PluginServicesArgs {
	options: WorkerOptions;
	[key: string]: unknown;
}

export interface R2Plugin {
	getBindings(
		options: WorkerOptions,
		sharedOptions: unknown,
		workerIndex: number
	): Promise<WorkerBinding[] | void> | WorkerBinding[] | void;
	getNodeBindings(
		options: WorkerOptions
	): Promise<Record<string, unknown>> | Record<string, unknown>;
	getServices(
		args: PluginServicesArgs
	):
		| Promise<Service[] | PluginServicesResult | void>
		| Service[]
		| PluginServicesResult
		| void;
}

export const SMOLFLARE_PLUGIN_NAME = "smolflare-r2";
const BLOB_SERVICE_NAME = "smolflare:blob-storage";

interface SmolflareBinding {
	bindingName: string;
	bucketName: string;
	blobServiceAddress: string;
}

/** Creates the Miniflare plugin that gives R2 an external blob store. */
export function createSmolflareR2Plugin(
	r2Plugin: R2Plugin,
	blobBindingName: string
) {
	return {
		bindingTypeDescription: "Smolflare R2 bucket",
		getBindings(
			options: WorkerOptions,
			sharedOptions: unknown,
			workerIndex: number
		) {
			return r2Plugin.getBindings(
				withR2Bindings(options),
				sharedOptions,
				workerIndex
			);
		},
		getNodeBindings(options: WorkerOptions) {
			return r2Plugin.getNodeBindings(withR2Bindings(options));
		},
		async getServices(args: PluginServicesArgs) {
			const bindings = getSmolflareBindings(args.options);
			if (bindings.length === 0) return [];
			const addresses = new Set(
				bindings.map((binding) => binding.blobServiceAddress)
			);
			if (addresses.size !== 1) {
				throw new Error(
					"All Smolflare R2 bindings in one Worker must use the same blob service"
				);
			}

			const result = await r2Plugin.getServices({
				...args,
				options: withR2Bindings(args.options),
			});
			const services = Array.isArray(result) ? result : result?.services;
			if (services === undefined) return [];
			bindExternalBlobService(services, blobBindingName);
			services.push({
				name: BLOB_SERVICE_NAME,
				external: {
					address: bindings[0]?.blobServiceAddress,
					http: {},
				},
			});
			return Array.isArray(result) ? services : { ...result, services };
		},
	};
}

function getSmolflareBindings(options: WorkerOptions): SmolflareBinding[] {
	const result: SmolflareBinding[] = [];
	for (const [bindingName, binding] of Object.entries(
		options.config.env ?? {}
	)) {
		if (!isSmolflareBinding(binding)) continue;
		const values = binding.dev?.options;
		const bucketName = readOption(values, "bucketName");
		const blobServiceAddress = readOption(values, "blobServiceAddress");
		result.push({ bindingName, bucketName, blobServiceAddress });
	}
	return result;
}

function withR2Bindings(options: WorkerOptions): WorkerOptions {
	const bindings = getSmolflareBindings(options);
	if (bindings.length === 0) return options;
	const env = { ...options.config.env };
	for (const binding of bindings) {
		env[binding.bindingName] = { type: "r2", name: binding.bucketName };
	}
	return { ...options, config: { ...options.config, env } };
}

function bindExternalBlobService(
	services: Service[],
	blobBindingName: string
): void {
	let replaced = false;
	for (const service of services) {
		if (service.worker === undefined) continue;
		for (const binding of service.worker.bindings ?? []) {
			if (binding.name !== blobBindingName) continue;
			if (binding.service === undefined) continue;
			binding.service = { name: BLOB_SERVICE_NAME };
			replaced = true;
		}
	}
	if (!replaced) {
		throw new Error("Miniflare did not provide an R2 blob service binding");
	}
}

function isSmolflareBinding(binding: UnsafeBinding): boolean {
	return (
		binding.type.startsWith("unsafe:") &&
		binding.dev?.plugin?.name === SMOLFLARE_PLUGIN_NAME
	);
}

function readOption(
	options: Record<string, unknown> | undefined,
	name: string
): string {
	const value = options?.[name];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`Smolflare binding option ${name} is required`);
	}
	return value.trim();
}
