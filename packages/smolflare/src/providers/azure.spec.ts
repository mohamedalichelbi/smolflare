import { Readable } from "node:stream";
import { it, vi } from "vitest";
import { AzureBlobStorage } from "./azure";

const { download, getProperties } = vi.hoisted(() => ({
	download: vi.fn(),
	getProperties: vi.fn(),
}));
vi.mock("@azure/storage-blob", () => ({
	BlobServiceClient: {
		fromConnectionString: () => ({
			getContainerClient: () => ({
				getBlobClient: () => ({ download, getProperties }),
			}),
		}),
	},
	StorageSharedKeyCredential: vi.fn(),
}));

it.for([
	{ range: undefined, contentRange: undefined, contentLength: 5, size: 5 },
	{
		range: { start: 2, end: 9 },
		contentRange: "bytes 2-4/5",
		contentLength: 3,
		size: 5,
	},
])(
	"uses download metadata: $contentRange",
	async ({ range, contentRange, contentLength, size }, { expect }) => {
		getProperties.mockClear();
		const source = Readable.from("hello");
		download.mockResolvedValueOnce({
			readableStreamBody: source,
			contentRange,
			contentLength,
		});
		const storage = new AzureBlobStorage({
			connectionString: "test",
			container: "test",
		});
		const result = await storage.get("blob", range);
		expect(result).toMatchObject({ size, contentLength });
		expect(getProperties).not.toHaveBeenCalled();
		result?.body.destroy();
		source.destroy();
	}
);

it.for([undefined, "bytes 0-2/5", "bytes 2-4/*", "bytes 2-9/5"])(
	"closes invalid ranged downloads: %s",
	async (contentRange, { expect }) => {
		const body = Readable.from("bad");
		download.mockResolvedValueOnce({
			readableStreamBody: body,
			contentLength: 3,
			contentRange,
		});
		const storage = new AzureBlobStorage({
			connectionString: "test",
			container: "test",
		});
		await expect(storage.get("blob", { start: 2, end: 4 })).rejects.toThrow(
			"invalid download metadata"
		);
		expect(body.destroyed).toBe(true);
	}
);
