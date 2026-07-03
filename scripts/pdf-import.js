/**
 * PDF import for SCP 2e character sheets.
 *
 * Reads the AcroForm fields of a filled-in official SCP2e fillable PDF and writes
 * them into the actor's SCP flag (flags.scp2e-character-sheet.data). Text fields
 * are mapped by geometry (scripts/field-map.json); the attribute dice pools are
 * decoded from the die checkboxes (scripts/dice-map.json).
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

async function loadJson(path) {
  const res = await fetch(`/modules/${MODULE_ID}/${path}`);
  if (!res.ok) throw new Error(`SCP2e: could not load ${path}`);
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
 * Decode attribute dice pools from the die checkboxes.
 *
 * The dice-map contains only the large "die" checkboxes (the small connector boxes
 * are upgrade-cost tolls and are ignored). Each attribute has 4 columns; the
 * leftmost two are always dice, columns 3-4 only exist if one of their die boxes
 * is checked. A die's tier is the highest checked die box in its column
 * (d6 -> d8 -> d10 -> d12), or d6 for a base column with none checked.
 */
function decodeDice(rawFields, diceMap) {
  const TIERS = ["d6", "d8", "d10", "d12"];
  const byAttr = {};
  for (const [name, info] of Object.entries(diceMap)) {
    (byAttr[info.attr] ??= {});
    (byAttr[info.attr][info.col] ??= []).push({ tier: info.tier, checked: rawFields[name] === "1" });
  }
  const out = {};
  for (const [attr, cols] of Object.entries(byAttr)) {
    const pool = { d6: 0, d8: 0, d10: 0, d12: 0 };
    for (let col = 0; col < 4; col++) {
      const checkedTiers = (cols[col] ?? []).filter((b) => b.checked).map((b) => b.tier);
      if (col <= 1) {
        // Base dice: always present; tier is the highest checked die box (d6 if none).
        pool[TIERS[checkedTiers.length ? Math.max(...checkedTiers) : 0]]++;
      } else if (checkedTiers.length) {
        // Expansion dice: only exist if a die box is checked.
        pool[TIERS[Math.max(...checkedTiers)]]++;
      }
    }
    out[attr] = pool;
  }
  return out;
}

/**
 * Build sparse SCP flag data (and actor name) from raw PDF fields.
 * @returns {{name: string|null, data: object}}
 */
function buildData(rawFields, fieldMap, diceMap) {
  const data = {};            // sparse: only fields actually present in the PDF
  const weaponRows = {};
  const groups = {};          // groupName -> [{ order, value }]
  let name = null;

  for (const [pdfName, raw] of Object.entries(rawFields)) {
    const map = fieldMap[pdfName];
    if (!map) continue;
    if (raw === "" || raw == null) continue;    // don't overwrite defaults with blanks
    const value = coerce(raw, map.type);

    if (map.array === "weapons") {
      const [, , row, col] = map.target.split(".");
      (weaponRows[row] ??= {})[col] = value;
      continue;
    }
    if (map.group) {
      (groups[map.group] ??= []).push({ order: map.order ?? 0, value });
      continue;
    }
    if (map.target === "name") {
      if (value) name = value;
      continue;
    }
    foundry.utils.setProperty(data, map.target.replace(/^system\./, ""), value);
  }

  // Grouped fields (everyday carry / small items / storage) become inventory
  // rows: one { name, qty } per non-empty PDF entry, in reading order.
  for (const [group, items] of Object.entries(groups)) {
    const rows = items.sort((a, b) => a.order - b.order)
      .map((i) => String(i.value).trim()).filter(Boolean)
      .map((itemName) => ({ name: itemName, qty: "" }));
    if (rows.length) foundry.utils.setProperty(data, group, rows);
  }

  const weapons = Object.keys(weaponRows)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => weaponRows[k])
    .filter((w) => Object.values(w).some((v) => v !== "" && v != null));
  if (weapons.length) data.weapons = weapons;

  // Attribute dice pools (from checkboxes).
  if (diceMap) {
    for (const [attr, pool] of Object.entries(decodeDice(rawFields, diceMap))) {
      foundry.utils.setProperty(data, `attributes.${attr}.dice`, pool);
    }
  }

  return { name, data };
}

/** Import a filled SCP2e PDF File into an Actor (writing the SCP flag). */
export async function importPdfToActor(file, actor) {
  const buffer = await file.arrayBuffer();
  const [fieldMap, diceMap] = await Promise.all([
    loadJson("scripts/field-map.json"),
    loadJson("scripts/dice-map.json")
  ]);
  const raw = await readPdfFields(buffer);
  const { name, data } = buildData(raw, fieldMap, diceMap);

  // Merge imported fields over the actor's existing data (filled in defaults).
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
      await target.setFlag("core", "sheetClass", "scp2e-character-sheet.SCP2eCharacterSheet");
      target.sheet?.render(true);
    } catch (err) {
      console.error("SCP2e | PDF import failed:", err);
      ui.notifications.error(game.i18n.localize("SCP2E.Import.Failure"));
    }
  });
  input.click();
}
