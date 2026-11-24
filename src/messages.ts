export interface CommentMessages {
	challenge: string;
	challengePending: string;
	closed: string;
	invalid: string;
	parentMissing: string;
	threadMissing: string;
	tooFast: string;
	tooLarge: string;
	tooMany: string;
	unexpected: string;
	unreadable: string;
}

export const defaultMessages = {
	challenge: 'The challenge did not pass. Please reload the page and try again.',
	challengePending: 'The challenge has not finished yet. Please wait a moment and try again.',
	closed: 'This page no longer takes comments.',
	invalid: 'That submission was not valid.',
	parentMissing: 'That reply target does not exist.',
	threadMissing: 'That page does not take comments.',
	tooFast: 'That was too fast. Please try again.',
	tooLarge: 'That submission was too large.',
	tooMany:
		'Several comments have just come from your connection. Please wait a few minutes before posting another.',
	unexpected: 'Something went wrong here. Please try again in a moment.',
	unreadable: 'That submission could not be read.',
} as const satisfies CommentMessages;
