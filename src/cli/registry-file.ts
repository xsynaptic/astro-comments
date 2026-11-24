import { readFile } from 'node:fs/promises';

import type { ThreadRegistry } from '#registry.ts';

import { threadRegistrySchema } from '#registry.ts';

export async function readThreadRegistry(registryFile: string): Promise<ThreadRegistry> {
	let contents: string;

	try {
		contents = await readFile(registryFile, 'utf8');
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;

		throw new Error(`No thread registry at ${registryFile}; build the site first`, {
			cause: error,
		});
	}

	return threadRegistrySchema.parse(JSON.parse(contents));
}
