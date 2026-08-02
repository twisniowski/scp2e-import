/**
 * SCP 2e dice roller.
 *
 * Pool dice are d6/d8/d10/d12. Every die explodes into ONE die of the next type
 * up when it rolls its maximum face (6 on a d6 -> +1d8, 8 on a d8 -> +1d10,
 * 10 -> +1d12, 12 -> +1d20). Bonus dice can themselves explode the same way. The
 * only die that does NOT explode is the d20.
 *
 * All rolled dice are candidates; the highest two are summed. A skill value (and
 * any flat modifiers — to-hit, aim, recoil, range, weapon parameters) are added
 * to that sum. The chat card reports the result only — no difficulty comparison,
 * no pass/fail, no critical labels.
 */
import { ATTRIBUTES, SKILLS } from "./config.js";
import { applyChatRollMode } from "./const.js";

const POOL_FACES = [6, 8, 10, 12];           // editable pool dice
const ORDER = [6, 8, 10, 12, 20];            // ascending so explosions cascade in one pass
const NEXT_FACE = { 6: 8, 8: 10, 10: 12, 12: 20, 20: null };

/**
 * Roll an attribute pool (optionally as a skill check), with optional flat
 * modifiers, bonus pool dice (e.g. an Exertion d12) and a chat roll mode.
 *
 * @param {Actor}  actor
 * @param {object} data       Normalised SCP flag data.
 * @param {string} attrKey    Attribute key to roll.
 * @param {object} [opts]
 * @param {string|null}  [opts.skillKey]      PC skill key; adds skills[key].value * mult.
 * @param {number|null}  [opts.skillValue]    Pre-computed flat skill contribution (NPCs).
 * @param {string|null}  [opts.skillLabel]    Display label used with skillValue.
 * @param {Array<{label:string,value:number}>} [opts.flatMods]  Flat modifiers added to the total.
 * @param {object|null}  [opts.bonusPool]     Extra pool dice, e.g. { d12: 1 } for Exertion.
 * @param {string|null}  [opts.bonusLabel]    Label describing the bonus pool (shown in the card).
 * @param {string|null}  [opts.rollMode]      "publicroll" | "gmroll" | "blindroll" | "selfroll".
 * @param {string|null}  [opts.title]         Flavor override.
 */
