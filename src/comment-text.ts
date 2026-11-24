// Bidi controls in a name reorder the markup beside it, such as an Owner badge
export function toDisplayName(name: string): string {
	return name
		.replaceAll(/\p{Bidi_Control}/gu, '')
		.replaceAll(/[\p{Cc}\s]+/gu, ' ')
		.trim();
}

// XML cannot carry most control characters, so one would break a feed built from the snapshot
export function toCommentBody(body: string): string {
	return body
		.replaceAll(/\r\n?/g, '\n')
		.replaceAll(/(?![\t\n])\p{Cc}/gu, '')
		.trim();
}
