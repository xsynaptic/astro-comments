import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { D1LocalOptions } from '#cloudflare/d1-local-binding.ts';

const initialMigration = '0000-initial';

// Through the package's own export, so the source and the build resolve the same file
const initialMigrationPath = createRequire(import.meta.url).resolve(
	`@xsynaptic/astro-comments/migrations/${initialMigration}.sql`,
);

// Lets a later version tell which package migrations a site already holds
const migrationMarker = `-- @xsynaptic/astro-comments ${initialMigration}`;

// Matches unmarked tables too, from a site that predates this command or copied the schema by hand
const createsCommentsTable = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["'`[]?comments\b/i;

// Named as `wrangler d1 migrations create` names one
export async function writeSchemaMigration(migrationsDirectory: string): Promise<string> {
	await mkdir(migrationsDirectory, { recursive: true });

	const existing = await readdir(migrationsDirectory);

	for (const name of existing) {
		const filePath = path.join(migrationsDirectory, name);

		if (name.endsWith('.sql') && createsCommentsTable.test(await readFile(filePath, 'utf8')))
			throw new Error(`${filePath} already creates the comments table`);
	}

	const highest = Math.max(0, ...existing.map((name) => Number(/^\d+/.exec(name)?.[0] ?? 0)));
	const filePath = path.join(
		migrationsDirectory,
		`${String(highest + 1).padStart(4, '0')}_astro_comments.sql`,
	);
	const schema = await readFile(initialMigrationPath, 'utf8');

	await writeFile(filePath, `${migrationMarker}\n${schema}`, { flag: 'wx' });

	return filePath;
}

export async function resolveMigrationsDirectory({
	binding,
	configPath,
}: D1LocalOptions): Promise<string> {
	const { unstable_readConfig } = await import('wrangler');
	const config = unstable_readConfig({ config: configPath }, { hideWarnings: true });
	const database = config.d1_databases.find((entry) => entry.binding === binding);

	if (!database) throw new Error(`The wrangler config has no D1 binding named ${binding}`);

	return path.resolve(path.dirname(configPath), database.migrations_dir ?? 'migrations');
}
