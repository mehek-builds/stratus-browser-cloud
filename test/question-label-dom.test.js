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

const CLOSED_CHOICE_SOURCE = [
  CHOICE_SOURCE,
  extractBraced('function marksRequired(el, block) {'),
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
      const inventory = helpers.optionsOf(input, block);
      labels.push({
        label: helpers.questionLabel(input),
        options: inventory.values,
      });
    }
    return labels;
  }, CHOICE_SOURCE);
}

async function closedChoiceDetailsFor(html, selector) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(([source, target]) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(`${source}\nreturn { blockOf, marksRequired, optionsOf, questionLabel };`)();
    const control = document.querySelector(target);
    const block = helpers.blockOf(control);
    const inventory = helpers.optionsOf(control, block);
    return {
      label: helpers.questionLabel(control),
      options: inventory.values,
      required: helpers.marksRequired(control, block),
    };
  }, [CLOSED_CHOICE_SOURCE, selector]);
}

async function optionInventoryFor(html, selector) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(([source, target]) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(`${source}\nreturn { blockOf, optionsOf };`)();
    const control = document.querySelector(target);
    return helpers.optionsOf(control, helpers.blockOf(control));
  }, [CHOICE_SOURCE, selector]);
}

async function optionBudgetSummaryFor(html, selector) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(([source, target]) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(`${source}\nreturn { blockOf, optionsOf };`)();
    const inventories = [...document.querySelectorAll(target)].map((control) => (
      helpers.optionsOf(control, helpers.blockOf(control))
    ));
    return {
      inventories: inventories.map((inventory) => ({
        complete: inventory.complete,
        count: inventory.values.length,
      })),
      serializedBytes: new TextEncoder().encode(JSON.stringify(
        inventories.flatMap((inventory) => inventory.values),
      )).byteLength,
    };
  }, [CHOICE_SOURCE, selector]);
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
 * FIXED 2026-08-17. This began as a characterisation test asserting the defect; the assertions
 * below are its inversion, which is how the fix was verified.
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
test('a Lever radio group is named by its question, not by its own first option', async () => {
  const labels = await labelsFor(
    leverCard('What degree are you currently pursuing?',
      leverRadioGroup('9f2b1c7a-0000-4000-8000-000000000001', 'field0', 'What degree are you currently pursuing?',
        ['High School Diploma', 'Associate Degree', 'Bachelor Degree', 'Masters/PhD'])),
    'input[type="radio"]',
  );
  assert.equal(labels.length, 4);
  // Every option in the group now answers with the QUESTION, which is what a resolver needs.
  for (const label of labels) {
    assert.match(label, /what degree are you currently pursuing/, label);
  }
  // And never with its own option text, which is what it used to return.
  assert.doesNotMatch(labels[0], /high school diploma/, labels[0]);
  assert.doesNotMatch(labels[3], /masters\/phd/, labels[3]);
  // Nor with the shared name handle, which downstream drops as handle-only.
  for (const label of labels) assert.doesNotMatch(label, /cards\[/, label);
});

/* AND IT REPORTS THE OPTIONS, which is the half nothing asserted and which cost a whole cycle.
 *
 * `has_field_options: false` on every Lever packet was diagnosed as "Stratus discovery reports no
 * option lists at all" and the remaining work was booked against this file. It was already working.
 * The lists were being discarded one repo downstream, by an inventory-key pattern that accepted a
 * bare name with at most a trailing `[]` and so could not express Lever's `cards[<uuid>][field0]`
 * (backend lib/portalSubmission.ts, controlNameOptionKeyFromDiscoveredSelector, and
 * lib/leverOptionInventory.test.ts pins it there).
 *
 * The label test above passes on markup whose options are never read, because it only ever looked at
 * labels. So this asserts the other half against the same fixture: what an employer offers, in the
 * employer's own words and order, which is what a resolver snaps a stored answer onto. Without it the
 * next person reading a packet with no options has no way to tell which side dropped them. */
test('a Lever radio group also reports the four options the employer offers', async () => {
  const details = await choiceDetailsFor(
    leverCard('What degree are you currently pursuing?',
      leverRadioGroup('9f2b1c7a-0000-4000-8000-000000000001', 'field0', 'What degree are you currently pursuing?',
        ['High School Diploma', 'Associate Degree', 'Bachelor Degree', 'Masters/PhD'])),
  );

  // One entry for the group, not one per option: choiceQuestionKey collapses them by shared name.
  assert.equal(details.length, 1);
  assert.match(details[0].label, /what degree are you currently pursuing/);
  // Exact texts and exact order. "Bachelor Degree" is the singular form the employer wrote, and it is
  // what the resolver's degree ladder has to find; a normalised or reordered list would not match it.
  assert.deepEqual(details[0].options, [
    'High School Diploma', 'Associate Degree', 'Bachelor Degree', 'Masters/PhD',
  ]);
});

/* THE YES/NO GROUP FROM THE SAME FORM. Two options, and the question is the card's, so a list of
 * ["Yes", "No"] is the only thing that lets a stored yes/no reach an employer's own radio. */
test('a Lever yes/no group reports both options', async () => {
  const details = await choiceDetailsFor(
    leverCard('Work authorisation',
      leverRadioGroup('9f2b1c7a-0000-4000-8000-000000000002', 'field0',
        'Are you lawfully authorized to work in the United States?', ['Yes', 'No'])),
  );

  assert.equal(details.length, 1);
  assert.deepEqual(details[0].options, ['Yes', 'No']);
});

test('a mixed short and long employer choice inventory is retained in full', async () => {
  const longChoice = 'This employer option includes detailed eligibility terms '.repeat(7).trim();
  const inventory = await optionInventoryFor(`
    <fieldset>
      <legend>Which eligibility statement applies?</legend>
      <label><input type="radio" name="eligibility" value="short">Yes</label>
      <label><input type="radio" name="eligibility" value="long">${longChoice}</label>
    </fieldset>`, 'input[type="radio"]');

  assert.deepEqual(inventory, {
    values: ['Yes', longChoice],
    complete: true,
  });
});

test('an unsafe employer choice marks the whole option inventory incomplete', async () => {
  const unsafeChoice = 'x'.repeat(10_001);
  const inventory = await optionInventoryFor(`
    <fieldset>
      <legend>Choose one statement</legend>
      <label><input type="radio" name="statement" value="short">Short choice</label>
      <label><input type="radio" name="statement" value="unsafe">${unsafeChoice}</label>
    </fieldset>`, 'input[type="radio"]');

  assert.deepEqual(inventory, {
    values: ['Short choice'],
    complete: false,
  });
});

test('native placeholders are structural and a valid Please label is preserved', async () => {
  const inventory = await optionInventoryFor(`
    <label for="contact-choice">Contact preference</label>
    <select id="contact-choice">
      <option value="">Select one</option>
      <option value="email">Please contact me by email</option>
      <option value="none">No contact</option>
    </select>`, '#contact-choice');

  assert.deepEqual(inventory, {
    values: ['Please contact me by email', 'No contact'],
    complete: true,
  });
});

test('duplicate labels with distinct employer values make the inventory incomplete', async () => {
  const inventory = await optionInventoryFor(`
    <label for="region-choice">Region</label>
    <select id="region-choice">
      <option value="">Choose one</option>
      <option value="north-america">Americas</option>
      <option value="south-america">Americas</option>
    </select>`, '#region-choice');

  assert.deepEqual(inventory, {
    values: ['Americas'],
    complete: false,
  });
});

test('a virtualized custom list stays incomplete unless full enumeration is proven', async () => {
  const incomplete = await optionInventoryFor(`
    <div class="field">
      <button id="virtual-choice" type="button" aria-haspopup="listbox">Choose</button>
      <div role="listbox" aria-labelledby="virtual-choice" data-virtualized="true">
        <div role="option" aria-setsize="100" aria-posinset="1" data-value="one">One</div>
        <div role="option" aria-setsize="100" aria-posinset="2" data-value="two">Two</div>
      </div>
    </div>`, '#virtual-choice');
  assert.deepEqual(incomplete, { values: ['One', 'Two'], complete: false });

  const complete = await optionInventoryFor(`
    <div class="field">
      <button id="full-choice" type="button" aria-haspopup="listbox">Choose</button>
      <div role="listbox" aria-labelledby="full-choice" data-virtualized="true">
        <div role="option" aria-setsize="2" aria-posinset="1" data-value="one">One</div>
        <div role="option" aria-setsize="2" aria-posinset="2" data-value="two">Two</div>
      </div>
    </div>`, '#full-choice');
  assert.deepEqual(complete, { values: ['One', 'Two'], complete: true });
});

test('the global serialized option budget truncates safely below the terminal limit', async () => {
  const optionText = 'x'.repeat(9_000);
  const lists = Array.from({ length: 5 }, (_, listIndex) => `
    <label for="budget-${listIndex}">Budget ${listIndex}</label>
    <select id="budget-${listIndex}">
      <option value="">Select one</option>
      ${Array.from({ length: 100 }, (_, optionIndex) => (
        `<option value="${listIndex}-${optionIndex}">${listIndex}-${optionIndex}-${optionText}</option>`
      )).join('')}
    </select>`).join('');
  const summary = await optionBudgetSummaryFor(lists, 'select');

  assert.ok(summary.serializedBytes < 4 * 1024 * 1024);
  assert.ok(summary.inventories.some((inventory) => inventory.complete === false));
  assert.ok(summary.inventories.reduce((sum, inventory) => sum + inventory.count, 0) < 500);
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
 * UNIVERSITY into an employer's high-school field. So the SHARED heading may never be borrowed by
 * either control. Since the sibling-label fallback shipped for selects and textareas, each control
 * is named by ITS OWN li's .application-label - "High School Name", "Year of High School
 * Graduation" - which is not a guess: it is the one label that disambiguates the card. The
 * backend's school resolution explicitly excludes high-school-worded questions
 * (submissionRunner.ts), so a truly named high-school field cannot be answered with her
 * university. The shared card heading still may never be borrowed by either control. */
test('a card holding two controls refuses its heading and keeps the handle', async () => {
  const labels = await labelsFor(
    leverCard('High School Name & Graduation Year',
      leverTextarea('d54adf7b-3148-4095-93bb-72bef32a61f8', 'field0', 'High School Name')
      + leverDropdown('d54adf7b-3148-4095-93bb-72bef32a61f8', 'field1', 'Year of High School Graduation')),
    'textarea, select',
  );
  assert.equal(labels.length, 2);
  assert.equal(labels[0], 'high school name\u2717');
  assert.equal(labels[1], 'year of high school graduation\u2717');
  for (const label of labels) {
    assert.doesNotMatch(label, /name & graduation/, 'the shared card heading must never be borrowed');
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

/* ---------------------------------------------------------------------------------------------
 * BREEZY'S QUESTIONNAIRE, transcribed from the live transparent-hiring.breezy.hr HR Assistant
 * Intern form on 2026-08-19, not sketched. The load-bearing details are all real:
 *   - each question is one <li class="question"> holding an <h3> heading; the question text is
 *     NEVER in a <label> element;
 *   - each multiplechoice option is <li class="option"><label><input .../><span>text</span></label>,
 *     so the input's nearest label IS its option;
 *   - every control's name is "section_<epoch>_question_<n>", which no person wrote;
 *   - paragraph and date questions hold a bare <textarea> / <input type="date"> with an empty
 *     placeholder and no label at all.
 *
 * WHY THE FIRST-OPTION DEFECT CAN DISQUALIFY AN APPLICANT, which is what makes this group's
 * labeling severity rather than cosmetics: the English question's first option is
 * "B1 (Intermediate) or below", and the tenant auto-disqualifies that answer. Discovery used to
 * store the group AS that option ("B1 (Intermediate) or below" was the question, and the option
 * list held only itself), so a user answering the question as shown answers herself out of the
 * role, and a saved answer can never anchor to the real rendered label.
 * ------------------------------------------------------------------------------------------- */
const breezySection = (questions) => `<form><ul class="questions">${questions.join('')}</ul></form>`;
const breezyMultipleChoice = (name, heading, options, body = '') => `
  <li ng-repeat="question in section.questions" class="question ng-scope">
    <div class="multiplechoice ng-scope">
      <h3><span class="ng-binding">${heading}</span><span title="Required" class="required">*</span></h3>
      ${body ? `<div class="question-body ng-scope"><p><span>${body}</span></p></div>` : ''}
      <ul class="options">
        ${options.map((option) => `
          <li ng-repeat="opt in question.options" class="option ng-scope"><label>
            <input type="radio" ng-model="question.response" value="${option}" name="${name}" required="required" />
            <span class="ng-binding">${option}</span></label></li>`).join('')}
      </ul>
      <div class="error-container ng-hide" style="display:none"><span class="error polygot">A response is required</span></div>
    </div>
  </li>`;
const breezyParagraph = (name, heading) => `
  <li ng-repeat="question in section.questions" class="question ng-scope">
    <div class="ng-scope">
      <h3><span class="ng-binding">${heading}</span><span title="Required" class="required">*</span></h3>
      <textarea name="${name}" placeholder="" class="description full" required="required"></textarea>
      <div class="error-container ng-hide" style="display:none"><span class="error polygot">A response is required</span></div>
    </div>
  </li>`;
const breezyDate = (name, heading) => `
  <li ng-repeat="question in section.questions" class="question ng-scope">
    <div class="ng-scope">
      <h3><span class="ng-binding">${heading}</span><span class="ng-hide required" style="display:none">*</span></h3>
      <input name="${name}" type="date" />
    </div>
  </li>`;

const BREEZY_ENGLISH = breezyMultipleChoice('section_1751373777767_question_0', 'English level', [
  'B1 (Intermediate) or below', 'B2 (Upper-Intermediate)', 'C1 (Advanced)', 'C2 (Proficient/Bilingual/Native)',
], 'Select your speaking level');

test('a Breezy multiplechoice group is named by its question, not by its disqualifying first option', async () => {
  const labels = await labelsFor(breezySection([BREEZY_ENGLISH]), 'input[type="radio"]');
  assert.equal(labels.length, 4);
  for (const label of labels) assert.match(label, /english level/, label);
  // Never the first option, which is the answer the tenant auto-disqualifies.
  for (const label of labels) assert.doesNotMatch(label, /b1 \(intermediate\)/, label);
  // And never the machine handle nobody wrote.
  for (const label of labels) assert.doesNotMatch(label, /section_\d+_question_\d+/, label);
});

test('a Breezy group reports every option, in the employer\'s own order', async () => {
  const details = await choiceDetailsFor(breezySection([BREEZY_ENGLISH]));
  assert.equal(details.length, 1, 'one entry for the group, not one per option');
  assert.match(details[0].label, /english level/);
  assert.deepEqual(details[0].options, [
    'B1 (Intermediate) or below', 'B2 (Upper-Intermediate)', 'C1 (Advanced)', 'C2 (Proficient/Bilingual/Native)',
  ]);
});

test('the whole Breezy questionnaire is walked: paragraph, date and later-section questions recover their headings', async () => {
  const markup = breezySection([
    BREEZY_ENGLISH,
    breezyParagraph('section_1751373777767_question_1', 'Send us a link from your LinkedIn profile'),
    breezyMultipleChoice('section_1751373777767_question_2', 'What is your time zone?', [
      'CET or within +- 3 hours', 'More than 5h difference from CET (German) time',
    ]),
    breezyDate('section_1751373777767_question_4', 'Your earliest possible start date'),
    breezyParagraph('section_1751373777767_question_5', 'Unpaid internship confirmation'),
  ]);
  const [linkedin, unpaid] = await labelsFor(markup, 'textarea');
  // These were not captured at all: the control's only name is the section_ handle, which the
  // handle-only fall-through now recognises as Breezy's and trades for the heading above it.
  assert.match(linkedin, /send us a link from your linkedin profile/, linkedin);
  assert.match(unpaid, /unpaid internship confirmation/, unpaid);
  const [startDate] = await labelsFor(markup, 'input[type="date"]');
  assert.match(startDate, /your earliest possible start date/, startDate);
  const timezone = await choiceDetailsFor(markup);
  assert.equal(timezone.length, 2, 'both choice groups discovered');
  assert.match(timezone[1].label, /what is your time zone/);
  assert.deepEqual(timezone[1].options, ['CET or within +- 3 hours', 'More than 5h difference from CET (German) time']);
});

/* ---------------------------------------------------------------------------------------------
 * RIPPLING'S COMBOBOX, transcribed from the live ats.rippling.com Easy Dynamics apply form on
 * 2026-08-19. The widget's own input says only what it is - aria-label "Search", placeholder
 * "Search" - and carries a name randomized on every render plus an id like "field-34". The visible
 * question sits in a plain div/span BESIDE the widget, several wrappers up, never in a <label>.
 * Discovery stored "search search vh-v1lveguk field-34" as a question: unanchorable by any saved
 * answer, and a NEW question on every render because the name half rotates.
 * The nesting depth below mirrors the live tree (the label div is eleven parents above the input),
 * so a walk that is too shallow fails here the way it failed live.
 * ------------------------------------------------------------------------------------------- */
const ripplingPhoneCode = (name) => `
  <div data-testid="field">
    <div><span id="field-31-label" class="css-1xdhyk6">Phone number</span></div>
    <div>
      <div data-testid="screen-reader-only" style="display:none"></div>
      <div>
        <div data-testid="field">
          <div>
            <div data-testid="phone_number-code">
              <div>
                <div data-testid="select-controller">
                  <div>
                    <div>
                      <div data-testid="select-search-input">
                        <input data-testid="input-select-search-input" id="field-34" name="${name}" type="text"
                          role="combobox" aria-expanded="false" autocomplete="auto-complete-off"
                          placeholder="Search" aria-label="Search" aria-required="true" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div data-testid="phone_number"><input id="field-35" type="tel" aria-labelledby="field-31-label" /></div>
      </div>
    </div>
  </div>`;
const ripplingCustomQuestion = (question, id) => `
  <div>
    <div>${question}</div>
    <div data-testid="field">
      <div data-testid="customQuestions.6a4e6720f5f7fe82342f4bbd.${id}">
        <div>
          <div data-testid="select-controller">
            <div>
              <div>
                <div data-testid="select-search-input">
                  <input data-testid="input-select-search-input" id="${id}" name="ZzRandom${id}" type="text"
                    role="combobox" aria-expanded="false" placeholder="Search" aria-label="Search" aria-required="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

test('a Rippling combobox is named by the visible label beside it, never by its internal ids', async () => {
  const [label] = await labelsFor(ripplingPhoneCode('vh-v1lveguk'), 'input[role="combobox"]');
  assert.match(label, /phone number/, label);
  assert.doesNotMatch(label, /field-34|vh-v1lveguk|search/, label);
});

test('a renamed Rippling widget input is still the same question on the next render', async () => {
  // The name attribute rotates between renders. The stored label must not carry it, or every
  // discovery mints a brand-new question and no saved answer ever lands.
  const [first] = await labelsFor(ripplingPhoneCode('vh-v1lveguk'), 'input[role="combobox"]');
  const [second] = await labelsFor(ripplingPhoneCode('QBIQlS1zQx'), 'input[role="combobox"]');
  assert.equal(first, second);
});

test('a Rippling custom question is named by the sibling text above its widget', async () => {
  const [label] = await labelsFor(
    ripplingCustomQuestion('Are you currently authorized to work in the U.S.?', 'field-63x'),
    'input[role="combobox"]',
  );
  assert.equal(label, 'are you currently authorized to work in the u.s.?');
});

test('a combobox with a real referenced label keeps it and never walks', async () => {
  // The gate: the sideways walk only exists for a widget that says nothing but furniture. A
  // labelled one (Rippling's own Pronouns control carries aria-labelledby) keeps its label.
  const [label] = await labelsFor(`
    <div data-testid="field">
      <div><span id="field-20-label">Pronouns</span></div>
      <div><input id="field-20" type="text" role="combobox" aria-labelledby="field-20-label"
        placeholder="Search" aria-label="Search" /></div>
    </div>`, 'input[role="combobox"]');
  assert.equal(label, 'pronouns');
});

/* ---------------------------------------------------------------------------------------------
 * TEAMTAILOR'S PLACEHOLDER, measured on fully.teamtailor.com and moburst.teamtailor.com
 * (2026-08-19/20): the phone question was stored as the concatenation "phone phone number with
 * country code +1 201-555-0123 candidate[phone] candidate_phone" - visible label plus PLACEHOLDER
 * plus name plus id. The placeholder half is volatile between renders, so consecutive discoveries
 * mint the "same" question under two different labels; downstream that flaps packet identity and
 * every send attempt refuses with packet_stale, forever. A labelled control is therefore named
 * WITHOUT its placeholder. The name and id are deliberately still in the join - the backend reads
 * control handles out of the stored label (school--0, the Greenhouse demographic ids) - and they
 * are stable between renders, so they cannot flap identity the way the placeholder measured.
 * ------------------------------------------------------------------------------------------- */
const teamtailorPhone = (placeholder) => `
  <div class="form-group">
    <label for="candidate_phone">Phone</label>
    <input id="candidate_phone" name="candidate[phone]" type="tel"${placeholder ? ` placeholder="${placeholder}"` : ''} />
  </div>`;

test('the same Teamtailor control discovers under ONE label with and without its placeholder', async () => {
  const [withPlaceholder] = await labelsFor(teamtailorPhone('Phone number with country code +1 201-555-0123'), 'input');
  const [withoutPlaceholder] = await labelsFor(teamtailorPhone(''), 'input');
  assert.equal(withPlaceholder, withoutPlaceholder,
    'a volatile placeholder must not mint a second identity for the same question');
  assert.doesNotMatch(withPlaceholder, /201-555|country code/, withPlaceholder);
  assert.match(withPlaceholder, /^phone\b/);
});

test('a placeholder still names a control that has nothing else written on it', async () => {
  // The Ashby shape: no label, no aria-label, and the placeholder is the only human text. Dropping
  // it here would reduce the label to a bare handle and lose the question entirely.
  const [label] = await labelsFor(
    '<div><div><input type="text" name="xyzzy123" placeholder="Your GitHub profile" /></div></div>',
    'input',
  );
  assert.match(label, /your github profile/, label);
});

/* THE COMBOBOX THAT IS NOT A FORM TAG, ON THE MARKUP THE EMPLOYER SERVES.
 *
 * Transcribed read-only from the live ats.rippling.com Easy Dynamics Software Engineer apply form
 * on 2026-08-20, not sketched. The load-bearing details are all real:
 *   - the control is a <div role="combobox" aria-haspopup="listbox">, so a scan over form TAGS
 *     never saw it, while the readiness gate - which scans [role="combobox"] - did, which is how a
 *     live run reported '1 required field has no question you can answer in Litos: "Select"' over
 *     a control discovery had never emitted;
 *   - everything the control says about itself is furniture: aria-label "Select", a <p>Select</p>
 *     child, no name, no label element anywhere on the form;
 *   - the employer's question sits in a plain div BESIDE the widget's wrapper, reachable only by
 *     the same preceding-sibling walk the input-backed Rippling comboboxes already use. */
const ripplingDivCombobox = `
  <div class="css-page">
    <div class="css-question">
      <div class="css-label"><p>Are you currently authorized to work in the U.S.?</p></div>
      <div class="css-widget">
        <div id="field-63" role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
          aria-expanded="false" aria-label="Select" aria-required="true" aria-invalid="false"
          aria-disabled="false" tabindex="0" class="css-hyyaj0"><p class="css-1lilszh">Select</p></div>
      </div>
    </div>
  </div>`;

test('a Rippling div combobox is named by the visible label beside it, not by "Select"', async () => {
  const [label] = await labelsFor(ripplingDivCombobox, '[role="combobox"]');
  assert.equal(label, 'are you currently authorized to work in the u.s.?');
});

/* And its aria-labelledby cousin keeps its real reference: Rippling's demographic comboboxes
 * (#field-75 on the same live form) point aria-labelledby at an EXTERNAL label element, and the
 * self-label guard below must never touch a reference that points outside the control. */
test('a div combobox whose aria-labelledby points outside itself keeps that label', async () => {
  const [label] = await labelsFor(`
    <div>
      <span id="field-75-label">Gender</span>
      <div id="field-75" role="combobox" aria-haspopup="listbox" aria-labelledby="field-75-label"
        aria-label="Select..."></div>
    </div>`, '[role="combobox"]');
  assert.equal(label, 'gender');
});

test('CBS Recruitee salutation keeps its exact required label and bound closed options', async () => {
  const details = await closedChoiceDetailsFor(`
    <fieldset>
      <legend>Meine Daten</legend>
      <div class="field">
        <label for="input-candidate.salutation-2">Allgemeine Anrede <span>*</span></label>
        <button id="input-candidate.salutation-2" type="button" aria-haspopup="listbox"
          aria-label="Allgemeine Anrede">Auswählen</button>
        <div role="listbox" aria-labelledby="input-candidate.salutation-2" style="display:none">
          <div role="option">Herr</div>
          <div role="option">Frau</div>
          <div role="option">Kein/e</div>
        </div>
      </div>
      <label for="candidate-name">Vor- und Nachname *</label><input id="candidate-name" name="candidate.name">
      <label for="candidate-email">E-Mail-Adresse *</label><input id="candidate-email" name="candidate.email">
      <label for="candidate-phone">Telefonnummer</label><input id="candidate-phone" name="candidate.phone">
    </fieldset>
    <div role="listbox" aria-labelledby="some-other-control"><div role="option">Wrong</div></div>
  `, '#input-candidate\\.salutation-2');
  assert.equal(details.label, 'allgemeine anrede *');
  assert.equal(details.required, true);
  assert.deepEqual(details.options, ['Herr', 'Frau', 'Kein/e']);
});

test('CBS Recruitee salutation refuses ambiguous reverse listbox bindings', async () => {
  const details = await closedChoiceDetailsFor(`
    <div class="field">
      <label for="input-candidate.salutation-2">Allgemeine Anrede <span>*</span></label>
      <button id="input-candidate.salutation-2" type="button" aria-haspopup="listbox"
        aria-label="Allgemeine Anrede">Auswählen</button>
      <div role="listbox" aria-labelledby="input-candidate.salutation-2"><div role="option">Herr</div></div>
      <div role="listbox" aria-labelledby="input-candidate.salutation-2"><div role="option">Frau</div></div>
    </div>
  `, '#input-candidate\\.salutation-2');
  assert.equal(details.required, true);
  assert.deepEqual(details.options, []);
});

test('CBS Recruitee salutation refuses a matching page-level listbox outside its field', async () => {
  const details = await closedChoiceDetailsFor(`
    <div class="field">
      <label for="input-candidate.salutation-2">Allgemeine Anrede <span>*</span></label>
      <button id="input-candidate.salutation-2" type="button" aria-haspopup="listbox"
        aria-label="Allgemeine Anrede">Auswählen</button>
    </div>
    <div role="listbox" aria-labelledby="input-candidate.salutation-2"><div role="option">Wrong</div></div>
  `, '#input-candidate\\.salutation-2');
  assert.equal(details.required, true);
  assert.deepEqual(details.options, []);
});

test('CBS Recruitee salutation refuses duplicate exact label bindings', async () => {
  const details = await closedChoiceDetailsFor(`
    <div class="field">
      <label for="input-candidate.salutation-2">Allgemeine Anrede <span>*</span></label>
      <label for="input-candidate.salutation-2">Another label <span>*</span></label>
      <button id="input-candidate.salutation-2" type="button" aria-haspopup="listbox"
        aria-label="Allgemeine Anrede">Auswählen</button>
      <div role="listbox" aria-labelledby="input-candidate.salutation-2"><div role="option">Herr</div></div>
    </div>
  `, '#input-candidate\\.salutation-2');
  assert.equal(details.label, 'allgemeine anrede');
  assert.equal(details.required, false);
  assert.deepEqual(details.options, ['Herr']);
});

test('CBS Recruitee native salutation excludes only the exact German placeholder', async () => {
  const details = await closedChoiceDetailsFor(`
    <div class="field">
      <label for="candidate-salutation">Allgemeine Anrede <span>*</span></label>
      <select id="candidate-salutation" required>
        <option value="">Auswählen</option>
        <option>Herr</option>
        <option>Frau</option>
        <option>Kein/e</option>
      </select>
    </div>
  `, '#candidate-salutation');
  assert.equal(details.required, true);
  assert.deepEqual(details.options, ['Herr', 'Frau', 'Kein/e']);
});

/* THE SELECT2 SELF-LABEL, ON LEVER'S OWN UNIVERSITY PICKER.
 *
 * Transcribed read-only from the live jobs.lever.co Mytos Junior/Mid Software Engineer apply form
 * on 2026-08-20. Three details are load-bearing and all three are real:
 *   - the original <select> stays in the DOM as select2-hidden-accessible: 1x1, tabindex="-1",
 *     aria-hidden="true", the immediate PREVIOUS SIBLING of the span Select2 renders - so the
 *     honeypot filter rightly drops it and the sibling walk must step past it rather than treat it
 *     as the previous question;
 *   - the visible control is '<span role="combobox">' whose aria-labelledby points at its OWN
 *     child, the selection span currently rendering the placeholder "Select a university or
 *     college" - a label that would change the moment an option lands;
 *   - the employer's words, "Which was the most recent university you attended?", sit in the
 *     question's own div.application-label, one sibling above the control's application-field. */
const leverSelect2University = `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width university">
      <div class="text">Which was the most recent university you attended?<span class="required">&#10033;</span></div>
    </div>
    <div class="application-field full-width required-field"><div class="application-university">
      <select data-qa="university-dropdown" name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field0]"
        id="university-picker-62541ff1-0b7c-4f5b-a51d-a217d565776e-0" data-placeholder="Select a university or college"
        required tabindex="-1" class="select2-hidden-accessible" aria-hidden="true"
        style="position:absolute;width:1px;height:1px;clip:rect(0 0 0 0);overflow:hidden">
        <option value="">Select a university or college</option>
        <option value="University of Southern California">University of Southern California</option>
      </select>
      <span class="select2 select2-container select2-container--default"><span class="selection">
        <span class="select2-selection select2-selection--single" role="combobox" aria-autocomplete="list"
          aria-haspopup="true" aria-expanded="false" tabindex="0"
          aria-labelledby="select2-university-picker-62541ff1-0b7c-4f5b-a51d-a217d565776e-0-container">
          <span class="select2-selection__rendered"
            id="select2-university-picker-62541ff1-0b7c-4f5b-a51d-a217d565776e-0-container">Select a university or college</span>
        </span>
      </span></span>
    </div></div>
  </div></li>`;

test('a Select2 university picker is named by its card heading, not by its own rendered placeholder', async () => {
  const [label] = await labelsFor(leverSelect2University, 'span[role="combobox"]');
  assert.match(label, /which was the most recent university you attended/);
  assert.doesNotMatch(label, /select a university or college/,
    'the widget’s rendered value must never be stored as the question');
});

/* THE PLACEHOLDER THAT IS NOT THE QUESTION, ON LEVER'S OWN EDUCATION CARD.
 *
 * Transcribed read-only from the same live Mytos form, 2026-08-20. Every text answer in the
 * education card is '<input class="card-field-input" placeholder="Type your response">' under its
 * own single-control div.application-label / div.application-field pair, all inside ONE card - so
 * the bounded heading walk refuses at the card level (many controls) and discovery stored the
 * question as "Type your response", one identical string for three different questions. No saved
 * answer can tell them apart, which is the Teamtailor packet-identity defect wearing Lever markup. */
const leverEducationCard = `
  <div class="section page-centered application-form" data-qa="additional-cards"><ul>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width text">
        <div class="text">What degree did you complete at the above university?<span class="required">&#10033;</span></div>
      </div>
      <div class="application-field full-width required-field">
        <input required class="card-field-input" type="text" placeholder="Type your response"
          name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field2]" />
      </div>
    </div></li>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width text">
        <div class="text">What was your numeric percentage average?<span class="required">&#10033;</span></div>
      </div>
      <div class="application-field full-width required-field">
        <input required class="card-field-input" type="text" placeholder="Type your response"
          name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field4]" />
      </div>
    </div></li>
  </ul></div>`;

test('a Lever card control whose only human text is its placeholder is named by its own heading', async () => {
  const [degree, average] = await labelsFor(leverEducationCard, 'input');
  assert.match(degree, /what degree did you complete at the above university/);
  assert.match(average, /what was your numeric percentage average/);
  // Two different questions must never share one label, or packet identity flaps forever.
  assert.notEqual(degree, average);
  for (const label of [degree, average]) {
    assert.doesNotMatch(label, /type your response/, 'the placeholder describes the control, not the question');
  }
});

/* ADVERSARIAL: the heading swap stays inside one question's own block. A label block speaking for
 * two controls speaks for neither - the same Palantir bound the fall-through already keeps - so a
 * placeholder input sharing its li keeps the placeholder, exactly as before. */
test('a placeholder control sharing its question block with another control keeps the placeholder', async () => {
  const [label] = await labelsFor(`
    <li class="application-question custom-question"><div>
      <div class="application-label full-width">
        <div class="text">High School Name &amp; Graduation Year</div>
      </div>
      <div class="application-field full-width">
        <input type="text" placeholder="Type your response" name="cards[d54adf7b-3148-4095-93bb-72bef32a61f8][field0]" />
        <select name="cards[d54adf7b-3148-4095-93bb-72bef32a61f8][field1]"><option value="">Select...</option></select>
      </div>
    </div></li>`, 'input');
  assert.match(label, /^type your response cards\[/);
  assert.doesNotMatch(label, /high school/, 'an ambiguous heading must never be borrowed');
});
