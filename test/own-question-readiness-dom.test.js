/* THE READINESS GATE, RUN AGAINST THE MARKUP THAT STOPPED SEVEN REAL PACKETS.
 *
 * WHAT THIS FILE IS PAYING FOR. The fix below was written, reviewed and merged into the backend as
 * PR #527 on 2026-08-13, and production went on producing the sentence it removes. The reason is
 * that the readiness gate exists TWICE - once in the backend's own direct-Playwright path
 * (READ_SUBMIT_READINESS_SCRIPT in portalSubmission.ts) and once here, inside the sandbox runner -
 * and only this copy runs a managed application. The backend's copy carried the test; the copy that
 * drives employer forms did not. That is the same three-way drift question-label-dom.test.js was
 * written for, one gate along.
 *
 * WHY A BROWSER AND NOT A STUB. Every discrimination here is a question about a real tree: what
 * counts as a leaf once Greenhouse prints its asterisk into a <span>, what closest() finds walking
 * up out of a <label>, which controls a question block holds once hidden inputs are excluded. A
 * stub answers those by construction, which is the same as not asking them.
 *
 * THE ASYMMETRY THE ASSERTIONS ENCODE. Dropping a blocker that was right means an employer receives
 * an incomplete application the applicant can never withdraw. Keeping a blocker that was wrong costs
 * her one send. So the optional-field cases below are one half of this file and the REQUIRED-field
 * cases are the other, and the required ones are what make the fix safe rather than merely quieter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied, the same way
 * question-label-dom.test.js and date-control-dom.test.js do it. A copy would let this file keep
 * passing while the gate drifted, which is the exact failure that made the backend's fix invisible.
 * Bounded by the `failed` fallback declared immediately after it, because the scan's own body holds
 * far too many braces inside regex literals to balance safely. */
function readinessScanSource() {
  const start = SANDBOX_RUNNER.indexOf('const scan = (root = document) => {');
  assert.notEqual(start, -1, 'the readiness scan must still be in the runner');
  const end = SANDBOX_RUNNER.indexOf("const failed = { blocking: ['Required-field readiness scan failed']", start);
  assert.ok(end > start, 'could not bound the readiness scan');
  return SANDBOX_RUNNER.slice(start, end).trimEnd();
}

const SCAN_SOURCE = readinessScanSource();

function atomicCandidateSource() {
  const marker = 'const candidates = await scope.evaluate(';
  const start = SANDBOX_RUNNER.indexOf(marker);
  assert.notEqual(start, -1, 'the atomic candidate scan must still be in the runner');
  const bodyStart = start + marker.length;
  const end = SANDBOX_RUNNER.indexOf('}, formFingerprint).catch', bodyStart);
  assert.ok(end > bodyStart, 'could not bound the atomic candidate scan');
  return SANDBOX_RUNNER.slice(bodyStart, end + 1);
}

const ATOMIC_CANDIDATE_SOURCE = atomicCandidateSource();

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/** Sets the page to `html` and returns what the shipped readiness scan reports about it. */
async function readinessOf(html) {
  await page.setContent(`<!doctype html><html><body><form>${html}</form></body></html>`);
  return page.evaluate((source) => {
    // eslint-disable-next-line no-new-func
    const scan = new Function(`${source}\nreturn scan;`)();
    return scan(document);
  }, SCAN_SOURCE);
}

async function atomicCandidatesOf(html) {
  await page.setContent(`<!doctype html><html><body><form>${html}</form></body></html>`);
  return page.evaluate(([source, fingerprint]) => {
    // eslint-disable-next-line no-new-func
    const scan = new Function(`return (${source});`)();
    return scan(document, fingerprint);
  }, [ATOMIC_CANDIDATE_SOURCE, 'a'.repeat(64)]);
}

/* THE DEFECT, ON THE EMPLOYER'S OWN MARKUP.
 *
 * Transcribed read-only from https://job-boards.greenhouse.io/embed/job_app?for=scaleai&token=4703343005
 * on 2026-08-13, not sketched. Three details are load-bearing and all three are real:
 *   - the question is a bare leaf <label>, because Greenhouse prints NOTHING inside the label of a
 *     field it does not require;
 *   - it carries aria-required="false" and no required attribute, which is the employer stating in
 *     its own markup that this answer is optional;
 *   - its words contain "please provide", which is a member of the gate's own ERROR_TEXT vocabulary.
 * Put together, the gate read the employer's QUESTION as the employer's COMPLAINT.
 */
