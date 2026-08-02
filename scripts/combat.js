/**
 * SCP 2e combat automation.
 *
 * Provides:
 *   - promptRoll():  a small pre-roll popup (public / GM-only + use-exertion) that
 *                    wraps every attribute and skill test.
 *   - useWeapon():   the weapon "Use" button — an attack dialog (attack type, skill,
 *                    distance, aim / recoil / exertion, visibility) that resolves a
 *                    to-hit roll and a damage roll, honouring weapon keywords.
 *
 * All numeric weapon fields are stored as free text, so everything is parsed
 * defensively.
 */
import { SKILLS } from "./config.js";
import { rollPool } from "./roll.js";
import { MODULE_ID, FLAG_KEY } from "./const.js";

/* -------------------------------------------------------------------------- */
/*  Weapon keyword ("Special") effects — SCP 2e rulebook p151/p153            */
/*                                                                            */
/*  Effect fields understood by the attack resolver:                          */
/*   aimMax               max number of Aim actions allowed (default 1)        */
/*   rangeMode "bonus"    range increments ADD to To-Hit (shotgun) instead of  */
/*                        subtracting                                          */
/*   damageDicePerIncrement  dice added(+)/removed(-) per range increment      */
/*   staggerToggle        offer a "target Staggered" toggle; +1 die type dmg   */
/*   damageDoubleMax      damage dice rolling their max are doubled (Lashing)   */
/*   thrown               use higher of Combat/Projectile; ignore negative     */
/*                        To-Hit (Throwing Weapons)                            */
/*   reminder             text shown on the card (rule the tool can't auto-    */
/*                        apply, e.g. success-margin effects)                  */
/* -------------------------------------------------------------------------- */
export const WEAPON_PARAMS = {
  // --- Firearms ---
  "shotgun":     { rangeMode: "bonus", damageDicePerIncrement: -1,
                   note: "Shotgun: range increments ADD to To-Hit and remove one damage die each." },
  "sniper":      { aimMax: 3, note: "Sniper: may Aim up to 3× (requires prep; two-handed)." },
  "aim+":        { aimMax: 2, note: "Aim+: may Aim up to 2×." },
  "automatic":   { reminder: "Automatic: +1 damage for each point the To-Hit beats the target (apply manually)." },
  "3-r burst":   { reminder: "3-R Burst: if the To-Hit succeeds by 3+, add +2 Base Damage dice (apply manually)." },
  "lightweight": { reminder: "Lightweight: −1 Draw Action (no attack effect)." },
  "silencer":    { reminder: "Silencer: suppressed — no combat modifier." },
  // --- Melee ---
  "assassin":     { staggerToggle: true, note: "Assassin: vs a Staggered target, +1 die type to all damage dice." },
  "lashing":      { damageDoubleMax: true, note: "Lashing: damage dice that roll their max are doubled." },
  "bonecrushing": { reminder: "Bonecrushing: a Critical Hit Staggers the target (apply manually)." },
  "compartment":  { reminder: "Compartment: hidden storage — no combat effect." },
  "disguised":    { reminder: "Disguised: no SUS penalty when drawn — no combat effect." },
  "mechanized retraction": { reminder: "Mechanized Retraction: −1 Draw Action." },
  "oversized":    { reminder: "Oversized: attacking costs two Actions, +2 SUS." },
  "throwing wep": { thrown: true, note: "Thrown: uses the higher of Combat/Projectile; ignores a negative To-Hit." }
};

/** Spelling variants that map onto a canonical keyword key. */
const PARAM_ALIASES = {
  "3 round burst": "3-r burst", "3-round burst": "3-r burst", "3r burst": "3-r burst",
  "three round burst": "3-r burst", "burst": "3-r burst", "burst fire": "3-r burst",
  "aimplus": "aim+", "aim +": "aim+",
  "suppressed": "silencer", "suppressor": "silenced", "silenced": "silencer",
  "throwing": "throwing wep", "throwing weapon": "throwing wep", "throwing weapons": "throwing wep",
  "throwing wep.": "throwing wep", "throwable": "throwing wep"
};

