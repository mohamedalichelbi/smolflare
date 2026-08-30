import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, it } from "vitest";
import { createR2BlobFetcher } from "./fetcher";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "./blob-storage";

interface DisposableRuntime {
	dispatchFetch(url: string): Promise<Response>;
	dispose(): Promise<void>;
}

interface MiniflareConstructor {
	new (options: unknown): DisposableRuntime;
}

// Avoid loading Miniflare's generated declarations into this Node-only test's
// type environment. The runtime shape we exercise is deliberately narrow.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep Miniflare's Worker-specific declarations out of this Node-only type environment.
const { Miniflare } = require("miniflare") as {
	Miniflare: MiniflareConstructor;
};

class MemoryBlobStorage implements BlobStorage {
	readonly objects = new Map<string, Buffer>();

	constructor(readonly putDelay = 0) {}

	async put(key: string, body: Readable): Promise<void> {
		const chunks: Buffer[] = [];
		for await (const chunk of body) {
			chunks.push(Buffer.from(chunk));
		}
		await delay(this.putDelay);
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

const runtimes: DisposableRuntime[] = [];

afterEach(async () => {
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

it("waits for external R2 blob writes", async ({ expect }) => {
	const storage = new MemoryBlobStorage(100);
	const runtime = new Miniflare({
		r2BlobStorage: {
			type: "custom",
			fetch: createR2BlobFetcher(storage),
		},
		workers: [
			{
				config: {
					type: "worker",
					name: "smolflare-test",
					compatibilityDate: "2025-08-04",
					manifest: {
						mainModule: "index.mjs",
						modulesRoot: process.cwd(),
						modules: {
							"index.mjs": {
								type: "esm",
								contents: `export default {
									async fetch(request, env) {
										await env.BUCKET.put("greeting", "hello from Smolflare");
										const object = await env.BUCKET.get("greeting");
										return new Response(await object.text());
									}
								}`,
							},
						},
					},
					env: {
						BUCKET: {
							type: "r2",
							name: "blueprints",
						},
					},
				},
			},
		],
	});
	runtimes.push(runtime);

	const response = await runtime.dispatchFetch("http://localhost");

	expect(await response.text()).toBe("hello from Smolflare");
	expect(storage.objects.size).toBe(1);
	const firstObject = storage.objects.entries().next().value;
	if (firstObject === undefined) {
		throw new Error("Blob was not stored");
	}
	const [key, body] = firstObject;
	expect(key).toMatch(/^blueprints\/blobs\/[0-9a-f]{80}$/);
	expect(body.toString()).toBe("hello from Smolflare");
});
