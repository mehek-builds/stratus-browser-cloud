/* CHOOSING AN OPTION, RUN AGAINST REAL MARKUP IN A REAL BROWSER.
 *
 * WHY A BROWSER AND NOT A STUB. Every question this file asks is a question about the accessible
 * name: what '<div role="option" aria-label="Bachelor s Degree">BS</div>' is called, whether a row
 * named only through aria-labelledby is reachable, whether the role engine can see an aria-hidden
 * row. A stub answers those by reimplementing them, and reimplementing them is precisely the defect
 * this file exists to prevent. An earlier version of this suite faked the option list, and because
 * the fake computed names the same wrong way the implementation did, it agreed with every one of
 * five defects and reported them all as passes.
 *
 * WHY THE HARNESS INJECTS scopedMenu, page AND optionsRoot. So that ANY version of
 * clickMatchingOption runs here, including the one on main. A test that can only fail with
 * 'ReferenceError: scopedMenu is not defined' proves the source changed, not that behaviour did,
 * and it is worth nothing as a regression test. Every assertion below is reached by executing the
 * helper, so checking out an older runner makes these fail on the assertion, with the row it
 * clicked printed next to the row it should have clicked.
 *
 * THE ASYMMETRY THE ASSERTIONS ENCODE. A choice this runner cannot make is handed back for a person
 * to finish, which costs a minute. A choice it makes WRONGLY is a wrong answer on somebody's real
 * job application, submitted under her name, and reported to her as filled. So the cases that
 * require NO click are as load-bearing as the cases that require one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Pulled out of the shipped runner string rather than copied, the same way question-label-dom and
 * captcha-dom do it. Tolerant on purpose: the helpers the current runner splits this logic into do
 * not all exist in older runners, and this file has to be able to execute those too. Only
 * clickMatchingOption itself is required. */
