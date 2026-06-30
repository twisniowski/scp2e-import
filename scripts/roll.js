/**
 * SCP 2e dice roller.
 *
 * Pool dice are d6/d8/d10/d12. Every die explodes into ONE die of the next type
 * up when it rolls its maximum face (6 on a d6 -> +1d8, 8 on a d8 -> +1d10,
 * 10 -> +1d12, 12 -> +1d20). Bonus dice can themselves explode the same way. The
 * only die that does NOT explode is the d20.
 *
 * All rolled dice are candidates; the highest two are summed. For a skill roll,
 * the skill's value is added to that sum. The chat card reports the result only —
 * no difficulty comparison, no pass/fail, no critical labels.
 */
import { ATTRIBUTES, SKILLS } from "./config.js";

const POOL_FACES = [6, 8, 10, 12];           // editable pool dice
const ORDER = [6, 8, 10, 12, 20];            // ascending so explosions cascade in one pass
const NEXT_FACE = { 6: 8, 8: 10, 10: 12, 12: 20, 20: null };

/**
 * Roll an attribute pool (optionally as a skill check).
 * @param {Actor}  actor
 * @param {object} data       Normalised SCP flag data.
 * @param {string} attrKey    Attribute key to roll.
 * @param {object} [opts]
 * @param {string|null} [opts.skillKey]  If set, add this skill's value to the result.
 */
export async function rollPool(actor, data, attrKey, { skillKey = null } = {}) {
  const attr = data.attributes?.[attrKey] ?? {};
  const pool = attr.dice ?? {};

  // Base pool counts (d20 always starts at 0; it only appears via explosions).
  const base = { 6: 0, 8: 0, 10: 0, 12: 0, 20: 0 };
  for (const f of POOL_FACES) base[f] = Math.max(0, Number(pool[`d${f}`] ?? 0));
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
        const isMax = r.result === f && NEXT_FACE[f] !== null;
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

  // Add skill value for a skill roll.
  let skillVal = 0;
  let skillMult = 1;
  let skillContribution = 0;
  let skillLabel = null;
  if (skillKey) {
    skillVal = Number(data.skills?.[skillKey]?.value ?? 0);
    skillMult = Math.max(1, Number(data.skills?.[skillKey]?.mult ?? 1));
    skillContribution = skillVal * skillMult;
    skillLabel = game.i18n.localize(SKILLS[skillKey].label);
  }
  const total = keptSum + skillContribution;

  // Build the chat card.
  const attrLabel = game.i18n.localize(ATTRIBUTES[attrKey].label);
  const poolDesc = POOL_FACES.filter((f) => base[f] > 0).map((f) => `${base[f]}d${f}`).join(", ");
  const diceHtml = dice.map((dd, i) => {
    const cls = ["scp-die", keptIdx.has(i) ? "kept" : "", dd.bonus ? "boom" : ""].filter(Boolean).join(" ");
    const mark = dd.exploded ? " ⚡" : "";
    return `<span class="${cls}">d${dd.faces}:${dd.value}${mark}</span>`;
  }).join(" ");

  const flavor = skillLabel ? `${attrLabel} + ${skillLabel}` : attrLabel;
  const skillTerm = skillMult > 1 ? `${skillVal}\u00d7${skillMult} = ${skillContribution}` : `${skillVal}`;
  const skillLine = skillLabel
    ? `<div class="scp-roll-line">Top two ${keptSum} + ${skillLabel} ${skillTerm}</div>`
    : "";

  const content = `
    <div class="scp2e-roll">
      <div class="scp-roll-head">${flavor}</div>
      <div class="scp-roll-pool">Pool: ${poolDesc}</div>
      <div class="scp-roll-dice">${diceHtml}</div>
      ${skillLine}
      <div class="scp-roll-total">Result: <strong>${total}</strong></div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content,
    rolls,
    sound: CONFIG.sounds.dice
  });

  return { total, kept: ranked.slice(0, 2).map((d) => d.value), skillVal };
}
