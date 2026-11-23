import type { CommentChallenge } from '#submission.ts';

export interface TurnstileChallengeOptions {
	timeoutMs?: number;
}

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const turnstileTokenField = 'cf-turnstile-response';

export function createTurnstileChallenge(
	secretKey: string,
	{ timeoutMs = 10_000 }: TurnstileChallengeOptions = {},
): CommentChallenge {
	return {
		tokenField: turnstileTokenField,
		async verify(token, remoteIp) {
			const body = new FormData();

			body.append('secret', secretKey);
			body.append('response', token);

			if (remoteIp) body.append('remoteip', remoteIp);

			// A Worker waits on a hung fetch for as long as the visitor stays connected
			const response = await fetch(siteverifyUrl, {
				body,
				method: 'POST',
				signal: AbortSignal.timeout(timeoutMs),
			});

			// An outage is a 500, not a visitor who failed the challenge
			if (!response.ok) throw new Error(`Turnstile siteverify answered ${String(response.status)}`);

			return isSuccess(await response.json());
		},
	};
}

function isSuccess(result: unknown): boolean {
	return (
		typeof result === 'object' && result !== null && 'success' in result && result.success === true
	);
}