const scaleAiOptionalFollowUp = `
  <div class="field">
    <label id="question_8788020005-label" for="question_8788020005" class="label label">If yes, please provide further explanation below.</label>
    <input id="question_8788020005" aria-label="If yes, please provide further explanation below." aria-required="false" type="text" maxlength="255" value="" />
  </div>`;

/* The second measured instance, DV Trading's question_8954179005, same shape and same outcome. Two
 * employers rather than one, because a fix that only works on the form it was written against is a
 * fixture, not a rule. */
const dvTradingOptionalFollowUp = `
  <div class="field">
    <label id="question_8954179005-label" for="question_8954179005" class="label label">If yes, please provide your visa type and expiration date.</label>
    <input id="question_8954179005" aria-label="If yes, please provide your visa type and expiration date." aria-required="false" type="text" maxlength="255" value="" />
  </div>`;

/* AND THE ONE THIS MUST NEVER TOUCH. Akuna's question_67727968 asks almost the same thing in almost
 * the same words, and the employer marked it required: aria-required="true", and the asterisk
 * printed into the label as <span aria-hidden="true">*</span>. That span is why a required
 * Greenhouse label is not a leaf, and it is what made the old assumption look safe. */
const akunaRequiredFollowUp = `
  <div class="field">
    <label id="question_67727968-label" for="question_67727968" class="label label">If you answered "Yes" above to requiring visa sponsorship, please provide your visa type and expiration date.<span aria-hidden="true">*</span></label>
    <input id="question_67727968" aria-required="true" required type="text" maxlength="255" value="" />
  </div>`;

test('an optional question is not a complaint about itself, on two employers’ forms', async () => {
  /* Packet 9ddffb88 (Scale AI) stopped with this as its ENTIRE attention_reason, and three DV
     Trading packets stopped the same way. The assertion is on all three lists, not only on
     `blocking`: the label is not a stale message and it is not an unmatched one either, because it
     was never a message. */
  for (const [employer, markup] of [['Scale AI', scaleAiOptionalFollowUp], ['DV Trading', dvTradingOptionalFollowUp]]) {
    const readiness = await readinessOf(markup);
    assert.deepEqual(readiness.blocking, [], `${employer}: an optional field must not hold the send`);
    assert.deepEqual(readiness.stale, [], `${employer}: its own question was never a message to go stale`);
    assert.deepEqual(readiness.unmatched, [], `${employer}: nor an unmatched one`);
  }
});

test('the required field wearing the same words still blocks', async () => {
  /* THE HALF THAT MAKES THE FIX SAFE. Akuna's follow-up contains "please provide" exactly as Scale
     AI's does, so a fix written as a narrower word list would have dropped this one too - and an
     employer that marked a field required and received it blank keeps that application. It blocks
     here for the reason it always did: the aria-required scan above this loop reaches it, and the
     skip cannot reach a label that is not a leaf. */
  const readiness = await readinessOf(akunaRequiredFollowUp);
  assert.equal(readiness.blocking.length, 1);
  assert.match(readiness.blocking[0], /is required and is still empty$/);
  assert.match(readiness.blocking[0], /please provide your visa type and expiration date/);
});

test('the optional follow-up standing beside its required neighbours reports only the neighbours', async () => {
  /* The two never appear alone on a real form, and the packets that stopped had both. Run together
     so the skip is exercised where it actually fires: one block dropped out of a list, with the
     rest of the list unchanged. */
  const readiness = await readinessOf(`
    <div class="field">
      <label id="question_8788021005-label" for="question_8788021005" class="label label">Are you legally authorized to work in the country where the job is located?<span aria-hidden="true">*</span></label>
      <input id="question_8788021005" aria-required="true" required type="text" maxlength="255" value="" />
    </div>
    ${scaleAiOptionalFollowUp}
    ${akunaRequiredFollowUp}`);
  assert.equal(readiness.blocking.length, 2, 'both required fields, and only those');
  assert.ok(readiness.blocking.some((message) => /legally authorized to work/.test(message)));
  assert.ok(readiness.blocking.some((message) => /visa type and expiration date/.test(message)));
  assert.ok(
    readiness.blocking.every((message) => !/further explanation below/.test(message)),
    'the optional follow-up is the one field that must not be in this list',
  );
});

