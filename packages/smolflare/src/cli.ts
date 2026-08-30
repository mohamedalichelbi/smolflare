#!/usr/bin/env node

import { gatewayConfigFromEnv } from "./config";
import { createBlobGateway } from "./server";

const config = gatewayConfigFromEnv();
const server = createBlobGateway(config);
server.listen(config.port, config.host, () => {
	process.stdout.write(
		`Smolflare blob gateway listening on ${config.host}:${config.port}\n`
	);
});

function shutdown(): void {
	server.close((error) => {
		if (error !== undefined) {
			process.stderr.write(`${error.stack}\n`);
			process.exitCode = 1;
		}
	});
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
