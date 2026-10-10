// The detective's canned lines, with ElevenLabs v4 audio tags. All of these are generated once
// and cached, so the round never waits on the network for them. Gemini writes the follow-up
// question and the verdict; the lines at the bottom are the fallbacks when it can't.

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

export function intro(players: number): string {
  if (players <= 1) return "[low, gravelly] One suspect. One secret word. [pause] Let's see if you know it.";
  return `[low, gravelly] ${COUNT[Math.min(players, 6)]} suspects. One secret word. [pause] One of you doesn't know it.`;
}

/** Softballs that set each player's calm baseline. */
export const BASELINE = [
  "[calm] Let's start easy. Say your name, and what you ate today.",
  '[calm] Tell me your name, and where you grew up.',
  '[calm] Your name, and what you did this morning.',
  '[calm] Your name, and your favourite snack.',
];

export const DEAL = "[whispers] Check your card. [pause] Don't let anyone see it.";

/** Questions anyone who knows the word can answer, and an imposter has to bluff. */
export const QUESTIONS = [
  'Describe it in three words.',
  '[curious] When did you last see one?',
  'Where would you usually find it?',
  '[pause] What colour do you picture?',
  'Who would want one?',
  'What does it remind you of?',
  '[skeptical] Is it bigger than a car? Explain.',
  'What sound does it make?',
  'Would you take one on holiday?',
  '[low] What would you do with one?',
];

export const HEARD_ENOUGH = "[low] I've heard enough. [pause] Let's see who's been lying.";

// SPEC: 20 canned lines for when Gemini times out.

/** Generic follow-ups, aimed at whoever drifted furthest (8). */
export const FOLLOWUP_FALLBACKS = [
  '[skeptical] You hesitated. [pause] Tell me one more thing about it.',
  '[whispers] And how does it make you feel?',
  'Interesting. [pause] Where did you first come across one?',
  '[low] Say that again, slower. What is it like?',
  '[curious] How would you explain it to a child?',
  "Hm. [pause] What's the best thing about it?",
  "[skeptical] Name something it's often seen with.",
  '[low, gravelly] What would happen if it disappeared?',
];

/** Accusations without a name; the spotlight on the big screen shows who (6). */
export const VERDICT_FALLBACKS = [
  "[low, gravelly] I've watched every one of you. [pause] And the imposter... is you.",
  "[whispers] Your voice gave you away. [pause] It's you.",
  'The pauses. The ums. [pause] I know exactly who you are.',
  "[low] Nobody fools me. [pause] You're the imposter.",
  "[sighs] It was never a mystery. [pause] It's you.",
  '[low, gravelly] The truth always slips out. [pause] And it slipped out of you.',
];

/** After the reveal, when the detective was right (3). */
export const CASE_CLOSED = ['[satisfied] Case closed.', '[low] Another one for the files. [pause] Case closed.', '[chuckles] Too easy. Case closed.'];

/** After the reveal, when the imposter got away with it (3). */
export const YOU_GOT_ME = [
  '[laughs] You got me. Nerves of steel.',
  "[surprised] Well... [pause] I didn't see that coming.",
  '[laughs] Fooled me. Remind me never to play cards with you.',
];

/** Every canned line, for pre-generating the audio cache at startup. */
export function allCannedLines(): string[] {
  return [
    ...[1, 2, 3, 4, 5, 6].map(intro),
    ...BASELINE,
    DEAL,
    ...QUESTIONS,
    HEARD_ENOUGH,
    ...FOLLOWUP_FALLBACKS,
    ...VERDICT_FALLBACKS,
    ...CASE_CLOSED,
    ...YOU_GOT_ME,
  ];
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
