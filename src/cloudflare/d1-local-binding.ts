import path from 'node:path';

import type { D1Binding } from '#cloudflare/d1-store.ts';

export interface D1LocalOptions {
	binding: string;
	configPath: string;
}

export interface D1LocalConnection {
	binding: D1Binding;
	dispose: () => Promise<void>;
}

// Remote off, so a `remote: true` in the config never reaches production
export async function openD1LocalBinding({
	binding,
	configPath,
}: D1LocalOptions): Promise<D1LocalConnection> {
	const { getPlatformProxy } = await import('wrangler');
	const resolvedConfigPath = path.resolve(configPath);
	const proxy = await withLocalWranglerEnvironment(() =>
		getPlatformProxy({
			configPath: resolvedConfigPath,
			// Where `wrangler d1 execute --local` writes; the proxy's default follows the cwd
			persist: { path: path.join(path.dirname(resolvedConfigPath), '.wrangler/state/v3') },
			remoteBindings: false,
		}),
	);
	const candidate = proxy.env[binding];

	if (!isD1Binding(candidate)) {
		await proxy.dispose();

		throw new Error(`The wrangler config has no D1 binding named ${binding}`);
	}

	return { binding: candidate, dispose: proxy.dispose };
}

// Wrangler reads both on every use; a value the caller set wins
// The log notice lands on stdout ahead of a caller's `--json`, and the CLI needs no secrets, so a site's `.env` stays unread
const localWranglerEnvironment = {
	CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
	WRANGLER_LOG: 'warn',
} as const;

async function withLocalWranglerEnvironment<Result>(run: () => Promise<Result>): Promise<Result> {
	const applied = Object.entries(localWranglerEnvironment).filter(
		([name]) => process.env[name] === undefined,
	);

	for (const [name, value] of applied) process.env[name] = value;

	try {
		return await run();
	} finally {
		for (const [name] of applied) Reflect.deleteProperty(process.env, name);
	}
}

function isD1Binding(value: unknown): value is D1Binding {
	return (
		typeof value === 'object' &&
		value !== null &&
		'prepare' in value &&
		typeof value.prepare === 'function'
	);
}