const DIE_ORDER = [4, 6, 8, 10, 12, 20];

/**
 * The pickable weapon keywords, with display labels, grouped by weapon family.
 * `key` is the canonical value stored in weapon.params (matches WEAPON_PARAMS).
 */
export const PARAM_CHOICES = [
  { key: "shotgun", label: "Shotgun", group: "firearms" },
  { key: "sniper", label: "Sniper", group: "firearms" },
  { key: "aim+", label: "Aim+", group: "firearms" },
  { key: "automatic", label: "Automatic", group: "firearms" },
  { key: "3-r burst", label: "3-R Burst", group: "firearms" },
  { key: "lightweight", label: "Lightweight", group: "firearms" },
  { key: "silencer", label: "Silencer", group: "firearms" },
  { key: "assassin", label: "Assassin", group: "melee" },
  { key: "bonecrushing", label: "Bonecrushing", group: "melee" },
  { key: "compartment", label: "Compartment", group: "melee" },
  { key: "disguised", label: "Disguised", group: "melee" },
  { key: "lashing", label: "Lashing", group: "melee" },
  { key: "mechanized retraction", label: "Mechanized Retraction", group: "melee" },
  { key: "oversized", label: "Oversized", group: "melee" },
  { key: "throwing wep", label: "Throwing Wep.", group: "melee" }
];
const PARAM_LABELS = Object.fromEntries(PARAM_CHOICES.map((c) => [c.key, c.label]));

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

/** Bump a die's faces up `steps` types (D6 -> D8 …), capped at D20. */
function bumpFaces(faces, steps) {
  const i = DIE_ORDER.indexOf(faces);
  if (i < 0) return faces;
  return DIE_ORDER[Math.min(DIE_ORDER.length - 1, i + steps)];
}

/** Split a parameters string into canonical keyword keys. */
function parseParams(str) {
  return String(str ?? "")
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => PARAM_ALIASES[s] ?? s);
}

/** Aggregate the effects of a set of keyword keys. */
function aggregateParams(keys) {
  const fx = {
    aimMax: 1, rangeMode: "normal", damageDicePerIncrement: 0,
    staggerToggle: false, damageDoubleMax: false, thrown: false,
    notes: [], reminders: [], unknown: []
  };
  for (const k of keys) {
    const e = WEAPON_PARAMS[k];
    if (!e) { fx.unknown.push(k); continue; }
    if (e.aimMax) fx.aimMax = Math.max(fx.aimMax, e.aimMax);
    if (e.rangeMode === "bonus") fx.rangeMode = "bonus";
    if (e.damageDicePerIncrement) fx.damageDicePerIncrement += e.damageDicePerIncrement;
    if (e.staggerToggle) fx.staggerToggle = true;
    if (e.damageDoubleMax) fx.damageDoubleMax = true;
    if (e.thrown) fx.thrown = true;
    if (e.note) fx.notes.push(e.note);
    if (e.reminder) fx.reminders.push(e.reminder);
  }
  return fx;
}

const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));

/** Turn a stored params string into display tags: [{ key, label, known }]. */
export function paramTagsFor(str) {
  return parseParams(str).map((key) => ({ key, label: PARAM_LABELS[key] ?? key, known: key in WEAPON_PARAMS }));
}

/** Overwrite a single field on one weapon row and persist the weapons array. */
async function setWeaponField(actor, data, index, fieldName, value) {
  const rows = foundry.utils.deepClone(data.weapons ?? []);
  if (!rows[index]) return;
  rows[index][fieldName] = value;
  await actor.setFlag(MODULE_ID, `${FLAG_KEY}.weapons`, rows);
}

