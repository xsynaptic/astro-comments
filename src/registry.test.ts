import { describe, expect, test, vi } from 'vitest';

import { createThreadResolver, isThreadOpen } from '#registry.ts';

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

describe('isThreadOpen', () => {
	test('reads `closesAt` as epoch seconds, closed from that second on', () => {
		const page = { closesAt: 1_800_000_000, path: '/mixes/voyager/' };

		expect(isThreadOpen(page, 1_799_999_999_999)).toBe(true);
		expect(isThreadOpen(page, 1_800_000_000_000)).toBe(false);
		expect(isThreadOpen({ path: '/mixes/voyager/' }, Number.MAX_SAFE_INTEGER)).toBe(true);
	});
});
