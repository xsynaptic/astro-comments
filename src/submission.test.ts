import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { CommentMessages } from '#messages.ts';
import type { NewComment } from '#store.ts';
import type { CommentRateLimit, CommentSubmissionConfig } from '#submission.ts';

import { defaultMessages } from '#messages.ts';
import { handleCommentSubmission } from '#submission.ts';

// SHA-256 of `reader@example.test` and of `test-salt203.0.113.7`, computed outside this suite
const emailHashOfLowercasedEmail =
	'2cecb651356e138bd83a5215c4d7c5a3ebfb923a0c316de1b218797417911c5e';
const saltedIpHash = 'c73444b80046bb2a92443cb729729d63ccd35a41c85e822a6557d6fc277cc93d';

const challengeField = 'challenge-token';

interface Harness {
	config: CommentSubmissionConfig;
	inserted: Array<NewComment>;
	resolved: Array<string>;
	verified: Array<[string, string | undefined]>;
}

interface HarnessOptions {
	approvedParents?: Array<[thread: string, parentId: string]>;
	closesAt?: number;
	ipSalt?: string;
	isChallengePassing?: boolean;
	messages?: Partial<CommentMessages>;
	rateLimit?: CommentRateLimit;
	threadPath?: (thread: string) => string;
	threads?: Array<string>;
}

type FieldOverrides = Record<string, string | undefined>;

function createHarness({
	approvedParents = [],
	closesAt,
	ipSalt = 'test-salt',
	isChallengePassing = true,
	messages,
	rateLimit,
	threadPath = (thread) => `/${thread}/`,
	threads = ['mixes/voyager'],
}: HarnessOptions = {}): Harness {
	const inserted: Array<NewComment> = [];
	const resolved: Array<string> = [];
	const verified: Array<[string, string | undefined]> = [];

	const config: CommentSubmissionConfig = {
		challenge: {
			tokenField: challengeField,
			verify: (token, remoteIp) => {
				verified.push([token, remoteIp]);

				return Promise.resolve(isChallengePassing);
			},
		},
		getClientIp: (request) => request.headers.get('x-client-ip') ?? undefined,
		ipSalt,
		...(messages ? { messages } : undefined),
		...(rateLimit ? { rateLimit } : undefined),
		resolveThread: (thread) => {
			resolved.push(thread);

			if (!threads.includes(thread)) return Promise.resolve(undefined);

			return Promise.resolve({
				path: threadPath(thread),
				...(closesAt === undefined ? undefined : { closesAt }),
			});
		},
		store: {
			countRecentComments: (ipHash, since) =>
				Promise.resolve(
					inserted.filter((comment) => comment.ipHash === ipHash && comment.createdAt > since)
						.length,
				),
			findApprovedParent: (parentId) =>
				Promise.resolve(approvedParents.find(([, id]) => id === parentId)?.[0]),
			insert: (comment) => {
				inserted.push(comment);

				return Promise.resolve();
			},
		},
	};

	return { config, inserted, resolved, verified };
}

