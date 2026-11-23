import type { ThreadPage, ThreadResolver } from '#registry.ts';

import { createThreadResolver } from '#registry.ts';

export interface AssetsBinding {
	fetch: (input: URL) => Promise<Response>;
}

// Once per isolate: the registry only changes with a deploy, which starts new isolates
const resolvers = new WeakMap<AssetsBinding, Map<string, ThreadResolver>>();

export function createAssetsThreadResolver(
	assets: AssetsBinding,
	registryPath: string,
): (thread: string, request: Request) => Promise<ThreadPage | undefined> {
	return (thread, request) => {
		const byPath = resolvers.get(assets) ?? new Map<string, ThreadResolver>();
		let resolver = byPath.get(registryPath);

		if (!resolver) {
			resolver = createThreadResolver(async () => {
				const response = await assets.fetch(new URL(registryPath, request.url));

				if (!response.ok)
					throw new Error(`The thread registry answered ${String(response.status)}`);

				return response.json();
			});
			byPath.set(registryPath, resolver);
			resolvers.set(assets, byPath);
		}

		return resolver(thread);
	};
}
