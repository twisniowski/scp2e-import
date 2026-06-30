/**
 * SCP 2e default data.
 *
 * Data is stored in an Actor flag (flags.scp2e-character-sheet.data) rather than
 * a custom Actor sub-type, so the sheet works under ANY game system without the
 * host system's Actor class choking on an unknown type. This module provides the
 * default data shape and a normaliser that fills gaps in stored data.
 */
import { ATTRIBUTES, SKILLS, DEPARTMENTS } from "./config.js";

/** A fresh, fully-zeroed SCP data object. */
export function getDefaultData() {
  const attributes = {};
  for (const key of Object.keys(ATTRIBUTES)) attributes[key] = { value: 0, dice: { d6: 0, d8: 0, d10: 0, d12: 0 } };

  const skills = {};
  for (const key of Object.keys(SKILLS)) skills[key] = { value: 0 };

  const departments = {};
  for (const d of DEPARTMENTS) departments[d] = 0;

  return {
    identity: {
      player: "", title: "", personnelClass: "", securityLevel: "",
      age: "", disruptionClass: "", chaptersSurvived: 0
    },
    attributes,
    skills,
    customSkills: [],            // [{ name, gov, value }]
    health: { hp: 0, maxHp: 0, baseHp: 0, dr: 0, hthMult: "" },
    combat: { baseSpeed: 0, speed: "", combat: "", projectile: "", reaction: "", stagger: "" },
    tracks: { exertion: 0, exertionTotal: 0, reverence: 0 },
    weapons: [],                 // [{ name, toHit, aim, recoil, bDam, xDam, mag, range, mass, note }]
    aspects: [],                 // [{ name, type, cost, page }]
    uniforms: { aStyle: "", aSus: "", bStyle: "", bSus: "" },
    everydayCarry: "", smallItems: "", storage: "", aspectNotes: "", miscNotes: "",
    departments
  };
}

/** Deep-merge stored flag data over the defaults (arrays are taken as-is). */
export function normalizeData(stored = {}) {
  return foundry.utils.mergeObject(getDefaultData(), stored ?? {}, {
    inplace: false, insertKeys: true, insertValues: true
  });
}

/** Skill caps derived from attributes: half the governing attribute, rounded down. */
export function computeSkillCaps(data) {
  const caps = {};
  for (const [key, def] of Object.entries(SKILLS)) {
    const gov = Number(data?.attributes?.[def.gov]?.value ?? 0);
    caps[key] = Math.floor(gov / 2);
  }
  return caps;
}

/** Empty rows for the three editable tables. */
export const EMPTY_ROWS = {
  weapons: { name: "", toHit: "", aim: "", recoil: "", bDam: "", xDam: "", mag: "", range: "", mass: "", note: "" },
  aspects: { name: "", type: "power", cost: "", page: "" },
  customSkills: { name: "", gov: "", value: 0 }
};
