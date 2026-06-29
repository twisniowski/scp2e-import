# SCP 2e Character Sheet — Foundry VTT Module

A dynamic, editable character sheet for the **SCP Foundation tabletop RPG (2nd edition)**, with one-click import from the official fillable PDF character sheet.

The module adds a self-contained Actor sub-type to Foundry, so it works in any world (including a blank/no-system world) without needing a full game system installed.

## Features

- **Editable character sheet** built on Foundry's ApplicationV2 framework, organized into Profile, Skills, Combat, Aspects, and Notes tabs.
- **All eight attributes** (Strength, Dexterity, Perception, Health, Intellect, Willpower, Charisma, Fate) grouped Physical / Mental.
- **All 33 standard skills** with governing-attribute tags and an automatic skill cap (½ the governing attribute, per the printed rule), plus custom write-in skills.
- **Combat block**: HP / Max HP / DR / base HP / base speed, weapon table, and the two uniform load-outs.
- **Aspects** (Powers / Talents / History), department favor tracks, and rich-text note areas.
- **Exertion / Reverence** pip trackers.
- **PDF import**: read a filled-in official SCP2e fillable PDF and populate a character automatically.

## Installation

**Manifest URL** (replace `REPLACE_ME` with the repository owner once published):

```
https://raw.githubusercontent.com/REPLACE_ME/scp2e-character-sheet/main/module.json
```

In Foundry: **Add-on Modules → Install Module → paste the manifest URL → Install**, then enable *SCP 2e Character Sheet* in your world.

## Usage

### Create a character

1. In the **Actors** sidebar, click **Create Actor** and choose the **SCP Personnel** type.
2. Open the actor to edit the sheet. Changes save automatically.

### Import from a PDF

There are two entry points:

- The **Import SCP PDF** button at the bottom of the Actors directory (creates a new character from the PDF).
- The **Import SCP PDF** button in the header of any open character sheet (fills that character).

Select a filled-in copy of the official `SCP2e_Character_Sheet` fillable PDF. The importer reads the PDF form fields and maps them onto the sheet — character name, player, title, personnel class, security level, age, all eight attributes, all skills, the HP/DR block, and the weapon table.

> The importer works with the **fillable** PDF (form fields intact). Flattened or scanned PDFs cannot be read.

### Macro / API

```js
const api = game.modules.get("scp2e-character-sheet").api;
api.importPdf();            // prompt to create a new character from a PDF
api.importPdf(actor);       // fill an existing actor
```

## How the PDF mapping works

The official PDF uses generic field names (`Text Field 12`, `Check Box 88`), so a
field map (`scripts/field-map.json`) was generated from the **geometry** of each
form widget — matching value boxes to their printed labels by position. The map
translates each PDF field to a path on the actor's data model. Regenerating the
map is only necessary if the official sheet layout changes.

## Project structure

```
scp2e-character-sheet/
├─ module.json              Manifest (declares the Actor sub-type + htmlFields)
├─ scripts/
│  ├─ module.js             Entry point: registers data model, sheet, import hooks
│  ├─ const.js              Shared constants
│  ├─ config.js             Attribute & skill definitions, reference tables
│  ├─ data-model.js         TypeDataModel schema for the character
│  ├─ sheet.js              ApplicationV2 character sheet
│  ├─ pdf-import.js         PDF parsing & field mapping
│  └─ field-map.json        PDF field → data path map (generated from geometry)
├─ templates/
│  └─ character-sheet.hbs   Sheet template
├─ styles/
│  └─ scp2e.css             Sheet styling
├─ lang/
│  └─ en.json              Localization
└─ lib/
   └─ pdf-lib.esm.min.js    Vendored pdf-lib (Apache-2.0) for in-browser parsing
```

## Compatibility

- Foundry VTT v13–v14.
- No game system required (the module provides its own Actor sub-type).

## Credits & licensing

- Module code: MIT (see `LICENSE`).
- Bundled [pdf-lib](https://github.com/Hopding/pdf-lib) is licensed Apache-2.0 / MIT.
- *SCP Foundation* content is released under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). This is an unofficial fan tool and is not affiliated with the SCP Foundation wiki or the authors of the SCP 2e tabletop RPG. Bring your own rulebook and character sheet PDF.
