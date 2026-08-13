import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SANDBOX_RUNNER, SUBMIT_READINESS_GRAMMAR, SUBMIT_READINESS_POLICY } from '../src/managed-browser.js';

/* D-01. THE REQUIRED FIELD NOTHING IN THIS FILE COULD SEE.
 *
 * Production packet 245c827a (Deepgram, Ashby, 2026-08-09) was filled, screenshotted, and reported
 * with an EMPTY blocker list while three required fields on the form were visibly empty: Current
 * Location, and both work-eligibility questions. Measured against that live form:
 *
 *   input[required], textarea[required], select[required]   6 matches
 *   [aria-required="true"]                                  0 matches
 *   label[class*="_required_"]                              9 matches
 *
 * Ashby marks a required question with a class on the question's own <label> and paints the
 * asterisk from it - ._required_<hash>:after{content:"*"} - so the marker is a CSS pseudo-element
 * that appears in no attribute and in no text anywhere on the page. Both readers this file had were
 * therefore blind to all three fields, and there was nothing to report.
 */

function extractFunctionSource(name) {
  const start = SANDBOX_RUNNER.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < SANDBOX_RUNNER.length; index += 1) {
    if (SANDBOX_RUNNER[index] === '{') depth += 1;
    if (SANDBOX_RUNNER[index] === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

/** The slice of the runner that decides what the CALLER is told, after every action has run. */
function endOfRunSection() {
  const start = SANDBOX_RUNNER.indexOf('const blockers = [...submitGateBlockers]');
  assert.notEqual(start, -1, 'the end-of-run blocker section must exist');
  const end = SANDBOX_RUNNER.indexOf('const title = await page.title()', start);
  assert.ok(end > start, 'could not bound the end-of-run blocker section');
  return SANDBOX_RUNNER.slice(start, end);
}

test('the run reports the same required fields the pre-submit gate would withhold the click for', () => {
  /* There used to be TWO answers in this file to "which required fields are still empty": the
     pre-submit gate, and a weaker pair of scans at the end of the run whose output is what the
     caller stores and shows. A PREPARE run queues no submit action, so the better reading never ran
     on the call that decides whether a packet is offered to a person as ready to send. */
  const section = endOfRunSection();
  assert.match(section, /const readiness = requiredFieldConfirmation\?\.version === 2/);
  assert.match(section, /: await readSubmitReadiness\(\)/);
  assert.match(section, /blockers\.push\(\.\.\.readiness\.blocking\)/);
  // The weaker readers are gone rather than left beside the better one, so the two cannot drift.
  assert.doesNotMatch(section, /page\.locator\('input\[required\], textarea\[required\], select\[required\]'\)/);
  assert.doesNotMatch(section, /requiredFileGroups/);
  // stale and unmatched stay OUT. Both are about validation MESSAGES rather than empty controls,
  // and a stale message over a filled field must never block a complete application - the mistake
  // an earlier gate made when it matched the form's own "* indicates a required field" legend.
  assert.doesNotMatch(section, /readiness\.stale/);
  assert.doesNotMatch(section, /readiness\.unmatched/);
});

test('the required scan reads a per-control marker and never page text', () => {
  const gate = SANDBOX_RUNNER.slice(
    SANDBOX_RUNNER.indexOf('const readSubmitReadiness'),
    SANDBOX_RUNNER.indexOf('const isFinalSubmitAction'),
  );
  // The three ways the three ATS families spell "required", all of them attributes or a class on
  // one specific field's own label.
  assert.match(gate, /input\[required\], textarea\[required\], select\[required\], \[aria-required="true"\]/);
  assert.match(gate, /label\[class\*="_required_"\], legend\[class\*="_required_"\]/);
  /* And the Greenhouse spelling of the same mark. Ashby paints its asterisk from a ':after' rule so
     it appears in no text; Greenhouse prints the character into the label. Measured read-only on
     2026-08-09: 19 of zscaler's 30 labels carry a standalone "*", 3 of yugabyte's 23, and ZERO on
     the Deepgram, Ramp and Linear Ashby forms. Still per-control: one <label> speaking for one
     control, never the page. */
  assert.match(gate, /const ASTERISK_MARK = /);
  assert.match(gate, /const ASTERISK_LEGEND = /);
  // Only the Ashby class arm may fall back to the block itself. A star whose control cannot be
  // found is not evidence that an application is incomplete.
  assert.match(gate, /noteMarkedLabel\(marker, true\)/);
  assert.match(gate, /noteMarkedLabel\(marker, false\)/);
  /* A label that WRAPS its control carries no "for", so byFor misses and widgetOf falls back to the
     label itself, whose querySelector('label') finds nothing inside it. Greenhouse's first name,
     last name and resume are all built that way; without this candidate the block walk names all
     three "First name" and the message dedupe then collapses two genuinely empty required fields
     out of the blocker list altogether. */
  assert.match(gate, /const wrappingLabelTextOf = /);
  // The legend guard survives. It is the whole reason an early version of this gate would have
  // refused every Greenhouse submission there is.
  assert.match(gate, /LEGEND_TEXT/);
  assert.match(gate, /indicates\?/);
});

/* THE PIN THAT MAKES THE BACKEND'S COPY OF THIS GATE FINDABLE.
 *
 * This gate is written twice, and the other copy is READ_SUBMIT_READINESS_SCRIPT in
 * student-outreach-backend/src/lib/portalSubmission.ts. On 2026-08-13 a fix for the gate reading an
 * optional question's own <label> as that field's validation error was written, reviewed and merged
 * into THAT copy, and production went on producing the same sentence, because this is the copy that
 * drives a managed application. Four Scale AI packets and three DV Trading packets stopped on a
 * field neither employer requires. The only thing that had ever asked the two to agree was a
 * comment, which is the same thing question-label-dom.test.js was written about one gate along.
 *
 * The hash below is the atomic chooser's guard applied to this gate: the same literal appears in the
 * backend's submitReadinessGrammar.test.ts, so an edit on either side leaves a value that is one
 * string search away in the file that has to match it. It cannot make the other repo change. What it
 * removes is the silent case.
 */
test('the readiness grammar hashes to the value the backend pins, and the gate is built from it', () => {
  assert.equal(SUBMIT_READINESS_POLICY.name, 'litos-submit-readiness');
  assert.equal(SUBMIT_READINESS_POLICY.version, 1);
  /* KEEP THIS IN STEP WITH SUBMIT_READINESS_GRAMMAR_HASH in
     student-outreach-backend/src/lib/submitReadinessGrammar.ts. */
  assert.equal(SUBMIT_READINESS_POLICY.grammarHash, '5382e70ebe4ac09c4a66af78dd1aae3b37032f30295621bdabfe43dbc0eaadbc');
  assert.equal(
    crypto.createHash('sha256').update(SUBMIT_READINESS_GRAMMAR).digest('hex'),
    SUBMIT_READINESS_POLICY.grammarHash,
  );
  /* A hash over a declaration nobody reads guards nothing. Every fragment has to be inside the gate
     that ships, or the hash is a statement about a constants object rather than about the code that
     runs against an employer's form. */
  const gate = SANDBOX_RUNNER.slice(
    SANDBOX_RUNNER.indexOf('const readSubmitReadiness'),
    SANDBOX_RUNNER.indexOf('const isFinalSubmitAction'),
  );
  for (const fragment of SUBMIT_READINESS_GRAMMAR.split('\n')) {
    assert.ok(gate.includes(fragment), `the shipped gate no longer carries: ${fragment.slice(0, 60)}`);
  }
});

/* THE FRAGMENT THAT IS NOT A WORD LIST, and the reason the hash is worth having at all.
 *
 * The two copies of this gate never disagreed about vocabulary. They disagreed about ONE structural
 * rule, so a hash over the vocabulary alone would have been green through the entire incident.
 * Asserted on what the statement decides rather than on its spelling: a decision about a LABEL,
 * against the control that label names, that skips. */
test('the structural rule the two copies diverged on is inside the hashed bytes', () => {
  assert.match(SUBMIT_READINESS_POLICY.ownQuestionSkip, /'LABEL'/);
  assert.match(SUBMIT_READINESS_POLICY.ownQuestionSkip, /getAttribute\('for'\)/);
  assert.match(SUBMIT_READINESS_POLICY.ownQuestionSkip, /\bcontinue\b/);
  /* AND BOUNDED TO THE QUESTION RATHER THAN TO ANY LABEL NAMING THE CONTROL. jQuery Validation's
     default errorElement IS `label`, with for=idOrName(element) and "This field is required." for
     text, so the unbounded rule skipped the very message this gate reads. The element must BE the
     first label for that control: the one authored with the field, not the one appended to it.
     Held on real markup by own-question-readiness-dom.test.js. */
  assert.match(SUBMIT_READINESS_POLICY.ownQuestionSkip, /element === \w+\.querySelector\(/);
  assert.match(SUBMIT_READINESS_POLICY.ownQuestionSkip, /label\[for=/);
  /* The shared fragment may only name bindings BOTH copies bind identically. This runner's scan root
     is `root` and the backend's is `scanRoot`, so either name is a ReferenceError in the other repo
     on any page rendering an inline error. `widget` is the binding they share. */
  assert.doesNotMatch(SUBMIT_READINESS_POLICY.ownQuestionSkip, /\broot\b/);
  assert.doesNotMatch(SUBMIT_READINESS_POLICY.ownQuestionSkip, /\bscanRoot\b/);
  assert.ok(SUBMIT_READINESS_GRAMMAR.includes(SUBMIT_READINESS_POLICY.ownQuestionSkip));
  // And the vocabulary that made an employer's question look like an employer's complaint is still
  // there, unnarrowed. The fix is the structural rule above, never a shorter word list.
  assert.match(SUBMIT_READINESS_POLICY.errorText, /please[^\n]*provide/);
});

/* THE LABEL READER INSIDE THIS GATE, RUN RATHER THAN ASSERTED ABOUT.
 *
 * The search starts at readSubmitReadiness on purpose: this runner declares labelOf twice, here and
 * again in the discovery scan, and they are not the same function. Extracted from the shipped runner
 * string rather than copied, so these cannot keep passing while the reader drifts.
 */
function readinessConst(name) {
  const scopeStart = SANDBOX_RUNNER.indexOf('const readSubmitReadiness');
  assert.notEqual(scopeStart, -1, 'readSubmitReadiness must exist in the sandbox runner');
  const start = SANDBOX_RUNNER.indexOf(`\n      const ${name} = `, scopeStart);
  assert.notEqual(start, -1, `${name} must exist inside readSubmitReadiness`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(/\n {6}(?:const|let|var|for|if|return|await)/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

function submitReadinessLabelOf() {
  const sources = ['clean', 'wrappingLabelTextOf', 'genericControlText', 'nearestQuestionText', 'labelOf']
    .map(readinessConst)
    .join('\n');
  return Function('root', 'CSS', `${sources}\nreturn labelOf;`)(
    { querySelector: () => null },
    { escape: (value) => String(value) },
  );
}

/** A control whose only label is its aria-label, with nothing above it to walk to. */
function bareControl(ariaLabel) {
  return {
    id: '',
    closest: () => null,
    parentElement: null,
    getAttribute: (name) => (name === 'aria-label' ? ariaLabel : null),
  };
}

test('a label written in a non-Latin script is a label, not a machine id', () => {
  /* THE REGRESSION. The guard here was /[a-z]/i, so a label containing no ASCII letter was
     classified as a machine identifier and thrown away, and the control came out of this gate with
     no name at all. The applicant is then told that an unnamed field is required, which is the same
     defect as being told a UUID is required, and it fires on every Japanese, Arabic, Cyrillic,
     Greek, Hebrew, Thai or Han label an employer serves.

     Confirmed as drift rather than as a decision: the backend already asks this with a Unicode
     letter class in fieldLabel.ts, and isProviderHandleOnly in this very runner already carries the
     comment "\p{L} and not [a-z]: a Japanese or Arabic label is a label". Two of the three copies
     had been fixed. This one was missed. */
  const labelOf = submitReadinessLabelOf();
  assert.equal(labelOf(null, bareControl('氏名')), '氏名');
  assert.equal(labelOf(null, bareControl('الاسم الكامل')), 'الاسم الكامل');
  assert.equal(labelOf(null, bareControl('Фамилия')), 'Фамилия');
  assert.equal(labelOf(null, bareControl('Διεύθυνση')), 'Διεύθυνση');
});

test('a machine identifier with no letters in any script is still discarded', () => {
  // The guard still earns its place. None of these carries a word a person wrote, in any script,
  // so widening it to \p{L} must not start letting them through.
  const labelOf = submitReadinessLabelOf();
  assert.equal(labelOf(null, bareControl('19302464004')), '');
  assert.equal(labelOf(null, bareControl('__ 1234 _ 5678 __')), '');
  assert.equal(labelOf(null, bareControl('---')), '');
  assert.equal(labelOf(null, bareControl('5a326a1d-1a9e-42b1-a918-ca74022064dc')), '');
});

test('an Ashby yes/no is read from its pills, because its checkbox cannot tell No from unanswered', () => {
  /* Verified live on the Deepgram form, 2026-08-09, by pressing each pill in a throwaway browser:
       press Yes -> the Yes button gains _active_1svni_57, the hidden checkbox becomes checked
       press No  -> the No  button gains _active_1svni_57, the hidden checkbox becomes UNCHECKED
     So an unchecked checkbox means either "No" or "nothing chosen", and only the pill class tells
     them apart. A gate reading the checkbox alone calls an answered No an empty required field. */
  const gate = SANDBOX_RUNNER.slice(
    SANDBOX_RUNNER.indexOf('const readSubmitReadiness'),
    SANDBOX_RUNNER.indexOf('const isFinalSubmitAction'),
  );
  assert.match(gate, /const chosenPillOf =/);
  assert.match(gate, /_active_\|_selected_\|_checked_/);
  // Consulted for a checkbox or radio BEFORE the peer-group walk, which reads the same unchecked
  // inputs and would answer "empty" for every Ashby yes/no on the form.
  const pill = gate.indexOf('const pill = chosenPillOf(widgetOf(element))');
  const peers = gate.indexOf('One answered radio answers its whole group');
  assert.ok(pill >= 0 && peers > pill, 'the pill state must be read before the radio-group walk');
  // And the block that owns an Ashby question has to be reachable at all, or its <label> is never
  // found and the field is reported as unlabelled.
  assert.match(gate, /\[data-field-path\], \[class\*="_fieldEntry_"\]/);
});

test('discovery reports choice questions, one entry per question, with their options', () => {
  /* A question that is never discovered cannot be answered and cannot be asked; it is simply
     absent. Both Deepgram work-eligibility questions render as pill groups, discovery skipped every
     choice control, so no question record was ever written for them and the resolver never got the
     chance to answer them from the stored work_authorized and needs_sponsorship booleans. */
  const discover = SANDBOX_RUNNER.slice(
    SANDBOX_RUNNER.indexOf("if (action.type === 'discover')"),
    SANDBOX_RUNNER.indexOf("if (action.type === 'click')"),
  );
  assert.match(discover, /input\[type="radio"\], input\[type="checkbox"\]/);
  assert.match(discover, /textarea, select/);
  // One entry per QUESTION. A radio group is one question wearing several inputs, and reporting
  // each input separately once turned three unanswered Greenhouse questions into seventeen blockers
  // named after their options.
  assert.match(discover, /const seenBlocks = new Set\(\)/);
  assert.match(discover, /const key = el\.name \|\| block/);
  // required and options now travel with the field, so the backend stops having to infer required
  // from a literal "*" in the label text - which Ashby never puts there.
  assert.match(discover, /required: marksRequired\(el, block\)/);
  assert.match(discover, /options: options\.length > 0 \? options : null/);
  assert.match(discover, /durableSelector: durableSelectorOf\(el, block\)/);
  // inputType alone reports React-selects as text. Preserve the live DOM role on the result wire so
  // the backend can probe only role=combobox controls and leave ordinary text inputs open.
  assert.match(discover, /role: el\.getAttribute\('role'\) \|\| null/);
  assert.match(SANDBOX_RUNNER, /\? \['discovery-control-role-v1'\]/);
});

test('a discovered control reports an identity that survives the next page load', () => {
  /* The fill run is a SECOND stateless call against a freshly loaded form, where the
     data-litos-discovered-N marker written by discovery does not exist. The backend's
     durablePortalSelector refuses that marker, so every managed-discovered question was really
     filled by matching the employer's label text. An id, a name, or the ATS's own field handle
     survives the reload and gives the fill something to aim at. */
  const source = extractFunctionSource('durableSelectorOf');
  const durableSelectorOf = Function('CSS', `return (${source});`)({ escape: (value) => String(value) });

  assert.equal(durableSelectorOf({ id: '_systemfield_name', getAttribute: () => null }, null), '#_systemfield_name');
  assert.equal(
    durableSelectorOf({ id: '', getAttribute: (name) => (name === 'name' ? '477fc43f-966e' : null) }, null),
    '[name="477fc43f-966e"]',
  );
  // Ashby's location combobox has neither, and its entry's data-field-path is the only handle there
  // is. Without this the field cannot be aimed at on the fill run at all.
  assert.equal(
    durableSelectorOf(
      { id: '', getAttribute: () => null },
      { getAttribute: (name) => (name === 'data-field-path' ? '_systemfield_location' : null) },
    ),
    '[data-field-path="_systemfield_location"]',
  );
  // Nothing durable is reported rather than something invented, so the label fallback still runs.
  assert.equal(durableSelectorOf({ id: '', getAttribute: () => null }, { getAttribute: () => null }), null);
  // An id starting with a digit is not a valid bare CSS id selector, so it is declined rather than
  // emitted as a selector that throws inside page.locator().
  assert.equal(durableSelectorOf({ id: '9lives', getAttribute: () => null }, { getAttribute: () => null }), null);
});

test('an option pill is only reported as filled once the selection is readable', () => {
  const source = SANDBOX_RUNNER.slice(
    SANDBOX_RUNNER.indexOf('const pickOptionPill = async'),
    SANDBOX_RUNNER.indexOf('const choiceControlIsClosed'),
  );
  // A press that did not take must not be recorded as an answer: the required-field gate is what
  // should then speak for the field.
  assert.match(source, /return await stuck\(\);/);
  // The retry is gated on the selected-state signal, so a press that DID take is never pressed a
  // second time and toggled back off.
  assert.match(source, /if \(!await stuck\(\)\) await press\(\);/);
  // Action buttons in the same block are excluded, or "Submit application" becomes an answer.
  assert.match(source, /upload\|replace\|drag\|drop\|submit\|browse\|remove\|delete/);
});
