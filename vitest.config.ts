import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					exclude: ['src/element/**'],
					include: ['src/**/*.test.ts'],
					name: 'server',
				},
			},
			{
				test: {
					environment: 'happy-dom',
					include: ['src/element/**/*.test.ts'],
					name: 'element',
				},
			},
		],
		silent: 'passed-only',
	},
});
