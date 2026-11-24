/* eslint-disable unicorn/no-null -- D1 answers and takes `null`, so the binding over SQLite must too */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { D1Binding } from '#cloudflare/d1-store.ts';

import { createD1CommentStore } from '#cloudflare/d1-store.ts';

const schema = readFileSync(
	path.join(import.meta.dirname, '../../migrations/0000-initial.sql'),
	'utf8',
);

const insertRow = `INSERT INTO comments (id, thread, parent_id, author, author_email, is_owner, body, status, source, created_at)
VALUES (?, ?, ?, 'Reader', ?, ?, 'An old comment.', ?, 'wordpress', ?)`;

let database: DatabaseSync;

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	database.exec(schema);
});

afterEach(() => {
	database.close();
});

function createBinding(): D1Binding {
	type Binding = Array<null | number | string>;
	function statement(sql: string, values: Binding = []): ReturnType<D1Binding['prepare']> {
		const prepared = database.prepare(sql);

		return {
			all: () => Promise.resolve({ results: prepared.all(...values) }),
			bind: (...bound) => statement(sql, bound),
			first: () => Promise.resolve(prepared.get(...values) ?? null),
			run: () => Promise.resolve({ meta: { changes: Number(prepared.run(...values).changes) } }),
		};
	}

	return { prepare: (sql) => statement(sql) };
}

function seed(
	rows: Array<{ createdAt?: number; email?: string; id: string; status: string; thread?: string }>,
): void {
	for (const row of rows) {
		database
			.prepare(insertRow)
			.run(
				row.id,
				row.thread ?? 'mixes/voyager',
				null,
				row.email ?? null,
				0,
				row.status,
				row.createdAt ?? 1_577_836_800,
			);
	}
}

describe('the write path', () => {
	test("finds an approved parent's thread, and nothing for any other status", async () => {
		seed([
			{ id: 'approved', status: 'approved', thread: 'mixes/other' },
			{ id: 'pending', status: 'pending' },
			{ id: 'spam', status: 'spam' },
		]);

		const store = createD1CommentStore(createBinding());

		await expect(store.findApprovedParent('approved')).resolves.toBe('mixes/other');
		await expect(store.findApprovedParent('pending')).resolves.toBeUndefined();
		await expect(store.findApprovedParent('spam')).resolves.toBeUndefined();
		await expect(store.findApprovedParent('missing')).resolves.toBeUndefined();
	});

	test("inserts a pending web comment, never the Owner's, with SQL NULL for every absent field", async () => {
		await createD1CommentStore(createBinding()).insert({
			author: 'Reader',
			body: 'A comment worth keeping.',
			createdAt: 1_763_899_200,
			id: 'k7d2mqzx4a',
			thread: 'mixes/voyager',
		});

		expect(database.prepare('SELECT * FROM comments').all()).toEqual([
			{
				author: 'Reader',
				author_email: null,
				author_url: null,
				body: 'A comment worth keeping.',
				created_at: 1_763_899_200,
				email_hash: null,
				id: 'k7d2mqzx4a',
				ip_hash: null,
				is_owner: 0,
				parent_id: null,
				source: 'web',
				status: 'pending',
				thread: 'mixes/voyager',
			},
		]);
	});

	test('writes each field to its own column', async () => {
		await createD1CommentStore(createBinding()).insert({
			author: 'Reader',
			authorEmail: 'reader@example.test',
			authorUrl: 'https://example.test/',
			body: 'A reply.',
			createdAt: 1_763_899_200,
			emailHash: 'email-hash',
			id: 'k7d2mqzx4a',
			ipHash: 'ip-hash',
			parentId: 'wp-1',
			thread: 'posts/a-post',
		});

		expect(database.prepare('SELECT * FROM comments').get()).toMatchObject({
			author_email: 'reader@example.test',
			author_url: 'https://example.test/',
			email_hash: 'email-hash',
			ip_hash: 'ip-hash',
			parent_id: 'wp-1',
			thread: 'posts/a-post',
		});
	});

	test('counts recent comments from one IP hash in every status, and only those', async () => {
		const insert = database.prepare(
			`INSERT INTO comments (id, thread, author, body, status, created_at, ip_hash) VALUES (?, 'mixes/voyager', 'Reader', 'Hi.', ?, ?, ?)`,
		);

		for (const [id, status, createdAt, ipHash] of [
			['approved', 'approved', 2000, 'visitor'],
			['pending', 'pending', 2001, 'visitor'],
			['rejected', 'rejected', 2002, 'visitor'],
			['spam', 'spam', 2003, 'visitor'],
			['too-old', 'pending', 1000, 'visitor'],
			['someone-else', 'pending', 2004, 'other'],
		] as const) {
			insert.run(id, status, createdAt, ipHash);
		}

		await expect(
			createD1CommentStore(createBinding()).countRecentComments('visitor', 1500),
		).resolves.toBe(4);
	});

	test('counts recent comments through the status index rather than a table scan', async () => {
		let countSql = '';
		const store = createD1CommentStore({
			prepare(sql) {
				countSql = sql;

				return createBinding().prepare(sql);
			},
		});

		await store.countRecentComments('visitor', 0);

		const plan = database.prepare(`EXPLAIN QUERY PLAN ${countSql}`).all(0, 'visitor');

		expect(plan.map((step) => step.detail).join(' ')).toContain('USING INDEX comments_status');
	});
});

