/**
 * PDF import for SCP 2e character sheets.
 *
 * Reads the AcroForm fields of a filled-in official SCP2e fillable PDF and writes
 * them into the actor's SCP flag (flags.scp2e-character-sheet.data). Field names
 * in the source PDF are generic ("Text Field 12"), so the mapping is derived from
 * field geometry (see scripts/field-map.json).
 */
import { MODULE_ID, FLAG_KEY } from "./const.js";
import { normalizeData } from "./data-model.js";

let _PDFLib = null;

/** Lazily load the vendored pdf-lib ESM build. */
async function loadPdfLib() {
  if (_PDFLib) return _PDFLib;
  _PDFLib = await import(`/modules/${MODULE_ID}/lib/pdf-lib.esm.min.js`);
  return _PDFLib;
}

/** Load the field map (PDF field name -> { target, type, array, group, order }). */
async function loadFieldMap() {
  const res = await fetch(`/modules/${MODULE_ID}/scripts/field-map.json`);
  if (!res.ok) throw new Error("SCP2e: could not load field-map.json");
  return res.json();
}

/** Parse a PDF ArrayBuffer into a flat record of fieldName -> string value. */
async function readPdfFields(arrayBuffer) {
  const { PDFDocument, PDFCheckBox, PDFTextField, PDFDropdown, PDFRadioGroup } = await loadPdfLib();
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
    } catch (e) { /* skip unreadable fields */ }
  }
  return out;
}

/** Coerce a raw PDF string to the type expected by a field. */
function coerce(value, type) {
  if (type === "number") {
    const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return String(value ?? "").trim();
}

/**
 * Build sparse SCP flag data (and actor name) from raw PDF fields.
 * @returns {{name: string|null, data: object}}
 */
function buildData(rawFields, fieldMap) {
  const data = {};            // sparse: only fields actually present in the PDF
  const weaponRows = {};
  const groups = {};          // groupName -> [{ order, value }]
  let name = null;

  for (const [pdfName, raw] of Object.entries(rawFields)) {
    const map = fieldMap[pdfName];
    if (!map) continue;
    // Only import fields actually filled in the PDF, so blanks don't overwrite
    // sensible defaults (e.g. an empty multiplier staying at x1).
    if (raw === "" || raw == null) continue;
    const value = coerce(raw, map.type);

    if (map.array === "weapons") {
      const [, , row, col] = map.target.split("."); // system.weapons.<row>.<col>
      (weaponRows[row] ??= {})[col] = value;
      continue;
    }
    if (map.group) {
      // Multiple PDF fields collected into one text area (everyday carry, etc.).
      (groups[map.group] ??= []).push({ order: map.order ?? 0, value });
      continue;
    }
    if (map.target === "name") {
      if (value) name = value;
      continue;
    }
    // map.target looks like "system.identity.player" -> strip the "system." prefix.
    const path = map.target.replace(/^system\./, "");
    foundry.utils.setProperty(data, path, value);
  }

  // Collapse grouped fields into newline-joined text, in reading order.
  for (const [group, items] of Object.entries(groups)) {
    const text = items
      .sort((a, b) => a.order - b.order)
      .map((i) => String(i.value).trim())
      .filter(Boolean)
      .join("\n");
    if (text) foundry.utils.setProperty(data, group, text);
  }

  const weapons = Object.keys(weaponRows)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => weaponRows[k])
    .filter((w) => Object.values(w).some((v) => v !== "" && v != null));
  if (weapons.length) data.weapons = weapons;

  return { name, data };
}

/**
 * Import a filled SCP2e PDF File into an Actor (writing the SCP flag).
 */
export async function importPdfToActor(file, actor) {
  const buffer = await file.arrayBuffer();
  const fieldMap = await loadFieldMap();
  const raw = await readPdfFields(buffer);
  const { name, data } = buildData(raw, fieldMap);

  // Merge imported fields over the actor's existing data (filled in defaults),
  // so manual entries the PDF doesn't cover (e.g. dice pools) are preserved.
  const existing = normalizeData(actor.getFlag(MODULE_ID, FLAG_KEY));
  const merged = foundry.utils.mergeObject(existing, data, { inplace: false });
  await actor.setFlag(MODULE_ID, FLAG_KEY, merged);
  if (name) await actor.update({ name });
  return { name, data: merged, fieldCount: Object.keys(raw).length };
}

/** Pick a creatable actor type for the active system (avoid the base type). */
function defaultActorType() {
  const types = (game.documentTypes?.Actor ?? Actor.TYPES ?? []).filter((t) => t !== CONST.BASE_DOCUMENT_TYPE);
  return types[0] ?? CONST.BASE_DOCUMENT_TYPE;
}

/**
 * Prompt for a PDF file, create (or reuse) an actor, import, and open the SCP sheet.
 * @param {Actor|null} actor  Existing actor to fill; if null a new one is created.
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
          type: defaultActorType()
        });
      }
      const result = await importPdfToActor(file, target);
      ui.notifications.info(game.i18n.format("SCP2E.Import.Success", {
        name: result.name ?? target.name, count: result.fieldCount
      }));
      // Force the SCP sheet for this actor and open it.
      await target.setFlag("core", "sheetClass", "scp2e-character-sheet.SCP2eCharacterSheet");
      target.sheet?.render(true);
    } catch (err) {
      console.error("SCP2e | PDF import failed:", err);
      ui.notifications.error(game.i18n.localize("SCP2E.Import.Failure"));
    }
  });
  input.click();
}
