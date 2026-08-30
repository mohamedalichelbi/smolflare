import { describe, expect, it, vi } from "vitest";
import { createSmolflareR2Plugin, SMOLFLARE_PLUGIN_NAME } from "./plugin-core";
import type { R2Plugin } from "./plugin-core";

const BLOB_BINDING = "MINIFLARE_BLOBS";

function smolflareOptions(address = "smolflare:8788") {
	return {
		config: {
			env: {
				BUCKET: {
					type: "unsafe:service",
					dev: {
						plugin: { name: SMOLFLARE_PLUGIN_NAME },
						options: {
							blobServiceAddress: address,
							bucketName: "blueprints",
						},
					},
				},
			},
		},
	};
}

describe("Smolflare R2 plugin", () => {
	it("uses Miniflare R2 and replaces only its blob service", async () => {
		const getBindings = vi.fn(() => []);
		const getNodeBindings = vi.fn(() => ({}));
		const getServices = vi.fn(() => [
			{ name: "r2:storage", disk: { path: "/data/r2" } },
			{
				name: "r2:bucket",
				worker: {
					bindings: [
						{
							name: BLOB_BINDING,
							service: { name: "r2:storage" },
						},
					],
				},
			},
		]);
		const r2Plugin = {
			getBindings,
			getNodeBindings,
			getServices,
		} satisfies R2Plugin;
		const plugin = createSmolflareR2Plugin(r2Plugin, BLOB_BINDING);
		const options = smolflareOptions();

		plugin.getBindings(options, {}, 0);
		const services = await plugin.getServices({ options } as never);

		expect(getBindings).toHaveBeenCalledWith(
			expect.objectContaining({
				config: {
					env: { BUCKET: { type: "r2", name: "blueprints" } },
				},
			}),
			{},
			0
		);
		expect(getServices).toHaveBeenCalledOnce();
		expect(services).toEqual([
			{ name: "r2:storage", disk: { path: "/data/r2" } },
			{
				name: "r2:bucket",
				worker: {
					bindings: [
						{
							name: BLOB_BINDING,
							service: { name: "smolflare:blob-storage" },
						},
					],
				},
			},
			{
				name: "smolflare:blob-storage",
				external: { address: "smolflare:8788", http: {} },
			},
		]);
	});

	it("rejects two blob gateways for one Worker", async () => {
		const r2Plugin = {
			getBindings: () => [],
			getNodeBindings: () => ({}),
			getServices: () => [],
		} satisfies R2Plugin;
		const plugin = createSmolflareR2Plugin(r2Plugin, BLOB_BINDING);
		const options = smolflareOptions();
		Object.assign(options.config.env, {
			SECOND_BUCKET: {
				type: "unsafe:service",
				dev: {
					plugin: { name: SMOLFLARE_PLUGIN_NAME },
					options: {
						blobServiceAddress: "another-gateway:8788",
						bucketName: "other",
					},
				},
			},
		});

		await expect(plugin.getServices({ options } as never)).rejects.toThrow(
			"must use the same blob service"
		);
	});
});
