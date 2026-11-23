import { z } from 'zod';

import { threadKeyPattern } from '#schemas.ts';

// `closesAt` is in epoch seconds, as `createdAt` is; a page without it stays open
const threadPageSchema = z.object({
	closesAt: z.number().int().optional(),
	path: z.string(),
});

export const threadRegistrySchema = z.record(z.string(), threadPageSchema);

export type ThreadPage = z.infer<typeof threadPageSchema>;

export type ThreadRegistry = z.infer<typeof threadRegistrySchema>;

export type ThreadResolver = (thread: string) => Promise<ThreadPage | undefined>;

// `closesAt: 0` registers a page that keeps its comments but takes no more, so the orphans report leaves it out
export interface ThreadEntry {
	closesAt?: number;
	formerKeys?: Array<string>;
	key: string;
	path: string;
}

export function buildThreadRegistry(entries: Iterable<ThreadEntry>): ThreadRegistry {
	const registry = new Map<string, ThreadPage>();

	for (const { closesAt, formerKeys = [], key: currentKey, path } of entries) {
		const page = closesAt === undefined ? { path } : { closesAt, path };

		for (const key of [currentKey, ...formerKeys]) {
			if (!threadKeyPattern.test(key)) throw new Error(`Thread key ${key} is not a valid key`);

			const claimed = registry.get(key);

			if (claimed !== undefined && claimed.path !== path) {
				throw new Error(`Thread ${key} resolves to both ${claimed.path} and ${path}`);
			}

			registry.set(key, page);
		}
	}

	return Object.fromEntries(registry);
}

export interface ThreadResolverOptions {
	// For a host whose registry changes without the handler restarting; unset, the first load is kept
	maxAgeSeconds?: number;
}

// A failed load is dropped so the next call retries
export function createThreadResolver(
	loadRegistry: () => Promise<unknown>,
	{ maxAgeSeconds }: ThreadResolverOptions = {},
): ThreadResolver {
	let registry: Promise<Map<string, ThreadPage>> | undefined;
	let loadedAt = 0;

	async function load(): Promise<Map<string, ThreadPage>> {
		return new Map(Object.entries(threadRegistrySchema.parse(await loadRegistry())));
	}

	return async (thread) => {
		if (maxAgeSeconds !== undefined && Date.now() - loadedAt >= maxAgeSeconds * 1000) {
			registry = undefined;
		}

		if (!registry) {
			registry = load();
			loadedAt = Date.now();
		}

		try {
			const threads = await registry;

			return threads.get(thread);
		} catch (error) {
			registry = undefined;
			throw error;
		}
	};
}

// The build reads this to leave out a closed page's form; the handler refuses a closed thread either way
export function isThreadOpen(page: ThreadPage, now = Date.now()): boolean {
	return page.closesAt === undefined || now < page.closesAt * 1000;
}
