import type { CommentModerationStore, CommentStatus, StoredComment } from '#store.ts';

export type Decision = Exclude<CommentStatus, 'pending'>;

export const decisionColours = {
	approved: 'green',
	rejected: 'red',
	spam: 'magenta',
} as const satisfies Record<Decision, string>;

export interface DecisionReport {
	decided: Array<{ id: string; isOwner: boolean }>;
	refused: Array<{ id: string; reason: string }>;
}

// The form has no login, so a matching email only marks a candidate; approving it is what vouches
export function createOwnerCheck(
	ownerEmails: ReadonlyArray<string>,
): (comment: StoredComment) => boolean {
	const owners = new Set(ownerEmails.map((email) => normalizeEmail(email)));

	return (comment) =>
		comment.authorEmail !== undefined && owners.has(normalizeEmail(comment.authorEmail));
}

export async function applyDecision(
	store: CommentModerationStore,
	{ decision, id, isOwner }: { decision: Decision; id: string; isOwner: boolean },
): Promise<void> {
	// Owner first, so a failure between the writes leaves the comment unpublished rather than unbadged
	if (isOwner) await store.setOwner([id], true);

	await store.setStatus([id], decision);
}

// Naming an id is an explicit decision, so an owner candidate approved here becomes the Owner
export async function decideComments(
	store: CommentModerationStore,
	{
		decision,
		ids,
		ownerEmails,
	}: { decision: Decision; ids: ReadonlyArray<string>; ownerEmails: ReadonlyArray<string> },
): Promise<DecisionReport> {
	const isOwnerCandidate = createOwnerCheck(ownerEmails);
	const report: DecisionReport = { decided: [], refused: [] };
	const uniqueIds = new Set(ids);

	for (const id of uniqueIds) {
		const comment = await store.getComment(id);

		if (!comment) {
			report.refused.push({ id, reason: 'no such comment' });
			continue;
		}

		// One-way, as the queue is
		if (comment.status !== 'pending') {
			report.refused.push({ id, reason: `already ${comment.status}` });
			continue;
		}

		const isOwner = decision === 'approved' && isOwnerCandidate(comment);

		await applyDecision(store, { decision, id, isOwner });
		report.decided.push({ id, isOwner });
	}

	return report;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