/** Open the tag picker and add the chosen keyword to a weapon (no free text). */
export async function addWeaponParam(actor, data, weaponIndex) {
  const weapon = (data.weapons ?? [])[weaponIndex];
  if (!weapon) return;
  const existing = new Set(parseParams(weapon.params));
  const available = PARAM_CHOICES.filter((c) => !existing.has(c.key));
  if (!available.length) {
    ui.notifications.info(game.i18n.localize("SCP2E.Param.AllAdded"));
    return;
  }

  const optGroup = (grp, lbl) => {
    const opts = available.filter((c) => c.group === grp).map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join("");
    return opts ? `<optgroup label="${lbl}">${opts}</optgroup>` : "";
  };
  const content = `
    <form class="scp2e-paramdlg">
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Param.Choose")}</label>
        <select name="paramKey">
          ${optGroup("firearms", game.i18n.localize("SCP2E.Param.Firearms"))}
          ${optGroup("melee", game.i18n.localize("SCP2E.Param.Melee"))}
        </select>
      </div>
    </form>`;

  const D = DialogV2();
  const key = await D.wait({
    window: { title: game.i18n.localize("SCP2E.Param.Title"), icon: "fa-solid fa-tag" },
    content,
    buttons: [
      { action: "add", label: game.i18n.localize("SCP2E.Param.Add"), default: true,
        callback: (event, button, dialog) => field(dialog, "paramKey") },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!key) return;

  const next = [...new Set([...parseParams(weapon.params), key])];
  await setWeaponField(actor, data, weaponIndex, "params", next.join(", "));
}

/** Remove a keyword tag from a weapon. */
export async function removeWeaponParam(actor, data, weaponIndex, key) {
  const weapon = (data.weapons ?? [])[weaponIndex];
  if (!weapon) return;
  const next = parseParams(weapon.params).filter((k) => k !== key);
  await setWeaponField(actor, data, weaponIndex, "params", next.join(", "));
}

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
 * @param {boolean} [opts.isNpc]  NPC uses Perception/Dexterity pool + Physical skill.
 */
export async function useWeapon(actor, data, weaponIndex, { isNpc = false } = {}) {
  const weapon = (data.weapons ?? [])[weaponIndex];
  if (!weapon) {
    ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoWeapon"));
    return;
  }

  const rangeNum = num(weapon.range);
  const defaultType = rangeNum > 1 ? "ranged" : "melee";
  const measured = measuredDistance(actor);
  const exert = Number(data.tracks?.exertion ?? 0);
  const keys = parseParams(weapon.params);
  const fx = aggregateParams(keys);
  const aimVal = num(weapon.aim);

  // PC skill selector (defaults: Firearms for ranged, Melee for melee).
  const skillOptions = Object.entries(SKILLS)
    .map(([k, def]) => `<option value="${k}">${game.i18n.localize(def.label)}</option>`)
    .join("");
  const skillBlock = isNpc
    ? `<p class="scp2e-attack-note">${game.i18n.localize("SCP2E.Attack.NpcNote")}</p>`
    : `<div class="form-group">
         <label>${game.i18n.localize("SCP2E.Attack.Skill")}</label>
         <select name="skillKey">${skillOptions}</select>
       </div>`;

  // Aim selector 0..aimMax.
  const aimOpts = Array.from({ length: fx.aimMax + 1 }, (_, n) => `<option value="${n}">${n}×</option>`).join("");
  const aimBlock = `<div class="form-group">
      <label>${game.i18n.format("SCP2E.Attack.AimTimes", { n: aimVal })}</label>
      <select name="aimCount">${aimOpts}</select>
    </div>`;

  const staggerBlock = fx.staggerToggle
    ? `<label class="scp2e-check"><input type="checkbox" name="staggered"/> ${game.i18n.localize("SCP2E.Attack.Staggered")}</label>`
    : "";

  const noteBits = [...fx.notes, ...fx.reminders];
  const notesBlock = noteBits.length
    ? `<div class="scp2e-attack-keywords">${noteBits.map((n) => `• ${esc(n)}`).join("<br>")}</div>`
    : "";
  const unknownBlock = fx.unknown.length
    ? `<p class="scp2e-attack-params"><em>${game.i18n.localize("SCP2E.Attack.UnknownParams")}: ${esc(fx.unknown.join(", "))}</em></p>`
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
      ${aimBlock}
      <div class="form-group scp2e-attack-checks">
        <label class="scp2e-check"><input type="checkbox" name="applyRecoil"/> ${game.i18n.format("SCP2E.Attack.Recoil", { n: num(weapon.recoil) })}</label>
        ${staggerBlock}
        <label class="scp2e-check"><input type="checkbox" name="useExertion" ${exert > 0 ? "" : "disabled"}/> ${game.i18n.format("SCP2E.Roll.UseExertion", { n: exert })}</label>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SCP2E.Roll.Visibility")}</label>
        <select name="rollMode">
          <option value="publicroll">${game.i18n.localize("SCP2E.Roll.Public")}</option>
          <option value="gmroll">${game.i18n.localize("SCP2E.Roll.GMOnly")}</option>
        </select>
      </div>
      <p class="scp2e-attack-tohit">${game.i18n.format("SCP2E.Attack.ToHitAlways", { n: num(weapon.toHit) })}</p>
      ${notesBlock}
      ${unknownBlock}
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
          aimCount: field(dialog, "aimCount"),
          applyRecoil: field(dialog, "applyRecoil"),
          staggered: field(dialog, "staggered"),
          useExertion: field(dialog, "useExertion"),
          rollMode: field(dialog, "rollMode")
        }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!choice) return;

  const ranged = choice.attackType === "ranged";

  /* ---- flat To-Hit modifiers ------------------------------------------ */
  const flatMods = [];
  let toHit = num(weapon.toHit);
  if (fx.thrown && toHit < 0) toHit = 0;               // thrown ignores a negative To-Hit
  if (toHit) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.ToHit"), value: toHit });

  const aimCount = Math.max(0, Math.min(fx.aimMax, num(choice.aimCount)));
  if (aimCount > 0 && aimVal) flatMods.push({ label: `${game.i18n.localize("SCP2E.Weapons.Aim")} ×${aimCount}`, value: aimVal * aimCount });

  if (choice.applyRecoil) {
    const recoil = num(weapon.recoil);
    if (recoil) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.Recoil"), value: -Math.abs(recoil) });
  }

  // Range increments (rulebook p151): the first band (distance ≤ range) is free,
  // then one step per further band → ceil(distance / range) − 1.
  // Normal → To-Hit penalty; Shotgun → To-Hit bonus (and −1 damage die each).
  const distance = num(choice.distance);
  const hasAsterisk = /\*/.test(String(weapon.range ?? ""));
  let increments = 0;
  if (rangeNum > 0 && distance > 0) increments = Math.max(0, Math.ceil(distance / rangeNum) - 1);
  if (increments > 0) {
    if (fx.rangeMode === "bonus") {
      flatMods.push({ label: game.i18n.format("SCP2E.Attack.RangeBonus", { d: distance }), value: increments });
    } else {
      flatMods.push({ label: game.i18n.format("SCP2E.Attack.RangePenalty", { d: distance }), value: -increments });
    }
  }
  // Asterisked range is a hard cap (e.g. melee "1*"): note if the target is beyond it.
  if (hasAsterisk && rangeNum > 0 && distance > rangeNum) {
    fx.reminders.push(game.i18n.format("SCP2E.Attack.BeyondRange", { r: rangeNum }));
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
    title,
    notes: fx.reminders
  });

  /* ---- damage roll ----------------------------------------------------- */
  await rollDamage(actor, data, weapon, {
    ranged,
    thrown: fx.thrown,
    rollMode: choice.rollMode,
    dieTypeBump: (fx.staggerToggle && choice.staggered) ? 1 : 0,
    diceDelta: fx.damageDicePerIncrement * increments,   // shotgun: negative
    doubleMax: fx.damageDoubleMax,
    reminders: fx.reminders
  });
}

