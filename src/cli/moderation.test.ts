import { expect, test } from 'vitest';

import type { CommentModerationStore, CommentStatus, StoredComment } from '#store.ts';

import { decideComments } from '#cli/moderation.ts';

const owner = 'owner@example.test';

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
		ownerEmails: [owner],
	});
	await decideComments(store, {
		decision: 'rejected',
		ids: ['rejected-mine'],
		ownerEmails: [owner],
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
		ownerEmails: [],
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
