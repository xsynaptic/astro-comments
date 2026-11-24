import { describe, expect, test } from 'vitest';

import { toNetworkKey } from '#network-key.ts';

describe('toNetworkKey', () => {
	test('keeps an IPv4 address as it is', () => {
		expect(toNetworkKey('203.0.113.7')).toBe('203.0.113.7');
	});

	test('reduces an IPv6 address to its /64, however it is spelled', () => {
		const spellings = [
			'2001:db8:1:2::1',
			'2001:0DB8:0001:0002:0000:0000:0000:0001',
			'2001:db8:1:2:ffff:ffff:ffff:ffff',
		];

		expect(new Set(spellings.map((address) => toNetworkKey(address)))).toEqual(
			new Set(['2001:db8:1:2::/64']),
		);
	});

	test('tells neighbouring /64 prefixes apart', () => {
		expect(toNetworkKey('2001:db8:1:2::1')).not.toBe(toNetworkKey('2001:db8:1:3::1'));
	});

	test('expands a prefix that `::` elides', () => {
		expect(toNetworkKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(toNetworkKey('::1')).toBe('0:0:0:0::/64');
	});

	test('folds an IPv4-mapped address back to the IPv4 client it carries', () => {
		expect(toNetworkKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(toNetworkKey('::ffff:198.51.100.2')).toBe('198.51.100.2');
	});

	test('passes through a value it cannot parse', () => {
		expect(toNetworkKey('fe80::1%eth0')).toBe('fe80::1%eth0');
		expect(toNetworkKey('not an address')).toBe('not an address');
	});
});