function constSource(name, indent, required = false) {
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

const BASE = ['clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'optionMatches']
  .map((name) => constSource(name, 4, true))
  .join('\n');
const INNER = ['clickIfPresent', 'menuRoot', 'escapeName', 'wholeName', 'shorterOptionNames']
  .map((name) => constSource(name, 6))
  .concat(constSource('clickMatchingOption', 6, true))
  .join('\n');
const OPTION_NODES = Function(`${constSource('OPTION_NODES', 6, true)}\nreturn OPTION_NODES;`)();

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/** One option row. `id` is what the assertions name it by, and is never part of its label. */
function option(id, { text = '', ariaLabel = null, labelledBy = null, title = null, hidden = false } = {}) {
  const parts = ['role="option"', `data-row="${id}"`, 'style="padding:4px"'];
  if (ariaLabel !== null) parts.push(`aria-label="${ariaLabel}"`);
  if (labelledBy !== null) parts.push(`aria-labelledby="${labelledBy}"`);
  if (title !== null) parts.push(`title="${title}"`);
  if (hidden) parts.push('aria-hidden="true"');
  return `<div ${parts.join(' ')}>${text}</div>`;
}

/* Runs the real clickMatchingOption against real Playwright locators over `rows`, and reports the
 * row it actually clicked. `extra` is markup outside the menu, for aria-labelledby targets. */
async function choose(rows, target, extra = '') {
  await page.setContent(`<!doctype html><html><body>${extra}`
    + `<div id="menu" class="select__container">${rows.join('')}</div></body></html>`);
  await page.evaluate(() => {
    window.__clicked = [];
    document.addEventListener('click', (event) => {
      const row = event.target.closest('[data-row]');
      window.__clicked.push(row ? row.getAttribute('data-row') : 'OUTSIDE_ANY_ROW');
    }, true);
  });
  const scopedMenu = page.locator('#menu');
  const optionsRoot = () => scopedMenu.locator(OPTION_NODES);
  const run = Function('scopedMenu', 'page', 'optionsRoot', `
    ${BASE}
    let lastClickedOptionText = '';
    ${INNER}
    return async (target) => ({ hit: await clickMatchingOption(target), text: lastClickedOptionText });
  `)(scopedMenu, page, optionsRoot);
  const result = await run(target);
  const clicked = await page.evaluate(() => window.__clicked);
  return { hit: result.hit, text: result.text, clicked: clicked[0] ?? null };
}

/* ---------------------------------------------------------------------------------------------
 * THE DEFECT. Every rule that shipped requires the EMPLOYER'S row to contain the answer, and
 * optionMatches, which is what verifyChoiceInContainer uses to decide whether the control ended up
 * holding the right answer, also accepts a row that is a substring of the stored answer. So this
 * row could never be clicked and would have been called correct had the form arrived with it
 * already selected.
 * ------------------------------------------------------------------------------------------- */
test('a row that is a substring of the stored answer is clickable', async () => {
  const { optionMatches } = Function(`${BASE}\nreturn { optionMatches };`)();
  const stored = "Bachelor's Degree in Computer Science";
  assert.equal(optionMatches("Bachelor's Degree", stored), true, 'the verifier accepts this row');
  const menu = await choose([
    option('masters', { text: "Master's Degree" }),
    option('bachelors', { text: "Bachelor's Degree" }),
    option('doctorate', { text: 'Doctorate' })
  ], stored);
  assert.equal(menu.hit, true);
  assert.equal(menu.clicked, 'bachelors');
  // Recorded, because verifyChoiceInContainer's third rule verifies against the row that was clicked.
  assert.equal(menu.text, "Bachelor's Degree");
});

test('a menu offering two different parts of the answer is handed back, not guessed at', async () => {
  /* Both rows are substrings of the stored answer, and nothing here knows whether this employer
     asked for the degree or the discipline. Every other rule is anchored on the answer as she
     stated it and cannot be ambiguous this way; this one is asking which PART of it was wanted.
     optionMatches accepts both, so verifyChoiceInContainer would report either as filled, which is
     what makes a guess here expensive: it is a wrong word on a real application, reported as done.
     Declining costs a minute. */
  const menu = await choose([
    option('discipline', { text: 'Computer Science' }),
    option('bachelors', { text: "Bachelor's Degree" })
  ], "Bachelor's Degree in Computer Science");
  assert.equal(menu.hit, false);
  assert.equal(menu.clicked, null);
});

test('a row that is exactly the answer beats a row that merely contains it', async () => {
  // The shipped query was getByRole(name, exact:false).first(), which is a substring match taken in
  // DOM order, so a menu that lists the wider row first handed over the wider row.
  const menu = await choose([
    option('wide', { text: 'Computer Science and Engineering' }),
    option('exact', { text: 'Computer Science' })
  ], 'Computer Science');
  assert.equal(menu.clicked, 'exact');
});

/* ---------------------------------------------------------------------------------------------
 * THE FIVE DEFECTS AN EARLIER ATTEMPT AT THIS FIX INTRODUCED, all from one decision: reading the
 * rows with textContent and comparing them with normalized(), instead of letting Playwright's role
 * engine compute the accessible name. All five pass on the runner that shipped. They are here so
 * that no future attempt can reintroduce them quietly.
 * ------------------------------------------------------------------------------------------- */
test('an answer whose punctuation carries all its meaning matches nothing rather than anything', async () => {
  // normalized() keeps only [a-z0-9], so "C++" reduces to "c", and "computer science" contains "c".
  // That turns a correct "a human should finish this" into a wrong answer reported as filled, which
  // is the worst outcome this file can produce.
  const menu = await choose([
    option('cs', { text: 'Computer Science' }),
    option('econ', { text: 'Economics' })
  ], 'C++');
  assert.equal(menu.hit, false);
  assert.equal(menu.clicked, null, 'no row is clicked when the answer is on no list');
});

test('two answers that differ only in punctuation are told apart', async () => {
  // normalized("C++") and normalized("C#") are both "c", so any rule built on it ties them and
  // takes whichever the employer listed first.
  const menu = await choose([
    option('cplusplus', { text: 'C++' }),
    option('csharp', { text: 'C#' })
  ], 'C#');
  assert.equal(menu.clicked, 'csharp');
});

test('a row named by aria-label is reachable even when its text says something else', async () => {
  // The accessible name is aria-label; the text is an abbreviation. A textContent read sees "BS".
  const menu = await choose([
    option('bs', { text: 'BS', ariaLabel: "Bachelor's Degree" })
  ], "Bachelor's Degree");
  assert.equal(menu.hit, true);
  assert.equal(menu.clicked, 'bs');
});

test('a row named only by aria-labelledby is reachable', async () => {
  // aria-labelledby outranks aria-label and content both, and this row has no content at all.
  const menu = await choose(
    [option('degree', { labelledBy: 'degree-label' })],
    "Bachelor's Degree",
    '<span id="degree-label">Bachelor\'s Degree</span>'
  );
  assert.equal(menu.hit, true);
  assert.equal(menu.clicked, 'degree');
});

test('a non-Latin answer reaches its own row', async () => {
  // normalized() keeps only [a-z0-9], so a Japanese, Arabic or Cyrillic answer reduces to the empty
  // string and matches nothing. Employers serve non-Latin forms, which is the whole subject of the
  // sibling label fix, and a non-Latin form serves non-Latin option rows.
  for (const [answer, id, rows] of [
    ['はい', 'hai', [option('hai', { text: 'はい' }), option('iie', { text: 'いいえ' })]],
    ['Да', 'da', [option('da', { text: 'Да' }), option('net', { text: 'Нет' })]],
    ['نعم', 'naam', [option('naam', { text: 'نعم' }), option('la', { text: 'لا' })]]
  ]) {
    const menu = await choose(rows, answer);
    assert.equal(menu.hit, true, `${answer} should be clickable`);
    assert.equal(menu.clicked, id);
  }
});

test('an aria-hidden ghost row never swallows the click', async () => {
  // Greenhouse and React Select both render duplicated measurement rows. The role engine refuses an
  // aria-hidden row; OPTION_NODES is a CSS selector and cannot, so enumerating through it lets a
  // ghost win on DOM order. The click then lands on nothing and the caller is told it succeeded.
  const menu = await choose([
    option('ghost', { text: 'Computer Science', hidden: true }),
    option('real', { text: 'Computer Science' })
  ], 'Computer Science');
  assert.equal(menu.clicked, 'real');
});

/* ---------------------------------------------------------------------------------------------
 * BEHAVIOUR THAT SHIPPED AND MUST NOT CHANGE.
 * ------------------------------------------------------------------------------------------- */
test('a short answer still reaches the longer row it always reached', async () => {
  // "yes" is three normalised characters, below optionMatches's own six-character containment
  // floor, so a rule built on optionMatches alone would refuse this row while
  // verifyChoiceInContainer went on accepting it. That is the same defect reversed.
  const menu = await choose([
    option('no', { text: 'No' }),
    option('yes', { text: 'Yes, I am authorized to work in the United States' })
  ], 'Yes');
  assert.equal(menu.hit, true);
  assert.equal(menu.clicked, 'yes');
});

test('an opt-out reaches an opt-out worded differently', async () => {
  const menu = await choose([
    option('veteran', { text: 'I identify as one or more of the classifications of protected veteran' }),
    option('decline', { text: 'I do not want to answer' })
  ], 'Decline to self-identify');
  assert.equal(menu.clicked, 'decline');
});

test('a menu holding no answer leaves the control untouched', async () => {
  const menu = await choose([
    option('mech', { text: 'Mechanical Engineering' }),
    option('econ', { text: 'Economics' }),
    option('decline', { text: 'Prefer not to say' })
  ], 'Computer Science');
  assert.equal(menu.hit, false);
  assert.equal(menu.clicked, null);
  assert.equal(menu.text, '');
});

test('the runs offered to the browser are the ones optionMatches would accept', async () => {
  /* The substring rule is optionMatches's third clause asked forwards: rather than reading a row
     and testing it, the answer's own word runs are generated and Playwright is asked whether a row
     is named one of them. The two have to stay the same rule, so every run this generates is
     required to be one optionMatches accepts, and the six-character floor has to hold. */
  // Checked before the scope is built, so a runner without this helper fails with a sentence rather
  // than with a ReferenceError out of the generated source.
  assert.ok(/\n {6}const shorterOptionNames = /.test(SANDBOX_RUNNER), 'shorterOptionNames must exist in the sandbox runner');
  const scope = Function(`${BASE}\n${INNER}\nreturn { shorterOptionNames, optionMatches, normalized };`)(
    undefined, undefined, undefined,
  );
  for (const answer of [
    "Bachelor's Degree in Computer Science",
    'Yes, I am authorized to work in the United States',
    'Decline to self-identify',
    'C++',
    'はい'
  ]) {
    for (const bucket of scope.shorterOptionNames(answer)) {
      for (const span of bucket) {
        assert.ok(scope.normalized(span).length > 6, `"${span}" must clear the six character floor`);
        assert.equal(scope.optionMatches(span, answer), true, `optionMatches must accept "${span}" for "${answer}"`);
      }
    }
  }
  // And an answer whose meaning is entirely punctuation offers nothing at all, which is why C++
  // cannot reach a Computer Science row through this rule either.
  assert.deepEqual(scope.shorterOptionNames('C++'), []);
  assert.deepEqual(scope.shorterOptionNames('はい'), []);
});