describe('moderation', () => {
	test('lists pending comments oldest first, leaving absent fields out', async () => {
		seed([
			{ createdAt: 20, id: 'newer', status: 'pending' },
			{ createdAt: 10, email: 'reader@example.test', id: 'older', status: 'pending' },
			{ createdAt: 5, id: 'decided', status: 'approved' },
		]);

		const pending = await createD1CommentStore(createBinding()).listPending();

		expect(pending.map((comment) => comment.id)).toEqual(['older', 'newer']);
		expect(pending[0]).toEqual({
			author: 'Reader',
			authorEmail: 'reader@example.test',
			body: 'An old comment.',
			createdAt: 10,
			id: 'older',
			isOwner: false,
			source: 'wordpress',
			status: 'pending',
			thread: 'mixes/voyager',
		});
	});

	test('lists only approved comments, grouped by thread in date order, ties by id', async () => {
		seed([
			{ createdAt: 20, id: 'b-late', status: 'approved', thread: 'mixes/b' },
			{ createdAt: 10, id: 'b-early-2', status: 'approved', thread: 'mixes/b' },
			{ createdAt: 10, id: 'b-early-1', status: 'approved', thread: 'mixes/b' },
			{ createdAt: 30, id: 'a', status: 'approved', thread: 'mixes/a' },
			{ createdAt: 1, id: 'held', status: 'pending', thread: 'mixes/a' },
		]);

		const approved = await createD1CommentStore(createBinding()).listApproved();

		expect(approved.map((comment) => comment.id)).toEqual([
			'a',
			'b-early-1',
			'b-early-2',
			'b-late',
		]);
	});

	test('answers an approved comment in the render shape, with no private column', async () => {
		database.exec(`INSERT INTO comments (id, thread, parent_id, author, author_email, author_url, email_hash, is_owner, body, status, source, created_at, ip_hash)
VALUES ('wp-2', 'mixes/voyager', 'wp-1', 'Basilisk', 'owner@example.test', 'https://example.test/', 'a-hash', 1, 'Thanks.', 'approved', 'wordpress', 1577836800, 'ip-hash')`);

		await expect(
			createD1CommentStore(createBinding(), { publishEmailHash: true }).listApproved(),
		).resolves.toEqual([
			{
				author: 'Basilisk',
				authorUrl: 'https://example.test/',
				body: 'Thanks.',
				createdAt: 1_577_836_800,
				emailHash: 'a-hash',
				id: 'wp-2',
				isOwner: true,
				parentId: 'wp-1',
				thread: 'mixes/voyager',
			},
		]);
	});

	test('leaves the email hash out of approved comments unless told to publish it', async () => {
		database.exec(`INSERT INTO comments (id, thread, author, email_hash, body, status, created_at)
VALUES ('hashed', 'mixes/voyager', 'Reader', 'a-hash', 'Hello.', 'approved', 1577836800)`);

		const [comment] = await createD1CommentStore(createBinding()).listApproved();

		expect(comment).not.toHaveProperty('emailHash');
	});

	test('sets the status of every id it is given, past the bound parameter cap, and counts them', async () => {
		const ids = Array.from({ length: 150 }, (_, index) => `id-${String(index)}`);

		seed(ids.map((id) => ({ id, status: 'pending' })));

		const store = createD1CommentStore(createBinding());

		await expect(store.setStatus([...ids, 'missing'], 'spam')).resolves.toBe(150);
		expect(
			database.prepare(`SELECT COUNT(*) AS count FROM comments WHERE status = 'spam'`).get(),
		).toEqual({
			count: 150,
		});
	});

	test('drops the IP hash of a decided comment, and keeps it on one still pending', async () => {
		const insert = database.prepare(
			`INSERT INTO comments (id, thread, author, body, status, created_at, ip_hash) VALUES (?, 'mixes/voyager', 'Reader', 'Hi.', 'pending', 1, 'visitor')`,
		);

		for (const id of ['approved', 'rejected', 'spam', 'requeued', 'untouched']) insert.run(id);

		const store = createD1CommentStore(createBinding());

		await store.setStatus(['approved'], 'approved');
		await store.setStatus(['rejected'], 'rejected');
		await store.setStatus(['spam'], 'spam');
		await store.setStatus(['requeued'], 'pending');

		expect(database.prepare('SELECT id, ip_hash FROM comments ORDER BY id').all()).toEqual([
			{ id: 'approved', ip_hash: null },
			{ id: 'rejected', ip_hash: null },
			{ id: 'requeued', ip_hash: 'visitor' },
			{ id: 'spam', ip_hash: null },
			{ id: 'untouched', ip_hash: 'visitor' },
		]);
	});

	test('deletes one comment and answers the row it removed', async () => {
		seed([
			{ id: 'gone', status: 'approved' },
			{ id: 'kept', status: 'pending' },
		]);

		const store = createD1CommentStore(createBinding());

		await expect(store.deleteComment('gone')).resolves.toMatchObject({
			id: 'gone',
			status: 'approved',
		});
		await expect(store.deleteComment('gone')).resolves.toBeUndefined();
		await expect(store.getComment('gone')).resolves.toBeUndefined();
		await expect(store.getComment('kept')).resolves.toMatchObject({ status: 'pending' });
	});
});
