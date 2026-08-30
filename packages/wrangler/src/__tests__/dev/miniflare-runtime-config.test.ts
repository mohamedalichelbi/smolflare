import { writeFileSync } from "node:fs";
import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { applyRuntimeConfig } from "../../dev/miniflare/runtime-config";
import type { MiniflareOptions } from "miniflare";

describe("Miniflare runtime config", () => {
	runInTempDir();

	it("loads host options from a module", async ({ expect }) => {
		writeFileSync(
			"runtime.mjs",
			`export default ({ env }) => ({ resourceTmpPath: env.TEST_PATH });`
		);
		const options = { workers: [] } satisfies MiniflareOptions;

		const result = await applyRuntimeConfig(options, "runtime.mjs", {
			TEST_PATH: "/runtime-data",
		});

		expect(result).toEqual({
			workers: [],
			resourceTmpPath: "/runtime-data",
		});
	});

	it("does nothing without a configured module", async ({ expect }) => {
		const options = { workers: [] } satisfies MiniflareOptions;

		await expect(applyRuntimeConfig(options, "")).resolves.toBe(options);
	});

	it("rejects worker replacement", async ({ expect }) => {
		writeFileSync("invalid.mjs", `export default () => ({ workers: [] });`);
		const options = { workers: [] } satisfies MiniflareOptions;

		await expect(applyRuntimeConfig(options, "invalid.mjs")).rejects.toThrow(
			"must return options without workers"
		);
	});
});
