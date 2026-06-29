/**
 * SCP 2e character TypeDataModel.
 * Mirrors the fields on the official SCP2e fillable character sheet so that an
 * imported PDF maps 1:1, while exposing a clean schema for the Foundry sheet.
 */
import { ATTRIBUTES, SKILLS, DEPARTMENTS } from "./config.js";

const fields = foundry.data.fields;

/** Build the attribute schema: one rating per attribute. */
function attributeSchema() {
  const schema = {};
  for (const key of Object.keys(ATTRIBUTES)) {
    schema[key] = new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });
  }
  return new fields.SchemaField(schema);
}

/** Build the skill schema: one rating per standard skill. */
function skillSchema() {
  const schema = {};
  for (const key of Object.keys(SKILLS)) {
    schema[key] = new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });
  }
  return new fields.SchemaField(schema);
}

/** A custom (blank-row) skill the player wrote in by hand. */
function customSkillField() {
  return new fields.ArrayField(new fields.SchemaField({
    name: new fields.StringField({ required: true, blank: true }),
    gov: new fields.StringField({ required: false, blank: true, initial: "" }),
    value: new fields.NumberField({ integer: true, initial: 0, min: 0 })
  }));
}

/** Weapon row from the equipment table. */
function weaponField() {
  return new fields.ArrayField(new fields.SchemaField({
    name:   new fields.StringField({ blank: true }),
    toHit:  new fields.StringField({ blank: true }),
    aim:    new fields.StringField({ blank: true }),
    recoil: new fields.StringField({ blank: true }),
    bDam:   new fields.StringField({ blank: true }),
    xDam:   new fields.StringField({ blank: true }),
    mag:    new fields.StringField({ blank: true }),
    range:  new fields.StringField({ blank: true }),
    mass:   new fields.StringField({ blank: true }),
    note:   new fields.StringField({ blank: true })
  }));
}

/** Aspect row (Power / Talent / History) from page 2. */
function aspectField() {
  return new fields.ArrayField(new fields.SchemaField({
    name: new fields.StringField({ blank: true }),
    cost: new fields.StringField({ blank: true }),
    page: new fields.StringField({ blank: true }),
    type: new fields.StringField({ blank: true, initial: "power",
      choices: ["power", "talent", "history"] })
  }));
}

export class SCP2eCharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const departments = {};
    for (const d of DEPARTMENTS) {
      departments[d] = new fields.NumberField({ integer: true, initial: 0 });
    }

    return {
      // --- Identity -------------------------------------------------------
      identity: new fields.SchemaField({
        player:         new fields.StringField({ blank: true }),
        title:          new fields.StringField({ blank: true }),
        personnelClass: new fields.StringField({ blank: true }),
        securityLevel:  new fields.StringField({ blank: true }),
        age:            new fields.StringField({ blank: true }),
        disruptionClass:new fields.StringField({ blank: true, initial: "" }),
        chaptersSurvived: new fields.NumberField({ integer: true, initial: 0, min: 0 })
      }),

      // --- Core ratings ---------------------------------------------------
      attributes: attributeSchema(),
      skills: skillSchema(),
      customSkills: customSkillField(),

      // --- Health / derived combat (manual boxes on the sheet) -----------
      health: new fields.SchemaField({
        hp:       new fields.NumberField({ integer: true, initial: 0 }),
        maxHp:    new fields.NumberField({ integer: true, initial: 0 }),
        baseHp:   new fields.NumberField({ integer: true, initial: 0 }),
        dr:       new fields.NumberField({ integer: true, initial: 0 }),
        hthMult:  new fields.StringField({ blank: true })
      }),
      combat: new fields.SchemaField({
        baseSpeed: new fields.NumberField({ integer: true, initial: 0 }),
        speed:     new fields.StringField({ blank: true }),
        combat:    new fields.StringField({ blank: true }),
        projectile:new fields.StringField({ blank: true }),
        reaction:  new fields.StringField({ blank: true }),
        stagger:   new fields.StringField({ blank: true })
      }),

      // --- Tracks (exertion / reverence pip counts) ----------------------
      tracks: new fields.SchemaField({
        exertion:  new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        reverence: new fields.NumberField({ integer: true, initial: 0, min: 0 })
      }),

      // --- Gear / aspects / notes ----------------------------------------
      weapons: weaponField(),
      aspects: aspectField(),
      uniforms: new fields.SchemaField({
        aStyle: new fields.StringField({ blank: true }),
        aSus:   new fields.StringField({ blank: true }),
        bStyle: new fields.StringField({ blank: true }),
        bSus:   new fields.StringField({ blank: true })
      }),
      smallItems: new fields.HTMLField({ blank: true }),
      storage:    new fields.HTMLField({ blank: true }),
      aspectNotes:new fields.HTMLField({ blank: true }),
      miscNotes:  new fields.HTMLField({ blank: true }),
      departments: new fields.SchemaField(departments)
    };
  }

  /**
   * Derived data: skill caps (half governing attribute, rounded down) and a
   * convenience grouping for the sheet. Kept side-effect free and faithful to
   * the rule printed on the sheet: "Skill Cap = 1/2 of governing attribute".
   */
  prepareDerivedData() {
    this.skillCaps = {};
    for (const [key, def] of Object.entries(SKILLS)) {
      const gov = this.attributes?.[def.gov]?.value ?? 0;
      this.skillCaps[key] = Math.floor(gov / 2);
    }
  }
}
