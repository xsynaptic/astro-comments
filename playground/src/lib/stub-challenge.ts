import type { CommentChallenge } from '@xsynaptic/astro-comments';

export const stubTokenField = 'stub-token';

export const stubPassingToken = 'pass';

export const stubChallenge: CommentChallenge = {
	tokenField: stubTokenField,
	verify: (token) => Promise.resolve(token === stubPassingToken),
};
