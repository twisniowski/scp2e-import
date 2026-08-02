/**
 * SCP 2e combat automation.
 *
 * Provides:
 *   - promptRoll():  a small pre-roll popup (public / GM-only + use-exertion) that
 *                    wraps every attribute and skill test.
 *   - useWeapon():   the weapon "Use" button — an attack dialog (attack type, skill,
 *                    distance, aim / recoil / exertion, visibility) that resolves a
 *                    to-hit roll and a damage roll.
 *
 * All numeric weapon fields are stored as free text, so everything is parsed
 * defensively.
 */
import { ATTRIBUTES, SKILLS } from "./config.js";
import { rollPool } from "./roll.js";
import { MODULE_ID, FLAG_KEY } from "./const.js";

/* -------------------------------------------------------------------------- */
/*  Weapon parameter effects                                                  */
/*                                                                            */
/*  EDIT ME: each key maps a weapon parameter tag to its mechanical effect.   */
/*  - toHit               flat modifier added to the to-hit total             */
/*  - rangePenaltyFactor  multiplies the computed range penalty (1 = no change)*/
/*  - damageDicePerRating extra xDam-style dice added per point of rating      */
/*  These values are PLACEHOLDERS — adjust to match the rulebook.             */
/* -------------------------------------------------------------------------- */
export const WEAPON_PARAMS = {
  silenced: { toHit: 0, rangePenaltyFactor: 1,   note: "Stealth only — no combat modifier." },
  sniper:   { toHit: 0, rangePenaltyFactor: 0.5, note: "Range penalty halved." },
  shotgun:  { toHit: 0, rangePenaltyFactor: 2,   note: "Range penalty doubled." },
  burst:    { toHit: 2, rangePenaltyFactor: 1,   note: "+2 to-hit (burst fire)." }
};

/** Spelling variants that map onto a canonical parameter key. */
const PARAM_ALIASES = {
  "3 round burst": "burst", "3-round burst": "burst", "three round burst": "burst", "burst fire": "burst",
  "silencer": "silenced", "suppressed": "silenced", "suppressor": "silenced"
};

