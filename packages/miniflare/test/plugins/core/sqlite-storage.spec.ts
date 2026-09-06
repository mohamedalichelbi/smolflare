import { test } from "vitest";
import { getDurableObjectStoragePluginName } from "../../../src/plugins/core/sqlite-storage";

test("uses the worker name for the Durable Object storage namespace", ({
	expect,
}) => {
	expect(getDurableObjectStoragePluginName("worker-a")).toBe("do-worker-a");
	expect(getDurableObjectStoragePluginName("worker-b")).toBe("do-worker-b");
});
