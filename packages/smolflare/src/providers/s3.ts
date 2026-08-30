import { Readable } from "node:stream";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { isMissingObject } from "./errors";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "../blob-storage";

/** Settings for an S3 or S3-compatible blob store. */
export interface S3BlobStorageOptions {
	bucket: string;
	endpoint?: string;
	region?: string;
	forcePathStyle?: boolean;
	accessKeyId?: string;
	secretAccessKey?: string;
}

/** Stores Miniflare blobs in S3 or an S3-compatible service. */
export class S3BlobStorage implements BlobStorage {
	readonly #bucket: string;
	readonly #client: S3Client;

	constructor(options: S3BlobStorageOptions) {
		this.#bucket = options.bucket;
		const credentials =
			options.accessKeyId !== undefined && options.secretAccessKey !== undefined
				? {
						accessKeyId: options.accessKeyId,
						secretAccessKey: options.secretAccessKey,
					}
				: undefined;
		this.#client = new S3Client({
			credentials,
			endpoint: options.endpoint,
			forcePathStyle: options.forcePathStyle,
			region: options.region ?? "auto",
		});
	}

	async put(key: string, body: Readable): Promise<void> {
		await new Upload({
			client: this.#client,
			leavePartsOnError: false,
			params: { Bucket: this.#bucket, Key: key, Body: body },
		}).done();
	}

	async head(key: string): Promise<BlobMetadata | null> {
		try {
			const result = await this.#client.send(
				new HeadObjectCommand({ Bucket: this.#bucket, Key: key })
			);
			if (result.ContentLength === undefined) {
				throw new Error(`S3 did not return a size for ${key}`);
			}
			return { size: result.ContentLength, contentType: result.ContentType };
		} catch (error) {
			if (isMissingObject(error)) return null;
			throw error;
		}
	}

	async get(key: string, range?: BlobRange): Promise<BlobDownload | null> {
		try {
			const result = await this.#client.send(
				new GetObjectCommand({
					Bucket: this.#bucket,
					Key: key,
					Range:
						range === undefined
							? undefined
							: `bytes=${range.start}-${range.end}`,
				})
			);
			if (result.Body === undefined || result.ContentLength === undefined) {
				throw new Error(`S3 returned an incomplete response for ${key}`);
			}
			const total = parseTotalSize(result.ContentRange) ?? result.ContentLength;
			return {
				body: Readable.from(result.Body as AsyncIterable<Uint8Array>),
				contentLength: result.ContentLength,
				contentType: result.ContentType,
				size: total,
			};
		} catch (error) {
			if (isMissingObject(error)) return null;
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		await this.#client.send(
			new DeleteObjectCommand({ Bucket: this.#bucket, Key: key })
		);
	}
}

function parseTotalSize(contentRange: string | undefined): number | undefined {
	if (contentRange === undefined) return undefined;
	const match = /\/(\d+)$/.exec(contentRange);
	if (match === null) return undefined;
	const size = Number(match[1]);
	return Number.isSafeInteger(size) ? size : undefined;
}
