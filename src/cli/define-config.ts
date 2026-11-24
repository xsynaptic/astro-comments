import { z } from 'zod';

// Optional until a remote command needs them
export const commentsConfigSchema = z.object({
	d1: z.object({
		local: z.object({ binding: z.string(), configPath: z.string() }),
		remote: z.object({
			accountId: z.string().optional(),
			apiToken: z.string().optional(),
			databaseId: z.string().optional(),
		}),
	}),
	ignoredOrphans: z.array(z.string()).default([]),
	owners: z
		.record(
			z.string(),
			z
				.array(z.string().optional())
				.transform((emails) =>
					emails.filter((email): email is string => email !== undefined && email !== ''),
				),
		)
		.default({}),
	publishEmailHash: z.boolean().default(true),
	snapshotDirectory: z.string(),
	threadRegistry: z.string(),
});

export type CommentsConfig = z.output<typeof commentsConfigSchema>;

type CommentsConfigInput = z.input<typeof commentsConfigSchema>;

export function defineCommentsConfig(config: CommentsConfigInput): CommentsConfigInput {
	return config;
}
