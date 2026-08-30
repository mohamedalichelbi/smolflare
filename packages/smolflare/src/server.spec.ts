import { once } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createBlobGateway } from "./server";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "./blob-storage";
import type { Server } from "node:http";

const BLOB_ID = "a".repeat(80);
const servers: Server[] = [];

class MemoryBlobStorage implements BlobStorage {
	readonly objects = new Map<string, Buffer>();

	async put(key: string, body: Readable): Promise<void> {
		const chunks: Buffer[] = [];
		for await (const chunk of body) chunks.push(Buffer.from(chunk));
		this.objects.set(key, Buffer.concat(chunks));
	}

	async head(key: string): Promise<BlobMetadata | null> {
		const body = this.objects.get(key);
		return body === undefined ? null : { size: body.length };
	}

	async get(key: string, range?: BlobRange): Promise<BlobDownload | null> {
		const body = this.objects.get(key);
		if (body === undefined) return null;
		const selected =
			range === undefined ? body : body.subarray(range.start, range.end + 1);
		return {
			body: Readable.from(selected),
			contentLength: selected.length,
			size: body.length,
		};
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((server) => {
			server.closeAllConnections();
			return new Promise<void>((resolve, reject) => {
				server.close((error) =>
					error === undefined ? resolve() : reject(error)
				);
			});
		})
	);
});

async function startGateway(storage: BlobStorage, retainDeleted = false) {
	const server = createBlobGateway({
		prefix: "test",
		retainDeleted,
		storage,
	});
	servers.push(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Gateway did not open a TCP port");
	}
	return `http://127.0.0.1:${address.port}`;
}

describe("blob gateway", () => {
	it("streams complete and ranged blob requests", async () => {
		const storage = new MemoryBlobStorage();
		const origin = await startGateway(storage);
		const url = `${origin}/blueprints/blobs/${BLOB_ID}`;

		expect(
			await fetch(`${origin}/healthz`).then((response) => response.text())
		).toBe("ok");
		expect(
			(await fetch(url, { method: "PUT", body: "hello world" })).status
		).toBe(204);
		expect(
			storage.objects.get(`test/blueprints/blobs/${BLOB_ID}`)?.toString()
		).toBe("hello world");

		const head = await fetch(url, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("11");

		const range = await fetch(url, { headers: { Range: "bytes=6-10" } });
		expect(range.status).toBe(206);
		expect(range.headers.get("content-range")).toBe("bytes 6-10/11");
		expect(await range.text()).toBe("world");

		expect((await fetch(url, { method: "DELETE" })).status).toBe(204);
		expect((await fetch(url)).status).toBe(404);
	});

	it("can retain blobs for point-in-time database restores", async () => {
		const storage = new MemoryBlobStorage();
		const origin = await startGateway(storage, true);
		const url = `${origin}/blueprints/blobs/${BLOB_ID}`;

		await fetch(url, { method: "PUT", body: "keep me" });
		await fetch(url, { method: "DELETE" });

		expect(await fetch(url).then((response) => response.text())).toBe(
			"keep me"
		);
	});
});
