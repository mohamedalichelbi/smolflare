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

function createRuntime(
	fetch: (request: Request) => Promise<Response>,
	contents: string
): DisposableRuntime {
	const runtime = new Miniflare({
		r2BlobStorage: {
			type: "custom",
			fetch,
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
								contents,
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
	return runtime;
}

it("waits for external R2 blob writes", async ({ expect }) => {
	const storage = new MemoryBlobStorage(100);
	const runtime = createRuntime(
		createR2BlobFetcher(storage),
		`export default {
		async fetch(request, env) {
			await env.BUCKET.put("greeting", "hello from Smolflare");
			const object = await env.BUCKET.get("greeting");
			return new Response(await object.text());
		}
	}`
	);

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

it.for(["response", "exception"])(
	"rejects a failed blob upload (%s) without storing metadata",
	async (failure, { expect }) => {
		let uploads = 0;
		const runtime = createRuntime(
			async (request) => {
				if (request.method !== "PUT")
					return new Response(null, { status: 404 });
				await request.arrayBuffer();
				uploads++;
				if (failure === "exception") throw new Error("Bucket upload failed");
				return new Response(null, { status: 503 });
			},
			`export default {
			async fetch(request, env) {
				let rejected = false;
				try {
					await env.BUCKET.put("greeting", "lost value");
				} catch {
					rejected = true;
				}
				return Response.json({
					rejected,
					objectExists: await env.BUCKET.head("greeting") !== null,
				});
			}
		}`
		);
		const response = await runtime.dispatchFetch("http://localhost");
		expect(await response.json()).toEqual({
			rejected: true,
			objectExists: false,
		});
		expect(uploads).toBe(1);
	}
);
