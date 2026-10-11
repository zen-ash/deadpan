// The detective's canned lines, with ElevenLabs v4 audio tags. All of these are generated once
// and cached, so the round never waits on the network for them. Gemini writes the follow-up
// question and the verdict; the lines at the bottom are the fallbacks when it can't.

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

export function intro(players: number): string {
  if (players <= 1) return "[low, gravelly] One suspect. One secret word. [pause] Let's see if you know it.";
  return `[low, gravelly] ${COUNT[Math.min(players, 6)]} suspects. One secret word. [pause] One of you doesn't know it.`;
}

/** Two Truths and a Lie. */
export function truthsIntro(players: number): string {
  if (players <= 1) return "[low, gravelly] Three questions. [pause] One of your answers will be a lie. I'll find it.";
  return `[low, gravelly] ${COUNT[Math.min(players, 6)]} suspects. Three questions each. [pause] Every one of you will lie once. I'll find it.`;
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

export const TRUTHS_DEAL = '[whispers] Check your phone. [pause] It tells you which answer to lie on.';

/**
 * Two Truths and a Lie: easy to answer truthfully, and a lie has to be made up on the spot. None
 * repeat a calibration question. 22, so six players get three each without a repeat.
 */
export const LIFE_QUESTIONS = [
  '[curious] Have you ever broken a bone? [pause] Tell me how.',
  "What's the last film you watched?",
  'Where did you go on your last holiday?',
  'What was your first job?',
  'Did you have a pet growing up? What was it called?',
  "[curious] What's the furthest you've ever been from home?",
  "What's the last thing you bought?",
  '[low] What did you do last weekend?',
  "What's a food you can't stand?",
  '[skeptical] Have you ever met anyone famous?',
  'What instrument have you tried to play?',
  'What was your favourite subject at school?',
  "What's the best concert you've been to?",
  "[low] What's the most trouble you got into as a kid?",
  "What's your hidden talent?",
  "[curious] What's the strangest thing you've ever eaten?",
  "What's the last book you read?",
  'What was your first phone?',
  'Where did you spend your last birthday?',
  "[skeptical] What's the worst haircut you've ever had?",
  'What sport did you play as a kid?',
  "What's the oldest thing you own?",
];

export const HEARD_ENOUGH = "[low] I've heard enough. [pause] Let's see who's been lying.";

/** Played while Gemini writes the follow-up, so the pause sounds like thinking. */
export const HMM = ['[thoughtful] Hmm...', '[low] Mm-hm. [pause] Interesting.', '[thoughtful] Hmm. [pause] Let me think.'];

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

/** Two Truths and a Lie follow-ups when Gemini can't write one: they press on the target's last answer (4). */
export const TRUTHS_FOLLOWUP_FALLBACKS = [
  '[skeptical] That last answer. [pause] Tell me more. Details, this time.',
  '[low] Go back to your last answer. [pause] Who else was there?',
  '[curious] Your last answer. [pause] When exactly was that?',
  '[low, gravelly] Hm. That last one. [pause] Walk me through it again, slowly.',
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

/** Two Truths and a Lie verdicts without names; the cards show each pick (3). */
export const TRUTHS_VERDICT_FALLBACKS = [
  "[low, gravelly] I've heard every story. [pause] And I know which ones were lies.",
  '[whispers] Every one of you lied once. [pause] I know exactly where.',
  '[low] The truth comes easy. The lies took work. [pause] I heard the work.',
];

/** After the reveal, when the detective was right (3). */
export const CASE_CLOSED = ['[satisfied] Case closed.', '[low] Another one for the files. [pause] Case closed.', '[chuckles] Too easy. Case closed.'];

/** After the reveal, when the imposter got away with it (3). */
export const YOU_GOT_ME = [
  '[laughs] You got me. Nerves of steel.',
  "[surprised] Well... [pause] I didn't see that coming.",
  '[laughs] Fooled me. Remind me never to play cards with you.',
];

/** Two Truths and a Lie, when the detective found some of the lies but not all (2). */
export const SOME_GOT_AWAY = ['[chuckles] Some of you lie better than others.', '[thoughtful] Some of the truth came out. [pause] Not all of it.'];

/** Every canned line, for pre-generating the audio cache at startup. */
export function allCannedLines(): string[] {
  return [
    ...[1, 2, 3, 4, 5, 6].map(intro),
    ...BASELINE,
    DEAL,
    ...QUESTIONS,
    HEARD_ENOUGH,
    ...HMM,
    ...FOLLOWUP_FALLBACKS,
    ...VERDICT_FALLBACKS,
    ...CASE_CLOSED,
    ...YOU_GOT_ME,
    ...[1, 2, 3, 4, 5, 6].map(truthsIntro),
    TRUTHS_DEAL,
    ...LIFE_QUESTIONS,
    ...TRUTHS_FOLLOWUP_FALLBACKS,
    ...TRUTHS_VERDICT_FALLBACKS,
    ...SOME_GOT_AWAY,
  ];
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
