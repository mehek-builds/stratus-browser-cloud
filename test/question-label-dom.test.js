/* THE QUESTION LABEL, RUN AGAINST THE MARKUP THE EMPLOYER SERVES.
 *
 * WHAT THIS FILE IS PAYING FOR. A fix for exactly this defect was written, adversarially verified
 * against 39 live employer forms, merged into the backend as PR 477 and deployed on 2026-08-11, and
 * the next real run was byte-for-byte identical: the same 7 discovered questions, the same 9 filled
 * fields, the same 8 blockers. The reason is that questionLabel exists THREE times - here in the
 * managed runner, in the backend's questionDiscovery.ts, and in the extension - and this copy is the
 * one that drives employer forms. A fix that lands anywhere else is invisible in production. The
 * comment above the discover action has asked for three-way hand-syncing since it was written; that
 * is what drifted, and this file is the first thing in this repo that would notice.
 *
 * WHY A BROWSER AND NOT A STUB. Every discrimination below is a question about a real tree: what
 * closest() and parentElement find walking up six levels of Lever's card markup, how many controls a
 * block holds once the hidden baseTemplate input is excluded, what textContent reports through a
 * text-transform. jsdom answers some of these and not the rest, and the ones it gets wrong are the
 * ones that decide whether a question is recovered or invented.
 *
 * THE ASYMMETRY THE ASSERTIONS ENCODE. A missing question is a blocker: the run stops, says which
 * field it could not name, and a person finishes it. A WRONG question is an answer typed into an
 * employer's form under a heading it does not belong to - on the live Palantir form, her university
 * typed into "High School Name". So every ambiguous shape here is required to return the handle
 * unchanged, which downstream drops, rather than a plausible guess.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied, the same way
 * test/captcha-dom.test.js and test/submit-outcome-dom.test.js do it. A copy would let this file
 * keep passing while the label reader drifted, which is the exact failure that made the backend fix
 * invisible in the first place. */
