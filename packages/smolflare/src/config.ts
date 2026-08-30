import { AzureBlobStorage } from "./providers/azure";
import { GcsBlobStorage } from "./providers/gcs";
import { S3BlobStorage } from "./providers/s3";
import type { BlobStorage } from "./blob-storage";

/** Runtime settings for the Smolflare gateway. */
export interface GatewayConfig {
	host: string;
	port: number;
	prefix: string;
	retainDeleted: boolean;
	storage: BlobStorage;
}

/** Creates gateway settings from environment variables. */
export function gatewayConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env
): GatewayConfig {
	const provider = required(env, "SMOLFLARE_PROVIDER");
	const storage = createStorage(provider, env);
	return {
		host: env.SMOLFLARE_HOST?.trim() || "0.0.0.0",
		port: parsePort(env.SMOLFLARE_PORT),
		prefix: normalisePrefix(env.SMOLFLARE_PREFIX),
		retainDeleted: parseBoolean(env.SMOLFLARE_RETAIN_DELETED, true),
		storage,
	};
}

function createStorage(provider: string, env: NodeJS.ProcessEnv): BlobStorage {
	switch (provider) {
		case "gcs":
			return new GcsBlobStorage({
				bucket: required(env, "SMOLFLARE_BUCKET"),
				keyFilename:
					env.SMOLFLARE_GCS_KEY_FILE?.trim() ||
					env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
				projectId: env.GOOGLE_CLOUD_PROJECT?.trim(),
			});
		case "s3":
			return new S3BlobStorage({
				accessKeyId: env.AWS_ACCESS_KEY_ID?.trim(),
				bucket: required(env, "SMOLFLARE_BUCKET"),
				endpoint: env.SMOLFLARE_S3_ENDPOINT?.trim(),
				forcePathStyle: parseBoolean(env.SMOLFLARE_S3_FORCE_PATH_STYLE, false),
				region: env.AWS_REGION?.trim(),
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim(),
			});
		case "azure": {
			const container = required(env, "SMOLFLARE_AZURE_CONTAINER");
			const connectionString = env.AZURE_STORAGE_CONNECTION_STRING?.trim();
			if (connectionString !== undefined && connectionString !== "") {
				return new AzureBlobStorage({ container, connectionString });
			}
			return new AzureBlobStorage({
				accountKey: required(env, "AZURE_STORAGE_ACCOUNT_KEY"),
				accountName: required(env, "AZURE_STORAGE_ACCOUNT_NAME"),
				container,
				endpoint: required(env, "SMOLFLARE_AZURE_ENDPOINT"),
			});
		}
		default:
			throw new Error(
				`SMOLFLARE_PROVIDER must be gcs, s3, or azure; received ${provider}`
			);
	}
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (value === undefined || value === "") {
		throw new Error(`${name} is required`);
	}
	return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value.trim() === "") return fallback;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`Expected true or false, received ${value}`);
}

function parsePort(value: string | undefined): number {
	const port = Number(value ?? "8788");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`SMOLFLARE_PORT must be a valid port; received ${value}`);
	}
	return port;
}

function normalisePrefix(value: string | undefined): string {
	return value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}
