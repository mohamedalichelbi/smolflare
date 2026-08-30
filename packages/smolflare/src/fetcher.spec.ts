import { Readable } from "node:stream";
import { describe, it } from "vitest";
import { createR2BlobFetcher } from "./fetcher";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "./blob-storage";

const BLOB_ID = "a".repeat(80);

class MemoryBlobStorage implements BlobStorage {
	readonly objects = new Map<string, Buffer>();

	async put(key: string, body: Readable): Promise<void> {
		const chunks: Buffer[] = [];
		for await (const chunk of body) {
			chunks.push(Buffer.from(chunk));
		}
		this.objects.set(key, Buffer.concat(chunks));
	}

	async head(key: string): Promise<BlobMetadata | null> {
		const body = this.objects.get(key);
		return body === undefined ? null : { size: body.length };
	}

	async get(key: string, range?: BlobRange): Promise<BlobDownload | null> {
		const body = this.objects.get(key);
		if (body === undefined) {
			return null;
		}
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

function request(method: string, init?: RequestInit) {
	return new Request(`http://placeholder/blueprints/blobs/${BLOB_ID}`, {
		...init,
		method,
		duplex: init?.body === undefined ? undefined : "half",
	} as RequestInit);
}

describe("R2 blob fetcher", () => {
	it("implements Miniflare's filesystem blob protocol", async ({ expect }) => {
		const storage = new MemoryBlobStorage();
		const fetch = createR2BlobFetcher(storage);

		expect(await fetch(request("PUT", { body: "hello world" }))).toMatchObject({
			status: 204,
		});
		const head = await fetch(request("HEAD"));
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("11");

		const ranged = await fetch(
			request("GET", { headers: { Range: "bytes=6-999" } })
		);
		expect(ranged.status).toBe(206);
		expect(ranged.headers.get("content-range")).toBe("bytes 6-10/11");
		expect(await ranged.text()).toBe("world");

		expect(
			(await fetch(request("GET", { headers: { Range: "bytes=11-12" } })))
				.status
		).toBe(416);
	});

	it("can retain deleted blobs for SQLite point-in-time restores", async ({
		expect,
	}) => {
		const storage = new MemoryBlobStorage();
		const fetch = createR2BlobFetcher(storage, { retainDeleted: true });
		await fetch(request("PUT", { body: "keep me" }));
		await fetch(request("DELETE"));

		expect(await (await fetch(request("GET"))).text()).toBe("keep me");
	});
});
