/**
 * SCP 2e combat automation.
 *
 *   - promptRoll():   pre-roll popup (visibility + exertion dice) for every
 *                     attribute / skill test.
 *   - useWeapon():    the weapon "Use" button — an attack dialog resolving the
 *                     to-hit roll, honouring weapon keywords. The result card
 *                     carries a "Confirm hit — roll damage" button.
 *   - confirmDamage(): triggered by that button; optionally spends Exertion to
 *                     boost Combat/Projectile rating, then rolls damage (dice shown).
 *
 * Exertion (rulebook p59): 1 point = +1D12 on an Attribute roll (multiple
 * allowed); 1 point = +1 Combat/Projectile rating for an attack.
 */
import { SKILLS } from "./config.js";
import { rollPool } from "./roll.js";
import { normalizeData } from "./data-model.js";
import { MODULE_ID, FLAG_KEY, applyChatRollMode } from "./const.js";

/* -------------------------------------------------------------------------- */
/*  Weapon keyword ("Special") effects — SCP 2e rulebook p151/p153            */
/* -------------------------------------------------------------------------- */
export const WEAPON_PARAMS = {
  "shotgun":     { rangeMode: "bonus", damageDicePerIncrement: -1,
                   note: "Shotgun: range increments ADD to To-Hit and remove one damage die each." },
  "sniper":      { aimMax: 3, note: "Sniper: may Aim up to 3× (requires prep; two-handed)." },
  "aim+":        { aimMax: 2, note: "Aim+: may Aim up to 2×." },
  "automatic":   { reminder: "Automatic: +1 damage for each point the To-Hit beats the target (apply manually)." },
  "3-r burst":   { reminder: "3-R Burst: if the To-Hit succeeds by 3+, add +2 Base Damage dice (apply manually)." },
  "lightweight": { reminder: "Lightweight: −1 Draw Action (no attack effect)." },
  "silencer":    { reminder: "Silencer: suppressed — no combat modifier." },
  "assassin":     { staggerToggle: true, note: "Assassin: vs a Staggered target, +1 die type to all damage dice." },
  "lashing":      { damageDoubleMax: true, note: "Lashing: damage dice that roll their max are doubled." },
  "bonecrushing": { reminder: "Bonecrushing: a Critical Hit Staggers the target (apply manually)." },
  "compartment":  { reminder: "Compartment: hidden storage — no combat effect." },
  "disguised":    { reminder: "Disguised: no SUS penalty when drawn — no combat effect." },
  "mechanized retraction": { reminder: "Mechanized Retraction: −1 Draw Action." },
  "oversized":    { reminder: "Oversized: attacking costs two Actions, +2 SUS." },
  "throwing wep": { thrown: true, note: "Thrown: uses the higher of Combat/Projectile; ignores a negative To-Hit." }
};

const PARAM_ALIASES = {
  "3 round burst": "3-r burst", "3-round burst": "3-r burst", "3r burst": "3-r burst",
  "three round burst": "3-r burst", "burst": "3-r burst", "burst fire": "3-r burst",
  "aimplus": "aim+", "aim +": "aim+",
  "suppressed": "silencer", "suppressor": "silencer", "silenced": "silencer",
  "throwing": "throwing wep", "throwing weapon": "throwing wep", "throwing weapons": "throwing wep",
  "throwing wep.": "throwing wep", "throwable": "throwing wep"
};

const DIE_ORDER = [4, 6, 8, 10, 12, 20];

/** Pickable weapon keywords with display labels, grouped by weapon family. */
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

