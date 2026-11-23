import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import type { ApprovedComment } from '#schemas.ts';
import type { CommentModerationStore } from '#store.ts';

import { readCommentsByThread, writeCommentsSnapshot } from '#snapshot/snapshot.ts';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'astro-comments-snapshot-'));
});

afterEach(async () => {
	await rm(directory, { recursive: true });
});

function approved(id: string, thread: string): ApprovedComment {
	return { author: 'Reader', body: 'A comment.', createdAt: 1, id, isOwner: false, thread };
}

test('writes what a build reads back by thread, into a directory it creates, leaving no temporary file', async () => {
	const rows = [approved('a', 'posts/one'), approved('b', 'posts/two'), approved('c', 'posts/one')];
	const store: CommentModerationStore = {
		deleteComment: () => Promise.resolve(undefined),
		getComment: () => Promise.resolve(undefined),
		listApproved: () => Promise.resolve(rows),
		listPending: () => Promise.resolve([]),
		setOwner: () => Promise.resolve(0),
		setStatus: () => Promise.resolve(0),
	};
	const filePath = path.join(directory, 'cache', 'approved-local.json');

	const tally = await writeCommentsSnapshot(store, filePath);

	expect(tally).toEqual({ approved: 3, pending: 0 });
	expect(Object.fromEntries(await readCommentsByThread(filePath))).toEqual({
		'posts/one': [rows[0], rows[2]],
		'posts/two': [rows[1]],
	});
	expect(await readdir(path.dirname(filePath))).toEqual(['approved-local.json']);
});
