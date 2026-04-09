import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const dynamic = 'force-static';

const api = createFromSource(source);

export const { staticGET: GET } = api;