/** Parse an "NdM" dice expression -> { count, faces }. A missing count means 1 (d8 = 1d8). */
function parseDice(s) {
  const m = String(s ?? "").match(/(\d*)\s*d\s*(\d+)/i);
  if (!m) return null;
  return { count: m[1] ? Number(m[1]) : 1, faces: Number(m[2]) };
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
  // DialogV2 coalesces a null callback result to the button action name, so
  // Cancel yields "cancel". Only accept a real, known keyword key.
  if (!key || !PARAM_LABELS[key]) return;

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

/** Spend up to `n` points of Exertion. Returns the number actually spent. */
async function spendExertion(actor, data, n = 1) {
  const cur = Number(data.tracks?.exertion ?? 0);
  const spend = Math.min(Math.max(0, Math.floor(n)), cur);
  if (spend <= 0) return 0;
  await actor.setFlag(MODULE_ID, `${FLAG_KEY}.tracks.exertion`, cur - spend);
  return spend;
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

/**
 * Best-effort: when the "punished" checkbox is ticked, disable the exertion
 * input (punished rolls can't use Exertion). Correctness is also enforced at
 * submit, so this is purely a UX nicety.
 */
function wirePunished(elOrDialog) {
  try {
    const root = elOrDialog?.element ?? (elOrDialog instanceof HTMLElement ? elOrDialog : null);
    if (!root) return;
    const pun = root.querySelector('[name="punished"]');
    const ex = root.querySelector('[name="exertDice"]');
    if (!pun || !ex) return;
    const exAvailable = !ex.disabled;
    const sync = () => {
      if (pun.checked) { ex.value = "0"; ex.disabled = true; }
      else ex.disabled = !exAvailable;
    };
    pun.addEventListener("change", sync);
    sync();
  } catch (e) { /* non-fatal */ }
}

/* -------------------------------------------------------------------------- */
/*  Pre-roll options popup (used by every attribute / skill roll)             */
/* -------------------------------------------------------------------------- */

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
      <div class="form-group scp2e-check-row">
        <label class="scp2e-check"><input type="checkbox" name="punished"/> ${game.i18n.localize("SCP2E.Roll.Punished")}</label>
      </div>
      <div class="form-group">
        <label>${game.i18n.format("SCP2E.Roll.ExertionDice", { n: exert })}</label>
        <input type="number" name="exertDice" value="0" min="0" max="${exert}" step="1" ${exert > 0 ? "" : "disabled"}/>
      </div>
    </form>`;

  const D = DialogV2();
  const result = await D.wait({
    window: { title: game.i18n.localize("SCP2E.Roll.OptionsTitle") },
    content,
    render: (event, dialog) => wirePunished(dialog ?? event),
    buttons: [
      { action: "roll", label: game.i18n.localize("SCP2E.Roll.Do"), default: true,
        callback: (event, button, dialog) => ({ rollMode: field(dialog, "rollMode"), exertDice: field(dialog, "exertDice"), punished: field(dialog, "punished") }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!result || typeof result !== "object") return null;

  const punished = !!result.punished;
  const { bonusPool, bonusLabel, notes } = punished
    ? { bonusPool: null, bonusLabel: null, notes: [] }
    : await applyExertionDice(actor, data, num(result.exertDice));

  return rollPool(actor, data, attrKey, {
    skillKey: opts.skillKey ?? null,
    skillValue: opts.skillValue ?? null,
    skillLabel: opts.skillLabel ?? null,
    title: opts.title ?? null,
    rollMode: result.rollMode,
    bonusPool,
    bonusLabel,
    notes,
    punished
  });
}

/** Spend N exertion for +N d12 on a roll; returns bonus pool + card note bits. */
async function applyExertionDice(actor, data, want) {
  const spent = want > 0 ? await spendExertion(actor, data, want) : 0;
  if (spent <= 0) return { bonusPool: null, bonusLabel: null, notes: [] };
  return {
    bonusPool: { d12: spent },
    bonusLabel: `${spent}×${game.i18n.localize("SCP2E.Roll.ExertionDie")}`,
    notes: [game.i18n.format("SCP2E.Roll.ExertionUsedN", { n: spent })]
  };
}

/* -------------------------------------------------------------------------- */
/*  Distance measurement                                                      */
/* -------------------------------------------------------------------------- */

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
/*  Weapon attack (to-hit)                                                    */
/* -------------------------------------------------------------------------- */

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

  const skillBlock = isNpc
    ? `<p class="scp2e-attack-note">${game.i18n.localize("SCP2E.Attack.NpcNote")}</p>`
    : "";

  let aimBlock;
  if (fx.aimMax > 1) {
    const aimOpts = Array.from({ length: fx.aimMax + 1 }, (_, n) => `<option value="${n}">${n}×</option>`).join("");
    aimBlock = `<div class="form-group">
        <label>${game.i18n.format("SCP2E.Attack.AimTimes", { n: aimVal })}</label>
        <select name="aimCount">${aimOpts}</select>
      </div>`;
  } else {
    aimBlock = `<div class="form-group scp2e-check-row">
        <label class="scp2e-check"><input type="checkbox" name="aimCheck"/> ${game.i18n.format("SCP2E.Attack.Aim", { n: aimVal })}</label>
      </div>`;
  }

  const staggerBlock = fx.staggerToggle
    ? `<div class="form-group scp2e-check-row"><label class="scp2e-check"><input type="checkbox" name="staggered"/> ${game.i18n.localize("SCP2E.Attack.Staggered")}</label></div>`
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
      <div class="form-group scp2e-check-row">
        <label class="scp2e-check"><input type="checkbox" name="applyRecoil"/> ${game.i18n.format("SCP2E.Attack.Recoil", { n: num(weapon.recoil) })}</label>
      </div>
      ${staggerBlock}
      <div class="form-group scp2e-check-row">
        <label class="scp2e-check"><input type="checkbox" name="punished"/> ${game.i18n.localize("SCP2E.Roll.Punished")}</label>
      </div>
      <div class="form-group">
        <label>${game.i18n.format("SCP2E.Roll.ExertionDice", { n: exert })}</label>
        <input type="number" name="exertDice" value="0" min="0" max="${exert}" step="1" ${exert > 0 ? "" : "disabled"}/>
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
    render: (event, dialog) => wirePunished(dialog ?? event),
    buttons: [
      { action: "attack", label: game.i18n.localize("SCP2E.Attack.Do"), default: true,
        callback: (event, button, dialog) => ({
          attackType: field(dialog, "attackType"),
          distance: field(dialog, "distance"),
          aimCount: field(dialog, "aimCount"),
          aimCheck: field(dialog, "aimCheck"),
          applyRecoil: field(dialog, "applyRecoil"),
          staggered: field(dialog, "staggered"),
          exertDice: field(dialog, "exertDice"),
          punished: field(dialog, "punished"),
          rollMode: field(dialog, "rollMode")
        }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!choice || typeof choice !== "object") return;

  const ranged = choice.attackType === "ranged";

  /* ---- flat To-Hit modifiers ------------------------------------------ */
  const flatMods = [];
  let toHit = num(weapon.toHit);
  if (fx.thrown && toHit < 0) toHit = 0;
  if (toHit) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.ToHit"), value: toHit });

  const aimCount = fx.aimMax > 1
    ? Math.max(0, Math.min(fx.aimMax, num(choice.aimCount)))
    : (choice.aimCheck ? 1 : 0);
  if (aimCount > 0 && aimVal) {
    const aimLabel = fx.aimMax > 1 ? `${game.i18n.localize("SCP2E.Weapons.Aim")} ×${aimCount}` : game.i18n.localize("SCP2E.Weapons.Aim");
    flatMods.push({ label: aimLabel, value: aimVal * aimCount });
  }

  if (choice.applyRecoil) {
    const recoil = num(weapon.recoil);
    if (recoil) flatMods.push({ label: game.i18n.localize("SCP2E.Weapons.Recoil"), value: -Math.abs(recoil) });
  }

  // Range increments (rulebook p151): first band free → ceil(distance / range) − 1.
  const distance = num(choice.distance);
  const hasAsterisk = /\*/.test(String(weapon.range ?? ""));
  let increments = 0;
  if (rangeNum > 0 && distance > 0) increments = Math.max(0, Math.ceil(distance / rangeNum) - 1);
  if (increments > 0) {
    if (fx.rangeMode === "bonus") flatMods.push({ label: game.i18n.format("SCP2E.Attack.RangeBonus", { d: distance }), value: increments });
    else flatMods.push({ label: game.i18n.format("SCP2E.Attack.RangePenalty", { d: distance }), value: -increments });
  }
  if (hasAsterisk && rangeNum > 0 && distance > rangeNum) fx.reminders.push(game.i18n.format("SCP2E.Attack.BeyondRange", { r: rangeNum }));

  /* ---- exertion dice on the to-hit (none if punished) ----------------- */
  const punished = !!choice.punished;
  const { bonusPool, bonusLabel, notes: exertNotes } = punished
    ? { bonusPool: null, bonusLabel: null, notes: [] }
    : await applyExertionDice(actor, data, num(choice.exertDice));
  const toHitNotes = [...fx.reminders, ...exertNotes];

  /* ---- to-hit roll + damage button ------------------------------------ */
  const typeLabel = game.i18n.localize(ranged ? "SCP2E.Attack.Ranged" : "SCP2E.Attack.Melee");
  const title = `${weapon.name || game.i18n.localize("SCP2E.Attack.Weapon")} — ${typeLabel}`;

  let rollArgs;
  if (isNpc) {
    const attrKey = ranged ? "perception" : "dexterity";
    const phys = data.npc?.skills?.physical ?? {};
    const mult = Math.max(1, Number(phys.mult) || 1);
    rollArgs = { attrKey, skillValue: (Number(phys.value) || 0) * mult, skillLabel: game.i18n.localize("SCP2E.Npc.Physical") };
  } else {
    const skillKey = ranged ? "firearms" : "melee";
    rollArgs = { attrKey: SKILLS[skillKey]?.gov ?? (ranged ? "perception" : "dexterity"), skillKey };
  }

  const payload = {
    actorUuid: actor.uuid,
    weaponIndex,
    ranged,
    thrown: fx.thrown,
    rollMode: choice.rollMode,
    dieTypeBump: (fx.staggerToggle && choice.staggered) ? 1 : 0,
    diceDelta: fx.damageDicePerIncrement * increments,
    doubleMax: fx.damageDoubleMax,
    reminders: fx.reminders,
    punished
  };
  // The attack context is stored as a flag on the chat message (robust against
  // chat-content sanitisation); the button only needs its class + message id.
  const cardButton = `<button type="button" class="scp2e-damage-btn"><i class="fa-solid fa-heart-crack"></i> ${game.i18n.localize("SCP2E.Attack.ConfirmDamage")}</button>`;

  await rollPool(actor, data, rollArgs.attrKey, {
    skillKey: rollArgs.skillKey ?? null,
    skillValue: rollArgs.skillValue ?? null,
    skillLabel: rollArgs.skillLabel ?? null,
    flatMods,
    bonusPool,
    bonusLabel,
    rollMode: choice.rollMode,
    title,
    notes: toHitNotes,
    cardButton,
    messageFlags: { [MODULE_ID]: { attack: payload } },
    punished
  });
}

/* -------------------------------------------------------------------------- */
/*  Damage (triggered from the hit card)                                      */
/* -------------------------------------------------------------------------- */

/** Prompt for an optional Exertion rating boost, then roll damage. */
async function confirmDamage(actor, payload) {
  const data = normalizeData(actor.getFlag(MODULE_ID, FLAG_KEY));
  const weapon = (data.weapons ?? [])[payload.weaponIndex];
  if (!weapon) { ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoWeapon")); return; }

  const ranged = !!payload.ranged;
  const thrown = !!payload.thrown;
  const punished = !!payload.punished;
  const avail = Number(data.tracks?.exertion ?? 0);
  const canBoost = avail > 0 && !punished;   // punished rolls can't use Exertion
  const ratingLabel = thrown
    ? game.i18n.localize("SCP2E.Attack.ThrownRating")
    : game.i18n.localize(ranged ? "SCP2E.Field.Projectile" : "SCP2E.Field.Combat");

  const boostNote = punished
    ? `<p class="scp2e-attack-note">${game.i18n.localize("SCP2E.Roll.PunishedNote")}</p>`
    : `<p class="scp2e-attack-note">${game.i18n.format("SCP2E.Attack.ExertLeft", { n: avail })}</p>`;
  const content = `
    <form class="scp2e-dmgdlg">
      <div class="form-group">
        <label>${game.i18n.format("SCP2E.Attack.RatingBoost", { r: ratingLabel })}</label>
        <input type="number" name="ratingBoost" value="0" min="0" max="${canBoost ? avail : 0}" step="1" ${canBoost ? "" : "disabled"}/>
      </div>
      ${boostNote}
    </form>`;

  const D = DialogV2();
  const res = await D.wait({
    window: { title: game.i18n.localize("SCP2E.Attack.DamageTitle"), icon: "fa-solid fa-heart-crack" },
    content,
    buttons: [
      { action: "roll", label: game.i18n.localize("SCP2E.Attack.RollDamage"), default: true,
        callback: (event, button, dialog) => ({ ratingBoost: field(dialog, "ratingBoost") }) },
      { action: "cancel", label: game.i18n.localize("SCP2E.Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!res || typeof res !== "object") return;

  const spent = punished ? 0 : await spendExertion(actor, data, num(res.ratingBoost));
  await rollDamage(actor, data, weapon, {
    ranged, thrown,
    rollMode: payload.rollMode,
    dieTypeBump: payload.dieTypeBump || 0,
    diceDelta: payload.diceDelta || 0,
    doubleMax: !!payload.doubleMax,
    reminders: payload.reminders || [],
    extraRating: spent
  });
}

/**
 * Roll weapon damage: Base Damage + (X.Dam die-count × rating)d(faces).
 * rating = Projectile (ranged) / Combat (melee) / higher of the two (thrown),
 * plus any Exertion rating boost. Honours die-type bump (Assassin), dice
 * add/remove (Shotgun range) and double-on-max (Lashing). Shows the dice.
 */
async function rollDamage(actor, data, weapon, { ranged, thrown, rollMode, dieTypeBump = 0, diceDelta = 0, doubleMax = false, reminders = [], extraRating = 0 }) {
  const combat = num(data.combat?.combat);
  const projectile = num(data.combat?.projectile);
  let rating = thrown ? Math.max(combat, projectile) : (ranged ? projectile : combat);
  rating += Math.max(0, extraRating);

  let list = [];
  const base = parseDice(weapon.bDam);
  let baseFlat = 0;
  if (base) for (let k = 0; k < base.count; k++) list.push(base.faces);
  else baseFlat = num(weapon.bDam);

  const x = parseDice(weapon.xDam);
  if (x && rating > 0) for (let k = 0; k < x.count * rating; k++) list.push(x.faces);

  if (dieTypeBump > 0) list = list.map((f) => bumpFaces(f, dieTypeBump));

  if (diceDelta < 0) { let r = -diceDelta; while (r > 0 && list.length > 0) { list.pop(); r--; } }
  else if (diceDelta > 0) { const f = list[list.length - 1] ?? (x?.faces ?? base?.faces ?? 6); for (let k = 0; k < diceDelta; k++) list.push(f); }

  if (!list.length && !baseFlat) { ui.notifications.info(game.i18n.localize("SCP2E.Attack.NoDamage")); return; }

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

  // Render each die; Lashing doubles dice that rolled their max.
  let total = baseFlat;
  const dieSpans = [];
  for (const term of roll.dice) {
    for (const r of term.results) {
      if (r.active === false) continue;
      const isMax = r.result === term.faces;
      const doubled = doubleMax && isMax;
      total += r.result + (doubled ? r.result : 0);
      dieSpans.push(`<span class="scp-die${doubled ? " boom" : ""}">d${term.faces}:${r.result}${doubled ? " ×2" : ""}</span>`);
    }
  }
  if (!doubleMax) total = roll.total; // no Lashing → use the plain evaluated total

  const ratingLabel = thrown
    ? game.i18n.localize("SCP2E.Attack.ThrownRating")
    : game.i18n.localize(ranged ? "SCP2E.Field.Projectile" : "SCP2E.Field.Combat");
  const flavor = `${weapon.name || game.i18n.localize("SCP2E.Attack.Weapon")} — ${game.i18n.localize("SCP2E.Attack.Damage")}`;
  const noteList = [...reminders];
  if (extraRating > 0) noteList.unshift(game.i18n.format("SCP2E.Attack.RatingBoostNote", { n: extraRating, r: ratingLabel }));
  const noteLine = noteList.length
    ? `<div class="scp-roll-line scp-roll-notes">${noteList.map((n) => `• ${esc(n)}`).join("<br>")}</div>`
    : "";
  const baseFlatHtml = baseFlat ? ` <span class="scp-die">+${baseFlat}</span>` : "";

  const content = `
    <div class="scp2e-roll">
      <div class="scp-roll-head">${flavor}</div>
      <div class="scp-roll-pool">${esc(formula)} <span class="scp-roll-bonus">(${ratingLabel} ${rating})</span></div>
      <div class="scp-roll-dice">${dieSpans.join(" ")}${baseFlatHtml}</div>
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
  applyChatRollMode(messageData, rollMode);
  await ChatMessage.create(messageData);
}

/* -------------------------------------------------------------------------- */
/*  Chat-card damage button wiring (single delegated listener)                */
/* -------------------------------------------------------------------------- */

async function handleDamageButton(btn) {
  const li = btn.closest("[data-message-id]");
  const msg = li ? game.messages.get(li.dataset.messageId) : null;
  const payload = msg?.getFlag(MODULE_ID, "attack");
  if (!payload) { ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoActor")); return; }

  const resolved = await fromUuid(payload.actorUuid).catch(() => null);
  const actor = resolved?.documentName === "Actor" ? resolved : resolved?.actor;
  if (!actor) { ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoActor")); return; }
  if (!actor.isOwner && !game.user.isGM) { ui.notifications.warn(game.i18n.localize("SCP2E.Attack.NoOwner")); return; }

  try { await confirmDamage(actor, payload); }
  catch (err) { console.error("SCP2e | damage failed:", err); ui.notifications.error("SCP2e: damage roll failed (see console)."); }
}

// One delegated listener catches clicks on any current/future damage button.
document.addEventListener("click", (event) => {
  const btn = event.target?.closest?.(".scp2e-damage-btn");
  if (!btn) return;
  event.preventDefault();
  handleDamageButton(btn);
});