/**
 * Roll weapon damage: Base Damage + (X.Dam die-count × rating)d(faces), where
 * rating = Projectile (ranged) / Combat (melee) / higher of the two (thrown).
 * Applies keyword damage effects: die-type bump (Assassin), dice add/remove
 * (Shotgun range), and double-on-max (Lashing).
 */
async function rollDamage(actor, data, weapon, { ranged, thrown, rollMode, dieTypeBump = 0, diceDelta = 0, doubleMax = false, reminders = [] }) {
  const combat = num(data.combat?.combat);
  const projectile = num(data.combat?.projectile);
  const rating = thrown ? Math.max(combat, projectile) : (ranged ? projectile : combat);

  // Build a flat list of dice faces (base first, then X damage).
  let list = [];
  const base = parseDice(weapon.bDam);
  let baseFlat = 0;
  if (base) for (let k = 0; k < base.count; k++) list.push(base.faces);
  else baseFlat = num(weapon.bDam);   // support a flat base value

  const x = parseDice(weapon.xDam);
  if (x && rating > 0) for (let k = 0; k < x.count * rating; k++) list.push(x.faces);

  // Assassin: bump every damage die up one type.
  if (dieTypeBump > 0) list = list.map((f) => bumpFaces(f, dieTypeBump));

  // Shotgun range: remove dice (from the X.Dam end first). diceDelta is negative.
  if (diceDelta < 0) { let r = -diceDelta; while (r > 0 && list.length > 0) { list.pop(); r--; } }
  else if (diceDelta > 0) { const f = list[list.length - 1] ?? (x?.faces ?? base?.faces ?? 6); for (let k = 0; k < diceDelta; k++) list.push(f); }

  if (!list.length && !baseFlat) return;

  // Group into an evaluable formula.
  const groups = {};
  for (const f of list) groups[f] = (groups[f] || 0) + 1;
  const terms = Object.entries(groups).map(([f, c]) => `${c}d${f}`);
  if (baseFlat) terms.push(String(baseFlat));
  const formula = terms.join(" + ") || "0";

  let roll;
  try {
    roll = await new Roll(formula).evaluate();
  } catch (err) {
    console.warn("SCP2e | damage formula failed:", formula, err);
    return;
  }

  // Lashing: dice that rolled their max are doubled.
  let total = roll.total;
  if (doubleMax) {
    total = baseFlat;
    for (const term of roll.dice) {
      for (const r of term.results) {
        if (r.active === false) continue;
        total += r.result + (r.result === term.faces ? r.result : 0);
      }
    }
  }

  const ratingLabel = thrown
    ? game.i18n.localize("SCP2E.Attack.ThrownRating")
    : game.i18n.localize(ranged ? "SCP2E.Field.Projectile" : "SCP2E.Field.Combat");
  const flavor = `${weapon.name || game.i18n.localize("SCP2E.Attack.Weapon")} — ${game.i18n.localize("SCP2E.Attack.Damage")}`;
  const noteLine = reminders.length
    ? `<div class="scp-roll-line scp-roll-notes">${reminders.map((n) => `• ${esc(n)}`).join("<br>")}</div>`
    : "";
  const content = `
    <div class="scp2e-roll">
      <div class="scp-roll-head">${flavor}</div>
      <div class="scp-roll-pool">${esc(formula)} <span class="scp-roll-bonus">(${ratingLabel} ${rating})</span></div>
      <div class="scp-roll-total">${game.i18n.localize("SCP2E.Attack.Damage")}: <strong>${total}</strong></div>
      ${noteLine}
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
