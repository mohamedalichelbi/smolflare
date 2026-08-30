import { createR2BlobFetcher } from "./fetcher";
import { AzureBlobStorage } from "./providers/azure";
import { GcsBlobStorage } from "./providers/gcs";
import { S3BlobStorage } from "./providers/s3";
import type { RemoteR2Options } from "./fetcher";
import type { AzureBlobStorageOptions } from "./providers/azure";
import type { GcsBlobStorageOptions } from "./providers/gcs";
import type { S3BlobStorageOptions } from "./providers/s3";

/** Stores R2 blob bodies with workerd's native filesystem service. */
export class R2FileSystem {
	readonly type = "fs" as const;

	constructor(readonly path?: string) {}
}

abstract class R2Remote {
	readonly type = "custom" as const;
	abstract fetch(request: Request): Promise<Response>;
}

/** Stores R2 blob bodies in S3 or an S3-compatible bucket. */
export class R2BucketS3 extends R2Remote {
	readonly fetch: (request: Request) => Promise<Response>;

	constructor(options: S3BlobStorageOptions & RemoteR2Options) {
		super();
		this.fetch = createR2BlobFetcher(new S3BlobStorage(options), options);
	}
}

/** Stores R2 blob bodies in Google Cloud Storage. */
export class R2BucketGCS extends R2Remote {
	readonly fetch: (request: Request) => Promise<Response>;

	constructor(options: GcsBlobStorageOptions & RemoteR2Options) {
		super();
		this.fetch = createR2BlobFetcher(new GcsBlobStorage(options), options);
	}
}

/** Stores R2 blob bodies in Azure Blob Storage. */
export class R2BucketAzureBlobStorage extends R2Remote {
	readonly fetch: (request: Request) => Promise<Response>;

	constructor(options: AzureBlobStorageOptions & RemoteR2Options) {
		super();
		this.fetch = createR2BlobFetcher(new AzureBlobStorage(options), options);
	}
}

export type { RemoteR2Options } from "./fetcher";
