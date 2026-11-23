import type { APIRoute } from 'astro';

import { createThreadResolver, handleCommentSubmission } from '@xsynaptic/astro-comments';

import { commentStore, playgroundThread } from '../../lib/comment-store.ts';
import { stubChallenge } from '../../lib/stub-challenge.ts';

const resolveThread = createThreadResolver(() =>
	Promise.resolve({ [playgroundThread]: { path: '/' } }),
);

export const ALL: APIRoute = ({ clientAddress, request }) =>
	handleCommentSubmission(request, {
		challenge: stubChallenge,
		getClientIp: () => clientAddress,
		ipSalt: 'playground',
		resolveThread,
		store: commentStore,
	});
