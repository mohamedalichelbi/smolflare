import { once } from "node:events";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { SMOLFLARE_PLUGIN_NAME } from "./plugin-core";
import { createBlobGateway } from "./server";
import type {
	BlobDownload,
	BlobMetadata,
	BlobRange,
	BlobStorage,
} from "./blob-storage";
import type { Server } from "node:http";

interface DisposableRuntime {
	dispatchFetch(url: string): Promise<Response>;
	dispose(): Promise<void>;
}

interface MiniflareConstructor {
	new (options: unknown): DisposableRuntime;
}

const { Miniflare } = require("miniflare") as {
	Miniflare: MiniflareConstructor;
};

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

const servers: Server[] = [];
const runtimes: DisposableRuntime[] = [];

afterEach(async () => {
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
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

it("stores R2 blob bytes outside Miniflare", async () => {
	const storage = new MemoryBlobStorage();
	const server = createBlobGateway({ storage });
	servers.push(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Gateway did not open a TCP port");
	}

	const pluginPackage = path.resolve(__dirname, "../dist/index.js");
	const runtime = new Miniflare({
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
							type: "unsafe:service",
							dev: {
								plugin: {
									package: pluginPackage,
									name: SMOLFLARE_PLUGIN_NAME,
								},
								options: {
									blobServiceAddress: `127.0.0.1:${address.port}`,
									bucketName: "blueprints",
								},
							},
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
	if (firstObject === undefined) throw new Error("Blob was not stored");
	const [key, body] = firstObject;
	expect(key).toMatch(/^blueprints\/blobs\/[0-9a-f]{80}$/);
	expect(body.toString()).toBe("hello from Smolflare");
});
