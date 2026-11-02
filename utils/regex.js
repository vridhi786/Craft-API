/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Whitelist for values interpolated into PostgREST `.or()` filter strings (where `,` `(` `)` `.` carry meaning).
 * Keeps letters, digits, space, @ - and strips everything else, so a search term can never inject filter syntax.
 */
export const safeFilterTerm = (s, max = 60) => String(s).replace(/[^\p{L}\p{N} @-]/gu, '').trim().slice(0, max);
