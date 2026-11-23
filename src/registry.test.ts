import { describe, expect, test, vi } from 'vitest';

import { buildThreadRegistry, createThreadResolver, isThreadOpen } from '#registry.ts';

describe('the thread resolver', () => {
	test('loads the registry once and answers each key, former keys included', async () => {
		const load = vi.fn(() =>
			Promise.resolve({
				'mixes/old-slug': { path: '/mixes/voyager/' },
				'mixes/voyager': { closesAt: 1_800_000_000, path: '/mixes/voyager/' },
			}),
		);
		const resolve = createThreadResolver(load);

		await expect(resolve('mixes/voyager')).resolves.toEqual({
			closesAt: 1_800_000_000,
			path: '/mixes/voyager/',
		});
		await expect(resolve('mixes/old-slug')).resolves.toEqual({ path: '/mixes/voyager/' });
		await expect(resolve('pages/about')).resolves.toBeUndefined();
		expect(load).toHaveBeenCalledOnce();
	});

	test("answers nothing for a key that names an object's own property", async () => {
		const resolve = createThreadResolver(() => Promise.resolve({}));

		await expect(resolve('constructor')).resolves.toBeUndefined();
	});

	test('loads again once the registry is older than its maximum age', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });

		const load = vi
			.fn<() => Promise<unknown>>()
			.mockResolvedValueOnce({})
			.mockResolvedValue({ 'posts/new': { path: '/new/' } });
		const resolve = createThreadResolver(load, { maxAgeSeconds: 60 });

		await expect(resolve('posts/new')).resolves.toBeUndefined();
		vi.advanceTimersByTime(59_000);
		await expect(resolve('posts/new')).resolves.toBeUndefined();
		vi.advanceTimersByTime(1000);
		await expect(resolve('posts/new')).resolves.toEqual({ path: '/new/' });

		vi.useRealTimers();
	});

	test('tries the load again after a failure', async () => {
		const load = vi
			.fn<() => Promise<unknown>>()
			.mockRejectedValueOnce(new Error('unreachable'))
			.mockResolvedValue({ 'mixes/voyager': { path: '/mixes/voyager/' } });
		const resolve = createThreadResolver(load);

		await expect(resolve('mixes/voyager')).rejects.toThrow('unreachable');
		await expect(resolve('mixes/voyager')).resolves.toEqual({ path: '/mixes/voyager/' });
	});
});

describe('buildThreadRegistry', () => {
	test("registers each former key under its page's path and closing time", () => {
		const registry = buildThreadRegistry([
			{
				closesAt: 0,
				formerKeys: ['mixes/old-slug'],
				key: 'mixes/voyager',
				path: '/mixes/voyager/',
			},
			{ key: 'posts/hello', path: '/hello/' },
		]);

		expect(registry).toEqual({
			'mixes/old-slug': { closesAt: 0, path: '/mixes/voyager/' },
			'mixes/voyager': { closesAt: 0, path: '/mixes/voyager/' },
			'posts/hello': { path: '/hello/' },
		});
	});

	test('refuses a key two pages claim, and a key the handler would reject', () => {
		expect(() =>
			buildThreadRegistry([
				{ key: 'posts/hello', path: '/hello/' },
				{ formerKeys: ['posts/hello'], key: 'posts/goodbye', path: '/goodbye/' },
			]),
		).toThrow('resolves to both /hello/ and /goodbye/');
		expect(() => buildThreadRegistry([{ key: 'posts/en:42', path: '/hello/' }])).toThrow(
			'not a valid key',
		);
	});
});

describe('isThreadOpen', () => {
	test('reads `closesAt` as epoch seconds, closed from that second on', () => {
		const page = { closesAt: 1_800_000_000, path: '/mixes/voyager/' };

		expect(isThreadOpen(page, 1_799_999_999_999)).toBe(true);
		expect(isThreadOpen(page, 1_800_000_000_000)).toBe(false);
		expect(isThreadOpen({ path: '/mixes/voyager/' }, Number.MAX_SAFE_INTEGER)).toBe(true);
	});
});
