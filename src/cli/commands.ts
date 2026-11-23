import path from 'node:path';
import { styleText } from 'node:util';

import type { CommentsConfig } from '#cli/define-config.ts';
import type { ModerationTally } from '#cli/moderation-queue.ts';
import type { Decision, DecisionReport } from '#cli/moderation.ts';
import type { SnapshotTally, SnapshotTarget } from '#snapshot/snapshot.ts';
import type { CommentModerationStore, StoredComment } from '#store.ts';

import { openCommentStore } from '#cli/config.ts';
import { runModerationQueue } from '#cli/moderation-queue.ts';
import { createOwnerCheck, decideComments, decisionColours } from '#cli/moderation.ts';
import { findOrphanedThreads, printOrphanedThreads } from '#cli/orphans.ts';
import { printComment, readKey } from '#cli/terminal.ts';
import { toSnapshotFile, writeCommentsSnapshot } from '#snapshot/snapshot.ts';

export async function decideByIds(
	config: CommentsConfig,
	target: SnapshotTarget,
	{ decision, ids }: { decision: Decision; ids: ReadonlyArray<string> },
): Promise<DecisionReport> {
	const report = await withStore(config, target, (store) =>
		decideComments(store, { decision, ids, ownerEmails: config.ownerEmails }),
	);

	for (const { id, isOwner } of report.decided) {
		console.log(
			styleText(decisionColours[decision], `✓ ${decision} ${id}${isOwner ? ' as the Owner' : ''}`),
		);
	}

	for (const { id, reason } of report.refused) {
		console.error(styleText('yellow', `✗ ${id}: ${reason}`));
	}

	if (decision === 'approved' && report.decided.length > 0) await pullComments(config, target);

	return report;
}

export async function deleteComment(
	config: CommentsConfig,
	target: SnapshotTarget,
	{ id, isConfirmed }: { id: string; isConfirmed: boolean },
): Promise<StoredComment | undefined> {
	if (!isConfirmed && !process.stdin.isTTY) {
		throw new Error('delete needs --yes without an interactive terminal');
	}

	const removed = await withStore(config, target, async (store) => {
		const comment = await store.getComment(id);

		if (!comment) throw new Error(`No comment with id ${id}`);

		if (!isConfirmed && !(await isDeleteConfirmed(comment))) {
			console.log(styleText('dim', 'Kept'));
			return;
		}

		const deleted = await store.deleteComment(id);

		console.log(styleText('green', `✓ Deleted ${id}`));

		return deleted;
	});

	if (removed?.status === 'approved') await pullComments(config, target);

	return removed;
}

export async function listPendingComments(
	config: CommentsConfig,
	target: SnapshotTarget,
	{ isJson }: { isJson: boolean },
): Promise<void> {
	const isOwnerCandidate = createOwnerCheck(config.ownerEmails);
	const pending = await withStore(config, target, (store) => store.listPending());

	if (isJson) {
		const rows = pending.map((comment) => ({
			...comment,
			isOwnerCandidate: isOwnerCandidate(comment),
		}));

		console.log(JSON.stringify(rows));
		return;
	}

	if (pending.length === 0) console.log(styleText('green', '✓ Nothing pending'));

	for (const comment of pending) {
		printComment(
			comment,
			isOwnerCandidate(comment) ? styleText('yellow', 'Owner') : styleText('dim', 'pending'),
		);
	}
}

// The site reads a snapshot, so an approval reaches it only after a pull
export async function moderateComments(
	config: CommentsConfig,
	target: SnapshotTarget,
): Promise<ModerationTally> {
	if (!process.stdin.isTTY) {
		throw new Error(
			'moderate needs an interactive terminal; list the queue with pending, then approve, reject or spam by id',
		);
	}

	const tally = await withStore(config, target, async (store) => {
		console.log(styleText('bold', `Moderation queue · ${target}`));

		return runModerationQueue(store, config.ownerEmails);
	});

	console.log(
		styleText(
			'dim',
			`Approved ${String(tally.approved)} · rejected ${String(tally.rejected)} · spam ${String(tally.spam)} · skipped ${String(tally.skipped)}`,
		),
	);

	if (tally.approved > 0) await pullComments(config, target);

	return tally;
}

export async function reportOrphans(config: CommentsConfig, target: SnapshotTarget): Promise<void> {
	const orphans = await withStore(config, target, (store) =>
		findOrphanedThreads(store, config.threadRegistry, config.ignoredOrphans),
	);

	printOrphanedThreads(orphans);
}

export async function pullComments(
	config: CommentsConfig,
	target: SnapshotTarget,
): Promise<SnapshotTally> {
	const filePath = toSnapshotFile(config.snapshotDirectory, target);
	const tally = await withStore(config, target, (store) => writeCommentsSnapshot(store, filePath));

	const written = tally.approved === 1 ? 'comment' : 'comments';

	console.log(
		styleText(
			'green',
			`✓ ${String(tally.approved)} approved ${written} written to ${path.relative(process.cwd(), filePath)}`,
		),
	);

	if (tally.pending > 0) console.log(styleText('yellow', `${String(tally.pending)} pending`));

	return tally;
}

async function isDeleteConfirmed(comment: StoredComment): Promise<boolean> {
	printComment(comment, styleText('dim', comment.status));
	console.log(
		`  ${styleText(['red', 'bold'], 'Delete permanently?')}  ${styleText('dim', 'y / n')}`,
	);

	return (await readKey(['y', 'n'])) === 'y';
}

async function withStore<Result>(
	config: CommentsConfig,
	target: SnapshotTarget,
	run: (store: CommentModerationStore) => Promise<Result>,
): Promise<Result> {
	const { dispose, store } = await openCommentStore(config, target);

	try {
		return await run(store);
	} finally {
		await dispose();
	}
}
