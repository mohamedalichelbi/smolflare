import { chmod, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

async function main(): Promise<void> {
	const root = resolve(__dirname, "..");
	const outdir = resolve(root, "dist");

	await rm(outdir, { recursive: true, force: true });
	await build({
		absWorkingDir: root,
		bundle: true,
		entryPoints: ["src/index.ts", "src/cli.ts"],
		external: ["miniflare"],
		format: "cjs",
		minifySyntax: true,
		outdir,
		platform: "node",
		sourcemap: true,
		target: "node22",
	});
	await chmod(resolve(outdir, "cli.js"), 0o755);
}

void main();
