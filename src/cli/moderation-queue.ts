import { styleText } from 'node:util';

import type { Decision } from '#cli/moderation.ts';
import type { CommentModerationStore, StoredComment } from '#store.ts';

import { applyDecision, createOwnerCheck, decisionColours } from '#cli/moderation.ts';
import { printComment, printLegend, readKey } from '#cli/terminal.ts';

export interface ModerationTally {
	approved: number;
	rejected: number;
	skipped: number;
	spam: number;
}

type Choice = (typeof choices)[number];

const choices = [
	{ key: 'a', label: 'approve', status: 'approved' },
	{ key: 'r', label: 'reject', status: 'rejected' },
	{ key: 's', label: 'spam', status: 'spam' },
	{ key: 'n', label: 'skip' },
	{ key: 'A', label: 'approve all' },
	{ key: 'q', label: 'quit' },
] as const satisfies ReadonlyArray<{ key: string; label: string; status?: Decision }>;

export async function runModerationQueue(
	store: CommentModerationStore,
	ownerEmails: ReadonlyArray<string>,
): Promise<ModerationTally> {
	const pending = await store.listPending();
	const isOwnerCandidate = createOwnerCheck(ownerEmails);
	const tally: ModerationTally = { approved: 0, rejected: 0, skipped: 0, spam: 0 };

	if (pending.length === 0) console.log(styleText('green', '✓ Nothing pending'));

	for (const [index, comment] of pending.entries()) {
		const isCandidate = isOwnerCandidate(comment);
		const choice = await promptChoice(comment, {
			isLast: index === pending.length - 1,
			marker: `${String(index + 1)}/${String(pending.length)}${isCandidate ? styleText('yellow', ' Owner') : ''}`,
		});

		if (!choice || choice.key === 'q') break;

		if (choice.key === 'A') {
			const remaining = pending.slice(index);
			const approvable = remaining.filter((candidate) => !isOwnerCandidate(candidate));

			await approveAll(store, approvable, tally);
			tally.skipped += remaining.length - approvable.length;
			break;
		}

		await decide(store, { choice, comment, isCandidate, tally });
	}

	return tally;
}

async function approveAll(
	store: CommentModerationStore,
	approvable: Array<StoredComment>,
	tally: ModerationTally,
): Promise<void> {
	await store.setStatus(
		approvable.map((comment) => comment.id),
		'approved',
	);

	tally.approved += approvable.length;
	console.log(styleText('green', `  ✓ approved ${String(approvable.length)} remaining`));
}

async function decide(
	store: CommentModerationStore,
	{
		choice,
		comment,
		isCandidate,
		tally,
	}: { choice: Choice; comment: StoredComment; isCandidate: boolean; tally: ModerationTally },
): Promise<void> {
	if (!('status' in choice)) {
		tally.skipped += 1;
		return;
	}

	await applyDecision(store, {
		decision: choice.status,
		id: comment.id,
		isOwner: isCandidate && choice.status === 'approved',
	});

	tally[choice.status] += 1;
	console.log(styleText(decisionColours[choice.status], `  ✓ ${choice.status}`));
}

// `A` decides the same row as `a` once this is the last one left
async function promptChoice(
	comment: StoredComment,
	{ isLast, marker }: { isLast: boolean; marker: string },
): Promise<Choice | undefined> {
	const available = isLast ? choices.filter((choice) => choice.key !== 'A') : choices;

	printComment(comment, styleText('dim', marker));
	printLegend(available);

	const key = await readKey(available.map((choice) => choice.key));

	return available.find((choice) => choice.key === key);
}
