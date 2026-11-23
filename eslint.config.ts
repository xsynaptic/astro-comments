import {
	getAstroConfig,
	getBrowserConfig,
	getConfig,
	getWebComponentConfig,
} from '@xsynaptic/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const elementFiles = ['src/element/**/*.ts'];

// Globals Node lacks; the DOM lib hides them from the type check, so this keeps them out of server code
const browserOnlyGlobals = Object.keys(globals.browser).filter(
	(name) => !Object.hasOwn(globals.nodeBuiltin, name),
);

export default getConfig([
	{
		ignores: ['**/dist/**', '**/node_modules/**', '**/.astro/**', '**/.wrangler/**', '.claude/**'],
	},
	...getAstroConfig(),
	getBrowserConfig([...elementFiles, 'playground/src/**/*']),
	getWebComponentConfig(elementFiles),
	{
		files: ['src/**/*.ts'],
		ignores: elementFiles,
		rules: {
			'no-restricted-globals': [
				'error',
				...browserOnlyGlobals.map((name) => ({
					message: 'Browser code goes under src/element.',
					name,
				})),
			],
		},
	},
	{
		// Ships to visitors' browsers, so ES2023 array copies stay out
		files: elementFiles,
		ignores: ['**/*.test.ts'],
		rules: {
			'no-restricted-properties': [
				'error',
				...['toReversed', 'toSorted', 'toSpliced', 'with'].map((property) => ({
					message: 'Copy then mutate instead (`[...array].sort()`)',
					property,
				})),
			],
			'unicorn/no-array-reverse': 'off',
			'unicorn/no-array-sort': 'off',
		},
	},
	{
		files: ['*.config.{ts,mjs}', 'playground/*.config.{ts,mjs}', 'verify/**'],
		...tseslint.configs.disableTypeChecked,
	},
	{
		files: ['verify/e2e/**/*.ts'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
		rules: {
			'unicorn/prefer-global-this': 'off',
		},
	},
	{
		// Code complexity rules promoting higher quality agentic coding output
		rules: {
			complexity: ['warn', { max: 16, variant: 'modified' }],
			'max-depth': ['warn', 4],
			'max-lines-per-function': ['warn', { max: 145, skipBlankLines: true, skipComments: true }],
			'max-params': ['warn', 4],
			'max-statements': ['warn', 38],
		},
	},
]);
