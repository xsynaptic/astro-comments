import { afterEach, describe, expect, test, vi } from 'vitest';

import { createTurnstileChallenge } from '#cloudflare/turnstile.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

const hostnames = ['example.com', 'preview.example.com'];

function stubSiteverify(response: typeof fetch) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(response);
}

function answer(result: Record<string, unknown>) {
	return stubSiteverify(() => Promise.resolve(Response.json(result)));
}

describe('the Turnstile challenge', () => {
	test('sends the secret, the token and the client IP, and passes only on success', async () => {
		const fetchSpy = answer({ hostname: 'example.com', success: true });
		const challenge = createTurnstileChallenge('secret', { hostnames });

		expect(await challenge.verify('token', '203.0.113.7')).toBe(true);

		const body = fetchSpy.mock.calls[0]?.[1]?.body;

		expect(body instanceof FormData ? Object.fromEntries(body) : undefined).toEqual({
			remoteip: '203.0.113.7',
			response: 'token',
			secret: 'secret',
		});

		fetchSpy.mockImplementation(() =>
			Promise.resolve(Response.json({ hostname: 'example.com', success: false })),
		);

		expect(await challenge.verify('token', '203.0.113.7')).toBe(false);
	});

	test('refuses a token solved on a host the site does not serve the form from', async () => {
		answer({ hostname: 'attacker.example', success: true });

		expect(
			await createTurnstileChallenge('secret', { hostnames }).verify('token', '203.0.113.7'),
		).toBe(false);
	});

	test('passes a token from any of the listed hosts', async () => {
		answer({ hostname: 'preview.example.com', success: true });

		expect(
			await createTurnstileChallenge('secret', { hostnames }).verify('token', '203.0.113.7'),
		).toBe(true);
	});

	test('refuses a success that names no hostname', async () => {
		answer({ success: true });

		expect(
			await createTurnstileChallenge('secret', { hostnames }).verify('token', '203.0.113.7'),
		).toBe(false);
	});

	test('refuses a token minted for another action, or for none, once an action is set', async () => {
		const fetchSpy = answer({ action: 'login', hostname: 'example.com', success: true });
		const challenge = createTurnstileChallenge('secret', { action: 'comment', hostnames });

		expect(await challenge.verify('token', '203.0.113.7')).toBe(false);

		fetchSpy.mockImplementation(() =>
			Promise.resolve(Response.json({ hostname: 'example.com', success: true })),
		);

		expect(await challenge.verify('token', '203.0.113.7')).toBe(false);

		fetchSpy.mockImplementation(() =>
			Promise.resolve(Response.json({ action: 'comment', hostname: 'example.com', success: true })),
		);

		expect(await challenge.verify('token', '203.0.113.7')).toBe(true);
	});

	test("passes Cloudflare's test secret, whose answer names example.com and no action", async () => {
		answer({ hostname: 'example.com', success: true });

		expect(
			await createTurnstileChallenge('1x0000000000000000000000000000000AA', {
				action: 'comment',
				hostnames: ['preview.example.com'],
			}).verify('XXXX.DUMMY.TOKEN.XXXX', '203.0.113.7'),
		).toBe(true);
	});

	test('fails the visitor, not the request, on a body that is not a siteverify result', async () => {
		answer({ hostname: 'example.com', success: 'true' });

		expect(
			await createTurnstileChallenge('secret', { hostnames }).verify('token', '203.0.113.7'),
		).toBe(false);
	});

	test('throws on an outage rather than failing the visitor', async () => {
		stubSiteverify(() => Promise.resolve(new Response(undefined, { status: 503 })));

		await expect(
			createTurnstileChallenge('secret', { hostnames }).verify('token', '203.0.113.7'),
		).rejects.toThrow('503');
	});

	test('gives up on a siteverify that never answers', async () => {
		stubSiteverify(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;

					signal?.addEventListener('abort', () => {
						reject(signal.reason as Error);
					});
				}),
		);

		await expect(
			createTurnstileChallenge('secret', { hostnames, timeoutMs: 10 }).verify(
				'token',
				'203.0.113.7',
			),
		).rejects.toThrow(/timed out|aborted/i);
	});
});
