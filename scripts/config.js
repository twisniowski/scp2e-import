/**
 * SCP 2e system configuration constants.
 * Attribute keys, skill definitions (with governing attribute), and the
 * progression/disruption reference data printed on the paper character sheet.
 */
export const SCP2E = {};

/** The eight core attributes, grouped Physical / Mental as on the sheet. */
export const ATTRIBUTES = {
  strength:   { label: "SCP2E.Attr.Strength",   abbr: "STR", group: "physical" },
  dexterity:  { label: "SCP2E.Attr.Dexterity",  abbr: "DEX", group: "physical" },
  perception: { label: "SCP2E.Attr.Perception", abbr: "PER", group: "physical" },
  health:     { label: "SCP2E.Attr.Health",     abbr: "HTH", group: "physical" },
  intellect:  { label: "SCP2E.Attr.Intellect",  abbr: "INT", group: "mental" },
  willpower:  { label: "SCP2E.Attr.Willpower",  abbr: "WIL", group: "mental" },
  charisma:   { label: "SCP2E.Attr.Charisma",   abbr: "CHA", group: "mental" },
  fate:       { label: "SCP2E.Attr.Fate",       abbr: "FTE", group: "mental" }
};

/**
 * The 33 standard skills. `crucial: true` marks the four combat skills printed
 * in the "(Crucial) Skills" block. `gov` is the governing attribute key, used
 * to compute the skill cap (half the governing attribute, rounded down).
 */
export const SKILLS = {
  awareness:    { label: "SCP2E.Skill.Awareness",   gov: "perception", crucial: true },
  dodge:        { label: "SCP2E.Skill.Dodge",       gov: "dexterity",  crucial: true },
  firearms:     { label: "SCP2E.Skill.Firearms",    gov: "perception", crucial: true },
  melee:        { label: "SCP2E.Skill.Melee",       gov: "dexterity",  crucial: true },
  animalKen:    { label: "SCP2E.Skill.AnimalKen",   gov: "charisma" },
  anomalistics: { label: "SCP2E.Skill.Anomalistics",gov: "intellect" },
  athletics:    { label: "SCP2E.Skill.Athletics",   gov: "health" },
  brawn:        { label: "SCP2E.Skill.Brawn",       gov: "strength" },
  breakFree:    { label: "SCP2E.Skill.BreakFree",   gov: "strength" },
  computers:    { label: "SCP2E.Skill.Computers",   gov: "intellect" },
  creativity:   { label: "SCP2E.Skill.Creativity",  gov: "intellect" },
  deceive:      { label: "SCP2E.Skill.Deceive",     gov: "charisma" },
  disarm:       { label: "SCP2E.Skill.Disarm",      gov: "dexterity" },
  disguise:     { label: "SCP2E.Skill.Disguise",    gov: "charisma" },
  intimidate:   { label: "SCP2E.Skill.Intimidate",  gov: "charisma" },
  intuition:    { label: "SCP2E.Skill.Intuition",   gov: "intellect" },
  investigate:  { label: "SCP2E.Skill.Investigate", gov: "intellect" },
  mathematics:  { label: "SCP2E.Skill.Mathematics", gov: "intellect" },
  mechanics:    { label: "SCP2E.Skill.Mechanics",   gov: "intellect" },
  medical:      { label: "SCP2E.Skill.Medical",     gov: "intellect" },
  navigate:     { label: "SCP2E.Skill.Navigate",    gov: "intellect" },
  ordnance:     { label: "SCP2E.Skill.Ordnance",    gov: "intellect" },
  persuade:     { label: "SCP2E.Skill.Persuade",    gov: "charisma" },
  poise:        { label: "SCP2E.Skill.Poise",       gov: "health" },
  psychology:   { label: "SCP2E.Skill.Psychology",  gov: "intellect" },
  resilience:   { label: "SCP2E.Skill.Resilience",  gov: "willpower" },
  resistDeath:  { label: "SCP2E.Skill.ResistDeath", gov: "fate" },
  selfControl:  { label: "SCP2E.Skill.SelfControl", gov: "willpower" },
  stealth:      { label: "SCP2E.Skill.Stealth",     gov: "dexterity" },
  teaching:     { label: "SCP2E.Skill.Teaching",    gov: "charisma" },
  technology:   { label: "SCP2E.Skill.Technology",  gov: "intellect" },
  thievery:     { label: "SCP2E.Skill.Thievery",    gov: "dexterity" },
  vehicles:     { label: "SCP2E.Skill.Vehicles",    gov: "dexterity" }
};

/** Disruption class -> chapter bonus reference, printed bottom-right of the sheet. */
export const DISRUPTION_CLASSES = {
  dark:  { label: "Dark",  ratio: "0/4", bonus: "+3 Any, +7 Skill" },
  vlam:  { label: "Vlam",  ratio: "1/3", bonus: "+1 Physical, +1 Mental, +1 Any, +4 Skill" },
  keneq: { label: "Keneq", ratio: "2/2", bonus: "+1 Physical, +1 Mental, +3 Skill" },
  ekhi:  { label: "Ekhi",  ratio: "3/1", bonus: "+1 Any, +2 Skill" },
  amida: { label: "Amida", ratio: "4/0", bonus: "(none)" }
};

/** Department / Favor tracks listed on page 2 of the sheet. */
export const DEPARTMENTS = ["AST", "SCP", "FIN", "HR", "INT", "MNT", "MED", "MIL", "SCI", "MTF", "DIR"];

SCP2E.ATTRIBUTES = ATTRIBUTES;
SCP2E.SKILLS = SKILLS;
SCP2E.DISRUPTION_CLASSES = DISRUPTION_CLASSES;
SCP2E.DEPARTMENTS = DEPARTMENTS;
