import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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

function storeOf(rows: Array<ApprovedComment>): CommentModerationStore {
	return {
		deleteComment: () => Promise.resolve(undefined),
		getComment: () => Promise.resolve(undefined),
		listApproved: () => Promise.resolve(rows),
		listPending: () => Promise.resolve([]),
		setOwner: () => Promise.resolve(0),
		setStatus: () => Promise.resolve(0),
	};
}

test('writes what a build reads back by thread, into a directory it creates, leaving no temporary file', async () => {
	const rows = [approved('a', 'posts/one'), approved('b', 'posts/two'), approved('c', 'posts/one')];
	const filePath = path.join(directory, 'cache', 'approved-local.json');

	const tally = await writeCommentsSnapshot(storeOf(rows), filePath);

	expect(tally).toEqual({ approved: 3, pending: 0 });
	expect(Object.fromEntries(await readCommentsByThread(filePath))).toEqual({
		'posts/one': [rows[0], rows[2]],
		'posts/two': [rows[1]],
	});
	expect(await readdir(path.dirname(filePath))).toEqual(['approved-local.json']);
});

test('writes one row per line, so an approval between pulls adds its own line and changes no other row', async () => {
	const filePath = path.join(directory, 'approved-remote.json');
	const first = approved('a', 'posts/one');
	const added = approved('b', 'posts/one');
	const last = approved('c', 'posts/two');

	async function rowLines(rows: Array<ApprovedComment>): Promise<Array<string>> {
		await writeCommentsSnapshot(storeOf(rows), filePath);

		const contents = await readFile(filePath, 'utf8');

		return contents.split('\n').slice(1);
	}

	const linesBefore = await rowLines([first, last]);
	const linesAfter = await rowLines([first, added, last]);

	expect(linesAfter.filter((line) => !linesBefore.includes(line))).toEqual([
		`${JSON.stringify(added)},`,
	]);
	expect(linesBefore.filter((line) => !linesAfter.includes(line))).toEqual([]);
});
