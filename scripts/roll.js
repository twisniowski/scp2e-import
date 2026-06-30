/**
 * SCP 2e dice roller.
 *
 * Pool dice are d6/d8/d10/d12. Only a 12 on a d12 explodes, adding a single d20
 * (which does not explode further). All rolled dice are candidates; the highest
 * two are summed. For a skill roll, the skill's value is added to that sum.
 *
 * The chat card reports the result only — no difficulty comparison, no pass/fail,
 * no critical labels.
 */
import { ATTRIBUTES, SKILLS } from "./config.js";

const POOL_FACES = [6, 8, 10, 12];

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

  // Build the base formula from the pool counts.
  const terms = [];
  for (const f of POOL_FACES) {
    const n = Math.max(0, Number(pool[`d${f}`] ?? 0));
    if (n > 0) terms.push(`${n}d${f}`);
  }
  if (!terms.length) {
    ui.notifications.warn(
      game.i18n.format("SCP2E.Roll.NoDice", { attr: game.i18n.localize(ATTRIBUTES[attrKey].label) })
    );
    return null;
  }

  // Roll the base pool.
  const baseRoll = await new Roll(terms.join(" + ")).evaluate();
  const dice = [];           // { faces, value, exploded? }
  let twelves = 0;
  for (const term of baseRoll.dice) {
    for (const r of term.results) {
      if (r.active === false) continue;
      dice.push({ faces: term.faces, value: r.result });
      if (term.faces === 12 && r.result === 12) twelves++;
    }
  }

  // Each 12 on a d12 explodes into one d20 (which does not explode).
  const rolls = [baseRoll];
  if (twelves > 0) {
    const bonus = await new Roll(`${twelves}d20`).evaluate();
    rolls.push(bonus);
    for (const term of bonus.dice) {
      for (const r of term.results) dice.push({ faces: 20, value: r.result, fromExplosion: true });
    }
  }

  // Keep the highest two dice.
  const ranked = dice.map((d, i) => ({ ...d, i })).sort((a, b) => b.value - a.value || a.i - b.i);
  const keptIdx = new Set(ranked.slice(0, 2).map((d) => d.i));
  const keptSum = ranked.slice(0, 2).reduce((s, d) => s + d.value, 0);

  // Add skill value for a skill roll.
  let skillVal = 0;
  let skillLabel = null;
  if (skillKey) {
    skillVal = Number(data.skills?.[skillKey]?.value ?? 0);
    skillLabel = game.i18n.localize(SKILLS[skillKey].label);
  }
  const total = keptSum + skillVal;

  // Build the chat card.
  const attrLabel = game.i18n.localize(ATTRIBUTES[attrKey].label);
  const poolDesc = terms.join(", ");
  const diceHtml = dice.map((dd, i) => {
    const cls = ["scp-die", keptIdx.has(i) ? "kept" : "", dd.fromExplosion ? "boom" : ""].filter(Boolean).join(" ");
    const mark = dd.faces === 12 && dd.value === 12 ? " ⚡" : "";
    return `<span class="${cls}">d${dd.faces}:${dd.value}${mark}</span>`;
  }).join(" ");

  const flavor = skillLabel ? `${attrLabel} + ${skillLabel}` : attrLabel;
  const skillLine = skillLabel
    ? `<div class="scp-roll-line">Top two ${keptSum} + ${skillLabel} ${skillVal}</div>`
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
