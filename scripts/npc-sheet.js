/**
 * SCP 2e NPC sheet — a simplified, single-page variant of the character sheet.
 * Shares the same flag data; adds NPC-only fields (threat level, containment
 * class, Physical/Mental/Social skills, an attack table and notes).
 */
import { ATTRIBUTES } from "./config.js";
import { normalizeData } from "./data-model.js";
import { rollPool } from "./roll.js";
import { MODULE_ID, FLAG_KEY } from "./const.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const ARRAY_KEYS = ["npcAttacks"];

export class SCP2eNpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["scp2e", "sheet", "actor", "npc"],
    position: { width: 540, height: 720 },
    window: { resizable: true, icon: "fa-solid fa-skull" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: SCP2eNpcSheet.#onEditImage,
      rollAttribute: SCP2eNpcSheet.#onRollAttribute,
      addAttack: SCP2eNpcSheet.#onAddAttack,
      delAttack: SCP2eNpcSheet.#onDelAttack
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

    const A = (k) => ({ key: k, abbr: ATTRIBUTES[k].abbr, value: data.attributes[k]?.value ?? 0 });
    context.attrRows = [
      [A("strength"), A("dexterity")],
      [A("perception"), A("health")],
      [A("intellect"), A("willpower")],
      [A("charisma"), A("fate")]
    ];
    context.attacks = data.npcAttacks ?? [];
    return context;
  }

  /** Rebuild the attacks array from index-keyed form data before saving. */
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

  static async #onAddAttack() {
    try {
      const rows = foundry.utils.deepClone(this.scpData.npcAttacks ?? []);
      rows.push({ name: "", toHit: "", damage: "", range: "", dmgType: "", note: "" });
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.npcAttacks`, rows);
    } catch (err) {
      console.error("SCP2e | NPC add attack failed:", err);
      ui.notifications.error("SCP2e: could not add attack (see console).");
    }
  }

  static async #onDelAttack(event, target) {
    try {
      const index = Number(target.dataset.index);
      const rows = (this.scpData.npcAttacks ?? []).filter((_, i) => i !== index);
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.npcAttacks`, rows);
    } catch (err) {
      console.error("SCP2e | NPC delete attack failed:", err);
      ui.notifications.error("SCP2e: could not remove attack (see console).");
    }
  }
}
