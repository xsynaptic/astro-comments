import { z } from 'zod';

// `closesAt` is in epoch seconds, as `createdAt` is; a page without it stays open
const threadPageSchema = z.object({
	closesAt: z.number().int().optional(),
	path: z.string(),
});

export const threadRegistrySchema = z.record(z.string(), threadPageSchema);

export type ThreadPage = z.infer<typeof threadPageSchema>;

export type ThreadRegistry = z.infer<typeof threadRegistrySchema>;

export type ThreadResolver = (thread: string) => Promise<ThreadPage | undefined>;

// A failed load is dropped so the next call retries
export function createThreadResolver(loadRegistry: () => Promise<unknown>): ThreadResolver {
	let registry: Promise<Map<string, ThreadPage>> | undefined;

	async function load(): Promise<Map<string, ThreadPage>> {
		return new Map(Object.entries(threadRegistrySchema.parse(await loadRegistry())));
	}

	return async (thread) => {
		registry = registry ?? load();

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
