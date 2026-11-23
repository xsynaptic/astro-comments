import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { loadCommentsConfig } from '#cli/config.ts';

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'astro-comments-config-'));
});

afterEach(async () => {
	await rm(directory, { recursive: true });
});

test("resolves the config's paths against its own directory, not the working one", async () => {
	await writeFile(
		path.join(directory, 'astro-comments.config.ts'),
		`export default {
			d1: { local: { binding: 'DB', configPath: 'wrangler.jsonc' }, remote: {} },
			snapshotDirectory: 'node_modules/.cache/comments',
			threadRegistry: '../shared/comment-threads.json',
		};`,
	);

	const config = await loadCommentsConfig(directory);

	expect(config.d1.local.configPath).toBe(path.join(directory, 'wrangler.jsonc'));
	expect(config.snapshotDirectory).toBe(path.join(directory, 'node_modules/.cache/comments'));
	expect(config.threadRegistry).toBe(path.resolve(directory, '../shared/comment-threads.json'));
});
