/**
 * PDF import for SCP 2e character sheets.
 *
 * Reads the AcroForm fields of a filled-in official SCP2e fillable PDF and maps
 * them onto a character actor's `system` data using the generated field map.
 * Field names in the source PDF are generic ("Text Field 12", "Check Box 88"),
 * so the mapping is derived from field geometry (see scripts/field-map.json).
 */
import { MODULE_ID, CHARACTER_TYPE } from "./const.js";

let _PDFLib = null;

/** Lazily load the vendored pdf-lib ESM build. */
async function loadPdfLib() {
  if (_PDFLib) return _PDFLib;
  _PDFLib = await import(`/modules/${MODULE_ID}/lib/pdf-lib.esm.min.js`);
  return _PDFLib;
}

/** Load the field map (PDF field name -> { target, type, array }). */
async function loadFieldMap() {
  const res = await fetch(`/modules/${MODULE_ID}/scripts/field-map.json`);
  if (!res.ok) throw new Error("SCP2e: could not load field-map.json");
  return res.json();
}

/**
 * Parse a PDF ArrayBuffer into a flat record of fieldName -> string value.
 * Text fields return their text; checkboxes return "1" when checked.
 */
async function readPdfFields(arrayBuffer) {
  const { PDFDocument, PDFCheckBox, PDFTextField, PDFDropdown, PDFRadioGroup } =
    await loadPdfLib();
  const doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const form = doc.getForm();
  const out = {};
  for (const field of form.getFields()) {
    const name = field.getName();
    try {
      if (field instanceof PDFTextField) out[name] = field.getText() ?? "";
      else if (field instanceof PDFCheckBox) out[name] = field.isChecked() ? "1" : "";
      else if (field instanceof PDFDropdown) out[name] = (field.getSelected() ?? []).join(", ");
      else if (field instanceof PDFRadioGroup) out[name] = field.getSelected() ?? "";
    } catch (e) {
      /* skip unreadable fields */
    }
  }
  return out;
}

/** Coerce a raw PDF string to the type expected by a schema field. */
function coerce(value, type) {
  if (type === "number") {
    const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return String(value ?? "").trim();
}

/**
 * Build a Foundry update object (and weapon array) from raw PDF fields.
 * @returns {{name: string|null, update: object, weapons: object[]}}
 */
function buildUpdate(rawFields, fieldMap) {
  const update = {};
  const weaponRows = {};
  let name = null;

  for (const [pdfName, raw] of Object.entries(rawFields)) {
    const map = fieldMap[pdfName];
    if (!map) continue;
    const value = coerce(raw, map.type);
    if (map.array === "weapons") {
      // target looks like "system.weapons.<row>.<col>"
      const [, , row, col] = map.target.split(".");
      (weaponRows[row] ??= {})[col] = value;
      continue;
    }
    if (map.target === "name") {
      if (value) name = value;
      continue;
    }
    foundry.utils.setProperty(update, map.target, value);
  }

  // Collapse weapon rows into a dense, non-empty array, ordered by row index.
  const weapons = Object.keys(weaponRows)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => weaponRows[k])
    .filter((w) => Object.values(w).some((v) => v !== "" && v != null));

  return { name, update, weapons };
}

/**
 * Import a filled SCP2e PDF File into an Actor. Returns the applied update.
 * @param {File} file               The user-selected PDF file.
 * @param {Actor} actor             The character actor to populate.
 */
export async function importPdfToActor(file, actor) {
  const buffer = await file.arrayBuffer();
  const fieldMap = await loadFieldMap();
  const raw = await readPdfFields(buffer);
  const { name, update, weapons } = buildUpdate(raw, fieldMap);

  if (name) update.name = name;
  if (weapons.length) foundry.utils.setProperty(update, "system.weapons", weapons);

  await actor.update(update);
  return { name, update, weapons, fieldCount: Object.keys(raw).length };
}

/**
 * Prompt for a PDF file, create (or reuse) a character actor, and import.
 * Used by the scene-controls button and the "Import PDF" macro.
 * @param {Actor|null} actor  Existing actor to fill; if null a new one is made.
 */
export async function promptPdfImport(actor = null) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      let target = actor;
      if (!target) {
        target = await Actor.create({
          name: game.i18n.localize("SCP2E.NewCharacter"),
          type: CHARACTER_TYPE
        });
      }
      const result = await importPdfToActor(file, target);
      ui.notifications.info(
        game.i18n.format("SCP2E.Import.Success", {
          name: result.name ?? target.name,
          count: result.fieldCount
        })
      );
      target.sheet?.render(true);
    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.localize("SCP2E.Import.Failure"));
    }
  });
  input.click();
}
