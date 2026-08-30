import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import { isMissingObject } from "./errors";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "../blob-storage";
import type { Readable } from "node:stream";

/** Settings for a Google Cloud Storage blob store. */
export interface GcsBlobStorageOptions {
	bucket: string;
	projectId?: string;
	keyFilename?: string;
}

/** Stores Miniflare blobs in Google Cloud Storage. */
export class GcsBlobStorage implements BlobStorage {
	readonly #bucket: ReturnType<Storage["bucket"]>;

	constructor(options: GcsBlobStorageOptions) {
		const storage = new Storage({
			keyFilename: options.keyFilename,
			projectId: options.projectId,
		});
		this.#bucket = storage.bucket(options.bucket);
	}

	async put(key: string, body: Readable): Promise<void> {
		await pipeline(
			body,
			this.#bucket.file(key).createWriteStream({
				resumable: true,
				validation: "crc32c",
			})
		);
	}

	async head(key: string): Promise<BlobMetadata | null> {
		try {
			const [metadata] = await this.#bucket.file(key).getMetadata();
			const size = Number(metadata.size);
			if (!Number.isSafeInteger(size)) {
				throw new Error(`GCS did not return a valid size for ${key}`);
			}
			return { size, contentType: metadata.contentType };
		} catch (error) {
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async get(key: string, range?: BlobRange): Promise<BlobDownload | null> {
		const metadata = await this.head(key);
		if (metadata === null) {
			return null;
		}
		const contentLength =
			range === undefined
				? metadata.size
				: Math.max(0, Math.min(range.end, metadata.size - 1) - range.start + 1);
		return {
			...metadata,
			body: this.#bucket
				.file(key)
				.createReadStream(
					range === undefined ? {} : { start: range.start, end: range.end }
				),
			contentLength,
		};
	}

	async delete(key: string): Promise<void> {
		await this.#bucket.file(key).delete({ ignoreNotFound: true });
	}
}