/* ADVERSARIAL: the loop still does the job it was written for.
 *
 * The message this gate exists to read is the line the form renders UNDER a control after its own
 * validator has run. It is not a <label>, so the skip cannot reach it, and an empty control beneath
 * it must still hold the send. (The wrapper is the minimal shape of that case rather than a
 * transcription: what is measured about it is that six such messages rendered on the live Redwood
 * Materials form on 2026-08-08, which is the incident this whole gate was built for.) */
test('a validation message rendered under an empty control still blocks', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label for="cover_letter_text" class="label label">Cover letter</label>
      <textarea id="cover_letter_text"></textarea>
      <div class="error">Please enter a cover letter.</div>
    </div>`);
  assert.deepEqual(readiness.blocking, ['"Cover letter" is required and is still empty']);
});

/* ADVERSARIAL, AND THE ONE THAT NEARLY SHIPPED: <label for> IS ALSO HOW FORMS RENDER ERRORS.
 *
 * The first version of the skip above keyed on tagName plus `for` plus a matching id, and nothing
 * else. That is too wide, because it never asks whether the label is the field's QUESTION or the
 * form's COMPLAINT about it, and a <label for> is the single most common cross-framework shape for
 * an inline field error there is. jQuery Validation's DEFAULT errorElement is `label`; it sets
 * for=idOrName(element); and its default message, "This field is required.", is a member of this
 * gate's own ERROR_TEXT vocabulary. So the widest possible reading of "a label naming this control"
 * swallowed the exact sentence the gate exists to read.
 *
 * Measured in a real browser against the shipped scan: both cases below blocked before the skip
 * existed and blocked NOTHING with the unbounded version, and both suites stayed green while that
 * was true, which is why they are here. confirmAndSubmit does not cover the gap either - its
 * candidate scan is built from [required], aria-required, label[class*="_required_"] and asterisk
 * markers, so a field that is required only by the form's own rendered message matches none of them
 * and reaches Submit unblocked.
 *
 * WHAT THE FIX TURNS ON. The question label is authored WITH the field; a validator's complaint is
 * appended to it afterwards. So the skip is bounded to the FIRST label naming that control, and
 * these two cases are the half of the file that holds it there. The asymmetry at the top of this
 * file is why they are worth their length: an employer that receives an incomplete application
 * keeps it, and the applicant cannot take it back.
 */
test('a jQuery-Validation error label is a complaint, not the question, and still blocks', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label for="q_start" class="label label">Start date</label>
      <input id="q_start" name="q_start" type="text" value="" />
      <label id="q_start-error" class="error" for="q_start">This field is required.</label>
    </div>`);
  assert.deepEqual(readiness.blocking, ['"Start date" is required and is still empty']);
});

test('a second validator’s error label, in its own words, still blocks', async () => {
  /* Not the same fixture twice: a different class, a different message, and no id at all, so the
     rule cannot be satisfied by keying on jQuery's '-error' id suffix or on one class name. What is
     shared is only the shape - a <label for> naming the control it accuses - which is the thing
     being discriminated. */
  const readiness = await readinessOf(`
    <div class="field">
      <label for="applicant_phone" class="label label">Phone</label>
      <input id="applicant_phone" name="applicant_phone" type="text" value="" />
      <label class="error-message" for="applicant_phone">Phone cannot be blank</label>
    </div>`);
  assert.deepEqual(readiness.blocking, ['"Phone" is required and is still empty']);
});

/* ADVERSARIAL: the skip is bounded to the field's OWN control, which is the whole of its claim.
 *
 * A <label for="..."> naming something in a different block says nothing about the block it is
 * sitting in, so it is not that block's question and the gate reads it exactly as it did before. */
