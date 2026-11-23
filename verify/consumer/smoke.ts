#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { styleText } from 'node:util';

interface Run {
	status: null | number;
	stderr: string;
	stdout: string;
}

const repository = path.resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8')) as {
	exports: Record<string, unknown>;
	name: string;
};
const browserEntries = new Set(['./cloudflare/widget', './element']);
const entries = Object.keys(manifest.exports).filter((entry) => !entry.includes('*'));
const owner = 'owner@example.test';
const project = mkdtempSync(path.join(tmpdir(), 'astro-comments-consumer-'));

function run(command: string, args: Array<string>, cwd = project): Run {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function check(label: string, result: Run, isPassing: (result: Run) => boolean): void {
	if (isPassingSafely(result, isPassing)) {
		console.log(`${styleText('green', '✓')} ${label}`);
		return;
	}

	console.error(`${styleText('red', '✗')} ${label}\n${result.stdout}${result.stderr}`);
	console.error(styleText('dim', `Kept ${project} for a look`));
	process.exit(1);
}

// Output a check cannot parse is a failure to report, not a crash
function isPassingSafely(result: Run, isPassing: (result: Run) => boolean): boolean {
	try {
		return isPassing(result);
	} catch {
		return false;
	}
}

// Go-to-definition follows these into the shipped source
function findUnshippedDeclarationSources(): Run {
	const dist = path.join(project, 'node_modules', manifest.name, 'dist');
	const maps = readdirSync(dist).filter((file) => file.endsWith('.d.mts.map'));
	const missing = maps.flatMap((file) => {
		const { sources } = JSON.parse(readFileSync(path.join(dist, file), 'utf8')) as {
			sources: Array<string>;
		};

		return sources.filter((source) => !existsSync(path.resolve(dist, source)));
	});

	return {
		status: maps.length > 0 && missing.length === 0 ? 0 : 1,
		stderr: '',
		stdout: missing.join('\n'),
	};
}

function isSuccessful(result: Run): boolean {
	return result.status === 0;
}

function bin(...args: Array<string>): Run {
	return run(path.join(project, 'node_modules/.bin/astro-comments'), [...args, '--local']);
}

// Pinned to what this repository installed, so the pnpm store answers without the network
function installedVersion(name: string): string {
	const require = createRequire(path.join(repository, 'package.json'));

	return (
		JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }
	).version;
}

function write(file: string, contents: string): void {
	mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
	writeFileSync(path.join(project, file), contents);
}

function readSnapshot(): Array<{ id: string; isOwner: boolean }> {
	const file = path.join(project, 'node_modules/.cache/comments/approved-local.json');

	return (
		JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<{ id: string; isOwner: boolean }> }
	).rows;
}

function writeTypeCheck(name: string, entryNames: Array<string>, lib: Array<string>): void {
	write(
		`${name}.ts`,
		entryNames
			.map(
				(entry, index) =>
					`export * as entry${String(index)} from '${manifest.name}${entry.slice(1)}';`,
			)
			.join('\n'),
	);
	write(
		`tsconfig.${name}.json`,
		JSON.stringify({
			compilerOptions: {
				exactOptionalPropertyTypes: true,
				lib,
				module: 'nodenext',
				noEmit: true,
				skipLibCheck: false,
				strict: true,
				target: 'es2024',
				types: lib.includes('dom') ? [] : ['node'],
			},
			files: [`${name}.ts`],
		}),
	);
}

check('builds the package', run('pnpm', ['build'], repository), isSuccessful);
check(
	'packs the tarball',
	run('pnpm', ['pack', '--pack-destination', project], repository),
	isSuccessful,
);

const tarball = readdirSync(project).find((file) => file.endsWith('.tgz'));

write(
	'package.json',
	JSON.stringify({
		dependencies: {
			'@types/node': installedVersion('@types/node'),
			[manifest.name]: `file:./${String(tarball)}`,
			typescript: installedVersion('typescript'),
			wrangler: installedVersion('wrangler'),
		},
		private: true,
		type: 'module',
	}),
);
write('pnpm-workspace.yaml', 'allowBuilds:\n  esbuild: true\n  workerd: true\n');
check('installs the tarball', run('pnpm', ['install', '--prefer-offline']), isSuccessful);
check('maps every declaration to shipped source', findUnshippedDeclarationSources(), isSuccessful);

