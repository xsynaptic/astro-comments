import { expect, test } from 'vitest';

import { toPrintable } from '#cli/terminal.ts';

test('strips escape sequences and other control characters, keeping line breaks and tabs', () => {
	expect(toPrintable('Nice\u{1B}[2J\u{1B}]52;c;aGk=\u{7} mix\nsecond\0\tline')).toBe(
		'Nice[2J]52;c;aGk= mix\nsecond\tline',
	);
});

test('names each bidi control in place, so text that renders reordered reads as such', () => {
	expect(toPrintable('mix\u{202E}lacol\u{200E}')).toBe('mix⟨U+202E⟩lacol⟨U+200E⟩');
});
