/** Shared constants + helpers. Kept in its own module to avoid circular imports. */
export const MODULE_ID = "scp2e-character-sheet";
/** Flag scope + key under which all SCP data is stored on a normal Actor. */
export const FLAG_SCOPE = MODULE_ID;
export const FLAG_KEY = "data";
/** Dotted path prefix used in form `name` attributes. */
export const FLAG_PREFIX = `flags.${MODULE_ID}.${FLAG_KEY}`;
/** The token-bar attribute path our HP is exposed on. */
export const HP_BAR = `${FLAG_PREFIX}.health.hp`;

/**
 * Apply a chat roll mode across Foundry versions. v14 renamed
 * ChatMessage.applyRollMode -> ChatMessage.applyMode.
 */
export function applyChatRollMode(messageData, rollMode) {
  const mode = rollMode || game.settings.get("core", "rollMode");
  if (typeof ChatMessage.applyMode === "function") ChatMessage.applyMode(messageData, mode);
  else if (typeof ChatMessage.applyRollMode === "function") ChatMessage.applyRollMode(messageData, mode);
  return messageData;
}

/**
 * Point an actor's prototype token (and any active tokens) at our flag-based HP
 * so token health bars work. Safe to call repeatedly (no-op once set).
 */
export async function ensureHpBar(actor) {
  if (!actor?.isOwner) return;
  const DM = globalThis.CONST?.TOKEN_DISPLAY_MODES ?? {};
  const updates = {};
  if (actor.prototypeToken?.bar1?.attribute !== HP_BAR) updates["prototypeToken.bar1.attribute"] = HP_BAR;
  if ((actor.prototypeToken?.displayBars ?? 0) === (DM.NONE ?? 0)) updates["prototypeToken.displayBars"] = DM.OWNER_HOVER ?? 20;
  if (Object.keys(updates).length) {
    try { await actor.update(updates); } catch (e) { console.error("SCP2e | prototype token bar update failed:", e); }
  }
  for (const t of actor.getActiveTokens?.() ?? []) {
    if (t?.document?.bar1?.attribute !== HP_BAR) {
      try { await t.document.update({ "bar1.attribute": HP_BAR }); } catch (e) { /* ignore */ }
    }
  }
}
