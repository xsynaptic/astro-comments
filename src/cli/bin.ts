#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs, styleText } from 'node:util';

import type { CommentsConfig } from '#cli/define-config.ts';
import type { Decision } from '#cli/moderation.ts';

import {
	decideByIds,
	deleteComment,
	listPendingComments,
	moderateComments,
	pullComments,
	reportOrphans,
} from '#cli/commands.ts';
import { loadCommentsConfig } from '#cli/config.ts';
import { writeSchemaMigration } from '#cli/schema.ts';

const usage = `Usage: astro-comments <command> [options]

Commands:
  moderate             Work through the pending queue in a terminal; pulls if anything was approved
  pending              List the pending queue; --json prints it for a script
  approve <id...>      Approve pending comments, an owner candidate as the Owner; pulls afterwards
  reject <id...>       Reject pending comments
  spam <id...>         Mark pending comments as spam
  delete <id>          Erase one comment after a prompt, or at once with --yes; pulls if it was approved
  pull                 Write the approved comments snapshot
  orphans              List threads the built registry does not hold
  schema <dir>         Write the comments table as the next migration in <dir>

Options:
  --local              Use the local D1 database rather than the remote one
  --env-file <path>    Load environment variables before the config; repeatable, the last file wins
  --json               Print pending as JSON
  -y, --yes            Delete without the prompt
  -h, --help           Show this help`;

const decisionCommands = {
	approve: 'approved',
	reject: 'rejected',
	spam: 'spam',
} as const satisfies Record<string, Decision>;

try {
	await run();
} catch (error) {
	console.error(styleText('red', error instanceof Error ? error.message : String(error)));
	process.exitCode = 1;
}

async function run(): Promise<void> {
	const { positionals, values } = readArguments();
	const [command, ...operands] = positionals;

	if (command === undefined || values.help) {
		console.log(usage);
		return;
	}

	if (command === 'schema') {
		const [directory] = operands;

		if (directory === undefined) throw new Error('schema needs a directory');

		console.log(`Wrote ${await writeSchemaMigration(directory)}`);
		return;
	}

	const execute = toCommand(command, operands, values);

	// Before the config, which reads credentials from the environment; reversed so the last file wins, as with Node's flag
	const envFiles = (values['env-file'] ?? []).toReversed();

	for (const file of envFiles) {
		if (existsSync(file)) process.loadEnvFile(file);
	}

	await execute(await loadCommentsConfig(process.cwd()));
}

function toCommand(
	command: string,
	operands: Array<string>,
	{ json, local, yes }: { json: boolean; local: boolean; yes: boolean },
): (config: CommentsConfig) => Promise<void> {
	const target = local ? 'local' : 'remote';

	if (Object.hasOwn(decisionCommands, command)) {
		if (operands.length === 0) throw new Error(`${command} needs at least one comment id`);

		const decision = decisionCommands[command as keyof typeof decisionCommands];

		return async (config) => {
			const { refused } = await decideByIds(config, target, { decision, ids: operands });

			if (refused.length > 0) process.exitCode = 1;
		};
	}

	switch (command) {
		case 'delete': {
			const [id] = operands;

			if (id === undefined) throw new Error('delete needs a comment id');

			return async (config) => {
				await deleteComment(config, target, { id, isConfirmed: yes });
			};
		}
		case 'moderate': {
			return async (config) => {
				await moderateComments(config, target);
			};
		}
		case 'orphans': {
			return (config) => reportOrphans(config, target);
		}
		case 'pending': {
			return (config) => listPendingComments(config, target, { isJson: json });
		}
		case 'pull': {
			return async (config) => {
				await pullComments(config, target);
			};
		}
		default: {
			throw new Error(`Unknown command ${command}; run astro-comments --help`);
		}
	}
}

function readArguments() {
	try {
		return parseArgs({
			allowPositionals: true,
			options: {
				'env-file': { multiple: true, type: 'string' },
				help: { default: false, short: 'h', type: 'boolean' },
				json: { default: false, type: 'boolean' },
				local: { default: false, type: 'boolean' },
				yes: { default: false, short: 'y', type: 'boolean' },
			},
		});
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}; run astro-comments --help`,
			{ cause: error },
		);
	}
}
