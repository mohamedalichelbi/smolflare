import { Readable } from "node:stream";
import { it, vi } from "vitest";
import { GcsBlobStorage } from "./gcs";

const { createReadStream, getMetadata } = vi.hoisted(() => ({
	createReadStream: vi.fn(),
	getMetadata: vi.fn(),
}));
vi.mock("@google-cloud/storage", () => ({
	Storage: class {
		bucket() {
			return { file: () => ({ createReadStream, getMetadata }) };
		}
	},
}));

it.for([false, true])(
	"gets headers without reading the full body: range=%s",
	async (ranged, { expect }) => {
		getMetadata.mockClear();
		const body = new Readable({
			read() {
				this.emit("response", {
					statusCode: ranged ? 206 : 200,
					headers: {
						"content-length": ranged ? "3" : "5",
						"content-range": ranged ? "bytes 2-4/5" : undefined,
					},
				});
			},
		});
		createReadStream.mockReturnValueOnce(body);
		const store = new GcsBlobStorage({ bucket: "test" });
		const result = await store.get(
			"blob",
			ranged ? { start: 2, end: 9 } : undefined
		);
		expect(result).toMatchObject({ size: 5, contentLength: ranged ? 3 : 5 });
		expect(getMetadata).not.toHaveBeenCalled();
		expect(body.readableLength).toBe(0);
		expect(createReadStream).toHaveBeenLastCalledWith({
			start: ranged ? 2 : undefined,
			end: ranged ? 9 : undefined,
			decompress: false,
		});
		body.destroy();
	}
);

it.for([true, false])(
	"rejects an early stream failure: error=%s",
	async (withError, { expect }) => {
		const body = new Readable({
			read() {
				this.destroy(withError ? new Error("network failed") : undefined);
			},
		});
		createReadStream.mockReturnValueOnce(body);
		await expect(
			new GcsBlobStorage({ bucket: "test" }).get("blob")
		).rejects.toThrow();
		expect(body.destroyed).toBe(true);
	}
);

it.for([404, 503, 200])(
	"closes rejected downloads: status=%s",
	async (statusCode, { expect }) => {
		const body = new Readable({
			read() {
				this.emit("response", { statusCode, headers: {} });
			},
		});
		createReadStream.mockReturnValueOnce(body);
		const result = new GcsBlobStorage({ bucket: "test" }).get("blob");
		if (statusCode === 404) {
			await expect(result).resolves.toBeNull();
		} else {
			await expect(result).rejects.toThrow("invalid download metadata");
		}
		expect(body.destroyed).toBe(true);
	}
);
