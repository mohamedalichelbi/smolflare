import { test } from "vitest";
import { getSqliteStorage } from "../../../src/plugins/shared/sqlite-storage";
import { useTmp } from "../../test-shared";
import type { ParsedInstanceOptions } from "../../../src/config/schema";

test("uses the existing disk service by default", async ({ expect }) => {
	const tmpPath = await useTmp();
	const sharedOptions = {} as ParsedInstanceOptions;
	const result = await getSqliteStorage(
		"r2",
		"r2:storage",
		tmpPath,
		sharedOptions
	);

	expect(result).toEqual({ storage: { localDisk: "r2:storage" } });
});

test("delegates to a custom SQLite backend", async ({ expect }) => {
	const tmpPath = await useTmp();
	const calls: unknown[] = [];
	const expected = { storage: { localDisk: "custom:storage" } } as const;
	const sharedOptions = {
		sqliteStorage: {
			type: "custom",
			getStorage(context: unknown) {
				calls.push(context);
				return expected;
			},
		},
	} as ParsedInstanceOptions;
	const result = await getSqliteStorage(
		"r2",
		"r2:storage",
		tmpPath,
		sharedOptions
	);

	expect(result).toBe(expected);
	expect(calls).toEqual([
		{ localDiskServiceName: "r2:storage", pluginName: "r2", tmpPath },
	]);
});
