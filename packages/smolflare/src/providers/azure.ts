import { Readable } from "node:stream";
import {
	BlobServiceClient,
	StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { isMissingObject } from "./errors";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "../blob-storage";

/** Settings for an Azure Blob Storage container. */
export type AzureBlobStorageOptions = {
	container: string;
} & (
	| { connectionString: string }
	| { endpoint: string; accountName: string; accountKey: string }
);

/** Stores Miniflare blobs in Azure Blob Storage. */
export class AzureBlobStorage implements BlobStorage {
	readonly #container: ReturnType<BlobServiceClient["getContainerClient"]>;

	constructor(options: AzureBlobStorageOptions) {
		const service =
			"connectionString" in options
				? BlobServiceClient.fromConnectionString(options.connectionString)
				: new BlobServiceClient(
						options.endpoint,
						new StorageSharedKeyCredential(
							options.accountName,
							options.accountKey
						)
					);
		this.#container = service.getContainerClient(options.container);
	}

	async put(key: string, body: Readable): Promise<void> {
		await this.#container.getBlockBlobClient(key).uploadStream(body);
	}

	async head(key: string): Promise<BlobMetadata | null> {
		try {
			const result = await this.#container.getBlobClient(key).getProperties();
			if (result.contentLength === undefined) {
				throw new Error(`Azure did not return a size for ${key}`);
			}
			return { size: result.contentLength, contentType: result.contentType };
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async get(key: string, range?: BlobRange): Promise<BlobDownload | null> {
		try {
			const result = await this.#container
				.getBlobClient(key)
				.download(
					range?.start,
					range === undefined ? undefined : range.end - range.start + 1
				);
			const body = result.readableStreamBody;
			const contentRange = result.contentRange?.match(
				/^bytes (\d+)-(\d+)\/(\d+)$/
			);
			const size =
				range === undefined ? result.contentLength : Number(contentRange?.[3]);
			const validRange =
				range === undefined ||
				(contentRange !== null &&
					contentRange !== undefined &&
					Number(contentRange[1]) === range.start &&
					Number(contentRange[2]) === Math.min(range.end, Number(size) - 1) &&
					result.contentLength === Number(contentRange[2]) - range.start + 1);
			if (
				body === undefined ||
				size === undefined ||
				!Number.isSafeInteger(size) ||
				size < 0 ||
				result.contentLength === undefined ||
				!Number.isSafeInteger(result.contentLength) ||
				result.contentLength < 0 ||
				!validRange
			) {
				body?.destroy();
				throw new Error(`Azure returned invalid download metadata for ${key}`);
			}
			return {
				size,
				body: Readable.from(body),
				contentLength: result.contentLength,
				contentType: result.contentType,
			};
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		await this.#container.getBlobClient(key).deleteIfExists();
	}
}
