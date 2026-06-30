/**
 * SCP 2e character sheet (ApplicationV2 / HandlebarsApplicationMixin).
 */
import { ATTRIBUTES, SKILLS, DISRUPTION_CLASSES, DEPARTMENTS } from "./config.js";
import { promptPdfImport } from "./pdf-import.js";
import { MODULE_ID } from "./const.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

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
      adjustTrack: SCP2eCharacterSheet.#onAdjustTrack
    }
  };

  static PARTS = {
    sheet: { template: `modules/${MODULE_ID}/templates/character-sheet.hbs`, scrollable: [".tab-body"] }
  };

  /** The active tab, persisted across re-renders. */
  tabGroups = { primary: "main" };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    context.actor = this.actor;
    context.system = sys;
    context.editable = this.isEditable;
    context.activeTab = this.tabGroups.primary;

    // Attributes grouped Physical / Mental.
    context.physical = [];
    context.mental = [];
    for (const [key, def] of Object.entries(ATTRIBUTES)) {
      const entry = { key, abbr: def.abbr, label: game.i18n.localize(def.label), value: sys.attributes[key].value };
      (def.group === "physical" ? context.physical : context.mental).push(entry);
    }

    // Skills with governing attribute + derived cap.
    context.skills = Object.entries(SKILLS).map(([key, def]) => ({
      key,
      label: game.i18n.localize(def.label),
      gov: ATTRIBUTES[def.gov].abbr,
      crucial: !!def.crucial,
      value: sys.skills[key].value,
      cap: sys.skillCaps?.[key] ?? 0
    }));
    context.crucialSkills = context.skills.filter((s) => s.crucial);
    context.standardSkills = context.skills.filter((s) => !s.crucial);

    context.disruptionClasses = DISRUPTION_CLASSES;
    context.departments = DEPARTMENTS.map((d) => ({ key: d, value: sys.departments[d] ?? 0 }));

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
   * Wrap document submission so any save error is logged with full context
   * instead of surfacing as an opaque toast, and so a failed save doesn't
   * leave the sheet looking broken.
   */
  async _processSubmitData(event, form, submitData, options) {
    try {
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

  /** Read a system array as a plain (deep-cloned) JS array. */
  #plainArray(path) {
    const key = path.replace(/^system\./, "");
    const src = this.actor.system.toObject(); // plain object, safe to mutate
    return Array.isArray(src[key]) ? src[key] : [];
  }

  /** Generic add-row handler. `data-array` names the system array path. */
  static async #onAddRow(event, target) {
    try {
      const path = target.dataset.array; // e.g. "system.weapons"
      const next = this.#plainArray(path).concat([{}]);
      await this.actor.update({ [path]: next });
    } catch (err) {
      console.error("SCP2e | add-row failed:", err);
      ui.notifications.error("SCP2e: could not add row (see console).");
    }
  }

  /** Generic delete-row handler. `data-index` is the array index to remove. */
  static async #onDeleteRow(event, target) {
    try {
      const path = target.dataset.array;
      const index = Number(target.dataset.index);
      const next = this.#plainArray(path).filter((_, i) => i !== index);
      await this.actor.update({ [path]: next });
    } catch (err) {
      console.error("SCP2e | delete-row failed:", err);
      ui.notifications.error("SCP2e: could not delete row (see console).");
    }
  }

  /** Increment/decrement a pip track (exertion / reverence). */
  static async #onAdjustTrack(event, target) {
    try {
      const track = target.dataset.track;
      const delta = Number(target.dataset.delta);
      const path = `system.tracks.${track}`;
      const value = Math.max(0, (foundry.utils.getProperty(this.actor, path) ?? 0) + delta);
      await this.actor.update({ [path]: value });
    } catch (err) {
      console.error("SCP2e | track adjust failed:", err);
      ui.notifications.error("SCP2e: could not update track (see console).");
    }
  }
}
