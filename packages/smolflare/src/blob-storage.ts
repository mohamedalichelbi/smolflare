import type { Readable } from "node:stream";

/** An inclusive byte range. */
export interface BlobRange {
	start: number;
	end: number;
}

/** Metadata returned without downloading a blob. */
export interface BlobMetadata {
	size: number;
	contentType?: string;
}

/** A blob download and the metadata needed for an HTTP response. */
export interface BlobDownload extends BlobMetadata {
	body: Readable;
	contentLength: number;
}

/** The storage contract used by the Smolflare blob gateway. */
export interface BlobStorage {
	put(key: string, body: Readable): Promise<void>;
	head(key: string): Promise<BlobMetadata | null>;
	get(key: string, range?: BlobRange): Promise<BlobDownload | null>;
	delete(key: string): Promise<void>;
}
