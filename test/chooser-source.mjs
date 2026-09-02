/* THE ONE LIST OF WHAT chooseOptionIndex REACHES FOR.
 *
 * Three suites extract this chooser out of the shipped runner and execute it. Each kept its own
 * copy of the name list, so adding a tier broke the other two with a ReferenceError that reads like
 * a behaviour regression and is not one. That happened twice while the band and date tiers landed.
 *
 * Adding a tier now means adding its name HERE, once. A suite that forgets is impossible, because
 * there is nowhere else to forget it.
 */
import assert from 'node:assert/strict';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

export function constSource(name, indent, required = true) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  if (start === -1) {
    if (required) assert.fail(`${name} must exist in the sandbox runner`);
    return '';
  }
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|fs\\.)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

/** Every helper chooseOptionIndex and its tiers depend on, in dependency order. */
export const CHOOSER_NAMES = [
  'clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'declineMatches',
  'AFFIRMATIVE_ANSWER', 'soleOptionIndex',
  'gradedValueWithScale', 'parseBand', 'gradedBandIndex',
  'MONTH_NAMES', 'monthIndexOf', 'datePartsOf', 'dateComponentIndex',
  'yesNoNegationIndex',
  'chooseOptionIndex',
];

/** The chooser and every tier, executed out of the shipped runner source. */
export function loadChooser() {
  const src = CHOOSER_NAMES.map((name) => constSource(name, 4)).join('\n');
  const returns = CHOOSER_NAMES.filter((n) => n !== 'DECLINE_TO_STATE' && n !== 'MONTH_NAMES' && n !== 'AFFIRMATIVE_ANSWER');
  return Function(`${src}\nreturn { ${returns.join(', ')} };`)();
}
