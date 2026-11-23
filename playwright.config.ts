import { defineConfig, devices } from '@playwright/test';

// Its own port, so a server on Astro's default 4321 is never mistaken for the playground
const port = 4341;

const baseURL = `http://localhost:${String(port)}/`;

// Astro 7 daemonizes `astro dev` when it detects an agent, so the webServer would exit early without the env
export default defineConfig({
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	retries: 0,
	testDir: './verify/e2e',
	use: { baseURL, trace: 'retain-on-failure' },
	webServer: {
		command: `pnpm --filter @playground/astro-comments dev --port ${String(port)}`,
		env: { ASTRO_DEV_BACKGROUND: '0' },
		// Reusing a running dev server is safe, since dev always serves the current source
		reuseExistingServer: true,
		timeout: 60_000,
		url: baseURL,
	},
});
