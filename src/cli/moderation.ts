import type { ThreadResolver } from '#registry.ts';
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

export type OwnerCheck = (comment: StoredComment) => Promise<boolean>;

// The form has no login, so a matching email only marks a candidate; approving it is what vouches
// The registry is read only for an email some owner holds, so most queues never need a build
export function createOwnerCheck(
	owners: Readonly<Record<string, ReadonlyArray<string>>>,
	resolveThread: ThreadResolver,
): OwnerCheck {
	const ownerIdsByEmail = new Map<string, Set<string>>();

	for (const [ownerId, emails] of Object.entries(owners)) {
		for (const email of emails) {
			const normalized = normalizeEmail(email);
			const ownerIds = ownerIdsByEmail.get(normalized) ?? new Set<string>();

			ownerIds.add(ownerId);
			ownerIdsByEmail.set(normalized, ownerIds);
		}
	}

	return async (comment) => {
		if (comment.authorEmail === undefined) return false;

		const ownerIds = ownerIdsByEmail.get(normalizeEmail(comment.authorEmail));

		if (ownerIds === undefined) return false;

		const page = await resolveThread(comment.thread);

		if (page === undefined) return false;

		if (page.owners === undefined) return true;

		return page.owners.some((ownerId) => ownerIds.has(ownerId));
	};
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
		isOwnerCandidate,
	}: { decision: Decision; ids: ReadonlyArray<string>; isOwnerCandidate: OwnerCheck },
): Promise<DecisionReport> {
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

		const isOwner = decision === 'approved' && (await isOwnerCandidate(comment));

		await applyDecision(store, { decision, id, isOwner });
		report.decided.push({ id, isOwner });
	}

	return report;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
