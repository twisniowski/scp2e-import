/**
 * SCP 2e character sheet (ApplicationV2 / HandlebarsApplicationMixin).
 *
 * Stores all data in an Actor flag rather than a custom Actor sub-type, so it can
 * be applied to a normal actor under any game system. Register via
 * Actors.registerSheet so the user can pick "SCP 2e Sheet" for any actor.
 */
import { ATTRIBUTES, SKILLS, DISRUPTION_CLASSES, DEPARTMENTS } from "./config.js";
import { normalizeData, computeSkillCaps, EMPTY_ROWS } from "./data-model.js";
import { promptPdfImport } from "./pdf-import.js";
import { rollPool } from "./roll.js";
import { MODULE_ID, FLAG_KEY } from "./const.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Array-valued flag keys that need object->array fixup on submit. */
const ARRAY_KEYS = ["weapons", "aspects", "customSkills"];

export class SCP2eCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["scp2e", "sheet", "actor", "character"],
    position: { width: 880, height: 820 },
    window: { resizable: true, icon: "fa-solid fa-folder-closed" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      importPdf: SCP2eCharacterSheet.#onImportPdf,
      changeTab: SCP2eCharacterSheet.#onChangeTab,
      addWeapon: SCP2eCharacterSheet.#onAddRow,
      deleteWeapon: SCP2eCharacterSheet.#onDeleteRow,
      addAspect: SCP2eCharacterSheet.#onAddRow,
      deleteAspect: SCP2eCharacterSheet.#onDeleteRow,
      addCustomSkill: SCP2eCharacterSheet.#onAddRow,
      deleteCustomSkill: SCP2eCharacterSheet.#onDeleteRow,
      adjustTrack: SCP2eCharacterSheet.#onAdjustTrack,
      rollAttribute: SCP2eCharacterSheet.#onRollAttribute,
      rollSkill: SCP2eCharacterSheet.#onRollSkill
    }
  };

  static PARTS = {
    sheet: { template: `modules/${MODULE_ID}/templates/character-sheet.hbs`, scrollable: [".tab-body"] }
  };

  /** The active tab, persisted across re-renders. */
  tabGroups = { primary: "main" };

  /** Current SCP data (defaults merged with stored flag). */
  get scpData() {
    return normalizeData(this.actor.getFlag(MODULE_ID, FLAG_KEY));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = this.scpData;
    const caps = computeSkillCaps(data);

    context.actor = this.actor;
    context.data = data;
    context.editable = this.isEditable;
    context.activeTab = this.tabGroups.primary;

    // Attributes grouped Physical / Mental.
    context.physical = [];
    context.mental = [];
    for (const [key, def] of Object.entries(ATTRIBUTES)) {
      const entry = { key, abbr: def.abbr, label: game.i18n.localize(def.label), value: data.attributes[key]?.value ?? 0, dice: data.attributes[key]?.dice ?? { d6: 0, d8: 0, d10: 0, d12: 0 } };
      (def.group === "physical" ? context.physical : context.mental).push(entry);
    }

    // Skills with governing attribute + derived cap.
    context.skills = Object.entries(SKILLS).map(([key, def]) => ({
      key,
      label: game.i18n.localize(def.label),
      gov: ATTRIBUTES[def.gov].abbr,
      crucial: !!def.crucial,
      value: data.skills[key]?.value ?? 0,
      cap: caps[key] ?? 0
    }));
    context.crucialSkills = context.skills.filter((s) => s.crucial);
    context.standardSkills = context.skills.filter((s) => !s.crucial);

    context.disruptionClasses = DISRUPTION_CLASSES;
    context.departments = DEPARTMENTS.map((dep) => ({ key: dep, value: data.departments[dep] ?? 0 }));

    context.tabs = [
      { id: "main", label: "SCP2E.Tab.Main", icon: "fa-solid fa-id-card" },
      { id: "skills", label: "SCP2E.Tab.Skills", icon: "fa-solid fa-list-check" },
      { id: "combat", label: "SCP2E.Tab.Combat", icon: "fa-solid fa-gun" },
      { id: "aspects", label: "SCP2E.Tab.Aspects", icon: "fa-solid fa-atom" },
      { id: "notes", label: "SCP2E.Tab.Notes", icon: "fa-solid fa-note-sticky" }
    ].map((t) => ({ ...t, active: t.id === this.tabGroups.primary }));

    return context;
  }

  /**
   * Foundry expands `...weapons.0.name` form fields into an object keyed by
   * index ({0:{...}}). Convert those back into real arrays before saving, since
   * flags have no DataModel to cast them.
   */
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
      console.error("SCP2e | save failed. Submitted data:", submitData, "\nError:", err);
      ui.notifications.error("SCP2e: could not save the sheet (see console / F12).");
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  static #onImportPdf() {
    promptPdfImport(this.actor);
  }

  static #onChangeTab(event, target) {
    this.tabGroups.primary = target.dataset.tab;
    this.render();
  }

  /** Generic add-row handler. `data-array` is the array key (weapons/aspects/customSkills). */
  static async #onAddRow(event, target) {
    try {
      const key = target.dataset.array;
      const rows = foundry.utils.deepClone(this.scpData[key] ?? []);
      rows.push(foundry.utils.deepClone(EMPTY_ROWS[key] ?? {}));
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.${key}`, rows);
    } catch (err) {
      console.error("SCP2e | add-row failed:", err);
      ui.notifications.error("SCP2e: could not add row (see console).");
    }
  }

  /** Generic delete-row handler. `data-index` is the array index to remove. */
  static async #onDeleteRow(event, target) {
    try {
      const key = target.dataset.array;
      const index = Number(target.dataset.index);
      const rows = (this.scpData[key] ?? []).filter((_, i) => i !== index);
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.${key}`, rows);
    } catch (err) {
      console.error("SCP2e | delete-row failed:", err);
      ui.notifications.error("SCP2e: could not delete row (see console).");
    }
  }

  /** Roll an attribute's dice pool (top two summed). */
  static async #onRollAttribute(event, target) {
    try {
      await rollPool(this.actor, this.scpData, target.dataset.attr);
    } catch (err) {
      console.error("SCP2e | attribute roll failed:", err);
      ui.notifications.error("SCP2e: roll failed (see console).");
    }
  }

  /** Roll a skill: governing attribute pool (top two) + skill value. */
  static async #onRollSkill(event, target) {
    try {
      const skillKey = target.dataset.skill;
      const govKey = SKILLS[skillKey]?.gov;
      await rollPool(this.actor, this.scpData, govKey, { skillKey });
    } catch (err) {
      console.error("SCP2e | skill roll failed:", err);
      ui.notifications.error("SCP2e: roll failed (see console).");
    }
  }

  /** Increment/decrement a pip track (exertion / reverence). */
  static async #onAdjustTrack(event, target) {
    try {
      const track = target.dataset.track;
      const delta = Number(target.dataset.delta);
      const current = Number(this.scpData.tracks?.[track] ?? 0);
      await this.actor.setFlag(MODULE_ID, `${FLAG_KEY}.tracks.${track}`, Math.max(0, current + delta));
    } catch (err) {
      console.error("SCP2e | track adjust failed:", err);
      ui.notifications.error("SCP2e: could not update track (see console).");
    }
  }
}
