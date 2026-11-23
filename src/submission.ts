import { z } from 'zod';

import type { CommentMessages } from '#messages.ts';
import type { ThreadPage } from '#registry.ts';
import type { CommentStore, NewComment } from '#store.ts';

import { commentFields } from '#fields.ts';
import { defaultMessages } from '#messages.ts';
import { isThreadOpen } from '#registry.ts';
import { maximumThreadKeyLength, threadKeyPattern } from '#schemas.ts';
import { sha256 } from '#sha256.ts';

export interface CommentChallenge {
	tokenField: string;
	verify: (token: string, remoteIp: string | undefined) => Promise<boolean>;
}

export interface CommentRateLimit {
	maximumComments?: number;
	windowSeconds?: number;
}

export interface CommentSubmissionConfig {
	challenge: CommentChallenge;
	getClientIp: (request: Request) => string | undefined;
	ipSalt: string;
	messages?: Partial<CommentMessages>;
	rateLimit?: CommentRateLimit;
	// The thread's page on this site, or `undefined` when the thread does not exist
	resolveThread: (thread: string, request: Request) => Promise<ThreadPage | undefined>;
	store: CommentStore;
}

type Submission = Omit<z.infer<typeof submissionSchema>, 'challengeToken'> & {
	challengeToken: string;
};

// The client measures the time itself, so its clock is never compared with this one
const minimumFillTimeMs = 3000;

// `request.formData()` parses the whole body before the schema's 8000-character cap can apply
const maximumBodyBytes = 32_768;

// Ids are read back as the `#comment-<id>` permalink, so they stay short; 32 chars masks to 5 bits with no bias
const commentIdAlphabet = 'abcdefghijklmnopqrstuvwxyz234567';
const commentIdLength = 10;

const defaultRateLimit = { maximumComments: 5, windowSeconds: 600 } as const;

const submissionSchema = z.object({
	author: z.string().min(1).max(80),
	authorEmail: z.email().max(200).optional(),
	authorUrl: z.httpUrl().max(200).optional(),
	body: z.string().min(2).max(8000),
	challengeToken: z.string().max(2048).optional(),
	fillTimeMs: z.coerce.number().int().nonnegative(),
	parentId: z.string().min(1).max(200).optional(),
	thread: z.string().max(maximumThreadKeyLength).regex(threadKeyPattern),
});

export async function handleCommentSubmission(
	request: Request,
	config: CommentSubmissionConfig,
): Promise<Response> {
	// A mount without this would read a GET's missing body as an oversized one
	if (request.method !== 'POST') {
		return new Response(undefined, { headers: { allow: 'POST' }, status: 405 });
	}

	const messages = { ...defaultMessages, ...config.messages };

	try {
		return await processSubmission(request, config, messages);
	} catch (error) {
		console.error(error);

		return reject(500, messages.unexpected);
	}
}

function createCommentId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(commentIdLength));

	return [...bytes].map((byte) => commentIdAlphabet.charAt(byte & 31)).join('');
}

// A missing header rejects too: a body of unknown size cannot be capped before it is parsed
function isBodySizeAcceptable(request: Request): boolean {
	const contentLength = Number(request.headers.get('content-length'));

	return (
		Number.isSafeInteger(contentLength) && contentLength > 0 && contentLength <= maximumBodyBytes
	);
}

async function isOverRateLimit(
	store: CommentStore,
	ipHash: string,
	{ maximumComments, windowSeconds }: Required<CommentRateLimit>,
): Promise<boolean> {
	const since = Math.floor(Date.now() / 1000) - windowSeconds;

	return (await store.countRecentComments(ipHash, since)) >= maximumComments;
}

// A parent under a former key of the same page still counts, so a renamed entry's old comments stay answerable
async function isValidParent(
	submission: Submission,
	threadPath: string,
	{ config, request }: { config: CommentSubmissionConfig; request: Request },
): Promise<boolean> {
	if (submission.parentId === undefined) return true;

	const parentThread = await config.store.findApprovedParent(submission.parentId);

	if (parentThread === undefined) return false;

	if (parentThread === submission.thread) return true;

	const parentPage = await config.resolveThread(parentThread, request);

	return parentPage?.path === threadPath;
}

