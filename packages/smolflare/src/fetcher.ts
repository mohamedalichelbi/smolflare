import { Readable } from "node:stream";
import type { BlobRange, BlobStorage } from "./blob-storage";

/** Shared options for remote R2 blob-storage implementations. */
export interface RemoteR2Options {
	prefix?: string;
	retainDeleted?: boolean;
}

/** Adapts a blob store to the Fetcher contract used by Miniflare's R2 worker. */
export function createR2BlobFetcher(
	storage: BlobStorage,
	options: RemoteR2Options = {}
) {
	return async (request: Request): Promise<Response> => {
		const match = /^\/([^/]+)\/blobs\/([0-9a-f]{80})$/.exec(
			new URL(request.url).pathname
		);
		if (match === null) {
			return new Response(null, { status: 404 });
		}
		const namespace = decodeURIComponent(match[1] ?? "");
		const blobId = match[2] ?? "";
		const key = [options.prefix, namespace, "blobs", blobId]
			.filter((part): part is string => part !== undefined && part !== "")
			.join("/");

		switch (request.method) {
			case "PUT": {
				if (request.body === null) {
					return new Response("Missing blob body", { status: 400 });
				}
				await storage.put(
					key,
					Readable.fromWeb(request.body as ReadableStream<Uint8Array>)
				);
				return new Response(null, { status: 204 });
			}
			case "HEAD": {
				const metadata = await storage.head(key);
				return metadata === null
					? new Response(null, { status: 404 })
					: new Response(null, { headers: metadataHeaders(metadata) });
			}
			case "GET":
				return getBlob(storage, key, request.headers.get("Range"));
			case "DELETE":
				if (options.retainDeleted === false) {
					await storage.delete(key);
				}
				return new Response(null, { status: 204 });
			default:
				return new Response(null, {
					status: 405,
					headers: { Allow: "PUT, HEAD, GET, DELETE" },
				});
		}
	};
}

async function getBlob(
	storage: BlobStorage,
	key: string,
	rangeHeader: string | null
): Promise<Response> {
	let range: BlobRange | undefined;
	try {
		range = parseRange(rangeHeader);
	} catch (error) {
		if (error instanceof InvalidRangeError) {
			return new Response(null, { status: 416 });
		}
		throw error;
	}

	if (range !== undefined) {
		const metadata = await storage.head(key);
		if (metadata === null) {
			return new Response(null, { status: 404 });
		}
		if (range.start >= metadata.size) {
			return new Response(null, {
				status: 416,
				headers: { "Content-Range": `bytes */${metadata.size}` },
			});
		}
		range = { start: range.start, end: Math.min(range.end, metadata.size - 1) };
	}

	const blob = await storage.get(key, range);
	if (blob === null) {
		return new Response(null, { status: 404 });
	}
	const headers = new Headers({
		"Accept-Ranges": "bytes",
		"Content-Length": String(blob.contentLength),
	});
	if (blob.contentType !== undefined) {
		headers.set("Content-Type", blob.contentType);
	}
	if (range !== undefined) {
		headers.set(
			"Content-Range",
			`bytes ${range.start}-${range.end}/${blob.size}`
		);
	}
	return new Response(Readable.toWeb(blob.body) as ReadableStream, {
		status: range === undefined ? 200 : 206,
		headers,
	});
}

class InvalidRangeError extends Error {}

function parseRange(value: string | null): BlobRange | undefined {
	if (value === null) {
		return undefined;
	}
	const match = /^bytes=(\d+)-(\d+)$/.exec(value);
	if (match === null) {
		throw new InvalidRangeError(`Unsupported Range header: ${value}`);
	}
	const start = Number(match[1]);
	const end = Number(match[2]);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		end < start
	) {
		throw new InvalidRangeError(`Invalid Range header: ${value}`);
	}
	return { start, end };
}

function metadataHeaders(metadata: { size: number; contentType?: string }) {
	const headers = new Headers({
		"Accept-Ranges": "bytes",
		"Content-Length": String(metadata.size),
	});
	if (metadata.contentType !== undefined) {
		headers.set("Content-Type", metadata.contentType);
	}
	return headers;
}
