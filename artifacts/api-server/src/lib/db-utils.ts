/**
 * Splits a large ID array into fixed-size chunks and issues one DB query per
 * chunk, concatenating results.  Prevents Drizzle ORM from recursively
 * building a massive SQL expression tree for large IN (...) clauses, which
 * causes "Maximum call stack size exceeded" with thousands of IDs.
 *
 * Uses Array.concat (never spread) so the accumulator never itself blows up.
 */
export async function queryInChunks<T>(
  ids: number[],
  queryFn: (chunk: number[]) => Promise<T[]>,
  chunkSize = 500,
): Promise<T[]> {
  if (ids.length === 0) return [];
  if (ids.length <= chunkSize) return queryFn(ids);
  let out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    out = out.concat(await queryFn(ids.slice(i, i + chunkSize)));
  }
  return out;
}
