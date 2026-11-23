#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface PackageManifest {
	name: string;
	version: string;
}

// Everything the tarball is built or copied from
const releasePaths = [
	'.changeset',
	'LICENSE',
	'README.md',
	'migrations',
	'package.json',
	'pnpm-lock.yaml',
	'src',
	'tsconfig.base.json',
	'tsdown.config.ts',
];

function run(command: string, args: Array<string>) {
	const result = spawnSync(command, args, { stdio: 'inherit' });

	if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command: string, args: Array<string>) {
	return spawnSync(command, args, { encoding: 'utf8' });
}

function runQuietly(script: string) {
	const logDirectory = mkdtempSync(path.join(tmpdir(), 'release-'));
	const logPath = path.join(logDirectory, 'output.log');
	const logFile = openSync(logPath, 'w');
	const startedAt = performance.now();

	process.stdout.write(`pnpm ${script}… `);

	// One descriptor for both streams keeps the log in the order the child wrote it
	const result = spawnSync('pnpm', [script], { stdio: ['ignore', logFile, logFile] });

	closeSync(logFile);

	const output = readFileSync(logPath, 'utf8');
	const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

	rmSync(logDirectory, { recursive: true });

	if (result.status !== 0) {
		console.log(`failed after ${seconds}s\n`);
		process.stdout.write(output);
		process.exit(result.status ?? 1);
	}

	console.log(`done in ${seconds}s`);
}

function exitWith(message: string): never {
	console.error(message);
	process.exit(1);
}

async function isPublished({ name, version }: PackageManifest) {
	const response = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
		method: 'HEAD',
		signal: AbortSignal.timeout(10_000),
	});

	if (response.status === 404) return false;
	if (!response.ok)
		throw new Error(`npm registry answered ${String(response.status)} for ${name}@${version}`);

	return true;
}

function hasRemoteTag(tag: string) {
	const result = capture('git', ['ls-remote', '--tags', '--refs', 'origin', `refs/tags/${tag}`]);

	if (result.status !== 0) exitWith(`Could not list tags on origin:\n${result.stderr}`);

	return result.stdout.trim() !== '';
}

const branch = capture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim();

// A publish from any other branch lands on npm and then fails to push
if (branch !== 'main') exitWith(`Release from main; HEAD is ${branch || 'detached'}`);

const uncommitted = capture('git', [
	'status',
	'--porcelain',
	'--',
	...releasePaths,
]).stdout.trimEnd();

// `changeset publish` packs from the working tree, so it must match what is committed
if (uncommitted) exitWith(`Commit or stash these before releasing:\n${uncommitted}`);

const hasChangesets = readdirSync('.changeset').some(
	(fileName) => fileName.endsWith('.md') && fileName !== 'README.md',
);

if (hasChangesets) exitWith('Pending changesets; run `pnpm version-packages` and commit first');

const fetchResult = capture('git', ['fetch', '--quiet', 'origin', 'main']);

if (fetchResult.status !== 0) exitWith(`Could not fetch origin/main:\n${fetchResult.stderr}`);

if (capture('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).status !== 0)
	exitWith('origin/main has commits that HEAD lacks; pull before releasing');

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
const tag = `${manifest.name}@${manifest.version}`;

if (await isPublished(manifest)) {
	if (!hasRemoteTag(tag))
		exitWith(
			`On npm but not tagged on origin: ${tag}\nPush with \`git push --follow-tags origin main\``,
		);

	console.log(`Nothing to release; ${tag} is already on npm`);
	process.exit(0);
}

const whoami = capture('npm', ['whoami']);

if (whoami.status !== 0) exitWith('Not logged in to npm; run `npm login` first');

console.log(`Releasing ${tag} as ${whoami.stdout.trim()}\n`);

runQuietly('build');
runQuietly('check');
runQuietly('test:e2e');
run('pnpm', ['changeset', 'publish']);
// The checks above already gated this tree; the hook would recheck unrelated work in progress
run('git', ['push', '--no-verify', '--follow-tags', 'origin', 'main']);