/** Parse a free-text integer (handles "+2", "-1", "6 m", ""). */
function num(v) {
  const n = parseInt(String(v ?? "").replace(/[^0-9+\-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Parse an "NdM" dice expression -> { count, faces } (or null). */
function parseDice(s) {
  const m = String(s ?? "").match(/(\d+)\s*d\s*(\d+)/i);
  return m ? { count: Number(m[1]), faces: Number(m[2]) } : null;
}

/** Split a parameters string into canonical tag keys. */
function parseParams(str) {
  return String(str ?? "")
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => PARAM_ALIASES[s] ?? s);
}

/** Aggregate the effects of a set of parameter keys. */
function aggregateParams(keys) {
  let toHit = 0;
  let rangeFactor = 1;
  const notes = [];
  const unknown = [];
  for (const k of keys) {
    const e = WEAPON_PARAMS[k];
    if (!e) { unknown.push(k); continue; }
    toHit += Number(e.toHit || 0);
    rangeFactor *= Number(e.rangePenaltyFactor ?? 1);
    if (e.note) notes.push(`${k}: ${e.note}`);
  }
  return { toHit, rangeFactor, notes, unknown };
}

const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));

/* -------------------------------------------------------------------------- */
/*  Exertion                                                                  */
/* -------------------------------------------------------------------------- */

/** Spend one point of Exertion, if available. Returns true if spent. */
async function spendExertion(actor, data) {
  const cur = Number(data.tracks?.exertion ?? 0);
  if (cur <= 0) return false;
  await actor.setFlag(MODULE_ID, `${FLAG_KEY}.tracks.exertion`, cur - 1);
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Dialog plumbing                                                           */
/* -------------------------------------------------------------------------- */

const DialogV2 = () => foundry.applications?.api?.DialogV2;

/** Read a field value from a rendered DialogV2 by input name. */
function field(dialog, name) {
  const el = dialog?.element?.querySelector(`[name="${name}"]`);
  if (!el) return undefined;
  return el.type === "checkbox" ? el.checked : el.value;
}

/* -------------------------------------------------------------------------- */
/*  Pre-roll options popup (used by every attribute / skill roll)             */
/* -------------------------------------------------------------------------- */

/**
 * Show the small "roll options" popup, then roll the given attribute pool
 * (optionally as a skill check). Handles roll visibility and exertion.
 *
 * @param {Actor}  actor
 * @param {object} data      Normalised SCP flag data.
 * @param {string} attrKey   Governing attribute key for the pool.
 * @param {object} [opts]
 * @param {string|null} [opts.skillKey]     PC skill key to add.
 * @param {number|null} [opts.skillValue]   Flat skill contribution (NPC).
 * @param {string|null} [opts.skillLabel]   Label for skillValue.
 * @param {string|null} [opts.title]        Flavor override.
 */
export async function promptRoll(actor, data, attrKey, opts = {}) {
  const exert = Number(data.tracks?.exertion ?? 0);
  const content = `
    <form class="scp2e-rolldlg">
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Roll.Visibility")}</label>
        <select name="rollMode">
          <option value="publicroll">${game.i18n.localize("SCP2E.Roll.Public")}</option>
          <option value="gmroll">${game.i18n.localize("SCP2E.Roll.GMOnly")}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.format("SCP2E.Roll.UseExertion", { n: exert })}</label>
        <input type="checkbox" name="useExertion" ${exert > 0 ? "" : "disabled"}/>
      </div>
    </form>`;

  const D = DialogV2();
  const result = await D.wait({
    window: { title: game.i18n.localize("SCP2E.Roll.OptionsTitle") },
    content,
    buttons: [
      { action: "roll", label: game.i18n.localize("SCP2E.Roll.Do"), default: true,
        callback: (event, button, dialog) => ({ rollMode: field(dialog, "rollMode"), useExertion: field(dialog, "useExertion") }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!result) return null;

  let bonusPool = null;
  let bonusLabel = null;
  if (result.useExertion && (await spendExertion(actor, data))) {
    bonusPool = { d12: 1 };
    bonusLabel = game.i18n.localize("SCP2E.Roll.ExertionDie");
  }

  return rollPool(actor, data, attrKey, {
    skillKey: opts.skillKey ?? null,
    skillValue: opts.skillValue ?? null,
    skillLabel: opts.skillLabel ?? null,
    title: opts.title ?? null,
    rollMode: result.rollMode,
    bonusPool,
    bonusLabel
  });
}

/* -------------------------------------------------------------------------- */
/*  Distance measurement                                                      */
/* -------------------------------------------------------------------------- */

/** Grid distance from the actor's token to a single targeted token, or null. */
function measuredDistance(actor) {
  try {
    const src = actor.getActiveTokens?.()[0];
    const targets = Array.from(game.user?.targets ?? []);
    if (!src || targets.length !== 1) return null;
    const a = src.center;
    const b = targets[0].center;
    if (canvas.grid?.measurePath) {
      const r = canvas.grid.measurePath([a, b]);
      const d = r?.distance ?? r?.cost;
      if (Number.isFinite(d)) return Math.round(d);
    }
    if (canvas.grid?.measureDistance) return Math.round(canvas.grid.measureDistance(a, b));
    return null;
  } catch (e) {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Weapon attack                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Open the attack dialog for a weapon and resolve it (to-hit + damage).
 * @param {Actor}  actor
 * @param {object} data           Normalised SCP flag data.
 * @param {number} weaponIndex
 * @param {object} [opts]
 * @param {boolean} [opts.isNpc]  NPC uses Perception/Dexterity pool + Physical skill.
 */
export async function useWeapon(actor, data, weaponIndex, { isNpc = false } = {}) {
  const weapon = (data.weapons ?? [])[weaponIndex];
  if (!weapon) {
    ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoWeapon"));
    return;
  }

  const rangeNum = num(weapon.range);
  const defaultType = rangeNum > 0 ? "ranged" : "melee";
  const measured = measuredDistance(actor);
  const exert = Number(data.tracks?.exertion ?? 0);
  const paramKeys = parseParams(weapon.params);
  const paramFx = aggregateParams(paramKeys);

  // PC skill selector (defaults: Firearms for ranged, Melee for melee).
  const skillOptions = Object.entries(SKILLS)
    .map(([k, def]) => `<option value="${k}" data-gov="${def.gov}">${game.i18n.localize(def.label)}</option>`)
    .join("");
  const skillBlock = isNpc
    ? `<p class="scp2e-attack-note">${game.i18n.localize("SCP2E.Attack.NpcNote")}</p>`
    : `<div class="form-group">
         <label>${game.i18n.localize("SCP2E.Attack.Skill")}</label>
         <select name="skillKey">${skillOptions}</select>
       </div>`;

  const paramLine = paramKeys.length
    ? `<p class="scp2e-attack-params">${game.i18n.localize("SCP2E.Weapons.Params")}: ${esc(paramKeys.join(", "))}${
        paramFx.unknown.length ? ` <em>(${game.i18n.localize("SCP2E.Attack.UnknownParams")}: ${esc(paramFx.unknown.join(", "))})</em>` : ""
      }</p>`
    : "";

  const content = `
    <form class="scp2e-attackdlg">
      <h3 class="scp2e-attack-title">${esc(weapon.name || game.i18n.localize("SCP2E.Attack.Weapon"))}</h3>
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Attack.Type")}</label>
        <select name="attackType">
          <option value="ranged" ${defaultType === "ranged" ? "selected" : ""}>${game.i18n.localize("SCP2E.Attack.Ranged")}</option>
          <option value="melee" ${defaultType === "melee" ? "selected" : ""}>${game.i18n.localize("SCP2E.Attack.Melee")}</option>
        </select>
      </div>
      ${skillBlock}
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Attack.Distance")}</label>
        <input type="number" name="distance" value="${measured ?? ""}" min="0" step="1" placeholder="—"/>
      </div>
      <div class="form-group scp2e-attack-checks">
        <label><input type="checkbox" name="applyAim"/> ${game.i18n.format("SCP2E.Attack.Aim", { n: num(weapon.aim) })}</label>
        <label><input type="checkbox" name="applyRecoil"/> ${game.i18n.format("SCP2E.Attack.Recoil", { n: num(weapon.recoil) })}</label>
        <label><input type="checkbox" name="useExertion" ${exert > 0 ? "" : "disabled"}/> ${game.i18n.format("SCP2E.Roll.UseExertion", { n: exert })}</label>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Roll.Visibility")}</label>
        <select name="rollMode">
          <option value="publicroll">${game.i18n.localize("SCP2E.Roll.Public")}</option>
          <option value="gmroll">${game.i18n.localize("SCP2E.Roll.GMOnly")}</option>
        </select>
      </div>
      <p class="scp2e-attack-tohit">${game.i18n.format("SCP2E.Attack.ToHitAlways", { n: num(weapon.toHit) })}</p>
      ${paramLine}
    </form>`;

  const D = DialogV2();
  const choice = await D.wait({
    window: { title: game.i18n.localize("SCP2E.Attack.Title"), icon: "fa-solid fa-crosshairs" },
    content,
    buttons: [
      { action: "attack", label: game.i18n.localize("SCP2E.Attack.Do"), default: true,
        callback: (event, button, dialog) => ({
          attackType: field(dialog, "attackType"),
          skillKey: field(dialog, "skillKey"),
          distance: field(dialog, "distance"),
          applyAim: field(dialog, "applyAim"),
          applyRecoil: field(dialog, "applyRecoil"),
          useExertion: field(dialog, "useExertion"),
          rollMode: field(dialog, "rollMode")
        }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!choice) return;

  const ranged = choice.attackType === "ranged";

  /* ---- flat modifiers -------------------------------------------------- */
  const flatMods = [];
  const toHit = num(weapon.toHit);
  if (toHit) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.ToHit"), value: toHit });
  if (choice.applyAim) {
    const aim = num(weapon.aim);
    if (aim) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.Aim"), value: aim });
  }
  if (choice.applyRecoil) {
    const recoil = num(weapon.recoil);
    if (recoil) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.Recoil"), value: -Math.abs(recoil) });
  }
  if (paramFx.toHit) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.Params"), value: paramFx.toHit });

  // Range penalty: -floor(distance / weapon range), scaled by parameter factor.
  const distance = num(choice.distance);
  if (rangeNum > 0 && distance > 0) {
    let penalty = Math.floor(distance / rangeNum);
    penalty = Math.floor(penalty * paramFx.rangeFactor);
    if (penalty > 0) flatMods.push({ label: game.i18n.format("SCP2E.Attack.RangePenalty", { d: distance }), value: -penalty });
  }

  /* ---- exertion -------------------------------------------------------- */
  let bonusPool = null;
  let bonusLabel = null;
  if (choice.useExertion && (await spendExertion(actor, data))) {
    bonusPool = { d12: 1 };
    bonusLabel = game.i18n.localize("SCP2E.Roll.ExertionDie");
  }

  /* ---- to-hit roll ----------------------------------------------------- */
  const typeLabel = game.i18n.localize(ranged ? "SCP2E.Attack.Ranged" : "SCP2E.Attack.Melee");
  const title = `${weapon.name || game.i18n.localize("SCP2E.Attack.Weapon")} — ${typeLabel}`;

  let rollArgs;
  if (isNpc) {
    const attrKey = ranged ? "perception" : "dexterity";
    const phys = data.npc?.skills?.physical ?? {};
    const mult = Math.max(1, Number(phys.mult) || 1);
    const skillValue = (Number(phys.value) || 0) * mult;
    rollArgs = { attrKey, skillValue, skillLabel: game.i18n.localize("SCP2E.Npc.Physical") };
  } else {
    const skillKey = choice.skillKey || (ranged ? "firearms" : "melee");
    const attrKey = SKILLS[skillKey]?.gov ?? (ranged ? "perception" : "dexterity");
    rollArgs = { attrKey, skillKey };
  }

  await rollPool(actor, data, rollArgs.attrKey, {
    skillKey: rollArgs.skillKey ?? null,
    skillValue: rollArgs.skillValue ?? null,
    skillLabel: rollArgs.skillLabel ?? null,
    flatMods,
    bonusPool,
    bonusLabel,
    rollMode: choice.rollMode,
    title
  });

  /* ---- damage roll ----------------------------------------------------- */
  await rollDamage(actor, data, weapon, { ranged, rollMode: choice.rollMode });
}

/**
 * Roll weapon damage: base damage + (xDam die-count × rating)d(faces), where
 * rating = Projectile (ranged) or Combat (melee).
 */
async function rollDamage(actor, data, weapon, { ranged, rollMode }) {
  const rating = ranged ? num(data.combat?.projectile) : num(data.combat?.combat);
  const x = parseDice(weapon.xDam);
  const parts = [];

  const base = String(weapon.bDam ?? "").trim();
  if (base) parts.push(base);

  let xDesc = "";
  if (x && rating > 0) {
    const n = x.count * rating;
    if (n > 0) { parts.push(`${n}d${x.faces}`); xDesc = `${x.count}d${x.faces} × ${rating}`; }
  }

  if (!parts.length) return; // nothing to roll

  const formula = parts.join(" + ");
  let roll;
  try {
    roll = await new Roll(formula).evaluate();
  } catch (err) {
    console.warn("SCP2e | damage formula failed:", formula, err);
    return;
  }

  const ratingLabel = game.i18n.localize(ranged ? "SCP2E.Field.Projectile" : "SCP2E.Field.Combat");
  const flavor = `${weapon.name || game.i18n.localize("SCP2E.Attack.Weapon")} — ${game.i18n.localize("SCP2E.Attack.Damage")}`;
  const detail = xDesc ? `${esc(base || "0")} + ${esc(xDesc)}` : esc(formula);
  const content = `
    <div class="scp2e-roll">
      <div class="scp-roll-head">${flavor}</div>
      <div class="scp-roll-pool">${detail} <span class="scp-roll-bonus">(${ratingLabel} ${rating})</span></div>
      <div class="scp-roll-total">${game.i18n.localize("SCP2E.Attack.Damage")}: <strong>${roll.total}</strong></div>
    </div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  };
  ChatMessage.applyRollMode(messageData, rollMode || game.settings.get("core", "rollMode"));
  await ChatMessage.create(messageData);
}
