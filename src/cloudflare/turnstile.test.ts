import { afterEach, describe, expect, test, vi } from 'vitest';

import { createTurnstileChallenge } from '#cloudflare/turnstile.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

function stubSiteverify(response: typeof fetch) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(response);
}

describe('the Turnstile challenge', () => {
	test('sends the secret, the token and the client IP, and passes only on success', async () => {
		const fetchSpy = stubSiteverify(() => Promise.resolve(Response.json({ success: true })));
		const challenge = createTurnstileChallenge('secret');

		expect(await challenge.verify('token', '203.0.113.7')).toBe(true);

		const body = fetchSpy.mock.calls[0]?.[1]?.body;

		expect(body instanceof FormData ? Object.fromEntries(body) : undefined).toEqual({
			remoteip: '203.0.113.7',
			response: 'token',
			secret: 'secret',
		});

		fetchSpy.mockImplementation(() => Promise.resolve(Response.json({ success: false })));

		expect(await challenge.verify('token', '203.0.113.7')).toBe(false);
	});

	test('throws on an outage rather than failing the visitor', async () => {
		stubSiteverify(() => Promise.resolve(new Response(undefined, { status: 503 })));

		await expect(createTurnstileChallenge('secret').verify('token', '203.0.113.7')).rejects.toThrow(
			'503',
		);
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
			createTurnstileChallenge('secret', { timeoutMs: 10 }).verify('token', '203.0.113.7'),
		).rejects.toThrow(/timed out|aborted/i);
	});
});