test('a label naming a control in someone else’s block is not skipped', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label for="question_elsewhere" class="label label">Please enter your start date.</label>
      <input id="question_here" type="text" value="" />
    </div>
    <div class="field">
      <label for="question_elsewhere_label" class="label label">Elsewhere</label>
      <input id="question_elsewhere" type="text" value="" />
    </div>`);
  assert.equal(readiness.blocking.length, 1);
  assert.match(readiness.blocking[0], /Please enter your start date/);
});

/* ADVERSARIAL: a form the gate should pass in silence still passes in silence. The optional
 * follow-up answered, its required neighbour answered, and nothing left to say. */
test('a complete form reports nothing, with the optional follow-up filled in', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label id="question_8788020005-label" for="question_8788020005" class="label label">If yes, please provide further explanation below.</label>
      <input id="question_8788020005" aria-required="false" type="text" maxlength="255" value="No agreements apply." />
    </div>
    <div class="field">
      <label id="question_67727968-label" for="question_67727968" class="label label">If you answered "Yes" above to requiring visa sponsorship, please provide your visa type and expiration date.<span aria-hidden="true">*</span></label>
      <input id="question_67727968" aria-required="true" required type="text" maxlength="255" value="F-1 OPT, expires 2028-05-15" />
    </div>`);
  assert.deepEqual(readiness.blocking, []);
  assert.deepEqual(readiness.stale, []);
  assert.deepEqual(readiness.unmatched, []);
});

test('a Workable select proxy is named by its rendered combobox question', async () => {
  const question = 'Which office would you prefer?';
  const readiness = await readinessOf(`
    <span id="QA_100_label">* ${question}</span>
    <div data-input-type="select" data-ui="QA_100">
      <label><span hidden>SVGs not supported by this browser.</span>
        <input id="input_QA_100_input" role="combobox" readonly
          aria-labelledby="QA_100_label" placeholder="Select an option…"></label>
      <input name="QA_100" required style="width:1px;height:1px" value="">
    </div>`);

  assert.deepEqual(readiness.blocking, [`"* ${question}" is required and is still empty`]);
  assert.doesNotMatch(readiness.blocking[0], /SVGs not supported|input_QA_100_input/);
});

test('an answered Workable select proxy is ready', async () => {
  const readiness = await readinessOf(`
    <span id="QA_100_label">* Which office would you prefer?</span>
    <div data-input-type="select" data-ui="QA_100">
      <input id="input_QA_100_input" role="combobox" readonly
        aria-labelledby="QA_100_label" placeholder="Select an option…">
      <input name="QA_100" required style="width:1px;height:1px" value="Tokyo">
    </div>`);
  assert.deepEqual(readiness.blocking, []);
});

test('a sibling combobox label cannot rename an empty required phone control', async () => {
  const markup = `
    <div class="field">
      <span id="country_label">Country code</span>
      <input role="combobox" aria-labelledby="country_label" value="+971">
      <label for="phone_number">Phone</label>
      <input id="phone_number" type="tel" required value="">
    </div>`;

  const readiness = await readinessOf(markup);
  assert.deepEqual(readiness.blocking, ['"Phone" is required and is still empty']);

  const candidates = await atomicCandidatesOf(markup);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].label, 'Phone');
  assert.equal(candidates[0].answered, false);
});

/* The live Workable phone tree, reduced only by removing visual-only flag and arrow children.
 * Workable puts the dial-code opener before the actual required telephone input inside one
 * wrapping label. The label's literal asterisk sends it through noteMarkedLabel as well as the
 * native required scan. Selecting the first matching descendant therefore asks the opener whether
 * it has an answer, ignores the filled telephone input beside it, and reports "Phone +1" empty. */
const workablePhone = (value) => `
  <div class="styles--3IYUq styles--3JEd1">
    <label class="styles--3aPac">
      <span><span><strong>*</strong></span><span id="phone_label"><strong>Phone</strong></span></span>
      <div data-ignore-focus="true" data-ui="phone">
        <div data-role="illustrated-input">
          <div>
            <div class="iti iti--allow-dropdown iti--separate-dial-code iti--show-flags">
              <div class="iti__flag-container">
                <div class="iti__selected-flag" role="combobox" aria-haspopup="listbox"
                  aria-controls="iti-0__country-listbox" aria-expanded="false"
                  aria-label="Telephone country code" tabindex="0" title="United States">
                  <div class="iti__selected-dial-code">+1</div>
                </div>
              </div>
              <input aria-required="true" name="phone" required type="tel"
                class="styles--2e9Cp iti__tel-input" value="${value}">
            </div>
          </div>
        </div>
      </div>
    </label>
  </div>`;