function extractBraced(prefix) {
  const start = SANDBOX_RUNNER.indexOf(prefix);
  assert.notEqual(start, -1, `${prefix} must still be in the runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, i + 1);
    }
  }
  throw new Error(`could not find the end of ${prefix}`);
}

const LABEL_SOURCE = [
  extractBraced('function clean(s) {'),
  extractBraced('function renderedText(node) {'),
  extractBraced('function labelledByText(el) {'),
  extractBraced('function blockOf(el) {'),
  extractBraced('function questionLabel(el) {'),
].join('\n');

const CHOICE_SOURCE = [
  LABEL_SOURCE,
  extractBraced('function choiceQuestionKey(el, block) {'),
  extractBraced('function optionsOf(el, block) {'),
].join('\n');

/* Transcribed from https://jobs.lever.co/palantir/d5486403-c050-4920-b2e0-91b69b61ebb2/apply on
 * 2026-08-11, not sketched. Three details are load-bearing and all three are real:
 *   - the question text sits in a sibling div.application-label, never in a <label>, which is why
 *     the control has no label element to find and the assembled string is the bare handle;
 *   - the heading is an <h4 data-qa="card-name"> OUTSIDE the <li>, six levels up from the control;
 *   - every card opens with a hidden baseTemplate input carrying the card's JSON. That input is why
 *     the two-control bound has to say input:not([type="hidden"]): counted naively, EVERY Lever card
 *     holds two controls and the walk would refuse all of them.
 * The heading is painted text-transform:uppercase by Lever's stylesheet, so innerText reads
 * "YEAR OF GRADUATION" where textContent reads the employer's own "Year of Graduation". */
const leverCard = (heading, questions) => `
  <div class="section page-centered application-form" data-qa="additional-cards">
    <h4 data-qa="card-name" style="text-transform:uppercase">${heading}</h4>
    <input type="hidden" name="cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][baseTemplate]"
      value='{"text":"${heading}","type":"posting"}' />
    <ul>${questions}</ul>
  </div>`;

const leverDropdown = (uuid, field, prompt) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown">
      <div class="text">${prompt}<span class="required">&#10007;</span></div>
    </div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="cards[${uuid}][${field}]" required>
        <option value="">Select...</option>
        <option value="2028">2028</option>
      </select>
    </div></div>
  </div></li>`;

/* A radio GROUP, which is the shape the recovery has never handled. Read live off Belvedere
 * Trading's Lever posting 2026-08-17: the question sits in the card heading and each option carries
 * its own <label>, so the input's nearest label is "High School Diploma" - an OPTION, not a
 * question. Every option in the group shares one name attribute. */
const leverRadioGroup = (uuid, field, prompt, options) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width">
      <div class="text">${prompt}<span class="required">&#10007;</span></div>
    </div>
    <div class="application-field full-width required-field"><ul>
      ${options.map((option) => `
        <li><label><input type="radio" name="cards[${uuid}][${field}]" value="${option}" required />
          <span>${option}</span></label></li>`).join('')}
    </ul></div>
  </div></li>`;

const leverTextarea = (uuid, field, prompt) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width textarea">
      <div class="text">${prompt}<span class="required">&#10007;</span></div>
    </div>
    <div class="application-field full-width required-field">
      <textarea class="card-field-input" name="cards[${uuid}][${field}]" required></textarea>
    </div>
  </div></li>`;

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/* Sets the page to `html` and returns questionLabel(el) for every control matching `selector`. */
async function labelsFor(html, selector) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(([source, sel]) => {
    // eslint-disable-next-line no-new-func
    const questionLabel = new Function(`${source}\nreturn questionLabel;`)();
    return [...document.querySelectorAll(sel)].map((el) => questionLabel(el));
  }, [LABEL_SOURCE, selector]);
}

async function choiceDetailsFor(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate((source) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(`${source}\nreturn { blockOf, choiceQuestionKey, optionsOf, questionLabel };`)();
    const inputs = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')];
    const keys = new Set();
    const labels = [];
    for (const input of inputs) {
      const block = helpers.blockOf(input);
      const key = helpers.choiceQuestionKey(input, block);
      if (keys.has(key)) continue;
      keys.add(key);
      labels.push({
        label: helpers.questionLabel(input),
        options: helpers.optionsOf(input, block),
      });
    }
    return labels;
  }, CHOICE_SOURCE);
}

/* THE DEFECT, AND THE FIX, ON THE MARKUP THAT CAUSED IT.
 *
 * Before the fall-through, all seven of these returned their own name attribute. The backend's
 * normalizeDiscoveredLabel drops a name-shaped string as handle-only - correctly, "cards [field0]"
 * tells an applicant nothing - and the question vanished: no row on the Apply screen, no answer
 * resolved, no fill attempted. The run came back saying "University" is required and is still empty
 * while the packet held USC Viterbi, 2028 and Computer Science. */
