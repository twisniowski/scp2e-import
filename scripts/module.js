/**
 * SCP 2e Character Sheet — module entry point.
 *
 * Rather than defining a custom Actor sub-type (which breaks under game systems
 * that don't recognise it), this registers an ALTERNATE Actor sheet that stores
 * all SCP data in an Actor flag. Apply it to any actor via the sheet picker, or
 * create one straight from a PDF.
 */
import { MODULE_ID } from "./const.js";
import { SCP2E } from "./config.js";
import { SCP2eCharacterSheet } from "./sheet.js";
import { promptPdfImport } from "./pdf-import.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing SCP 2e Character Sheet`);
  CONFIG.SCP2E = SCP2E;

  // Register Handlebars helpers used by the sheet (defensively).
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

  // Determine which actor types exist in the active system, excluding the base.
  const types = (game.documentTypes?.Actor ?? Actor.TYPES ?? []).filter((t) => t !== CONST.BASE_DOCUMENT_TYPE);

  // Register our sheet as a selectable (non-default) sheet for every actor type,
  // so it can overlay any system's actors without replacing their own sheet.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    Actor, MODULE_ID, SCP2eCharacterSheet,
    {
      types: types.length ? types : undefined,
      makeDefault: false,
      label: "SCP2E.SheetLabel"
    }
  );
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { importPdf: promptPdfImport };
});

/**
 * Add an "Import SCP PDF" button to the Actors directory footer.
 */
Hooks.on("renderActorDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".scp2e-import-pdf")) return;

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
