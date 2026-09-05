import { DatabaseSync } from "node:sqlite";

const [extension, replicaUrl] = process.argv.slice(2);
if (extension === undefined || replicaUrl === undefined) {
	throw new Error("usage: node probe-node-sqlite.mjs EXTENSION REPLICA_URL");
}

process.env.LITESTREAM_REPLICA_URL = replicaUrl;
process.env.LITESTREAM_HYDRATION_ENABLED = "false";

const loader = new DatabaseSync(":memory:", { allowExtension: true });
loader.loadExtension(extension);

let namedVfsOpen = "succeeded";
try {
	const database = new DatabaseSync("file:probe.sqlite?vfs=litestream");
	database.close();
} catch (error) {
	namedVfsOpen = error instanceof Error ? error.message : String(error);
}
loader.close();

console.log(
	JSON.stringify({ extensionLoad: "succeeded", namedVfsOpen }, null, 2)
);