function makeRequest({
	fields: fieldOverrides = {},
	headers: headerOverrides = {},
}: { fields?: FieldOverrides; headers?: Record<string, string> } = {}): Request {
	const fields: FieldOverrides = {
		author: 'Reader',
		body: 'A comment worth keeping.',
		[challengeField]: 'token',
		fillTimeMs: '5000',
		thread: 'mixes/voyager',
		...fieldOverrides,
	};

	const body = new URLSearchParams(
		Object.entries(fields).filter(([, value]) => value !== undefined) as Array<[string, string]>,
	).toString();

	return new Request('https://example.test/api/comments', {
		body,
		headers: {
			'content-length': String(new TextEncoder().encode(body).length),
			'content-type': 'application/x-www-form-urlencoded',
			'x-client-ip': '203.0.113.7',
			...headerOverrides,
		},
		method: 'POST',
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function silenceErrors() {
	return vi.spyOn(console, 'error').mockImplementation(vi.fn());
}

describe('handleCommentSubmission', () => {
	test('answers anything but a POST with 405, before reading a body', async () => {
		const { config } = createHarness();

		for (const method of ['GET', 'HEAD', 'PUT']) {
			const response = await handleCommentSubmission(
				new Request('https://example.test/api/comments', { method }),
				config,
			);

			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('POST');
		}
	});

	test('refuses to run without an IP salt, rather than hashing against a constant', async () => {
		const logged = silenceErrors();
		const { config, inserted } = createHarness({ ipSalt: '' });
		const response = await handleCommentSubmission(makeRequest(), config);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.unexpected });
		expect(logged).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('IP salt') as unknown }),
		);
		expect(inserted).toEqual([]);
	});

	test('refuses a request with no client IP rather than letting it past the rate limit', async () => {
		const logged = silenceErrors();
		const { config, inserted, verified } = createHarness();
		const request = makeRequest();

		request.headers.delete('x-client-ip');

		const response = await handleCommentSubmission(request, config);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.unexpected });
		expect(logged).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('client IP') as unknown }),
		);
		expect(verified).toEqual([]);
		expect(inserted).toEqual([]);
	});

	test('logs a store failure and answers 500', async () => {
		const logged = silenceErrors();
		const { config } = createHarness();

		config.store.insert = () => Promise.reject(new Error('D1 is down'));

		const response = await handleCommentSubmission(makeRequest(), config);

		expect(response.status).toBe(500);
		expect(logged).toHaveBeenCalledOnce();
	});

	test('rejects a body over the size cap', async () => {
		const { config } = createHarness();
		const response = await handleCommentSubmission(
			makeRequest({ fields: { body: 'x'.repeat(40_000) } }),
			config,
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.tooLarge });
	});

	test('rejects a body of unknown size, which cannot be capped', async () => {
		const { config } = createHarness();
		const request = makeRequest();

		request.headers.delete('content-length');

		const response = await handleCommentSubmission(request, config);

		expect(response.status).toBe(413);
	});

	test('rejects a body that is not a form', async () => {
		const { config } = createHarness();
		const request = new Request('https://example.test/api/comments', {
			body: 'not a form',
			headers: {
				'content-length': '10',
				'content-type': 'text/plain',
				'x-client-ip': '203.0.113.7',
			},
			method: 'POST',
		});

		const response = await handleCommentSubmission(request, config);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.unreadable });
	});

	test('rejects a filled honeypot, and ignores an untouched one', async () => {
		const { config } = createHarness();
		const trapped = await handleCommentSubmission(
			makeRequest({ fields: { extra: 'spam.test' } }),
			config,
		);

		expect(trapped.status).toBe(400);
		await expect(trapped.json()).resolves.toEqual({ message: defaultMessages.invalid });

		const untouched = await handleCommentSubmission(
			makeRequest({ fields: { extra: '  ' } }),
			config,
		);

		expect(untouched.status).toBe(201);
	});

	test('rejects a thread key outside the pattern before the site resolves it', async () => {
		const { config, resolved } = createHarness();

		for (const thread of ['../../etc/passwd', 'mixes//voyager', '/mixes/voyager', 'a b']) {
			const response = await handleCommentSubmission(makeRequest({ fields: { thread } }), config);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({ message: defaultMessages.invalid });
		}

		expect(resolved).toEqual([]);
	});

	test('answers a missing challenge token with the pending message, without verifying', async () => {
		const { config, verified } = createHarness();
		const response = await handleCommentSubmission(
			makeRequest({ fields: { [challengeField]: undefined } }),
			config,
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.challengePending });
		expect(verified).toEqual([]);
	});

	test('rejects a form filled in under three seconds', async () => {
		const { config } = createHarness();
		const response = await handleCommentSubmission(
			makeRequest({ fields: { fillTimeMs: '100' } }),
			config,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.tooFast });
	});

	test('rejects a thread the site does not resolve', async () => {
		const { config } = createHarness();
		const response = await handleCommentSubmission(
			makeRequest({ fields: { thread: 'mixes/no-such-mix' } }),
			config,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.threadMissing });
	});

	test('rejects a reply whose parent is not approved on this thread', async () => {
		const { config } = createHarness({ approvedParents: [['mixes/other', 'parent-id']] });
		const response = await handleCommentSubmission(
			makeRequest({ fields: { parentId: 'parent-id' } }),
			config,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.parentMissing });
	});

	test('accepts a reply to an approved parent on the same thread', async () => {
		const { config, inserted } = createHarness({
			approvedParents: [['mixes/voyager', 'parent-id']],
		});
		const response = await handleCommentSubmission(
			makeRequest({ fields: { parentId: 'parent-id' } }),
			config,
		);

		expect(response.status).toBe(201);
		expect(inserted.at(-1)?.parentId).toBe('parent-id');
	});

	test('accepts a reply to a parent under a former key of the same page, stored under the current one', async () => {
		const { config, inserted } = createHarness({
			approvedParents: [['mixes/old-slug', 'parent-id']],
			threadPath: (thread) => (thread === 'mixes/old-slug' ? '/mixes/voyager/' : `/${thread}/`),
			threads: ['mixes/voyager', 'mixes/old-slug'],
		});
		const response = await handleCommentSubmission(
			makeRequest({ fields: { parentId: 'parent-id' } }),
			config,
		);

		expect(response.status).toBe(201);
		expect(inserted.at(-1)).toMatchObject({ parentId: 'parent-id', thread: 'mixes/voyager' });
	});

	test('rejects a reply to a parent on another page', async () => {
		const { config } = createHarness({
			approvedParents: [['mixes/other', 'parent-id']],
			threads: ['mixes/voyager', 'mixes/other'],
		});
		const response = await handleCommentSubmission(
			makeRequest({ fields: { parentId: 'parent-id' } }),
			config,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.parentMissing });
	});

	test('rejects a submission the challenge will not verify, and stores nothing', async () => {
		const { config, inserted } = createHarness({ isChallengePassing: false });
		const response = await handleCommentSubmission(makeRequest(), config);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.challenge });
		expect(inserted).toEqual([]);
	});

	test('never reaches the challenge on a local rejection', async () => {
		const { config, inserted, verified } = createHarness({
			approvedParents: [['mixes/other', 'gone']],
		});

		const rejected = [
			makeRequest({ fields: { body: 'x'.repeat(40_000) } }),
			makeRequest({ fields: { extra: 'spam.test' } }),
			makeRequest({ fields: { author: undefined } }),
			makeRequest({ fields: { fillTimeMs: '100' } }),
			makeRequest({ fields: { thread: 'mixes/no-such-mix' } }),
			makeRequest({ fields: { parentId: 'gone' } }),
		];

		for (const request of rejected) {
			const response = await handleCommentSubmission(request, config);

			expect(response.ok).toBe(false);
		}

		expect(verified).toEqual([]);
		expect(inserted).toEqual([]);
	});

	test('hands the token from the challenge field and the client IP to the challenge', async () => {
		const { config, verified } = createHarness();

		await handleCommentSubmission(makeRequest(), config);

		expect(verified).toEqual([['token', '203.0.113.7']]);
	});

	test('stores a new comment on its thread, with no key for an absent field, and answers 201', async () => {
		const { config, inserted } = createHarness();
		const response = await handleCommentSubmission(makeRequest(), config);

		expect(response.status).toBe(201);
		expect(inserted).toStrictEqual([
			{
				author: 'Reader',
				body: 'A comment worth keeping.',
				createdAt: Math.floor(Date.now() / 1000),
				id: expect.stringMatching(/^[a-z2-7]{10}$/) as unknown,
				ipHash: saltedIpHash,
				thread: 'mixes/voyager',
			},
		]);
	});

	test('stores the name without control or bidi characters, its whitespace folded', async () => {
		const { config, inserted } = createHarness();

		await handleCommentSubmission(
			makeRequest({ fields: { author: 'Ann\u{202E}\u{7}\tLee\u{A0}\u{A0}Ho\u{2066}' } }),
			config,
		);

		expect(inserted.at(-1)?.author).toBe('Ann Lee Ho');
	});

	test('rejects a name with nothing left once control and bidi characters go', async () => {
		const { config, inserted } = createHarness();
		const response = await handleCommentSubmission(
			makeRequest({ fields: { author: '\u{202E}\u{1}\u{200E}' } }),
			config,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: defaultMessages.invalid });
		expect(inserted).toEqual([]);
	});

	test('stores the body without control characters, keeping its tabs and line breaks', async () => {
		const { config, inserted } = createHarness();

		await handleCommentSubmission(
			makeRequest({ fields: { body: 'First\u{1}\tline\r\nsecond\u{85} line' } }),
			config,
		);

		expect(inserted.at(-1)?.body).toBe('First\tline\nsecond line');
	});

	test('stores the email as submitted, plus a hash of its lowercased form', async () => {
		const { config, inserted } = createHarness();

		await handleCommentSubmission(
			makeRequest({ fields: { authorEmail: 'Reader@Example.TEST' } }),
			config,
		);

		expect(inserted.at(-1)).toMatchObject({
			authorEmail: 'Reader@Example.TEST',
			emailHash: emailHashOfLowercasedEmail,
		});
	});

	test('stores the client IP only as a salted hash', async () => {
		const { config, inserted } = createHarness();

		await handleCommentSubmission(
			makeRequest({ headers: { 'x-client-ip': '203.0.113.7' } }),
			config,
		);

		const comment = inserted.at(-1);

		expect(comment?.ipHash).toBe(saltedIpHash);
		expect(Object.values(comment ?? {})).not.toContain('203.0.113.7');
	});

	test('takes comments until the thread closes, then refuses them before the challenge', async () => {
		const closesAt = Math.floor(Date.now() / 1000) + 60;
		const { config, inserted, verified } = createHarness({ closesAt });

		const open = await handleCommentSubmission(makeRequest(), config);

		expect(open.status).toBe(201);

		vi.setSystemTime(closesAt * 1000);

		const closed = await handleCommentSubmission(makeRequest(), config);

		expect(closed.status).toBe(403);
		await expect(closed.json()).resolves.toEqual({ message: defaultMessages.closed });
		expect(verified).toHaveLength(1);
		expect(inserted).toHaveLength(1);
	});

	test('turns an IP away once it reaches the allowance, before the challenge, until the window passes', async () => {
		const { config, inserted, verified } = createHarness();

		for (let count = 0; count < 5; count += 1) {
			await handleCommentSubmission(makeRequest(), config);
		}

		const refused = await handleCommentSubmission(makeRequest(), config);

		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).toBe('600');
		await expect(refused.json()).resolves.toEqual({ message: defaultMessages.tooMany });
		expect(verified).toHaveLength(5);

		vi.setSystemTime(Date.now() + 601_000);

		const later = await handleCommentSubmission(makeRequest(), config);

		expect(later.status).toBe(201);
		expect(inserted).toHaveLength(6);
	});

	test('counts an IPv6 /64 as one network, and an IPv4-mapped address as its IPv4 client', async () => {
		const { config } = createHarness({ rateLimit: { maximumComments: 1, windowSeconds: 60 } });
		const statuses: Array<number> = [];

		for (const address of [
			'2001:db8:1:2::1',
			'2001:db8:1:2::beef',
			'2001:db8:1:3::1',
			'203.0.113.7',
			'::ffff:203.0.113.7',
			'::ffff:198.51.100.2',
		]) {
			const response = await handleCommentSubmission(
				makeRequest({ headers: { 'x-client-ip': address } }),
				config,
			);

			statuses.push(response.status);
		}

		expect(statuses).toEqual([201, 429, 201, 201, 429, 201]);
	});

	test('counts each IP on its own', async () => {
		const { config } = createHarness({ rateLimit: { maximumComments: 1, windowSeconds: 60 } });

		await handleCommentSubmission(makeRequest(), config);

		const again = await handleCommentSubmission(makeRequest(), config);
		const other = await handleCommentSubmission(
			makeRequest({ headers: { 'x-client-ip': '198.51.100.2' } }),
			config,
		);

		expect(again.status).toBe(429);
		expect(again.headers.get('retry-after')).toBe('60');
		expect(other.status).toBe(201);
	});

	test('answers with the site message where one is given, and the default elsewhere', async () => {
		const { config } = createHarness({ messages: { tooFast: 'Slow down.' } });
		const tooFast = await handleCommentSubmission(
			makeRequest({ fields: { fillTimeMs: '100' } }),
			config,
		);
		const invalid = await handleCommentSubmission(
			makeRequest({ fields: { author: undefined } }),
			config,
		);

		await expect(tooFast.json()).resolves.toEqual({ message: 'Slow down.' });
		await expect(invalid.json()).resolves.toEqual({ message: defaultMessages.invalid });
	});
});
