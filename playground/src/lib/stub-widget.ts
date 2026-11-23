import type { CommentChallengeWidget } from '@xsynaptic/astro-comments/element';

import { stubPassingToken, stubTokenField } from './stub-challenge.ts';

// A visible field, so a test can type a failing token in
export const stubWidget = {
	remove: () => Promise.resolve(),
	render(container) {
		const input = document.createElement('input');

		input.name = stubTokenField;
		input.value = stubPassingToken;
		input.setAttribute('aria-label', 'Challenge token');
		container.replaceChildren(input);

		return Promise.resolve();
	},
} satisfies CommentChallengeWidget;
