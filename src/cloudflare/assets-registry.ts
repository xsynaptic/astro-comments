import type { ThreadPage, ThreadResolver } from '#registry.ts';

import { createThreadResolver } from '#registry.ts';

export interface AssetsBinding {
	fetch: (input: URL) => Promise<Response>;
}

// Once per isolate: the registry only changes with a deploy, which starts new isolates
const resolvers = new WeakMap<AssetsBinding, ThreadResolver>();

export function createAssetsThreadResolver(
	assets: AssetsBinding,
	registryPath: string,
): (thread: string, request: Request) => Promise<ThreadPage | undefined> {
	return (thread, request) => {
		let resolver = resolvers.get(assets);

		if (!resolver) {
			resolver = createThreadResolver(async () => {
				const response = await assets.fetch(new URL(registryPath, request.url));

				if (!response.ok)
					throw new Error(`The thread registry answered ${String(response.status)}`);

				return response.json();
			});
			resolvers.set(assets, resolver);
		}

		return resolver(thread);
	};
}
