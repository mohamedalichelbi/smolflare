import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import type { BlobRange, BlobStorage } from "./blob-storage";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Settings accepted by the HTTP blob gateway. */
export interface BlobGatewayOptions {
	prefix?: string;
	retainDeleted?: boolean;
	storage: BlobStorage;
}

/** Creates the HTTP service consumed by Miniflare's internal BlobStore. */
export function createBlobGateway(options: BlobGatewayOptions) {
	return createServer((request, response) => {
		void handleRequest(request, response, options).catch((error: unknown) => {
			if (!response.headersSent) {
				response.writeHead(500, { "Content-Type": "text/plain" });
			}
			response.end("Blob storage request failed");
			const message = error instanceof Error ? error.stack : String(error);
			process.stderr.write(`${message}\n`);
		});
	});
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: BlobGatewayOptions
): Promise<void> {
	if (request.url === "/healthz") {
		response.writeHead(200, { "Content-Type": "text/plain" });
		response.end("ok");
		return;
	}

	const path = new URL(request.url ?? "/", "http://smolflare").pathname;
	const match = /^\/([^/]+)\/blobs\/([0-9a-f]{80})$/.exec(path);
	if (match === null) {
		response.writeHead(404);
		response.end();
		return;
	}
	const namespace = decodeURIComponent(match[1] ?? "");
	const blobId = match[2] ?? "";
	const key = [options.prefix, namespace, "blobs", blobId]
		.filter((part): part is string => part !== undefined && part !== "")
		.join("/");

	switch (request.method) {
		case "PUT":
			await options.storage.put(key, request);
			response.writeHead(204);
			response.end();
			return;
		case "HEAD": {
			const metadata = await options.storage.head(key);
			if (metadata === null) return notFound(response);
			response.writeHead(200, metadataHeaders(metadata));
			response.end();
			return;
		}
		case "GET": {
			const range = parseRange(request.headers.range);
			const blob = await options.storage.get(key, range);
			if (blob === null) return notFound(response);
			const status = range === undefined ? 200 : 206;
			const headers: Record<string, string> = {
				"Accept-Ranges": "bytes",
				"Content-Length": String(blob.contentLength),
			};
			if (blob.contentType !== undefined) {
				headers["Content-Type"] = blob.contentType;
			}
			if (range !== undefined) {
				headers["Content-Range"] = `bytes ${range.start}-${Math.min(
					range.end,
					blob.size - 1
				)}/${blob.size}`;
			}
			response.writeHead(status, headers);
			await pipeline(blob.body, response);
			return;
		}
		case "DELETE":
			if (options.retainDeleted !== true) {
				await options.storage.delete(key);
			}
			response.writeHead(204);
			response.end();
			return;
		default:
			response.writeHead(405, { Allow: "PUT, HEAD, GET, DELETE" });
			response.end();
	}
}

function metadataHeaders(metadata: { size: number; contentType?: string }) {
	const headers: Record<string, string> = {
		"Accept-Ranges": "bytes",
		"Content-Length": String(metadata.size),
	};
	if (metadata.contentType !== undefined) {
		headers["Content-Type"] = metadata.contentType;
	}
	return headers;
}

function parseRange(value: string | undefined): BlobRange | undefined {
	if (value === undefined) return undefined;
	const match = /^bytes=(\d+)-(\d+)$/.exec(value);
	if (match === null) throw new Error(`Unsupported Range header: ${value}`);
	const start = Number(match[1]);
	const end = Number(match[2]);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		end < start
	) {
		throw new Error(`Invalid Range header: ${value}`);
	}
	return { start, end };
}

function notFound(response: ServerResponse): void {
	response.writeHead(404);
	response.end();
}
