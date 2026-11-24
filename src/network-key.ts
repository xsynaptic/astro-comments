const hextetCount = 8;

// A household holds at least an IPv6 /64 and can rotate through it at will, so the prefix is the identity
export function toNetworkKey(address: string): string {
	const hextets = parseIpv6(address);

	if (!hextets) return address;

	// Node reports an IPv4 client on a dual-stack socket in this form; truncated, every one would share a bucket
	if (hextets.slice(0, 5).every((hextet) => hextet === '0') && hextets[5] === 'ffff') {
		return [hextets[6], hextets[7]]
			.flatMap((hextet = '0') => {
				const value = Number.parseInt(hextet, 16);

				return [value >> 8, value & 255];
			})
			.join('.');
	}

	return `${hextets.slice(0, 4).join(':')}::/64`;
}

// The URL parser canonicalizes case, leading zeros and `::`, so one address has one spelling
function parseIpv6(address: string): Array<string> | undefined {
	if (!address.includes(':')) return undefined;

	let hostname: string;

	try {
		({ hostname } = new URL(`http://[${address}]/`));
	} catch {
		return undefined;
	}

	const [head = '', tail] = hostname.slice(1, -1).split('::', 2);
	const headHextets = head === '' ? [] : head.split(':');

	if (tail === undefined) return headHextets;

	const tailHextets = tail === '' ? [] : tail.split(':');
	const elided = Array.from(
		{ length: hextetCount - headHextets.length - tailHextets.length },
		() => '0',
	);

	return [...headHextets, ...elided, ...tailHextets];
}
