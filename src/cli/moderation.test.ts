import { expect, test } from 'vitest';

import type { CommentModerationStore, CommentStatus, StoredComment } from '#store.ts';

import { createOwnerCheck, decideComments } from '#cli/moderation.ts';
import { createThreadResolver } from '#registry.ts';

const owner = 'owner@example.test';

const isSiteOwnerCandidate = createOwnerCheck(
	{ basilisk: [owner] },
	createThreadResolver(() => Promise.resolve({ 'mixes/voyager': { path: '/mixes/voyager/' } })),
);

const isNoOwnerCandidate = createOwnerCheck(
	{},
	createThreadResolver(() => Promise.resolve({})),
);

function pendingOn(thread: string, authorEmail?: string): StoredComment {
	return {
		author: 'Reader',
		body: 'A comment.',
		createdAt: 1,
		id: 'pending',
		isOwner: false,
		source: 'web',
		status: 'pending',
		thread,
		...(authorEmail === undefined ? undefined : { authorEmail }),
	};
}

function createStore(
	rows: Array<{ email?: string; id: string; status?: CommentStatus }>,
): CommentModerationStore & { comments: Array<StoredComment> } {
	const comments: Array<StoredComment> = rows.map(({ email, id, status = 'pending' }, index) => ({
		author: 'Reader',
		body: 'A comment.',
		createdAt: index,
		id,
		isOwner: false,
		source: 'web',
		status,
		thread: 'mixes/voyager',
		...(email === undefined ? undefined : { authorEmail: email }),
	}));

	function update(ids: Array<string>, change: Partial<StoredComment>): Promise<number> {
		const matched = comments.filter((comment) => ids.includes(comment.id));

		for (const comment of matched) Object.assign(comment, change);

		return Promise.resolve(matched.length);
	}

	return {
		comments,
		deleteComment: () => Promise.resolve(undefined),
		getComment: (id) => Promise.resolve(comments.find((comment) => comment.id === id)),
		listApproved: () => Promise.resolve([]),
		listPending: () => Promise.resolve(comments.filter((comment) => comment.status === 'pending')),
		setOwner: (ids, isOwner) => update(ids, { isOwner }),
		setStatus: (ids, status) => update(ids, { status }),
	};
}

test('approving an owner candidate by id makes it the Owner, and only on approval', async () => {
	const store = createStore([
		{ email: ' Owner@Example.test ', id: 'mine' },
		{ email: owner, id: 'rejected-mine' },
		{ id: 'theirs' },
	]);

	await decideComments(store, {
		decision: 'approved',
		ids: ['mine', 'theirs'],
		isOwnerCandidate: isSiteOwnerCandidate,
	});
	await decideComments(store, {
		decision: 'rejected',
		ids: ['rejected-mine'],
		isOwnerCandidate: isSiteOwnerCandidate,
	});

	expect(store.comments.map(({ id, isOwner, status }) => ({ id, isOwner, status }))).toEqual([
		{ id: 'mine', isOwner: true, status: 'approved' },
		{ id: 'rejected-mine', isOwner: false, status: 'rejected' },
		{ id: 'theirs', isOwner: false, status: 'approved' },
	]);
});

test('refuses an unknown id and an already decided comment, deciding the rest', async () => {
	const store = createStore([{ id: 'waiting' }, { id: 'done', status: 'spam' }]);

	const report = await decideComments(store, {
		decision: 'approved',
		ids: ['missing', 'done', 'waiting', 'waiting'],
		isOwnerCandidate: isNoOwnerCandidate,
	});

	expect(report).toEqual({
		decided: [{ id: 'waiting', isOwner: false }],
		refused: [
			{ id: 'missing', reason: 'no such comment' },
			{ id: 'done', reason: 'already spam' },
		],
	});
	expect(store.comments.find((comment) => comment.id === 'done')?.status).toBe('spam');
});

test("marks a candidate only on a page that lists the comment's owner, or lists no owners", async () => {
	const isOwnerCandidate = createOwnerCheck(
		{ basilisk: [owner], soren: ['soren@example.test', 'old@example.test'] },
		createThreadResolver(() =>
			Promise.resolve({
				'labels/y': { path: '/labels/y/' },
				'posts/closed-off': { owners: [], path: '/posts/closed-off/' },
				'releases/soren': { owners: ['soren'], path: '/releases/soren/' },
			}),
		),
	);

	expect(await isOwnerCandidate(pendingOn('releases/soren', 'Old@Example.test'))).toBe(true);
	expect(await isOwnerCandidate(pendingOn('releases/soren', owner))).toBe(false);
	expect(await isOwnerCandidate(pendingOn('labels/y', owner))).toBe(true);
	expect(await isOwnerCandidate(pendingOn('labels/y', 'soren@example.test'))).toBe(true);
	expect(await isOwnerCandidate(pendingOn('posts/closed-off', owner))).toBe(false);
	expect(await isOwnerCandidate(pendingOn('posts/unregistered', owner))).toBe(false);
});

test("reads the registry only for an owner's email, so a queue without one needs no build", async () => {
	const isOwnerCandidate = createOwnerCheck(
		{ basilisk: [owner] },
		createThreadResolver(() =>
			Promise.reject(new Error('No thread registry; build the site first')),
		),
	);

	expect(await isOwnerCandidate(pendingOn('labels/y', 'reader@example.test'))).toBe(false);
	expect(await isOwnerCandidate(pendingOn('labels/y'))).toBe(false);
	await expect(isOwnerCandidate(pendingOn('labels/y', owner))).rejects.toThrow('build the site');
});
