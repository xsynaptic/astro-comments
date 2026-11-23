import { defineConfig } from 'tsdown';

export default defineConfig({
	dts: true,
	entry: {
		bin: 'src/cli/bin.ts',
		cli: 'src/cli/index.ts',
		cloudflare: 'src/cloudflare/index.ts',
		'cloudflare-node': 'src/cloudflare/node.ts',
		'cloudflare-widget': 'src/element/turnstile-widget.ts',
		config: 'src/cli/config-entry.ts',
		element: 'src/element/index.ts',
		import: 'src/import/index.ts',
		index: 'src/index.ts',
		render: 'src/render/index.ts',
		snapshot: 'src/snapshot/index.ts',
	},
	format: 'esm',
	publint: true,
	sourcemap: true,
});
