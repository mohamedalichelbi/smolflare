/** Returns true when an SDK error represents a missing object. */
export function isMissingObject(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const value = error as {
		name?: unknown;
		code?: unknown;
		statusCode?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	return (
		value.name === "NoSuchKey" ||
		value.name === "NotFound" ||
		value.code === 404 ||
		value.code === "404" ||
		value.statusCode === 404 ||
		value.$metadata?.httpStatusCode === 404
	);
}
