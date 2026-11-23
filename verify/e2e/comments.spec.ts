import type { Page } from '@playwright/test';
import type { StoredComment } from '@xsynaptic/astro-comments';

import { expect, test } from '@playwright/test';
import { defaultMessages } from '@xsynaptic/astro-comments';

const thread = 'posts/hello';

// The handler refuses a form filled in under three seconds
const settledFillTimeMs = 10_000;

async function openSettledPage(page: Page): Promise<void> {
	await page.clock.install();
	await page.goto('/');
	await page.clock.fastForward(settledFillTimeMs);
}

async function fillComment(page: Page, body: string): Promise<void> {
	await page.getByLabel('Name').fill('Playwright');
	await page.getByLabel('Comment').fill(body);
}

async function findPending(page: Page, body: string): Promise<StoredComment | undefined> {
	const response = await page.request.get('/api/pending');
	const pending = (await response.json()) as Array<StoredComment>;

	return pending.find((comment) => comment.body === body);
}

function postedForm(body: string, fields: Record<string, string> = {}): Record<string, string> {
	return {
		author: 'Direct',
		body,
		extra: '',
		fillTimeMs: String(settledFillTimeMs),
		parentId: '',
		'stub-token': 'pass',
		thread,
		...fields,
	};
}

test.describe('the element', () => {
	test('posts a comment as JSON and shows the received notice', async ({ page }) => {
		const body = `A top-level comment ${test.info().testId}`;

		await openSettledPage(page);
		await page.getByRole('button', { name: 'Leave a comment' }).click();
		await fillComment(page, body);
		await page.getByRole('button', { name: 'Post comment' }).click();

		await expect(page.getByText('Your comment is awaiting moderation.')).toBeVisible();
		await expect(page.locator('[data-comment-form]')).toBeHidden();
		expect(await findPending(page, body)).toMatchObject({ status: 'pending', thread });
	});

	test('moves the form under the comment it replies to and posts the reply', async ({ page }) => {
		const body = `A reply ${test.info().testId}`;

		await openSettledPage(page);

		const accepted = page.evaluate(
			() =>
				new Promise((resolve) => {
					document.addEventListener('comments:accepted', (event) => {
						resolve(event.detail);
					});
				}),
		);
		const reply = page.locator('#comment-seeded').getByRole('button', { name: 'Reply' });

		await reply.click();

		await expect(reply).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('#comment-seeded + [data-comment-form]')).toBeVisible();

		await fillComment(page, body);
		await page.getByRole('button', { name: 'Post comment' }).click();

		expect(await accepted).toEqual({ isReply: true, thread });
		await expect(page.locator('[data-comment-form-home] > [data-comment-form]')).toBeHidden();
		expect(await findPending(page, body)).toMatchObject({ parentId: 'seeded', thread });
	});

	test('shows the message a JSON rejection carries', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Leave a comment' }).click();
		await fillComment(page, 'Posted the moment the page loaded');
		await page.getByRole('button', { name: 'Post comment' }).click();

		await expect(page.getByText(defaultMessages.tooFast)).toBeVisible();
	});

	test('renders a fresh challenge after a failed one', async ({ page }) => {
		const body = `Retried after the challenge ${test.info().testId}`;
		const token = page.getByLabel('Challenge token');

		await openSettledPage(page);
		await page.getByRole('button', { name: 'Leave a comment' }).click();
		await fillComment(page, body);
		await token.fill('fail');
		await page.getByRole('button', { name: 'Post comment' }).click();

		await expect(page.getByText(defaultMessages.challenge)).toBeVisible();
		await expect(token).toHaveValue('pass');

		await page.getByRole('button', { name: 'Post comment' }).click();

		await expect(page.getByText('Your comment is awaiting moderation.')).toBeVisible();
		expect(await findPending(page, body)).toBeDefined();
	});
});

test('answers a rejection with its message as JSON', async ({ page }) => {
	const response = await page.request.post('/api/comments', {
		form: postedForm('A comment on a page that takes none', { thread: 'posts/missing' }),
	});

	expect(response.status()).toBe(400);
	expect(await response.json()).toEqual({ message: defaultMessages.threadMissing });
});
