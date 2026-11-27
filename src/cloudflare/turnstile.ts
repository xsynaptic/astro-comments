import { z } from 'zod';

import type { CommentChallenge } from '#submission.ts';

export interface TurnstileChallengeOptions {
	action?: string;
	hostnames: ReadonlyArray<string>;
	timeoutMs?: number;
}

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Rejects every real token, and answers with `example.com` as the host and no action
const passingTestSecretKey = '1x0000000000000000000000000000000AA';

const turnstileTokenField = 'cf-turnstile-response';

const siteverifySchema = z.object({
	action: z.string().optional(),
	hostname: z.string().optional(),
	success: z.boolean(),
});

export function createTurnstileChallenge(
	secretKey: string,
	{ action, hostnames, timeoutMs = 10_000 }: TurnstileChallengeOptions,
): CommentChallenge {
	return {
		tokenField: turnstileTokenField,
		async verify(token, remoteIp) {
			const body = new FormData();

			body.append('secret', secretKey);
			body.append('response', token);
			body.append('remoteip', remoteIp);

			// A Worker waits on a hung fetch for as long as the visitor stays connected
			const response = await fetch(siteverifyUrl, {
				body,
				method: 'POST',
				signal: AbortSignal.timeout(timeoutMs),
			});

			// An outage is a 500, not a visitor who failed the challenge
			if (!response.ok) throw new Error(`Turnstile siteverify answered ${String(response.status)}`);

			const result = siteverifySchema.safeParse(await response.json());

			if (!result.success || !result.data.success) return false;

			if (secretKey === passingTestSecretKey) return true;

			const { hostname } = result.data;

			if (hostname === undefined || !hostnames.includes(hostname)) return false;

			return action === undefined || result.data.action === action;
		},
	};
}