writeTypeCheck(
	'server',
	entries.filter((entry) => !browserEntries.has(entry)),
	['es2024'],
);
writeTypeCheck('browser', [...browserEntries], ['es2024', 'dom']);
check(
	'type-checks the server entries without DOM types',
	run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.server.json']),
	isSuccessful,
);
check(
	'type-checks the browser entries',
	run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.browser.json']),
	isSuccessful,
);

write(
	'import-all.mjs',
	entries.map((entry) => `await import('${manifest.name}${entry.slice(1)}');`).join('\n'),
);
check('imports every entry in Node', run('node', ['import-all.mjs']), isSuccessful);

write(
	'wrangler.jsonc',
	JSON.stringify({
		compatibility_date: '2026-11-01',
		d1_databases: [
			{
				binding: 'DB',
				database_id: 'local',
				database_name: 'comments',
				migrations_dir: 'migrations',
			},
		],
		name: 'consumer',
	}),
);
write(
	'astro-comments.config.ts',
	`import { defineCommentsConfig } from '${manifest.name}/config';

export default defineCommentsConfig({
	d1: { local: { binding: 'DB', configPath: 'wrangler.jsonc' }, remote: {} },
	ownerEmails: ['${owner}'],
	snapshotDirectory: 'node_modules/.cache/comments',
	threadRegistry: 'dist/comment-threads.json',
});
`,
);
write('dist/comment-threads.json', JSON.stringify({ 'posts/hello': { path: '/hello/' } }));
mkdirSync(path.join(project, 'migrations'));

check(
	'prints the usage for --help',
	bin('--help'),
	(result) => isSuccessful(result) && result.stdout.includes('approve <id...>'),
);
check(
	'writes the schema migration',
	run(path.join(project, 'node_modules/.bin/astro-comments'), ['schema', 'migrations']),
	isSuccessful,
);
check(
	'applies it to the local D1',
	run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']),
	isSuccessful,
);
check(
	'seeds pending comments',
	run('pnpm', [
		'exec',
		'wrangler',
		'd1',
		'execute',
		'DB',
		'--local',
		'--command',
		`INSERT INTO comments (id, thread, author, author_email, body, created_at) VALUES ('mine', 'posts/hello', 'Owner', '${owner}', 'From the site.', 1), ('theirs', 'posts/gone', 'Reader', NULL, 'From a reader.', 2), ('junk', 'posts/hello', 'Bot', NULL, 'Buy now.', 3);`,
	]),
	isSuccessful,
);

check(
	'lists the queue as JSON on stdout alone, flagging the owner candidate',
	bin('pending', '--json'),
	(result) => {
		const rows = JSON.parse(result.stdout) as Array<{ id: string; isOwnerCandidate: boolean }>;

		return (
			isSuccessful(result) &&
			rows.map((row) => `${row.id}:${String(row.isOwnerCandidate)}`).join(',') ===
				'mine:true,theirs:false,junk:false'
		);
	},
);
check(
	'approves by id, the candidate as the Owner, and pulls',
	bin('approve', 'mine', 'theirs'),
	(result) => {
		const snapshot = readSnapshot();

		return (
			isSuccessful(result) &&
			snapshot.length === 2 &&
			snapshot.find((row) => row.id === 'mine')?.isOwner === true
		);
	},
);
check('marks spam by id', bin('spam', 'junk'), isSuccessful);
check(
	'refuses to decide a comment twice',
	bin('reject', 'junk'),
	(result) => result.status === 1 && result.stderr.includes('already spam'),
);
check(
	'reports the orphaned thread',
	bin('orphans'),
	(result) => isSuccessful(result) && result.stdout.includes('posts/gone'),
);
check(
	'refuses delete without --yes and a terminal',
	bin('delete', 'theirs'),
	(result) => result.status === 1 && result.stderr.includes('--yes'),
);
check(
	'deletes with --yes and pulls',
	bin('delete', 'theirs', '--yes'),
	(result) => isSuccessful(result) && readSnapshot().length === 1,
);
check(
	'pulls',
	bin('pull'),
	(result) => isSuccessful(result) && result.stdout.includes('1 approved comment'),
);

rmSync(project, { recursive: true });
