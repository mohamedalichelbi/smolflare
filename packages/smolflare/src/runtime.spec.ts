import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
	installSmolflareRuntime,
	SMOLFLARE_RUNTIME_LOCK,
	type SmolflareRuntimeLock,
} from "./runtime";

describe("installSmolflareRuntime", () => {
	const initialDirectory = process.cwd();
	let temporaryDirectory: string;

	beforeEach(async () => {
		temporaryDirectory = await mkdtemp(
			path.join(tmpdir(), "smolflare-runtime-")
		);
		process.chdir(temporaryDirectory);
	});

	afterEach(async () => {
		process.chdir(initialDirectory);
		await rm(temporaryDirectory, { force: true, recursive: true });
	});

	it("downloads, verifies, and reuses the pinned files", async ({ expect }) => {
		const content = new Map<string, string>([
			[SMOLFLARE_RUNTIME_LOCK.workerd.url, "workerd"],
			[SMOLFLARE_RUNTIME_LOCK.litestreamVfs.url, "litestream"],
		]);
		const runtimeLock: SmolflareRuntimeLock = {
			...SMOLFLARE_RUNTIME_LOCK,
			workerd: {
				...SMOLFLARE_RUNTIME_LOCK.workerd,
				sha256: sha256("workerd"),
			},
			litestreamVfs: {
				...SMOLFLARE_RUNTIME_LOCK.litestreamVfs,
				sha256: sha256("litestream"),
			},
		};

		const runtime = await installSmolflareRuntime("runtime", {
			fetch: async (url) => new Response(content.get(String(url))),
			runtimeLock,
		});
		expect(await readFile(runtime.workerdPath, "utf8")).toBe("workerd");
		expect(await readFile(runtime.extensionPath, "utf8")).toBe("litestream");
		expect((await stat(runtime.workerdPath)).mode & 0o111).not.toBe(0);

		await installSmolflareRuntime("runtime", {
			fetch: async () => {
				throw new Error("cached files must not be downloaded");
			},
			runtimeLock,
		});
	});

	it("rejects a file with an invalid checksum", async ({ expect }) => {
		const runtimeLock: SmolflareRuntimeLock = {
			...SMOLFLARE_RUNTIME_LOCK,
			workerd: {
				...SMOLFLARE_RUNTIME_LOCK.workerd,
				sha256: sha256("expected"),
			},
			litestreamVfs: {
				...SMOLFLARE_RUNTIME_LOCK.litestreamVfs,
				sha256: sha256("litestream"),
			},
		};

		await expect(
			installSmolflareRuntime("runtime", {
				fetch: async (url) =>
					new Response(
						String(url) === runtimeLock.workerd.url ? "received" : "litestream"
					),
				runtimeLock,
			})
		).rejects.toThrow("Checksum mismatch for workerd-linux-x64");
	});
});

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
