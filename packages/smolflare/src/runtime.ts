import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

export const SMOLFLARE_RUNTIME_LOCK = {
	platform: "linux",
	architecture: "x64",
	workerd: {
		commit: "4c92a9c3eb81d074f3f3477b3067df4f9a9c4a14",
		fileName: "workerd-linux-x64",
		sha256: "6cdd0a85df447b994996f3a2e0a2acbed20e41254392223e7bf0847284552cf7",
		url: "https://github.com/mohamedalichelbi/workerd/releases/download/v1.20260905.1-smolflare.1/workerd-linux-x64",
		version: "v1.20260905.1-smolflare.1",
	},
	litestreamVfs: {
		commit: "50aa20ce550cb38eb08ff05295044decc822700a",
		fileName: "litestream-vfs.so",
		sha256: "6ba069432840a94227a4f2bd67ab10475509a02965e8c9b45bdba5853db9152b",
		url: "https://github.com/mohamedalichelbi/litestream/releases/download/v0.5.17-smolflare.1/litestream-vfs.so",
		version: "v0.5.17-smolflare.1",
	},
} as const;

export interface SmolflareRuntimePaths {
	readonly extensionPath: string;
	readonly workerdPath: string;
}

export interface InstallSmolflareRuntimeOptions {
	readonly fetch?: typeof globalThis.fetch;
	readonly runtimeLock?: SmolflareRuntimeLock;
	readonly timeoutMs?: number;
}

export interface SmolflareRuntimeLock {
	readonly architecture: string;
	readonly litestreamVfs: SmolflareRuntimeArtifact;
	readonly platform: string;
	readonly workerd: SmolflareRuntimeArtifact;
}

export interface SmolflareRuntimeArtifact {
	readonly commit?: string;
	readonly fileName: string;
	readonly sha256: string;
	readonly url: string;
	readonly version?: string;
}

/**
 * Download and verify the Workerd and Litestream binaries for remote SQLite.
 * Existing files are reused only when their SHA-256 values match the lock.
 */
export async function installSmolflareRuntime(
	directory: string,
	options: InstallSmolflareRuntimeOptions = {}
): Promise<SmolflareRuntimePaths> {
	const runtimeLock = options.runtimeLock ?? SMOLFLARE_RUNTIME_LOCK;
	if (
		process.platform !== runtimeLock.platform ||
		process.arch !== runtimeLock.architecture
	) {
		throw new Error("The pinned Smolflare runtime supports Linux x64 only.");
	}

	await mkdir(directory, { recursive: true });
	const fetchImplementation = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 120_000;
	const [workerdPath, extensionPath] = await Promise.all([
		installArtifact(
			directory,
			runtimeLock.workerd,
			fetchImplementation,
			timeoutMs
		),
		installArtifact(
			directory,
			runtimeLock.litestreamVfs,
			fetchImplementation,
			timeoutMs
		),
	]);

	return { extensionPath, workerdPath };
}

async function installArtifact(
	directory: string,
	artifact: SmolflareRuntimeArtifact,
	fetchImplementation: typeof globalThis.fetch,
	timeoutMs: number
): Promise<string> {
	const destination = path.join(directory, artifact.fileName);
	if ((await fileSha256(destination)) === artifact.sha256) {
		await chmod(destination, 0o755);
		return destination;
	}

	const temporary = path.join(
		directory,
		`.${artifact.fileName}.${randomUUID()}.tmp`
	);
	try {
		const response = await fetchImplementation(artifact.url, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok || response.body === null) {
			throw new Error(
				`Cannot download ${artifact.url}: HTTP ${response.status}.`
			);
		}

		await pipeline(
			response.body as unknown as ReadableStream,
			createWriteStream(temporary, { mode: 0o755 })
		);
		const actual = await fileSha256(temporary);
		if (actual !== artifact.sha256) {
			throw new Error(
				`Checksum mismatch for ${artifact.fileName}: expected ${artifact.sha256}, received ${actual}.`
			);
		}
		await rename(temporary, destination);
		return destination;
	} finally {
		await rm(temporary, { force: true });
	}
}

async function fileSha256(filePath: string): Promise<string | undefined> {
	const hash = createHash("sha256");
	try {
		for await (const chunk of createReadStream(filePath)) hash.update(chunk);
		return hash.digest("hex");
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
