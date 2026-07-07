/**
 * SCP 2e NPC sheet — a simplified, single-page variant of the character sheet.
 * Shares the same flag data. Attributes are full dice pools (rollable, like the
 * PC sheet); HP is current/max; the weapon list is the same Weapons table as the
 * player sheet.
 */
import { ATTRIBUTES } from "./config.js";
import { normalizeData, EMPTY_ROWS } from "./data-model.js";
import { rollPool } from "./roll.js";
import { MODULE_ID, FLAG_KEY, ensureHpBar } from "./const.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const ARRAY_KEYS = ["weapons"];

export class SCP2eNpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["scp2e", "sheet", "actor", "npc"],
    position: { width: 560, height: 760 },
    window: { resizable: true, icon: "fa-solid fa-skull" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: SCP2eNpcSheet.#onEditImage,
      rollAttribute: SCP2eNpcSheet.#onRollAttribute,
      addWeapon: SCP2eNpcSheet.#onAddRow,
      deleteWeapon: SCP2eNpcSheet.#onDeleteRow
    }
  };

  static PARTS = {
    sheet: { template: `modules/${MODULE_ID}/templates/npc-sheet.hbs`, scrollable: [".npc-body"] }
  };

  get scpData() {
    return normalizeData(this.actor.getFlag(MODULE_ID, FLAG_KEY));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = this.scpData;
    context.actor = this.actor;
    context.data = data;
    context.editable = this.isEditable;

    const A = (k) => ({
      key: k,
      abbr: ATTRIBUTES[k].abbr,
      value: data.attributes[k]?.value ?? 0,
      dice: data.attributes[k]?.dice ?? { d6: 0, d8: 0, d10: 0, d12: 0 }
    });
    context.attrRows = [
      [A("strength"), A("dexterity")],
      [A("perception"), A("health")],
      [A("intellect"), A("willpower")],
      [A("charisma"), A("fate")]
    ];
    context.weapons = data.weapons ?? [];
    return context;
  }

  /** Rebuild the weapons array from index-keyed form data before saving. */
  async _processSubmitData(event, form, submitData, options) {
    try {
      const node = submitData?.flags?.[MODULE_ID]?.[FLAG_KEY];
      if (node) {
        for (const key of ARRAY_KEYS) {
          const v = node[key];
          if (v && !Array.isArray(v) && typeof v === "object") {
            node[key] = Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
          }
        }
      }
      return await super._processSubmitData(event, form, submitData, options);
    } catch (err) {
      console.error("SCP2e | NPC save failed:", err, "\nSubmitted:", submitData);
      ui.notifications.error("SCP2e: could not save the NPC sheet (see console / F12).");
    }
  }

  /** Ensure the actor's token HP bar points at our flag HP. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    ensureHpBar(this.actor);
  }

  static #onEditImage() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    return new FP({ type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }) }).render(true);
  }

  static async #onRollAttribute(event, target) {
    try {
      await rollPool(this.actor, this.scpData, target.dataset.attr);
    } catch (err) {
      console.error("SCP2e | NPC roll failed:", err);
      ui.notifications.error("SCP2e: roll failed (see console).");
    }
  }

  static async #onAddRow(event, target) {
    try {
      const key = target.dataset.array;
      const rows = foundry.utils.deepClone(this.scpData[key] ?? []);
      rows.push(foundry.utils.deepClone(EMPTY_ROWS[key] ?? {}));
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.${key}`, rows);
    } catch (err) {
      console.error("SCP2e | NPC add row failed:", err);
      ui.notifications.error("SCP2e: could not add row (see console).");
    }
  }

  static async #onDeleteRow(event, target) {
    try {
      const key = target.dataset.array;
      const index = Number(target.dataset.index);
      const rows = (this.scpData[key] ?? []).filter((_, i) => i !== index);
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.${key}`, rows);
    } catch (err) {
      console.error("SCP2e | NPC delete row failed:", err);
      ui.notifications.error("SCP2e: could not remove row (see console).");
    }
  }
}