test('a filled required Workable phone is not hidden behind its preceding country combobox', async () => {
  const readiness = await readinessOf(workablePhone('2135746270'));
  assert.deepEqual(readiness.blocking, []);
});

test('an empty required Workable phone still blocks after choosing its real required control', async () => {
  const readiness = await readinessOf(workablePhone(''));
  assert.equal(readiness.blocking.length, 1);
  assert.match(readiness.blocking[0], /required.*still empty/i);
});

test('a valid for target stays authoritative over one separately marked required descendant', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label for="country_code">* Phone</label>
      <div id="country_code" role="combobox" aria-label="Telephone country code"></div>
      <input name="phone" required value="2135746270">
    </div>`);
  assert.deepEqual(readiness.blocking, ['"* Phone" is required and is still empty']);
});

test('zero or multiple marked descendants retain the first-control fail-closed fallback', async () => {
  for (const controls of [
    `<div role="combobox" aria-label="Unanswered choice"></div><input value="answered">`,
    `<div role="combobox" aria-label="Unanswered choice"></div>
     <input required value="first answer"><input aria-required="true" value="second answer">`,
  ]) {
    const readiness = await readinessOf(`
      <div class="field">
        <label>* Required composite ${controls}</label>
      </div>`);
    assert.deepEqual(readiness.blocking, ['"* Required composite" is required and is still empty']);
  }
});

test('a starred wrapping label cannot borrow an unrelated required field from its parent form', async () => {
  const readiness = await readinessOf(`
    <label>* Marker only<input value=""></label>
    <input required value="filled">`);
  assert.deepEqual(readiness.blocking, ['"* Marker only" is required and is still empty']);
});

test('unique option names still form one Workable checkbox question', async () => {
  const empty = await readinessOf(`
    <span id="experience_label">* Which development experience applies?</span>
    <div role="group" aria-labelledby="experience_label">
      <label><input type="checkbox" name="5854742" required>Internship</label>
      <label><input type="checkbox" name="5854743" required>Hackathon</label>
      <label><input type="checkbox" name="5854744" required>Individual Development</label>
    </div>`);
  assert.deepEqual(empty.blocking, ['"* Which development experience applies?" is required and is still empty']);

  const answered = await readinessOf(`
    <span id="experience_label">* Which development experience applies?</span>
    <div role="group" aria-labelledby="experience_label">
      <label><input type="checkbox" name="5854742" required>Internship</label>
      <label><input type="checkbox" name="5854743" required checked>Hackathon</label>
      <label><input type="checkbox" name="5854744" required>Individual Development</label>
    </div>`);
  assert.deepEqual(answered.blocking, []);
});

test('an outer fieldset cannot let one named choice group answer another', async () => {
  const markup = `
    <fieldset>
      <legend>Applicant disclosures</legend>
      <div class="field">
        <span id="first_choice_label">* First choice question</span>
        <label><input type="radio" name="first_choice" required
          aria-labelledby="first_choice_label" checked>Yes</label>
        <label><input type="radio" name="first_choice" required
          aria-labelledby="first_choice_label">No</label>
      </div>
      <div class="field">
        <span id="second_choice_label">* Second choice question</span>
        <label><input type="radio" name="second_choice" required
          aria-labelledby="second_choice_label">Yes</label>
        <label><input type="radio" name="second_choice" required
          aria-labelledby="second_choice_label">No</label>
      </div>
    </fieldset>`;

  const readiness = await readinessOf(markup);
  assert.deepEqual(readiness.blocking, [
    '"* Second choice question" is required and is still empty',
  ]);

  const candidates = await atomicCandidatesOf(markup);
  const choices = candidates.filter((candidate) => candidate.fieldType === 'radio');
  assert.equal(choices.length, 2);
  assert.deepEqual(
    choices.map(({ label, answered }) => ({ label, answered })),
    [
      { label: '* First choice question', answered: true },
      { label: '* Second choice question', answered: false },
    ],
  );
});

/* THE REQUIRED COMBOBOX THE GATE COULD ONLY CALL "Select".
 *
 * Transcribed read-only from the live ats.rippling.com Easy Dynamics apply form, 2026-08-20. The
 * control is '<div role="combobox" aria-haspopup="listbox" aria-label="Select"
 * aria-required="true">' - no input inside it, no label element anywhere, the employer's question
 * in a plain div beside the widget's wrapper. The aria-required scan has always caught it; labelOf
 * could reach nothing but the furniture aria-label, so the live packet read '1 required field has
 * no question you can answer in Litos: "Select"'. The gate now walks to the same preceding-sibling
 * label discovery uses, so the blocker line and the discovered question say the same words. */
const ripplingRequiredDivCombobox = `
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

test('a required Rippling div combobox blocks under the employer’s question, not under "Select"', async () => {
  const readiness = await readinessOf(ripplingRequiredDivCombobox);
  assert.equal(readiness.blocking.length, 1, JSON.stringify(readiness.blocking));
  assert.match(readiness.blocking[0], /Are you currently authorized to work in the U\.S\.\?/);
  assert.match(readiness.blocking[0], /is required and is still empty$/);
  assert.doesNotMatch(readiness.blocking[0], /"Select"/,
    'widget furniture must not be the name the applicant is handed');
});

test('an ANSWERED bare div combobox is not a blocker: its rendered text is its value', async () => {
  /* The fill landed "Yes" on the live Easy Dynamics work-authorization div (the run's own preview
   * screenshot shows it) and the gate still reported the control required-and-still-empty, because
   * a div matches none of hasAnswer's tag arms and holds no child control. The rendered text IS
   * this shape's value; the furniture words it shows while empty still read as empty. */
  const readiness = await readinessOf(`
    <div><div>
      <div class="q">Are you currently authorized to work in the U.S.?</div>
      <div id="field-63" role="combobox" aria-haspopup="listbox" aria-label="Select"
        aria-required="true" tabindex="0"><p>Yes</p></div>
    </div></div>`);
  assert.equal(readiness.blocking.length, 0, JSON.stringify(readiness.blocking));
});

test('a custom empty-state placeholder is not an answer', async () => {
  /* A tenant-configured placeholder is outside the shared furniture vocabulary, and reading it as
   * an answer silently skips a required field. Placeholder-shaped grammar and aria-label
   * restatement both read as empty. */
  for (const empty of ['Please select an answer', 'Select a country', '-- Select --', 'Pick one', 'None selected']) {
    const readiness = await readinessOf(`
      <div><div>
        <div class="q">Are you currently authorized to work in the U.S.?</div>
        <div id="field-63" role="combobox" aria-haspopup="listbox"
          aria-required="true" tabindex="0"><p>${empty}</p></div>
      </div></div>`);
    assert.equal(readiness.blocking.length, 1, empty + ': ' + JSON.stringify(readiness.blocking));
  }
});

test('the furniture aria-label is a last resort, not a casualty', async () => {
  // The same widget with NOTHING beside it to walk to: "Select" is still one notch better than an
  // unnamed required field, so demoting it must not have dropped it.
  const readiness = await readinessOf(`
    <div><div>
      <div id="field-63" role="combobox" aria-haspopup="listbox" aria-label="Select"
        aria-required="true" tabindex="0"><p>Select</p></div>
    </div></div>`);
  assert.equal(readiness.blocking.length, 1, JSON.stringify(readiness.blocking));
  assert.match(readiness.blocking[0], /"Select" is required and is still empty/);
});

/* THE SELECT2 SELF-LABEL, IN THE GATE. Same live Mytos markup as question-label-dom.test.js: the
 * span points aria-labelledby at its own rendered-value child, so the gate named the required
 * university field by its placeholder, "Select a university or college" - words that change the
 * moment an option lands. The blocker must carry the employer's heading instead, which is also
 * what discovery now stores, so the two halves of one run call the control one thing. */
const leverSelect2UniversityCard = `
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

test('an empty required Select2 picker blocks under its heading, not under its rendered placeholder', async () => {
  const readiness = await readinessOf(leverSelect2UniversityCard);
  assert.equal(readiness.blocking.length, 1, JSON.stringify(readiness.blocking));
  assert.match(readiness.blocking[0], /Which was the most recent university you attended/);
  assert.doesNotMatch(readiness.blocking[0], /Select a university or college/,
    'the widget’s rendered value is not the employer’s question');
});