async function processSubmission(
	request: Request,
	config: CommentSubmissionConfig,
	messages: CommentMessages,
): Promise<Response> {
	// A falsy salt hashes every IP against a constant, which is brute-forceable
	if (!config.ipSalt) throw new Error('The comment IP salt is not set');

	const submission = await readSubmission(request, config.challenge.tokenField, messages);

	if (submission instanceof Response) return submission;

	const page = await config.resolveThread(submission.thread, request);

	if (page === undefined) return reject(400, messages.threadMissing);

	if (!isThreadOpen(page)) return reject(403, messages.closed);

	if (!(await isValidParent(submission, page.path, { config, request })))
		return reject(400, messages.parentMissing);

	const remoteIp = config.getClientIp(request);
	const ipHash = remoteIp ? await sha256(`${config.ipSalt}${remoteIp}`) : undefined;
	const rateLimit = { ...defaultRateLimit, ...config.rateLimit };

	// Counts stored comments rather than attempts, so a failed challenge spends no one's allowance and this can run first
	if (ipHash !== undefined && (await isOverRateLimit(config.store, ipHash, rateLimit))) {
		return reject(429, messages.tooMany, {
			'retry-after': String(rateLimit.windowSeconds),
		});
	}

	// Last, after the local checks: a challenge may be a network round trip, and a rejected request burns a single-use token
	if (!(await config.challenge.verify(submission.challengeToken, remoteIp))) {
		return reject(403, messages.challenge);
	}

	await config.store.insert(await toNewComment(submission, ipHash));

	return new Response(undefined, { status: 201 });
}

// Empty and whitespace-only fields read as absent, so an untouched optional input is not a validation error
function readField(form: FormData, name: string): string | undefined {
	const value = form.get(name);

	if (typeof value !== 'string') return undefined;

	const trimmed = value.trim();

	return trimmed === '' ? undefined : trimmed;
}

async function readFormData(request: Request): Promise<FormData | undefined> {
	try {
		return await request.formData();
	} catch {
		return undefined;
	}
}

// Local only, so a rejection here never spends a network call or a single-use token
async function readSubmission(
	request: Request,
	challengeField: string,
	messages: CommentMessages,
): Promise<Response | Submission> {
	if (!isBodySizeAcceptable(request)) return reject(413, messages.tooLarge);

	const form = await readFormData(request);

	if (!form) return reject(400, messages.unreadable);

	// Answered as `invalid`, so a bot cannot tell the trap from a schema failure
	if (readField(form, commentFields.honeypot) !== undefined) return reject(400, messages.invalid);

	const parsed = submissionSchema.safeParse({
		author: readField(form, commentFields.author),
		authorEmail: readField(form, commentFields.authorEmail),
		authorUrl: readField(form, commentFields.authorUrl),
		body: readField(form, commentFields.body),
		challengeToken: readField(form, challengeField),
		fillTimeMs: readField(form, commentFields.fillTimeMs),
		parentId: readField(form, commentFields.parentId),
		thread: readField(form, commentFields.thread),
	});

	if (!parsed.success) return reject(400, messages.invalid);

	if (parsed.data.fillTimeMs < minimumFillTimeMs) return reject(400, messages.tooFast);

	const { challengeToken, ...fields } = parsed.data;

	// Usually a widget that never finished or never loaded, which the challenge message explains better than `invalid`
	if (challengeToken === undefined) return reject(403, messages.challenge);

	return { ...fields, challengeToken };
}

function reject(status: number, message: string, headers: Record<string, string> = {}): Response {
	return Response.json({ message }, { headers, status });
}

async function toNewComment(
	submission: Submission,
	ipHash: string | undefined,
): Promise<NewComment> {
	const comment: NewComment = {
		author: submission.author,
		body: submission.body,
		createdAt: Math.floor(Date.now() / 1000),
		id: createCommentId(),
		thread: submission.thread,
	};

	if (submission.authorEmail !== undefined) {
		comment.authorEmail = submission.authorEmail;
		comment.emailHash = await sha256(submission.authorEmail.toLowerCase());
	}

	if (submission.authorUrl !== undefined) comment.authorUrl = submission.authorUrl;

	if (submission.parentId !== undefined) comment.parentId = submission.parentId;

	if (ipHash !== undefined) comment.ipHash = ipHash;

	return comment;
}
