import type { APIRoute } from 'astro';

import { commentStore } from '../../lib/comment-store.ts';

export const GET: APIRoute = async () => Response.json(await commentStore.listPending());
