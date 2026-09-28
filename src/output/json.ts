import type { SearchResult } from '../models/search.ts';

export function resultToJson(result: SearchResult, pretty = true): string {
  return JSON.stringify(result, null, pretty ? 2 : 0);
}
