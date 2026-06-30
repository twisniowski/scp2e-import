/** Shared constants. Kept in its own module to avoid circular imports. */
export const MODULE_ID = "scp2e-character-sheet";
/** Flag scope + key under which all SCP data is stored on a normal Actor. */
export const FLAG_SCOPE = MODULE_ID;
export const FLAG_KEY = "data";
/** Dotted path prefix used in form `name` attributes. */
export const FLAG_PREFIX = `flags.${MODULE_ID}.${FLAG_KEY}`;
