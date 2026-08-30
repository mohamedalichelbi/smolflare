import { Storage } from "@google-cloud/storage";
import { afterEach, it } from "vitest";
import { R2BucketGCS } from "./r2";

interface DisposableRuntime {
	dispatchFetch(url: string): Promise<Response>;
	dispose(): Promise<void>;
}

interface MiniflareConstructor {
	new (options: unknown): DisposableRuntime;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep Miniflare's Worker-specific declarations out of this Node-only type environment.
const { Miniflare } = require("miniflare") as {
	Miniflare: MiniflareConstructor;
};

const runtimes: DisposableRuntime[] = [];

afterEach(async () => {
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

const bucketName = process.env.SMOLFLARE_GCS_TEST_BUCKET;
const integrationTest = bucketName === undefined ? it.skip : it;

integrationTest(
	"stores Miniflare R2 blob bodies in GCS",
	async ({ expect }) => {
		if (bucketName === undefined) {
			return;
		}
		const prefix = `smolflare-tests/${crypto.randomUUID()}`;
		const storage = new Storage({
			projectId: process.env.GOOGLE_CLOUD_PROJECT,
			keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
		});
		const bucket = storage.bucket(bucketName);

		try {
			const runtime = new Miniflare({
				r2BlobStorage: new R2BucketGCS({
					bucket: bucketName,
					prefix,
					projectId: process.env.GOOGLE_CLOUD_PROJECT,
					keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
					retainDeleted: false,
				}),
				workers: [
					{
						config: {
							type: "worker",
							name: "smolflare-gcs-test",
							compatibilityDate: "2025-08-04",
							manifest: {
								mainModule: "index.mjs",
								modulesRoot: process.cwd(),
								modules: {
									"index.mjs": {
										type: "esm",
										contents: `export default {
											async fetch(request, env) {
												await env.BUCKET.put("greeting", "hello from GCS");
												const full = await env.BUCKET.get("greeting");
												const range = await env.BUCKET.get("greeting", {
													range: { offset: 6, length: 4 }
												});
												await env.BUCKET.delete("greeting");
												const deleted = await env.BUCKET.get("greeting");
												return Response.json({
													full: await full.text(),
													range: await range.text(),
													deleted: deleted === null
												});
											}
										}`,
									},
								},
							},
							env: {
								BUCKET: { type: "r2", name: "gcs-integration" },
							},
						},
					},
				],
			});
			runtimes.push(runtime);

			const response = await runtime.dispatchFetch("http://localhost");
			expect(await response.json()).toEqual({
				full: "hello from GCS",
				range: "from",
				deleted: true,
			});
		} finally {
			const [files] = await bucket.getFiles({ prefix });
			await Promise.all(
				files.map((file) => file.delete({ ignoreNotFound: true }))
			);
		}
	},
	60_000
);
