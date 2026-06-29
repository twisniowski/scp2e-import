/**
 * SCP 2e Character Sheet — module entry point.
 *
 * Registers a module-provided Actor sub-type (`scp2e-character-sheet.character`)
 * with its TypeDataModel and ApplicationV2 sheet, plus a PDF import entry point
 * in the Actors directory and a convenience global API.
 */
import { MODULE_ID, CHARACTER_TYPE } from "./const.js";
import { SCP2E } from "./config.js";
import { SCP2eCharacterData } from "./data-model.js";
import { SCP2eCharacterSheet } from "./sheet.js";
import { promptPdfImport } from "./pdf-import.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing SCP 2e Character Sheet`);

  // Expose config for macros / other modules.
  CONFIG.SCP2E = SCP2E;

  // Register the data model for our actor sub-type.
  Object.assign(CONFIG.Actor.dataModels, { [CHARACTER_TYPE]: SCP2eCharacterData });

  // Register the sheet for our sub-type and make it the default.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    Actor, MODULE_ID, SCP2eCharacterSheet,
    {
      types: [CHARACTER_TYPE],
      makeDefault: true,
      label: "SCP2E.SheetLabel"
    }
  );

  // Register Handlebars helpers used by the sheet. `eq` is registered defensively
  // since it is not guaranteed to exist across all Foundry versions.
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
  Handlebars.registerHelper("scp2eRepeat", (n, block) => {
    let out = "";
    for (let i = 0; i < n; i++) out += block.fn(i);
    return out;
  });
});

Hooks.once("ready", () => {
  // Public API for macros: game.modules.get(MODULE_ID).api.importPdf()
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { importPdf: promptPdfImport, CHARACTER_TYPE };
});

/**
 * Add an "Import SCP PDF" button to the Actors directory footer so players can
 * create a character straight from a filled-in PDF.
 */
Hooks.on("renderActorDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".scp2e-import-pdf")) return;

  const footer = root.querySelector(".directory-footer") ?? root.querySelector(".header-actions");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scp2e-import-pdf";
  button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n.localize("SCP2E.Import.Button")}`;
  button.addEventListener("click", () => promptPdfImport(null));

  if (footer) footer.appendChild(button);
  else root.appendChild(button);
});

export { MODULE_ID };
