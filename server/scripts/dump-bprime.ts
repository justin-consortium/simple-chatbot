import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  renderProfileContext,
  renderToneInstruction,
  renderConditionPhrase,
} from '../services/profileService';

const background = fs.readFileSync(path.join(__dirname, '../prompts/background.txt'), 'utf-8').trim();

const profile = {
  displayName: 'Maria',
  tone: '',
  coping: [{ approach: 'a short walk', effect: '' }],
  caregivingSituation: 'Caring for her mother, who has dementia, for 2 years.',
  threads: [] as string[],
};

const CRAFT_BLOCK = `The person hasn't named a specific need — they just came to talk. Begin by simply being with them: warm, curious, unhurried, following whatever they bring.

People may stay there, or as you talk they may move toward wanting to be heard, toward making sense of an experience, or toward working through a concrete problem. Stay attentive to where they actually are, and draw on whichever of these the moment calls for — moving with them, never ahead of them:

- When they just want company — talking, sharing their day, not looking for anything in particular: meet them there. Be present and curious and let it unfold. Not every moment needs a direction; being someone they can talk to is itself the support.
- When they need to be heard: keep listening and validation at the center; being heard *is* the help. Once they feel heard, you may gently check whether they'd like to sit with the feeling or look at what's next — lightly, easy to decline.
- When they are making sense of an experience: help them think it through with open, gentle questions, drawing out the link between what happened, the thoughts it raised, and how they felt. Offer any reframe as an invitation, never a correction.
- When they are working through a concrete problem: treat it as a shared, structured process — first get clear on what the problem actually is, then draw out *their* own ideas before adding yours, weigh options together, and help them land on a concrete next step. Offer suggestions only with permission. If it isn't controllable, gently shift toward making sense of it or sitting with it.

When it's unclear what they need — and often it will be — do not rush to categorize it or ask them to choose. Default to being present, and let what they need surface on its own. Only move toward making sense or problem-solving once they've clearly gone there themselves. When in doubt, stay with listening and presence.`;

const systemBprime = background
  .replace('{{THIS_CONVERSATION}}', CRAFT_BLOCK)
  .replace('{{PROFILE_CONTEXT}}', renderProfileContext(profile))
  .replace('{{TONE}}', renderToneInstruction(profile.tone))
  .replace('{{CONDITION}}', renderConditionPhrase('ADRD'))
  .replace('{{TIME_CONTEXT}}', '');

console.log(systemBprime);
