// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';

import { TurnstileWidget } from '#element/turnstile-widget.ts';

// Held detached, since happy-dom fails any script it is handed before the test can choose the outcome
function captureScripts(): Array<HTMLScriptElement> {
	const scripts: Array<HTMLScriptElement> = [];

	vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
		scripts.push(...nodes.filter((node) => node instanceof HTMLScriptElement));
	});

	return scripts;
}

test('a script that fails to load is retried on the next render, never from the failure', async () => {
	const scripts = captureScripts();
	const container = document.createElement('div');
	const widget = new TurnstileWidget();
	const api = { remove: vi.fn(), render: vi.fn(() => 'widget-1') };

	document.body.append(container);

	const failed = widget.render(container);

	scripts[0]?.dispatchEvent(new Event('error'));
	await failed;

	expect(scripts).toHaveLength(1);

	const retried = widget.render(container);

	vi.stubGlobal('turnstile', api);
	scripts[1]?.dispatchEvent(new Event('load'));
	await retried;

	expect(scripts).toHaveLength(2);
	expect(api.render).toHaveBeenCalledOnce();
});
