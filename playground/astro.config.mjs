import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
	adapter: node({ mode: 'standalone' }),
	// The specs fake the clock, and the toolbar throws once `performance` is replaced
	devToolbar: { enabled: false },
	output: 'server',
});
