import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const bin = fileURLToPath(import.meta.resolve('#cli/bin.ts'));

function runBin(...args: Array<string>) {
	return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
}

test('prints the usage for --help and -h', () => {
	for (const flag of ['--help', '-h']) {
		const { status, stdout } = runBin(flag);

		expect(status).toBe(0);
		expect(stdout).toContain('approve <id...>');
	}
});

test('answers a bad invocation in one line, with no stack trace and before reading any config', () => {
	for (const args of [['--bogus'], ['frob'], ['approve'], ['delete'], ['schema', 'migrations']]) {
		const { status, stderr } = runBin(...args);

		expect(status).toBe(1);
		expect(stderr.trim().split('\n')).toHaveLength(1);
		expect(stderr).not.toContain('config');
	}
});
