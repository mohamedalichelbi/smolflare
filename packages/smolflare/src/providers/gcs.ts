import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import { isMissingObject } from "./errors";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "../blob-storage";
import type { IncomingMessage } from "node:http";
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
		const body = this.#bucket.file(key).createReadStream({
			start: range?.start,
			end: range?.end,
			decompress: false,
		});
		try {
			const response = await new Promise<IncomingMessage>((resolve, reject) => {
				body.once("response", resolve);
				// Keep the error listener until consumption starts. Errors also remain on the stream.
				body.once("error", reject);
				body.once("close", () =>
					reject(new Error("GCS download closed before its response"))
				);
				body.read(0);
			});
			if (response.statusCode === 404) {
				body.destroy();
				return null;
			}
			const contentLength = Number(response.headers["content-length"]);
			const contentRange = response.headers["content-range"]?.match(
				/^bytes (\d+)-(\d+)\/(\d+)$/
			);
			const size =
				range === undefined ? contentLength : Number(contentRange?.[3]);
			const validRange =
				range === undefined ||
				(contentRange !== null &&
					contentRange !== undefined &&
					Number(contentRange[1]) === range.start &&
					Number(contentRange[2]) === Math.min(range.end, size - 1) &&
					contentLength === Number(contentRange[2]) - range.start + 1);
			if (
				response.statusCode !== (range === undefined ? 200 : 206) ||
				!Number.isSafeInteger(size) ||
				size < 0 ||
				!Number.isSafeInteger(contentLength) ||
				contentLength < 0 ||
				!validRange
			) {
				throw new Error(`GCS returned invalid download metadata for ${key}`);
			}
			return {
				body,
				size,
				contentLength,
				contentType: response.headers["content-type"],
			};
		} catch (error) {
			body.destroy();
			if (isMissingObject(error)) {
				return null;
			}
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		await this.#bucket.file(key).delete({ ignoreNotFound: true });
	}
}
