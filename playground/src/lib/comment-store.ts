/* eslint-disable unicorn/no-null -- D1 answers and takes `null`, so the binding over SQLite must too */
import type { D1Binding } from '@xsynaptic/astro-comments/cloudflare';

import { createD1CommentStore } from '@xsynaptic/astro-comments/cloudflare';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

type Bound = Array<null | number | string>;

export const playgroundThread = 'posts/hello';

export const approvedParentId = 'seeded';

export const pendingParentId = 'waiting';

const database = new DatabaseSync(':memory:');

database.exec(
	readFileSync(
		createRequire(import.meta.url).resolve('@xsynaptic/astro-comments/migrations/0000-initial.sql'),
		'utf8',
	),
);

for (const [id, status] of [
	[approvedParentId, 'approved'],
	[pendingParentId, 'pending'],
] as const) {
	database
		.prepare(
			`INSERT INTO comments (id, thread, author, body, status, created_at) VALUES (?, ?, 'Seeded reader', ?, ?, 1577836800)`,
		)
		.run(id, playgroundThread, `A seeded ${status} comment.`, status);
}

database
	.prepare(
		`INSERT INTO comments (id, thread, parent_id, author, author_url, body, status, created_at) VALUES ('seeded-reply', ?, ?, 'Seeded replier', 'https://example.com/', 'A seeded reply.', 'approved', 1577840400)`,
	)
	.run(playgroundThread, approvedParentId);

function statement(sql: string, values: Bound = []): ReturnType<D1Binding['prepare']> {
	const prepared = database.prepare(sql);

	return {
		all: () => Promise.resolve({ results: prepared.all(...values) }),
		bind: (...bound) => statement(sql, bound),
		first: () => Promise.resolve(prepared.get(...values) ?? null),
		run: () => Promise.resolve({ meta: { changes: Number(prepared.run(...values).changes) } }),
	};
}

export const commentStore = createD1CommentStore({ prepare: (sql) => statement(sql) });
