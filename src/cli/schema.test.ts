import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { writeSchemaMigration } from '#cli/schema.ts';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'astro-comments-schema-'));
});

afterEach(async () => {
	await rm(directory, { recursive: true });
});

test('writes a marked migration after the highest number, and it builds the table', async () => {
	await writeFile(path.join(directory, '0007_stats.sql'), 'CREATE TABLE listens (id TEXT);');

	const written = await writeSchemaMigration(directory);
	const sql = await readFile(written, 'utf8');
	const database = new DatabaseSync(':memory:');

	database.exec(sql);

	expect(path.basename(written)).toBe('0008_astro_comments.sql');
	expect(sql.split('\n', 1)[0]).toBe('-- @xsynaptic/astro-comments 0000-initial');
	expect(database.prepare(`SELECT count(*) AS total FROM comments`).get()).toEqual({ total: 0 });
});

test('refuses a folder holding its own earlier output', async () => {
	await writeSchemaMigration(directory);

	await expect(writeSchemaMigration(directory)).rejects.toThrow(
		'already creates the comments table',
	);
	expect(await readdir(directory)).toHaveLength(1);
});

test('refuses a folder whose unmarked migration creates the table', async () => {
	await writeFile(
		path.join(directory, '0001-comments.sql'),
		'create table if not exists "comments" (id TEXT);',
	);

	await expect(writeSchemaMigration(directory)).rejects.toThrow(
		'already creates the comments table',
	);
	expect(await readdir(directory)).toEqual(['0001-comments.sql']);
});

test('refuses a folder that does not exist, rather than creating it', async () => {
	const missing = path.join(directory, 'migrations');

	await expect(writeSchemaMigration(missing)).rejects.toThrow(`${missing} does not exist`);
	expect(await readdir(directory)).toEqual([]);
});