export async function rollPool(actor, data, attrKey, {
  skillKey = null,
  skillValue = null,
  skillLabel = null,
  flatMods = [],
  bonusPool = null,
  bonusLabel = null,
  rollMode = null,
  title = null,
  notes = [],
  cardButton = "",
  messageFlags = null,
  punished = false
} = {}) {
  // Punished rolls never explode and can't benefit from Exertion dice.
  if (punished) bonusPool = null;
  const attr = data.attributes?.[attrKey] ?? {};
  const pool = attr.dice ?? {};

  // Base pool counts (d20 always starts at 0; it only appears via explosions).
  const base = { 6: 0, 8: 0, 10: 0, 12: 0, 20: 0 };
  for (const f of POOL_FACES) base[f] = Math.max(0, Number(pool[`d${f}`] ?? 0));

  // Fold in any bonus pool dice (e.g. Exertion adds one d12).
  if (bonusPool) for (const f of POOL_FACES) base[f] += Math.max(0, Number(bonusPool[`d${f}`] ?? 0));

  if (!POOL_FACES.some((f) => base[f] > 0)) {
    ui.notifications.warn(
      game.i18n.format("SCP2E.Roll.NoDice", { attr: game.i18n.localize(ATTRIBUTES[attrKey].label) })
    );
    return null;
  }

  // Roll ascending; a max face adds one die of the next type up, which is rolled
  // later in the same pass (cascading explosions). The d20 never explodes.
  const counts = { ...base };
  const dice = [];           // { faces, value, exploded (rolled max), bonus (added by an explosion) }
  const rolls = [];
  for (const f of ORDER) {
    const n = counts[f] ?? 0;
    if (n <= 0) continue;
    const roll = await new Roll(`${n}d${f}`).evaluate();
    rolls.push(roll);

    let idx = 0;
    let maxes = 0;
    for (const term of roll.dice) {
      for (const r of term.results) {
        if (r.active === false) continue;
        const isMax = !punished && r.result === f && NEXT_FACE[f] !== null;
        dice.push({ faces: f, value: r.result, exploded: isMax, bonus: idx >= base[f] });
        if (isMax) maxes++;
        idx++;
      }
    }
    const nxt = NEXT_FACE[f];
    if (nxt !== null && maxes > 0) counts[nxt] = (counts[nxt] ?? 0) + maxes;
  }

  // Keep the highest two dice.
  const ranked = dice.map((d, i) => ({ ...d, i })).sort((a, b) => b.value - a.value || a.i - b.i);
  const keptIdx = new Set(ranked.slice(0, 2).map((d) => d.i));
  const keptSum = ranked.slice(0, 2).reduce((s, d) => s + d.value, 0);

  // Skill contribution: PC skill (key) or a pre-computed flat value (NPC).
  let skillContribution = 0;
  let flavorSkill = null;
  let skillLine = "";
  if (skillKey) {
    const sv = Number(data.skills?.[skillKey]?.value ?? 0);
    const sm = Math.max(1, Number(data.skills?.[skillKey]?.mult ?? 1));
    skillContribution = sv * sm;
    flavorSkill = game.i18n.localize(SKILLS[skillKey].label);
    const term = sm > 1 ? `${sv}×${sm} = ${skillContribution}` : `${sv}`;
    skillLine = `<div class="scp-roll-line">Top two ${keptSum} + ${flavorSkill} ${term}</div>`;
  } else if (skillValue != null) {
    skillContribution = Number(skillValue) || 0;
    flavorSkill = skillLabel;
    skillLine = `<div class="scp-roll-line">Top two ${keptSum} + ${skillLabel ?? "Skill"} ${skillContribution}</div>`;
  }

  // Flat modifiers (to-hit, aim, recoil, range, parameters, …).
  const mods = (flatMods ?? []).filter((m) => Number(m.value) !== 0 || m.always);
  const flatSum = mods.reduce((s, m) => s + (Number(m.value) || 0), 0);
  const modLine = mods.length
    ? `<div class="scp-roll-line">Modifiers: ${mods
        .map((m) => `${m.label} ${(Number(m.value) || 0) >= 0 ? "+" : ""}${Number(m.value) || 0}`)
        .join(", ")}</div>`
    : "";

  const total = keptSum + skillContribution + flatSum;

  // Build the chat card.
  const attrLabel = game.i18n.localize(ATTRIBUTES[attrKey].label);
  const poolDesc = POOL_FACES.filter((f) => base[f] > 0).map((f) => `${base[f]}d${f}`).join(", ");
  const bonusNote = bonusLabel ? ` <span class="scp-roll-bonus">(+${bonusLabel})</span>` : "";
  const diceHtml = dice.map((dd, i) => {
    const cls = ["scp-die", keptIdx.has(i) ? "kept" : "", dd.bonus ? "boom" : ""].filter(Boolean).join(" ");
    const mark = dd.exploded ? " ⚡" : "";
    return `<span class="${cls}">d${dd.faces}:${dd.value}${mark}</span>`;
  }).join(" ");

  const flavor = title || (flavorSkill ? `${attrLabel} + ${flavorSkill}` : attrLabel);
  const allNotes = [...(notes ?? [])];
  if (punished) allNotes.unshift(game.i18n.localize("SCP2E.Roll.PunishedNote"));
  const noteLine = allNotes.length
    ? `<div class="scp-roll-line scp-roll-notes">${allNotes.map((n) => `• ${n}`).join("<br>")}</div>`
    : "";

  const content = `
    <div class="scp2e-roll">
      <div class="scp-roll-head">${flavor}</div>
      <div class="scp-roll-pool">Pool: ${poolDesc}${bonusNote}</div>
      <div class="scp-roll-dice">${diceHtml}</div>
      ${skillLine}
      ${modLine}
      <div class="scp-roll-total">Result: <strong>${total}</strong></div>
      ${noteLine}
      ${cardButton || ""}
    </div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content,
    rolls,
    sound: CONFIG.sounds.dice
  };
  if (messageFlags) messageData.flags = foundry.utils.mergeObject(messageData.flags ?? {}, messageFlags);
  applyChatRollMode(messageData, rollMode);
  await ChatMessage.create(messageData);

  return { total, kept: ranked.slice(0, 2).map((d) => d.value), skillContribution, flatSum };
}
