import fs from "node:fs/promises";
import { CoreBindings, CoreHeaders } from "../../workers";
import { WORKER_BINDING_SERVICE_LOOPBACK } from "./constants";
import type { ParsedInstanceOptions } from "../../config/schema";
import type { Service } from "../../runtime";

/** Build a shared blob service for a local storage plugin. */
export async function getBlobStorageService(
	pluginName: "r2" | "kv",
	sharedOptions: ParsedInstanceOptions
): Promise<Service | undefined> {
	const storageKey = `${pluginName}BlobStorage` as const;
	const storage = sharedOptions[storageKey];
	const name = `${pluginName}:blob-storage`;
	if (storage?.type === "fs" && storage.path !== undefined) {
		await fs.mkdir(storage.path, { recursive: true });
		return { name, disk: { path: storage.path, writable: true } };
	}
	if (storage?.type !== "custom") return;
	return {
		name,
		worker: {
			compatibilityDate: "2025-08-04",
			compatibilityFlags: ["connect_pass_through"],
			bindings: [WORKER_BINDING_SERVICE_LOOPBACK],
			serviceWorkerScript: `addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    let body;
    let bodyPump = Promise.resolve();
    if (event.request.body !== null) {
      const stream = new TransformStream();
      bodyPump = event.request.body.pipeTo(stream.writable);
      body = stream.readable;
    }
    const request = new Request(event.request, { body });
    request.headers.set("${CoreHeaders.BLOB_STORAGE}", "${storageKey}");
    request.headers.set("${CoreHeaders.ORIGINAL_URL}", request.url);
    const [response] = await Promise.all([
      ${CoreBindings.SERVICE_LOOPBACK}.fetch(request),
      bodyPump,
    ]);
    if (request.method === "PUT" && !response.ok) {
      await response.body?.cancel();
      throw new Error("Blob upload failed with status " + response.status);
    }
    return response;
  })());
})`,
		},
	};
}
