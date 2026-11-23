import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import type { CommentModerationStore } from '#store.ts';

import { findOrphanedThreads } from '#cli/orphans.ts';

const comment = { author: 'Reader', body: 'Hello.', createdAt: 0, id: 'id', isOwner: false };

test('reports threads the registry does not hold, leaving out closed pages and ignored keys', async () => {
	const registryFile = path.join(await mkdtemp(path.join(tmpdir(), 'orphans-')), 'registry.json');
	const threads = ['posts/open', 'posts/closed', 'posts/unpublished', 'posts/lost', 'posts/lost'];

	await writeFile(
		registryFile,
		JSON.stringify({
			'posts/closed': { closesAt: 0, path: '/closed/' },
			'posts/open': { path: '/open/' },
		}),
	);

	const store = {
		listApproved: () => Promise.resolve(threads.map((thread) => ({ ...comment, thread }))),
		listPending: () =>
			Promise.resolve([
				{ ...comment, source: 'web', status: 'pending' as const, thread: 'posts/lost' },
			]),
	} as unknown as CommentModerationStore;

	await expect(findOrphanedThreads(store, registryFile, ['posts/unpublished'])).resolves.toEqual([
		{ approved: 2, pending: 1, thread: 'posts/lost' },
	]);
});
