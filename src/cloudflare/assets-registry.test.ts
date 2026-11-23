import { expect, test, vi } from 'vitest';

import { createAssetsThreadResolver } from '#cloudflare/assets-registry.ts';

const request = new Request('https://example.test/api/comments');

test('fetches the registry from the assets binding once, however many resolvers share it', async () => {
	const fetch = vi.fn((_input: URL) =>
		Promise.resolve(Response.json({ 'posts/hello': { path: '/hello/' } })),
	);
	const assets = { fetch };

	await expect(
		createAssetsThreadResolver(assets, '/comment-threads.json')('posts/hello', request),
	).resolves.toEqual({ path: '/hello/' });
	await expect(
		createAssetsThreadResolver(assets, '/comment-threads.json')('posts/missing', request),
	).resolves.toBeUndefined();

	expect(fetch).toHaveBeenCalledOnce();
	expect(fetch.mock.calls[0]?.[0].href).toBe('https://example.test/comment-threads.json');
});

test('throws when the registry is missing, so the handler answers 500 rather than refusing every thread', async () => {
	const assets = { fetch: () => Promise.resolve(new Response(undefined, { status: 404 })) };

	await expect(
		createAssetsThreadResolver(assets, '/comment-threads.json')('posts/hello', request),
	).rejects.toThrow('answered 404');
});