test('a Lever custom question is named by its card heading, not by its name attribute', async () => {
  const [label] = await labelsFor(
    leverCard('Year of Graduation', leverDropdown(
      '026d7ce7-7ca4-44ed-9db6-1c7857707f0e', 'field0',
      'Please include your intended graduation year for the degree or relevant learning program that you are currently pursuing or have completed.',
    )),
    'select',
  );
  assert.equal(label, 'year of graduation');
  assert.doesNotMatch(label, /cards\s*\[/, 'the handle must not survive into the stored question');
});

/* The heading is read out of the MARKUP, not off the screen. Lever paints card headings
 * text-transform:uppercase, so innerText reports "YEAR OF GRADUATION" - the employer's styling, not
 * the employer's words. This runner lowercases every label it returns, which means the two
 * properties cannot be told apart by this assertion alone; textContent is kept because it is what
 * the backend's identical walk and the submit-readiness gate both read, and the three must not
 * disagree about what an employer's question says. */
/* THE RADIO GROUP DEFECT, PINNED ON THE MARKUP THAT CAUSES IT.
 *
 * CHARACTERISATION, NOT AN ENDORSEMENT. This asserts what the shipped reader does TODAY so the
 * defect is reproducible in this repo instead of only in production. It is expected to be inverted
 * by whoever fixes it.
 *
 * Measured on the owner's account 2026-08-16/17: Belvedere Trading and Palantir, two unrelated Lever
 * tenants, both come back with required fields called "High School Diploma", "Yes", "Other",
 * "December 2026/January 2027" and "I Understand". Every one of those is the FIRST OPTION of a
 * question. No stored answer can ever reach a control named after one of its own options, which is
 * why no Lever application has ever completed - the CAPTCHA flags on those packets are separately
 * disproved as stale.
 *
 * TWO THINGS STOP THE EXISTING RECOVERY, and a fix needs both:
 *
 *   1. The handle-only fall-through is gated on `!written`, and a radio's own <label> is real human
 *      text ("High School Diploma"), so `written` is non-empty and the branch never runs. An
 *      option's label is not the control's question.
 *   2. Even reached, the card would be refused as ambiguous: the two-control bound counts each
 *      radio separately, so a four-option group looks like four controls. Every option in a group
 *      shares one name attribute, so they can be collapsed to one - but that has to be done
 *      deliberately, because the bound is what stops "High School Name & Graduation Year" being
 *      borrowed by both of its controls.
 *
 * THE MECHANISM, traced 2026-08-17. questionLabel ALREADY has a radio/checkbox branch written for
 * exactly this - "a radio or checkbox is labelled with its OPTION and the applicant is answering the
 * QUESTION above it". It calls blockOf(el) to find the owning block, then looks inside it for a
 * label that is not an option's.
 *
 * blockOf matches: fieldset, [role=group], [role=radiogroup], [data-field-path], [class*=_fieldEntry_],
 * [class*=select__container], .field, .field-wrapper.
 *
 * Lever's container is div.application-field, and **`.field` does not match `application-field`** -
 * a CSS class selector matches whole tokens. So blockOf finds nothing, falls back to
 * el.parentElement, and on Lever that IS the option's own <label>. The branch then searches inside
 * that label for a non-option label, finds none, and yields nothing. The existing fix is right and
 * simply never reaches this markup.
 *
 * A second obstacle sits behind it: Lever puts its question in div.application-label > div.text,
 * which is not a <label> or <legend> element, so even with the right block the branch's
 * querySelectorAll('label, legend') would still come back empty.
 *
 * DO NOT fix this by adding .application-label to the generic walk. The runner already records that
 * it was measured and rejected: it recovers four more fields and also resolves "High School Name*"
 * to "University of Southern California, Viterbi School of Engineering". Note that the radio branch
 * is a NARROWER place than that generic walk - its owner is one application-question, not a card -
 * so the rejection does not automatically apply there, but it has to be re-measured rather than
 * assumed. This file's whole asymmetry is that a wrong question is worse than a missing one. */
test('a Lever radio group is named by its own first option, which is the defect', async () => {
  const labels = await labelsFor(
    leverCard('What degree are you currently pursuing?',
      leverRadioGroup('9f2b1c7a-0000-4000-8000-000000000001', 'field0', 'What degree are you currently pursuing?',
        ['High School Diploma', 'Associate Degree', 'Bachelor Degree', 'Masters/PhD'])),
    'input[type="radio"]',
  );
  assert.equal(labels.length, 4);
  /* Each option answers with ITS OWN TEXT, concatenated with the shared name handle - the `own`
   * string is [labelText, aria-label, placeholder, name, id] joined, and for a radio the labelText
   * is the option. So the stored question for the first option starts with "high school diploma". */
  assert.match(labels[0], /^high school diploma\b/, labels[0]);
  assert.match(labels[3], /^masters\/phd\b/, labels[3]);
  // Every option in the group shares one name, which is what makes collapsing them to one control
  // possible - and is also why a selector-keyed diff over them reports false positives.
  for (const label of labels) assert.match(label, /cards\[9f2b1c7a-0000-4000-8000-000000000001\]\[field0\]/);
  // And not one of them carries the question a resolver would need in order to answer it.
  for (const label of labels) {
    assert.doesNotMatch(label, /degree are you currently pursuing/,
      'when this starts failing, the recovery has been fixed and the assertions above invert');
  }
});

test('a heading painted uppercase is stored as the words the employer wrote', async () => {
  const [label] = await labelsFor(
    leverCard('Year of Graduation', leverDropdown('026d7ce7-7ca4-44ed-9db6-1c7857707f0e', 'field0', 'Intended graduation year')),
    'select',
  );
  assert.equal(label, 'year of graduation');
});

/* THE BOUND, WHICH IS THE WHOLE SAFETY OF THE WALK.
 *
 * The live "High School Name & Graduation Year" card holds a textarea and a select under ONE
 * heading. Borrowing that heading names both of them "high school name & graduation year", and the
 * resolver answers "High School Name" out of the education profile - which would type her
 * UNIVERSITY into an employer's high-school field. Both stay handle-only, which downstream drops
 * into an honest blocker. */
test('a card holding two controls refuses its heading and keeps the handle', async () => {
  const labels = await labelsFor(
    leverCard('High School Name & Graduation Year',
      leverTextarea('d54adf7b-3148-4095-93bb-72bef32a61f8', 'field0', 'High School Name')
      + leverDropdown('d54adf7b-3148-4095-93bb-72bef32a61f8', 'field1', 'Year of High School Graduation')),
    'textarea, select',
  );
  assert.equal(labels.length, 2);
  for (const label of labels) {
    assert.match(label, /^cards\[d54adf7b-3148-4095-93bb-72bef32a61f8\]\[field\d\]$/);
    assert.doesNotMatch(label, /high school/, 'an ambiguous heading must never be borrowed');
  }
});

/* The hidden baseTemplate input every Lever card carries is not a control anyone answers. Counting
 * it would make every single-question card look ambiguous and refuse every recovery on the form. */
test('the hidden baseTemplate input does not make a one-question card look ambiguous', async () => {
  const [label] = await labelsFor(
    leverCard('University', leverDropdown('3da58b41-acf5-40a1-945e-c7f047ef8050', 'field0', 'Which university do you attend?')),
    'select',
  );
  assert.equal(label, 'university');
});

/* ADVERSARIAL: the branch must not reach a field that already reads correctly.
 *
 * A meaningful name or id is a label. isProviderHandleOnly leaves its letters standing, so the
 * fall-through never fires and the assembled string is returned exactly as before. */
test('a control with a meaningful name is untouched', async () => {
  const labels = await labelsFor(`
    <div class="section"><h4>Personal Information</h4>
      <div><div><input type="text" name="firstName" /></div></div>
      <div><div><input type="text" id="school" /></div></div>
    </div>`, 'input');
  assert.deepEqual(labels, ['firstname', 'school']);
});

/* ADVERSARIAL: nothing is invented. A handle-only control with no heading anywhere above it returns
 * the handle unchanged, and is dropped downstream exactly as it is today. */
test('a handle-only control with no heading above it invents nothing', async () => {
  const [label] = await labelsFor(`
    <div><div><div><select name="cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]">
      <option value="">Select...</option></select></div></div></div>`, 'select');
  assert.equal(label, 'cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]');
});

/* ADVERSARIAL: a heading that names the CONTROL rather than the question is refused, and the walk
 * carries on past it. "Pick date..." is what an Ashby datepicker calls itself; storing it as the
 * question would put a widget's name where an employer's words belong. */
test('a nearby label that only names the control is refused, and the walk continues', async () => {
  const [nothingAbove] = await labelsFor(`
    <div class="section">
      <div><label>Pick date...</label>
        <div><input type="text" name="cards[c9485a46-997f-459a-91d1-7649ceb70cb1][field0]" /></div>
      </div>
    </div>`, 'input');
  assert.equal(nothingAbove, 'cards[c9485a46-997f-459a-91d1-7649ceb70cb1][field0]');

  const [realQuestionAbove] = await labelsFor(`
    <div class="section"><h4>Where are you spending summer 2026?</h4>
      <div><label>Pick date...</label>
        <div><input type="text" name="cards[c9485a46-997f-459a-91d1-7649ceb70cb1][field0]" /></div>
      </div>
    </div>`, 'input');
  assert.equal(realQuestionAbove, 'where are you spending summer 2026?');
});

/* ADVERSARIAL: a placeholder is something a person wrote, so its presence closes the branch outright
 * - the control is not anonymous and the heading above it is not its question. */
test('a control carrying a placeholder keeps it and never reaches the heading', async () => {
  const [label] = await labelsFor(`
    <div class="section"><h4>Year of Graduation</h4>
      <div><div><input type="text" placeholder="Start typing..."
        name="cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]" /></div></div>
    </div>`, 'input');
  assert.equal(label, 'start typing... cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]');
  assert.doesNotMatch(label, /year of graduation/);
});

/* ADVERSARIAL: a Greenhouse control whose id carries a repeated-section handle still has a real
 * <label>, so it is human-labelled and the branch stays off it entirely. */
test('a labelled Greenhouse control with a section handle in its id is untouched', async () => {
  const [label] = await labelsFor(`
    <div class="field"><label for="school--0">School*</label>
      <input type="text" id="school--0" name="school--0" /></div>`, 'input');
  assert.equal(label, 'school* school--0 school--0');
});

test('a Workable checkbox group is one clean question despite unique option names', async () => {
  const question = 'Which development experience applies to you?';
  const rows = await choiceDetailsFor(`
    <span id="experience_label">* ${question}</span>
    <div role="group" aria-labelledby="experience_label" data-ui="QA_11143558">
      <label><span hidden>SVGs not supported by this browser.</span>
        <input type="checkbox" name="5854742">Internship</label>
      <label><span hidden>SVGs not supported by this browser.</span>
        <input type="checkbox" name="5854743">Hackathon</label>
      <label><span hidden>SVGs not supported by this browser.</span>
        <input type="checkbox" name="5854744">Individual Development</label>
      <label><span hidden>SVGs not supported by this browser.</span>
        <input type="checkbox" name="5854745">No experiences</label>
    </div>`);

  assert.deepEqual(rows, [{
    label: `* ${question.toLowerCase()}`,
    options: ['Internship', 'Hackathon', 'Individual Development', 'No experiences'],
  }]);
});

test('an outer fieldset does not merge separately named choice questions', async () => {
  const rows = await choiceDetailsFor(`
    <fieldset>
      <legend>Applicant disclosures</legend>
      <div class="field">
        <span id="first_choice_label">First choice question</span>
        <label><input type="checkbox" name="first_choice"
          aria-labelledby="first_choice_label">First answer</label>
      </div>
      <div class="field">
        <span id="second_choice_label">Second choice question</span>
        <label><input type="checkbox" name="second_choice"
          aria-labelledby="second_choice_label">Second answer</label>
      </div>
    </fieldset>`);
  assert.deepEqual(rows, [
    { label: 'first choice question', options: ['First answer'] },
    { label: 'second choice question', options: ['Second answer'] },
  ]);
});

test('distinct option references do not replace a shared fieldset question', async () => {
  const rows = await choiceDetailsFor(`
    <fieldset>
      <legend>Are you authorized to work in this location?</legend>
      <span id="authorized_yes">Yes</span>
      <input type="radio" name="authorized" aria-labelledby="authorized_yes">
      <span id="authorized_no">No</span>
      <input type="radio" name="authorized" aria-labelledby="authorized_no">
    </fieldset>`);

  assert.deepEqual(rows, [{
    label: 'are you authorized to work in this location?',
    options: ['Yes', 'No'],
  }]);
});

test('hidden fallback and closed-menu copy never become an employer question', async () => {
  const [address, phone] = await labelsFor(`
    <label for="address"><span>* Address</span>
      <span hidden>SVGs not supported by this browser.</span></label>
    <input id="address" name="address" aria-labelledby="address_label">
    <span id="address_label">* Address</span>
    <label><span>* Phone</span><span>+971</span>
      <span hidden>United States +1 United Kingdom +44 Canada +1</span>
      <input name="phone"></label>`, 'input');

  assert.equal(address, '* address');
  assert.match(phone, /^\* phone\s*\+971/);
  assert.doesNotMatch(`${address} ${phone}`, /svg|united states|united kingdom|canada/i);
});
