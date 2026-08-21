import { assertPublicUrl } from './security.js';
import { Sandbox } from '@vercel/sandbox';
import crypto from 'node:crypto';

export const FREE_MANAGED_LIMITS = Object.freeze({
  concurrentBrowsers: 10,
  monthlyCpuHours: 5,
  maxRunSeconds: 60,
  persistedDays: 30
});

export const EXTRACT_ASSERTIONS_CAPABILITY = 'extract-assertions-v1';

export const ATOMIC_SUBMIT_POLICY = Object.freeze({
  name: 'litos-final-submit',
  version: 2,
  finalPattern: '(?:\\b(?:submit|send)\\s+(?:your\\s+|my\\s+|the\\s+|this\\s+)?application\\b|\\bsubmit\\s+with\\s+(?:attachments?|resumes?|cvs?|cover\\s+letters?)\\b|^\\s*submit\\s*$|^\\s*apply\\s*$|^\\s*apply\\s+now\\s*$|\\bfinish\\s+(?:and|&)\\s+apply\\b)',
  exclusionPattern: '(?:\\b(?:apply|continue|autofill|import|sign\\s?in|log\\s?in)(?:\\s+with)?\\s+(?:linkedin|indeed|google|facebook|apple)\\b|\\b(?:apply|submit|send|autofill|sign\\s?in|log\\s?in|continue|register|import)\\b(?:\\s+\\w+){0,4}\\s+(?:with|using|via|from)\\s+(?!(?:the\\s+|your\\s+|my\\s+|a\\s+|an\\s+)?(?:attachments?|resumes?|cvs?|cover\\s+letters?|documents?|files?|e-?signature|profiles?|accounts?|saved\\s+(?:details|information))\\b)|\\bquick apply\\b|\\bone[-\\s]?click apply\\b|\\bpowered\\s+by\\b|^\\s*(?:continue|next|start(?:\\s+application)?|complete|finish|review\\s+(?:and\\s+submit|application)|save\\s+and\\s+continue)\\s*$|\\bapplication\\s+(?:feedback|survey|issue|question|review|experience)\\b|\\bfeedback\\s+on\\s+your\\s+application\\b|^(?!.*\\bapplication\\b).*\\b(?:feedback|request|ticket|comment|search|report|question|issue|review|rating|survey|contact|bug)\\b)',
  grammarHash: '3302786c27e20fc2dd0a7396078e286db37051962893b554e92b8fd9db6816e9'
});
const atomicSubmitGrammarHash = crypto.createHash('sha256')
  .update(`${ATOMIC_SUBMIT_POLICY.finalPattern}\n${ATOMIC_SUBMIT_POLICY.exclusionPattern}`)
  .digest('hex');
if (atomicSubmitGrammarHash !== ATOMIC_SUBMIT_POLICY.grammarHash) {
  throw new Error('Atomic submit chooser grammar hash mismatch');
}
/* THE PRE-SUBMIT READINESS GATE'S GRAMMAR, UNDER THE SAME GUARD AS THE CHOOSER'S, AND FOR A REASON
 * THAT HAS ALREADY COST SEVEN PACKETS.
 *
 * readSubmitReadiness below is written twice: here, inside the sandbox script, which is what runs a
 * managed application; and again in the backend as READ_SUBMIT_READINESS_SCRIPT
 * (student-outreach-backend, src/lib/portalSubmission.ts), for its own direct-Playwright path. Until
 * now the only thing asking those two to agree was a comment, and on 2026-08-13 that is exactly what
 * failed: a fix for the gate reading an optional question's own <label> as that field's validation
 * error was written, reviewed and merged into the BACKEND copy as its PR #527, and production went
 * on producing the same sentence because this copy never got it. Four Scale AI packets and three DV
 * Trading packets stopped on a field neither employer requires.
 *
 * So the chooser's guard, applied to the gate that needed it. The fragments below are the exact
 * bytes the two copies share, the hash is over those bytes in that order, and the same literal is
 * pinned in the backend's submitReadinessGrammar.test.ts. Editing a fragment here fails this boot
 * check until the literal is updated, and that literal is one string search away in the file that
 * has to match it. It cannot make the other repo change; what it removes is the SILENT divergence.
 *
 * WHY THESE SEVEN AND NOT THE WHOLE GATE. The two copies do not share a body - this one keys note()
 * on the control and reports `unmatched`, the backend's keys on the widget and does not - so hashing
 * the gate is not available. What they genuinely share is the vocabulary they read employer markup
 * with, plus the one structural rule they diverged on, which is in here precisely because a hash
 * over the vocabulary alone would have been green through the whole incident.
 *
 * SCOPE, said out loud: this covers readSubmitReadiness. The confirmAndSubmit pass further down
 * carries its own required-control scan with its own copy of some of these patterns, and that scan
 * has no twin in the backend to drift against, so it is deliberately left out rather than quietly
 * half-covered. */
export const SUBMIT_READINESS_POLICY = Object.freeze({
  name: 'litos-submit-readiness',
  version: 1,
  requiredAttributes: String.raw`input[required], textarea[required], select[required], [aria-required="true"]`,
  requiredClassMarkers: String.raw`label[class*="_required_"], legend[class*="_required_"]`,
  asteriskMark: String.raw`\*(?:\s|$)|(?:^|\s)\*`,
  asteriskLegend: String.raw`\*\s*(?:indicates|denotes|means|marks|=)`,
  errorText: String.raw`\bis required\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b`,
  legendText: String.raw`\bindicates?\b|\bdenotes?\b|\bfields?\s+marked\b|\ball fields\b`,
  /* The field's own question is not the field's own complaint, as one statement of source shared
   * with the backend rather than as two statements that happened to agree. Each copy supplies
   * `element`, `controls` and `widget`, and its own indentation; nothing else about it is theirs to
   * choose. `widget` is in that list deliberately: it is the one scope binding BOTH copies have
   * under the same name. The runner calls its scan root `root` and the backend calls its own
   * `scanRoot`, so a fragment reaching for `root` is a ReferenceError in the backend the moment a
   * page renders any inline error at all, which is precisely the page this gate is for. */
  ownQuestionSkip: String.raw`if (element.tagName === 'LABEL' && element.getAttribute('for') && controls.some((candidate) => candidate.id === element.getAttribute('for')) && element === widget.querySelector('label[for="' + CSS.escape(element.getAttribute('for')) + '"]')) continue;`,
  grammarHash: '5382e70ebe4ac09c4a66af78dd1aae3b37032f30295621bdabfe43dbc0eaadbc'
});
export const SUBMIT_READINESS_GRAMMAR = [
  SUBMIT_READINESS_POLICY.requiredAttributes,
  SUBMIT_READINESS_POLICY.requiredClassMarkers,
  SUBMIT_READINESS_POLICY.asteriskMark,
  SUBMIT_READINESS_POLICY.asteriskLegend,
  SUBMIT_READINESS_POLICY.errorText,
  SUBMIT_READINESS_POLICY.legendText,
  SUBMIT_READINESS_POLICY.ownQuestionSkip
].join('\n');
const submitReadinessGrammarHash = crypto.createHash('sha256')
  .update(SUBMIT_READINESS_GRAMMAR)
  .digest('hex');
if (submitReadinessGrammarHash !== SUBMIT_READINESS_POLICY.grammarHash) {
  throw new Error('Submit readiness gate grammar hash mismatch');
}
const ATOMIC_SUBMIT_SELECTOR = 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]';
const ALLOWED_ACTIONS = new Set(['click', 'fill', 'fillByLabelText', 'upload', 'waitForSelector', 'press', 'select', 'extract', 'discover', 'requireCapability', 'confirmAndSubmit']);
const MAX_ACTIONS = 120;
const MAX_VALUE_LENGTH = 10_000;
const MAX_FILE_BASE64_LENGTH = 6_000_000;
/* THE HELD SESSION, and what the two numbers on it now mean.
 *
 * A continuation exists for exactly one reason: some pages answer a submit with a challenge that
 * only that page can resolve, and reloading the page to reach the challenge control means SENDING
 * THE FORM AGAIN. Greenhouse rotates its emailed security code on every send, measured on a live
 * Cresta application on 2026-08-09 - three codes to one mailbox, 20:24:03, 21:13:07 and 21:13:53,
 * each one invalidating the last - so a code typed into a page that had to be resubmitted to exist
 * is always one generation stale. The held page is not an optimisation. It is the only page that
 * can ever accept the code.
 *
 * TTL IS COUNTED FROM THE CHALLENGE, NOT FROM THE FORK. It used to be counted from before phase 0
 * started, and phase 0 is a hundred-odd actions against a real employer form: on a 120 second TTL a
 * 75 second fill left 45 seconds to fetch an email and come back, and the runner's own 30 second
 * floor was the only thing keeping that from being negative. The window a caller asks for is a
 * window ON THE CHALLENGE, so the runner rebases it the moment the challenge is the thing in front
 * of it, and reports the rebased deadline back. See the marker rewrite at the end of the run loop.
 *
 * 240 SECONDS, and where it comes from. The caller's own budget is a 300 second serverless
 * invocation which also pays for phase 0, so no caller can idle here for the full window anyway;
 * the ceiling is sized so that a bounded automated mailbox read - seconds, not a person's minutes -
 * fits with room for the round trip rather than racing it. maxContinuations stays 1: one challenge,
 * one answer, and no session that can be resumed twice.
 */
export const MANAGED_CONTINUATION_CONTRACT = Object.freeze({
  requestField: 'requestContinuation',
  checkpointField: 'continuationCheckpoint',
  ttlField: 'continuationTtlSeconds',
  tokenField: 'continuationToken',
  expiresAtField: 'continuationExpiresAt',
  defaultTtlSeconds: 180,
  minTtlSeconds: 15,
  maxTtlSeconds: 240,
  /* The window opens when the challenge is raised, not when the sandbox is forked. Stated in the
   * contract because the caller's `continuationExpiresAt` now comes back later than the one it
   * could have computed itself, and a caller that assumed otherwise would expire a live session. */
  ttlStartsAt: 'challenge',
  maxContinuations: 1
});

const SANDBOX_NAME = 'stratus-browser-runtime';
const SANDBOX_DEPENDENCIES = [
  'nss', 'dbus-libs', 'atk', 'at-spi2-atk', 'cups-libs', 'libxcb', 'libxkbcommon',
  'at-spi2-core', 'libX11', 'libXcomposite', 'libXdamage', 'libXext', 'libXfixes',
  'libXrandr', 'mesa-libgbm', 'cairo', 'pango', 'alsa-lib'
];

// Exported so tests can pin the load-bearing branches of the runner. It ships to the sandbox as a
// string, so a regression here is invisible until a real portal run fails on a real application.
export const SANDBOX_RUNNER = String.raw`
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync('stratus-input.json', 'utf8'));
  const startedAt = Date.now();
  const extractAssertionsCapability = 'extract-assertions-v1';
  const assertRequiredCapabilities = (actions) => {
    const required = (actions || [])
      .filter((action) => action.type === 'requireCapability')
      .map((action) => action.value);
    const unsupported = required.filter((capability) => capability !== extractAssertionsCapability);
    if (unsupported.length > 0) {
      throw new Error('Unsupported required runner capability: ' + unsupported.join(', '));
    }
  };
  // Reject the contract before Chromium opens or any employer page receives an action.
  assertRequiredCapabilities(input.actions);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const browserContext = await browser.newContext({ viewport: input.viewport || { width: 1440, height: 900 } });
    const page = await browserContext.newPage();
    // A RUN THAT WAS NOT ASKED TO SUBMIT MUST BE STRUCTURALLY UNABLE TO SUBMIT.
    //
    // Measured on 2026-08-08: three Greenhouse packets (Redwood Materials, Scale AI, Cresta) reached
    // 'ready_for_final_approval' with submission_claimed_at, submission_authorization and
    // browser_session_id all null - so the authorized submit path provably never ran - while
    // Greenhouse emailed the applicant a security code at the exact minute of each FILL run. The
    // fill run had submitted a real application to a real employer with nobody's authorization.
    //
    // The mechanism at the time was a keystroke: 'press' ignored its selector and fired
    // page.keyboard.press('Enter'), and an Enter inside a form is implicit submission. PR #19 and
    // #20 aimed the press and withhold Enter on a closed choice control, which closes that
    // particular door. This closes the DOORWAY. Aiming a keystroke does not make it safe: an aimed
    // Enter on a plain text input still submits the form, and so does any click that lands on
    // something submit-shaped. The caller declares intent once, here, and the page is then
    // physically incapable of contradicting it.
    //
    // addInitScript rather than an evaluate after goto, because a guard installed into one document
    // dies at the first navigation, and a form post navigates. This one is reinstalled by the
    // browser into every document the run ever loads.
    //
    // WHAT IT DOES NOT COVER, said out loud: a page that posts with fetch/XHR from its own click
    // handler never dispatches a submit event and never calls form.submit(), so nothing here sees
    // it. This is a floor, not a proof. 'blockedSubmits' in the result is the measurement that says
    // whether the floor was ever reached.
    if (input.allowSubmit !== true) {
      await page.addInitScript(() => {
        window.__litosBlockedSubmits = 0;
        // Capture phase on document, so this runs before any framework handler and before the
        // browser's own default. stopImmediatePropagation is what stops React's onSubmit, which is
        // attached lower down the tree and would otherwise still fire its own fetch.
        document.addEventListener('submit', (event) => {
          window.__litosBlockedSubmits += 1;
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
        // form.submit() dispatches no submit event at all, by specification, so the listener above
        // cannot see it. requestSubmit() does dispatch one and is therefore already covered.
        const nativeSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function litosBlockedSubmit() {
          window.__litosBlockedSubmits += 1;
          return undefined;
        };
        // Kept referenced so a minifier or a future edit cannot quietly drop the original and leave
        // no way back for a run that IS allowed to submit.
        HTMLFormElement.prototype.submit.nativeSubmit = nativeSubmit;
      }).catch(() => undefined);
    }
    const waitUntil = input.waitUntil === 'networkidle2' || input.waitUntil === 'networkidle0' ? 'networkidle' : input.waitUntil;
    await page.goto(input.url, { waitUntil, timeout: 45000 });
    // Continuations may keep the exact page and context alive, but they may not turn that context
    // into a general browser. Only main-frame navigations are host locked, so ordinary assets and
    // employer-owned CDN requests continue to work.
    if (input.requestContinuation) {
      await browserContext.route('**/*', async (route) => {
        const request = route.request();
        if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.continue();
        try {
          const targetHost = new URL(request.url()).hostname.toLowerCase();
          if (targetHost !== input.allowedHost) return route.abort('blockedbyclient');
        } catch {
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
    }
    const extracted = [];
    const filledFields = [];
    /* Privacy-safe execution breadcrumbs for provider-owned question controls. These deliberately
     * carry only durable control ids, counts, booleans and bounded enum-like outcomes. Applicant
     * answers, employer question text, option text and page content never enter this array. */
    const actionDiagnostics = [];
    /* THE CONTROLS THIS RUN WAS SENT TO WRITE INTO, kept for the whole session rather than per
     * phase. The submit chooser uses them to tell the application form apart from any other form
     * on the page: a form holding a control this run typed into, uploaded to or chose an option in
     * is the form this run was filling. A continuation phase submits the page an earlier phase
     * filled, so clearing this per phase would throw away the evidence exactly when it is needed. */
    const addressedSelectors = [];
    const skipped = [];
    const discovered = [];
    // Filled by the pre-submit gate, and merged into 'blockers' after the loop. It has to be
    // declared up here because the gate runs mid-loop, before the final click, while 'blockers' is
    // only assembled once every action has run.
    const submitGateBlockers = [];
    // What happened to a code the caller supplied, or null when it never supplied one. Written by
    // the final-submit branch and reported verbatim: whether the code was typed, whether the form
    // was sent again, and whether the challenge was still standing afterwards. The caller cannot
    // work any of that out from the outside, and guessing it is how an application ends up recorded
    // as sent when it is still sitting behind a human check.
    let securityCodeAttempt = null;
    /* WAS THE BUTTON PRESSED. Separate from everything the page says afterwards, because the two
     * answer different questions and the run has to be able to say "pressed, and I do not know what
     * happened next" without either half contaminating the other. Production packet
     * 13bccb2d (Skydio, Ashby, 2026-08-09) is the case: the run was killed while this was the only
     * fact anybody needed, and it was not recorded anywhere. */
    let finalSubmitPressed = false;
    /* WHAT THE SUBMIT REQUEST ITSELF CAME BACK WITH, because the page is allowed to say nothing.
     *
     * Measured on the live Easy Dynamics Rippling form, twice (2026-08-20, 15:15Z and 17:09Z):
     * Send was pressed, the run stayed the full post-submit window, and the page never rendered a
     * confirmation, a rejection, or anything else readSubmitOutcome knows how to read - the receipt
     * screenshot shows the form still standing and the Apply button holding a spinner. Whether the
     * employer received that application turns entirely on what the submit request returned, and
     * nothing recorded it: the applicant was left with "Litos does not know", twice, on the same
     * form, with no way for anyone to learn more from the next attempt than from the last.
     *
     * So the moment before a final-submit control is pressed, the run starts writing down every
     * write-shaped request the page makes: method, origin plus path, and the status it came back
     * with - or the failure text when it never came back, which is evidence of exactly the hang the
     * spinner looks like. Origin plus path only, never the query string or body, because a submit
     * URL can carry tokens and the record travels to the caller. Armed at the press and never
     * disarmed, because everything after the press is the submission settling; bounded, because a
     * page can chatter (analytics POSTs are write-shaped too) and twenty entries around the press
     * is worth more than an unbounded log of everything after it.
     *
     * The listeners must never break the run: a witness that can throw during the one click that
     * matters is worse than no witness, so every read is wrapped and a failure to record is
     * silently a missing entry. */
    let submitNetwork = null;
    const armSubmitNetworkWatch = () => {
      if (submitNetwork) return;
      submitNetwork = [];
      const record = (entry) => { if (submitNetwork.length < 20) submitNetwork.push(entry); };
      const writeShaped = (request) => {
        const method = request.method();
        if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return null;
        const type = request.resourceType();
        if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return null;
        return method;
      };
      page.on('response', (response) => {
        try {
          const method = writeShaped(response.request());
          if (!method) return;
          const parsed = new URL(response.url());
          record({ method, url: (parsed.origin + parsed.pathname).slice(0, 300), status: response.status() });
        } catch (error) { /* a witness must never break the run */ }
      });
      page.on('requestfailed', (request) => {
        try {
          const method = writeShaped(request);
          if (!method) return;
          const parsed = new URL(request.url());
          const failure = request.failure();
          record({ method, url: (parsed.origin + parsed.pathname).slice(0, 300), status: null, failure: String(failure && failure.errorText || 'failed').slice(0, 120) });
        } catch (error) { /* a witness must never break the run */ }
      });
    };
    let requiredFieldConfirmation = null;
    const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    /* A REFUSAL TO STATE, RECOGNISED BY WHAT IT MEANS RATHER THAN BY HOW IT IS SPELLED.
     *
     * Tested against normalized() output, where punctuation is already spaces, so "don't" arrives
     * as "don t" and "self-identify" as "self identify".
     *
     * The enumerated synonym list below could not reach the wording that actually shipped. Both of
     * the option vocabularies Litos has ever recorded, read out of stored Greenhouse label blobs on
     * 2026-08-09, word their opt-out their own way:
     *   "I decline to self-identify for protected veteran status"
     *   "I do not want to answer"                     <- want, not wish. No synonym on the list.
     * Enumerating spellings is a losing game on this family: an opt-out is the one entry on an EEO
     * list an employer can word however it likes, because it means the same thing regardless.
     *
     * WHAT IS NEGATED IS THE WANTING, NEVER THE FACT, and that is the whole rule. The previous
     * pattern made the volition verb optional - '(?:want|wish|like)? ?' - so "do not" followed by
     * any stating verb read as a refusal, and Greenhouse's ordinary EEO row
     *
     *   "I do not identify with any of the above"
     *
     * matched. That row is not a refusal. It is a substantive claim about her: it says she is none
     * of the listed races, or none of the listed veteran classifications, which is an answer an
     * employer records and reports. Measured on this tree before the change: with
     * "Decline to self-identify" on file and that row on the list and no true opt-out beside it, the
     * row was selected and the field reported filled. A stored refusal must never be able to state
     * something about her, so the volition is now required: "do not WANT to answer" is a refusal,
     * "do not identify" is a claim, and only the first of them reaches this matcher.
     *
     * AND BARE 'identify' IS GONE FROM THE VOLITIONAL BRANCH, WHICH IS THE SAME DEFECT ONE CLAUSE
     * OVER. Requiring the volition verb fixes the headline row and does nothing for the rows that
     * spell their claim volitionally:
     *
     *   "I choose not to identify with any of the above"
     *   "I prefer not to identify with any of the above"
     *
     * Those reach '(?:chooses? not|prefers? not) (?:to )?identify' and read as refusals, and they
     * are claims for exactly the reason the headline row is: what follows 'identify' is a
     * complement naming categories, and naming them is the statement. The refusal idiom is the
     * compound "self identify", which is kept in every branch it was already in. 'identify' stays
     * in the plain-negation branch, where the volition verb in front of it ("do not want to
     * identify") is what makes it a refusal.
     *
     * THIS PREDICATE IS DUPLICATED, and this is the third time the two copies have drifted. The
     * backend carries its own in 'src/lib/selfIdentification.ts' and it is the authority: the
     * branch shapes below are its merged 5e9317f3 semantics, one alternative at a time. Only the
     * spelling of the negations differs, and it has to: the backend compares against
     * comparableOption(), which DELETES apostrophes so "don't" reads "dont", while normalized()
     * here maps every non-alphanumeric to a space so the same text reads "don t". Both spellings
     * are accepted below, so the two agree on the wording and not merely on the token. The replay
     * suite pins the table both sides are supposed to satisfy; if it fails, the copies have drifted
     * a fourth time and this file is the one that reaches an employer.
     */
    /* Still ONE const, and that is not a style choice. The unit suites lift these declarations out
       of this string BY NAME and run them, so a helper broken out beside this one is a name they
       have to be told about in three separate manifests. The parts are arguments instead. */
    const DECLINE_TO_STATE = ((negation, volitional, object, stating) => new RegExp([
      'declines? to ' + object,
      negation + ' (?:want|wish|like|care|choose|prefer|intend)(?:ing)? to ' + stating,
      volitional + '(?: to)? ' + object,
      '^(?:declined?|declines|i decline|no answer|not disclosed|not specified|undisclosed)$'
    ].join('|')))(
      /* The plain negations, which say nothing at all about willingness. Both apostrophe spellings
         of each, per the note above, because a runner reads whatever the employer typed. */
      '(?:do not|do nt|don t|dont|does not|does nt|doesn t|doesnt'
        + '|did not|did nt|didn t|didnt|would not|would nt|wouldn t|wouldnt'
        + '|will not|wo nt|won t|wont)',
      /* A negation that is ALREADY volitional and may go straight to the verb. 'wish(?:es)?' and
         not 'wishes?', which parses as "wishe" plus an optional s and so never matched a bare
         "wish not": "I wish not to answer" was read as a claim. */
      '(?:would rather not|rather not|prefers? not|chooses? not|wish(?:es)? not|wants? not)',
      // What a refusal can be a refusal TO. No bare 'identify': see the branch note above.
      '(?:answer|say|state|specify|disclose|self identify|respond|provide)',
      // The same, plus bare 'identify', which only the plain-negation branch may have.
      '(?:answer|say|state|specify|disclose|self identify|identify|respond|provide)'
    );
    const answerOptions = (value) => {
      const base = clean(value);
      const lower = base.toLowerCase();
      const options = [base];
      if (/^yes$/.test(lower)) options.push('yes', 'i agree', 'agree', 'true');
      if (/^no$/.test(lower)) options.push('no', 'false');
      if (DECLINE_TO_STATE.test(normalized(base))) {
        options.push(
          'decline to self-identify',
          'i decline to self-identify',
          'i do not wish to answer',
          "i don't wish to answer",
          'i do not want to answer',
          "i don't want to answer",
          'i do not wish to disclose',
          'choose not to disclose',
          'prefer not to answer',
          'prefer not to say'
        );
      }
      return [...new Set(options.filter(Boolean))];
    };
    /* A LIST OF ONE HAS NOTHING TO CHOOSE BETWEEN, and that is the whole of this tier.
     *
     * Employers write acknowledgement rows as STATEMENTS, not as yes/no. Read off a live Optiver
     * Greenhouse form 2026-08-19, the three acknowledgement controls offered, in full:
     *
     *     "I consent to the above."
     *     "Yes, I have read and agree to Optiver's privacy policies, notices and disclaimers."
     *     "I am NOT currently in process for another Optiver role" / "I am currently in process..."
     *
     * A stored "Yes" matches none of them, so every one was refused and reported back as "required
     * and is still empty" while the applicant's answer sat in the packet. Nothing was broken; the
     * answer was simply not on the menu.
     *
     * WHY ONE OPTION IS THE SAFE CASE AND TWO IS NOT. With a single row the control offers no
     * alternative: the only outcomes are "select it" or "leave the required field blank", so an
     * affirmative answer can only mean the former and there is no second reading to guess between.
     * The moment a list offers two - the first-preference control above - choosing becomes a claim
     * about which statement is true of her, and that is hers. This tier therefore refuses at two,
     * and the refusal is a length check rather than a judgement about wording.
     *
     * WHAT BOUNDS IT UPSTREAM, and it is what makes an affirmative safe to act on at all: the
     * held-declaration veto in isConsentAcknowledgementQuestion runs long before here, so a truth
     * attestation, a background or reference authorisation, criminal history, health, work
     * authorisation, age, degree, veteran and EEO questions never carry a replayed answer into this
     * file. What reaches a single-option control with an affirmative stored against it has already
     * been classified as the routine consent class. */
    const AFFIRMATIVE_ANSWER = /^(?:yes|y|agree[d]?|i agree|i consent|consent|accept(?:ed)?|i accept|acknowledge[d]?|i acknowledge|confirm(?:ed)?|i confirm|true)\b/i;
    const soleOptionIndex = (texts, wanted) => {
      if (texts.length !== 1) return -1;
      if (!AFFIRMATIVE_ANSWER.test(clean(wanted))) return -1;
      // An empty row is not an option, it is a placeholder.
      return clean(texts[0]) ? 0 : -1;
    };
    /* A GRADED VALUE AGAINST A LIST OF BANDS IS NOT A NEAR MISS, and it is the only widening this
     * chooser carries. "3.89" against a list offering "3.50 - 4.00" is not a guess between two
     * plausible rows: exactly one band CONTAINS the number and the rest cannot. Measured on this
     * account 2026-08-19: "no option matched 3.89, left for you to choose" was the stored blocker
     * on Akuna and one other packet, with the answer sitting in the profile the whole time.
     *
     * THE SCALE IS WHAT MAKES IT SAFE, AND WITHOUT IT THIS TIER MUST NOT FIRE. A bare 3.89 against
     * a percentage list (0-25 / 26-50 / 51-75 / 76-100) falls inside "0-25", so a matcher that only
     * checked containment would state a first-quartile GPA to an employer, under her name, and
     * verifyFilled would agree with it because the row really was selected. Containment alone is
     * therefore NOT a sufficient condition and never becomes one.
     *
     * So the answer has to carry its own denominator - "3.89/4.0" - and the list's own maximum has
     * to equal it. A percentage list tops out at 100, 100 !== 4, and the tier declines before it
     * looks at a single row. That is a property of the two numbers rather than a guess about what
     * the question meant, which is what this file requires of a widening.
     *
     * Bounded further, on purpose:
     *   - the value must land in EXACTLY ONE band, so overlapping or repeated bands refuse;
     *   - every row that looks like a band must parse, so a list mixing bands with prose ("3.5-4.0",
     *     "Not applicable") is left alone rather than half-read;
     *   - it runs AFTER both exact tiers, so a list that literally offers "3.89" is still answered
     *     by the answer, not by a band that happens to contain it.
     */
    const gradedValueWithScale = (wanted) => {
      const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/|\s+out\s+of\s+)\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(wanted || ''));
      if (!match) return null;
      const value = Number(match[1]);
      const scale = Number(match[2]);
      if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0 || value < 0) return null;
      if (value > scale) return null;
      return { value, scale };
    };
    const parseBand = (text) => {
      const source = String(text || '').replace(/\s+/g, ' ').trim();
      if (!source) return null;
      const num = '(\\d+(?:\\.\\d+)?)';
      const span = new RegExp('^' + num + '\\s*(?:-|\u2013|\u2014|to)\\s*' + num + '$', 'i').exec(source);
      if (span) {
        const lo = Number(span[1]);
        const hi = Number(span[2]);
        return Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi ? { lo, hi } : null;
      }
      const atLeast = new RegExp('^(?:above|over|at least)\\s*' + num + '$|^' + num + '\\s*(?:\\+|and above|or above|and higher|or higher|and over|or more)$', 'i').exec(source);
      if (atLeast) {
        const lo = Number(atLeast[1] ?? atLeast[2]);
        return Number.isFinite(lo) ? { lo, hi: Infinity } : null;
      }
      const atMost = new RegExp('^(?:below|under|less than)\\s*' + num + '$', 'i').exec(source);
      if (atMost) {
        const hi = Number(atMost[1]);
        return Number.isFinite(hi) ? { lo: -Infinity, hi, exclusiveHi: true } : null;
      }
      return null;
    };
    /* A DATE ANSWER AGAINST A LIST THAT ASKS FOR ONE OF ITS PARTS.
     *
     * "May 2028" is the single most common unmatched answer on this account: seven stored blockers
     * reading "no option matched May 2028, left for you to choose", against Graduation Year lists
     * offering 2026 / 2027 / 2028 and Graduation Month lists offering January..December. The answer
     * holds both parts and the control wants one of them, so exact matching correctly fails and the
     * applicant is handed a field whose answer she already gave.
     *
     * WHAT IS AND IS NOT A PART. A year row that IS the answer's year, or a month row that IS the
     * answer's month, is that answer restated - not a near miss and not an inference. A SEASON is a
     * different thing and is refused: mapping May onto "Spring 2028" is a claim about the employer's
     * calendar, and Northern and Southern hemisphere terms disagree about it. Same for quarters.
     *
     * The uniqueness requirement is what keeps a partial read honest. A list offering both "2028"
     * and "May 2028" is answered by the fuller row through the exact tiers above, and if it somehow
     * reaches here with two rows matching, it refuses rather than picking.
     */
    const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIndexOf = (token) => {
      const word = String(token || '').trim().toLowerCase().replace(/\.$/, '');
      if (!word) return -1;
      return MONTH_NAMES.findIndex((name) => name === word || (word.length >= 3 && name.startsWith(word)));
    };
    const datePartsOf = (text) => {
      const source = String(text || '').replace(/\s+/g, ' ').trim();
      if (!source) return null;
      const year = /\b(19|20)\d{2}\b/.exec(source);
      const words = source.split(/[^A-Za-z]+/).filter(Boolean);
      let month = -1;
      for (const word of words) {
        const found = monthIndexOf(word);
        if (found !== -1) { month = found; break; }
      }
      if (!year && month === -1) return null;
      /* A SEASON OR QUARTER IN THE TEXT MAKES IT NOT A PLAIN DATE, and this is checked on both
       * sides. On the ANSWER it means the stored value already speaks the employer's vocabulary and
       * the exact tiers own it; on an OPTION it means the row is a term, not a month. */
      const seasonal = /\b(spring|summer|autumn|fall|winter|q[1-4]|quarter|semester|term|trimester)\b/i.test(source);
      return { year: year ? Number(year[0]) : null, month, seasonal, hasBoth: Boolean(year) && month !== -1 };
    };
    const dateComponentIndex = (texts, wanted) => {
      const answer = datePartsOf(wanted);
      // Only an answer carrying BOTH parts can be split; a bare "2028" is already exact-matchable.
      if (!answer || !answer.hasBoth || answer.seasonal) return -1;
      const hits = [];
      for (let index = 0; index < texts.length; index += 1) {
        const row = datePartsOf(texts[index]);
        if (!row || row.seasonal) continue;
        const yearOnly = row.year !== null && row.month === -1 && row.year === answer.year;
        const monthOnly = row.year === null && row.month !== -1 && row.month === answer.month;
        const bothMatch = row.hasBoth && row.year === answer.year && row.month === answer.month;
        if (yearOnly || monthOnly || bothMatch) hits.push(index);
      }
      return hits.length === 1 ? hits[0] : -1;
    };
    const gradedBandIndex = (texts, wanted) => {
      const graded = gradedValueWithScale(wanted);
      if (!graded) return -1;
      /* A ROW THAT IS THE VALUE BEATS A ROW THAT CONTAINS IT, and this guard is the only thing that
       * enforces it here. The exact tiers above never see the bare number: they are handed
       * "3.89/4.0" and answerOptions does not strip the denominator, so a list offering BOTH "3.89"
       * and "3.50 - 4.00" reaches this function with the literal row unmatched. Without this, the
       * band would answer a list that was offering the value itself. */
      const bare = String(graded.value);
      const trimmedBare = String(graded.value.toFixed(2));
      for (const text of texts) {
        const literal = clean(text).toLowerCase();
        if (literal === bare || literal === trimmedBare) return -1;
      }
      const bands = texts.map((text) => parseBand(text));
      const present = bands.filter(Boolean);
      // Two bands at minimum, or "a list of bands" is not what this is looking at.
      if (present.length < 2) return -1;
      /* THE LIST'S OWN CEILING HAS TO BE THE ANSWER'S DENOMINATOR. An open-topped band ("3.5+") is
       * read as reaching the scale, because that is what it means on a graded list; anything above
       * the scale means this list is not measuring what the answer measured. */
      let ceiling = 0;
      for (const band of present) {
        if (!Number.isFinite(band.hi)) { ceiling = Math.max(ceiling, graded.scale); continue; }
        ceiling = Math.max(ceiling, band.hi);
      }
      if (Math.abs(ceiling - graded.scale) > 0.011) return -1;
      const hits = [];
      for (let index = 0; index < bands.length; index += 1) {
        const band = bands[index];
        if (!band) continue;
        const withinLow = graded.value >= band.lo;
        const withinHigh = band.exclusiveHi ? graded.value < band.hi : graded.value <= band.hi;
        if (withinLow && withinHigh) hits.push(index);
      }
      return hits.length === 1 ? hits[0] : -1;
    };
    const optionMatches = (candidate, wanted) => {
      const a = normalized(candidate);
      if (!a) return false;
      // Intent before spelling, and only ever decline-to-decline. Two texts that both refuse to
      // state say the same thing however each one is worded, so an option list that offers any
      // refusal can carry a stored refusal. Nothing else is matched this way: every other answer on
      // an EEO list is a claim about her, and a claim has to match the words.
      if (DECLINE_TO_STATE.test(a) && DECLINE_TO_STATE.test(normalized(wanted))) return true;
      return answerOptions(wanted).some((option) => {
        const b = normalized(option);
        return a === b || (b.length > 6 && a.includes(b)) || (a.length > 6 && b.includes(a));
      });
    };
    /* EXACTNESS IS NOT NEGOTIABLE ON A CHOICE CONTROL, AND HERE IS WHY.
     *
     * optionMatches above is deliberately loose: for texts longer than six characters it matches in
     * BOTH directions, so an option containing the answer, or contained by it, counts. That is
     * survivable on a free-text field, where a near miss reads as a typo. It is not survivable on a
     * select, because these controls carry sponsorship, work authorisation and disclosure answers,
     * and the ordinary shape of a Lever or Greenhouse list is a short answer that is a PREFIX of the
     * true longer one:
     *
     *   I do not require sponsorship
     *   I do not require sponsorship now, but will in the future
     *   I am authorized to work
     *   I am authorized to work only with a student visa
     *
     * Under containment every one of those pairs matches, so the answer that gets sent depends on
     * which line the employer happened to list first. A near miss there is not a cosmetic error: it
     * is a false statement about visa status and work authorisation, made to an employer, under the
     * applicant's own name, and neither she nor Litos would ever see it. So on a native select the
     * answer must be the answer: exact after case and punctuation are normalised away, or nothing.
     *
     * Two loosenings survive, and each is bounded by something other than its own looseness:
     *   - answerOptions synonyms, which are authorised restatements of the same answer (yes / agree,
     *     and the enumerated refusals), compared by exact equality and never by containment;
     *   - decline-to-decline intent, which requires BOTH texts to read independently as a refusal to
     *     state under DECLINE_TO_STATE, and then requires the list to offer only ONE refusal.
     *     Stating it as "a refusal cannot be a near miss of a claim" was wrong, and wrong in the
     *     direction that matters: it is the matcher, not the concept, that keeps the two apart, and
     *     until DECLINE_TO_STATE was corrected above it read "I do not identify with any of the
     *     above" as a refusal and let a stored opt-out select a substantive claim. What is actually
     *     true is narrower and is worth writing down as it is: an employer words its opt-out however
     *     it likes, so intent is the only way to reach it; a refusal carries no fact about her, so
     *     one refusal standing for another costs her nothing; and where a list offers two refusals
     *     that are not the same string, this tier declines rather than choosing between them.
     * Anything else is left for the applicant, which is what an unanswerable field already does. */
    const optionMatchesExactly = (candidate, wanted) => {
      const a = normalized(candidate);
      if (!a) return false;
      return answerOptions(wanted).some((option) => normalized(option) === a);
    };
    const declineMatches = (candidate, wanted) =>
      DECLINE_TO_STATE.test(normalized(candidate)) && DECLINE_TO_STATE.test(normalized(wanted));
    /* THE FIRST OF SEVERAL IS NEVER AN ANSWER, and this is the one place that rule is written down.
     *
     * The exact tier is ranked by what the CALLER asked for rather than by where the employer put
     * it: her own words first, then the authorised restatements in the order answerOptions lists
     * them, and inside one rank the list is searched whole. So DOM order can never beat an exact
     * match found later, and every widened match sits strictly below every exact one.
     *
     * ONE FUNCTION FOR THE THREE RENDERINGS THAT CAN HAND IT A LIST. A sponsorship question is the
     * same question whether the board serves it as a native select, a radio group or a row of pills,
     * and before this it was answered by three different rules: the native path ranked exactly, and
     * the other two each looped and took the first optionMatches hit, which on the ordinary Lever and
     * Greenhouse vocabulary means the first line the employer happened to list. So the same stored
     * answer produced different declarations on different boards. Those three differ only in how a
     * candidate's text is READ, a native option's label, a radio's label element, a pill's text, and
     * that read is the caller's job. Ranking is not.
     *
     * THE FOURTH RENDERING IS NOT THIS FUNCTION, and the difference is worth stating rather than
     * implying. A React Select menu is not a list of strings this file may read: its rows are named
     * by aria-labelledby, aria-label and content in that order, and reading them here reintroduces
     * five defects that test/option-click-dom.test.js pins. clickMatchingOption therefore asks
     * Playwright's role engine the same questions in the same order, literal name before
     * punctuation-tolerant name before anything widened, and it keeps a widened tier this function
     * does not have. See the comment there for what that costs and what bounds it.
     *
     * THERE IS NO CONTAINMENT TIER HERE AT ALL, and that is the change this comment exists for. It
     * used to have one, used by the radio and pill paths and taken whenever the list offered exactly
     * ONE containment relative of the answer. That is precisely the shape of the defect this file is
     * about: a stored "I do not require sponsorship now, but will in the future" against a list
     * offering "I do not require sponsorship" and "I require sponsorship now" has exactly one
     * containment relative, and it is the false one. Two of them was never the dangerous number; one
     * was. Neither the radio path nor the pill path has any verification stage behind it, so a row
     * clicked here goes straight into filledFields and is never looked at again. Exact, an
     * unambiguous refusal, or nothing.
     */
    const chooseOptionIndex = (texts, wanted) => {
      if (!clean(wanted)) return -1;
      /* THE LITERAL MATCH IS TAKEN BEFORE ANYTHING IS NORMALISED, and that ordering is the whole of
       * this tier's safety. normalized() keeps only [a-z0-9], which is what lets "Yes," reach a
       * stored "Yes", and it is also what makes "C++", "C#" and "C" one string, and "10+" and "10"
       * one string. Comparing normalised first meant a literal, unambiguous answer could be thrown
       * away by a collision that does not exist in the text the employer actually wrote: on a skills
       * list offering C++ and C#, a stored "C++" matched both and was refused, and on an experience
       * list offering "10+" and "10", a stored "10" was refused when the row saying exactly 10 was
       * sitting right there. Case is folded because an employer printing "COMPUTER SCIENCE" is
       * spelling the same answer; nothing else is touched.
       *
       * Several rows carrying the SAME literal text are not a collision. They say the same thing, so
       * which one is taken cannot change what the employer reads. */
      for (const option of answerOptions(wanted)) {
        const want = clean(option).toLowerCase();
        if (!want) continue;
        const literal = texts.findIndex((text) => clean(text).toLowerCase() === want);
        if (literal !== -1) return literal;
      }
      for (const option of answerOptions(wanted)) {
        const want = normalized(option);
        if (!want) continue;
        const exact = [];
        for (let index = 0; index < texts.length; index += 1) {
          if (normalized(texts[index]) === want) exact.push(index);
        }
        if (exact.length === 1) return exact[0];
        /* A COLLISION IS NOT A TIE, IT IS A QUESTION, and by here no literal match exists to settle
         * it. Two rows that normalise to the answer differ only in the punctuation normalising threw
         * away, and punctuation is exactly what tells "10" from "10+" and "C" from "C++". Taking the
         * first is how a stored "10" ended up sending "10+", with verifyFilled agreeing because the
         * same normalisation is symmetric across the collision that caused it. The decline tier below
         * has always deduped and refused; this tier did not. */
        if (exact.length > 1) return -1;
      }
      /* AFTER BOTH EXACT TIERS, NEVER BEFORE THEM. A list that literally offers the answer is
       * answered by the answer; only a list that offers bands instead of values reaches here. See
       * gradedBandIndex for why the answer's own denominator is what bounds this. */
      /* After both exact tiers, like every widening here: a one-row list that literally offers the
       * stored answer is already handled above, and only a statement-worded row reaches this. */
      const sole = soleOptionIndex(texts, wanted);
      if (sole !== -1) return sole;
      const band = gradedBandIndex(texts, wanted);
      if (band !== -1) return band;
      /* Also after both exact tiers, for the same reason: a list that offers the whole date is
       * answered by the whole date, and only a list asking for one part reaches here. */
      const datePart = dateComponentIndex(texts, wanted);
      if (datePart !== -1) return datePart;
      const refusals = [];
      for (let index = 0; index < texts.length; index += 1) {
        if (declineMatches(texts[index], wanted)) refusals.push(index);
      }
      if (!refusals.length) return -1;
      return new Set(refusals.map((index) => normalized(texts[index]))).size === 1 ? refusals[0] : -1;
    };
    const verifyFilled = async (field, expected) => {
      const state = await field.evaluate((element) => {
        if (element instanceof HTMLInputElement && element.type === 'file') return { kind: 'other', actual: [element.files?.length ? 'file' : ''] };
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) return { kind: 'other', actual: [element.checked ? 'checked' : ''] };
        if (element instanceof HTMLSelectElement) {
          const selected = element.selectedOptions && element.selectedOptions[0];
          // THE SAME THREE STRINGS THE SNAPSHOT READ. selectNativeOption's snapshot names an option
          // by 'option.label || option.textContent', so an <option label="X">Y</option> is chosen as
          // X and was then read back here as Y and '' only. The write had landed and the field was
          // reported unfilled: a verification that reads a different attribute from the one the
          // chooser read is the same defect class as one that reads a different element.
          return { kind: 'select', actual: selected ? [selected.textContent || '', selected.value || '', selected.label || ''] : [element.value || ''] };
        }
        return {
          kind: 'other',
          // The control's own type travels with the reading, because a tel field's formatting is
          // not a difference of answer. See the digitsOnly arm in sameAnswer.
          type: element instanceof HTMLInputElement ? String(element.type || '') : '',
          /* A PHONE FIELD THAT DOES NOT SAY type="tel" IS STILL A PHONE FIELD.
           *
           * Measured on the live Rippling apply form (ats.rippling.com, Easy Dynamics, 2026-08-20):
           * its phone control #field-31 is type="text", and the tel arm below was therefore
           * unreachable, so the same defect PR #65 closed for Greenhouse reopened one board over -
           * the field auto-formats with dashes and the run reported
           * 'value did not persist after fill (wrote "2135746270", field holds "213-574-6270")'
           * with both sides holding the same ten digits.
           *
           * What the control DOES say, read off that live element: inputmode="tel",
           * data-input="phone_number", placeholder "Phone number". Each of those is the employer's
           * own markup naming this one control a phone field, the same per-control machine signal
           * class as type="tel" itself. The word test also reads name and id, because a board that
           * writes name="phone" is making the same statement; Rippling's randomized name
           * ("lzIjPmFwR5E") simply never matches anything. */
          telShaped: element instanceof HTMLInputElement && (
            element.type === 'tel'
            || (element.getAttribute('inputmode') || '').toLowerCase() === 'tel'
            || /(?:^|\s|:)tel(?:$|\s|-)/.test((element.getAttribute('autocomplete') || '').toLowerCase())
            || /(?:\b|_)(?:phone|mobile|telephone|tel)(?:\b|_)/i.test([
              element.getAttribute('placeholder') || '',
              element.getAttribute('aria-label') || '',
              element.getAttribute('name') || '',
              element.id || '',
              element.getAttribute('data-input') || '',
              element.getAttribute('data-testid') || ''
            ].join(' '))
          ),
          actual: ['value' in element ? String(element.value || '') : (element.textContent || '')],
        };
      }).catch(() => ({ kind: 'other', actual: [] }));
      const actual = state.actual || [];
      if (!clean(expected)) return actual.some((candidate) => Boolean(clean(candidate)));
      if (actual.includes('checked') && /^yes$/i.test(clean(expected))) return true;
      /* A VERIFICATION THAT CAN ONLY AGREE WITH THE CHOOSER IS NOT A VERIFICATION. selectNativeOption
       * picked the option it picked BECAUSE a predicate said yes; asking that same predicate the same
       * question about the same pair afterwards is a tautology, and it is the reason the containment
       * defect above shipped reporting selectNativeOption=true and verifyFilled=true together. So a
       * select is checked against the ANSWER, by the same exact rule that was allowed to choose it,
       * and a control left holding a substring relative of the answer fails closed. */
      if (state.kind === 'select') {
        // Both of these refuse a non-Latin candidate on their first line, because normalized() has
        // erased it. That is a fail-closed refusal and not a false accept: a Japanese native select
        // is left for the applicant, the same way this tier leaves any answer it cannot make exact.
        return actual.some((candidate) => optionMatchesExactly(candidate, expected) || declineMatches(candidate, expected));
      }
      /* TWO BLANKS ARE NOT EQUAL ANSWERS.
       *
       * normalized() keeps only [a-z0-9], so it erases a Japanese, Arabic, Cyrillic, Greek or
       * Chinese string entirely. This equality read '' === '' and a field holding いいえ verified as
       * holding はい, and a field holding NOTHING verified as holding either. Same defect as the
       * containment arm in verifyChoiceInContainer, one function apart, and unlike the select tier
       * above it accepts rather than refuses.
       *
       * When either side normalises away, compare the CLEANED text instead. Raw equality is strictly
       * stricter than normalised equality, and it is only ever reached on the pairs the normalised
       * comparison could not have judged, so no answer that used to verify stops verifying: a
       * non-Latin answer that is genuinely correct still matches itself.
       */
      const sameAnswer = (candidate) => {
        /* A PHONE FIELD'S OWN FORMATTING IS NOT A DIFFERENT ANSWER.
         *
         * normalized() replaces each non-alphanumeric RUN with a SPACE rather than with nothing, so
         * a number the control reformatted never equals the number that was written:
         *
         *   wrote  "2135746270"      -> normalized "2135746270"
         *   holds  "(213) 574-6270"  -> normalized "213 574 6270"
         *
         * Measured 2026-08-18 on this user's Greenhouse packets, from the read-back this repo
         * started recording one commit ago. Every one of Five Rings, Akuna, Tower Research, Jump
         * Trading and IMC reported phone as lost with those exact two strings, on forms where the
         * value had in fact landed correctly and a person looking at the page would see it.
         *
         * Restricted to type="tel" and to a pair that is digits-only on both sides once separators
         * go. That is the whole class where punctuation carries no meaning: a text answer, a select
         * option and anything containing a letter are all judged exactly as before. */
        const digitsOnly = (value) => String(value == null ? '' : value).replace(/\D+/g, '');
        // telShaped's first disjunct IS type === 'tel', so testing both here would invent a dead
        // path; the declared/inferred distinction lives one line down in phoneLength alone.
        if (state.telShaped) {
          const candidateDigits = digitsOnly(candidate);
          const expectedDigits = digitsOnly(expected);
          const noLetters = (value) => !/[a-z]/i.test(String(value == null ? '' : value));
          /* On a declared type="tel" the digit compare stands exactly as PR #65 shipped it. On a
           * field that is only INFERRED to be a phone (telShaped above: inputmode, autocomplete,
           * or a phone word in its own attributes), both sides must also carry at least seven
           * digits - the shortest thing that is a phone number anywhere - so a short numeric
           * answer that happens to sit near the word "phone" ("10" against "10+", an extension
           * box) is still judged by the strict comparison below and never by digits alone. */
          const phoneLength = state.type === 'tel'
            || (candidateDigits.length >= 7 && expectedDigits.length >= 7);
          if (candidateDigits && expectedDigits && phoneLength && noLetters(candidate) && noLetters(expected)) {
            return candidateDigits === expectedDigits;
          }
        }
        const a = normalized(candidate);
        const b = normalized(expected);
        if (a && b) return a === b;
        const rawCandidate = clean(candidate).toLowerCase();
        return Boolean(rawCandidate) && rawCandidate === clean(expected).toLowerCase();
      };
      return actual.some((candidate) => optionMatches(candidate, expected) || sameAnswer(candidate));
    };
    /* THE SAME BOUNDED WINDOW choiceLanded GIVES A REACT SELECT'S REPAINT, OFFERED TO EVERY OTHER
     * VERIFICATION IN THIS FILE THAT USED TO READ A CONTROL BACK EXACTLY ONCE.
     *
     * PR #54/#77 closed this race for one control shape: a react-select whose chosen-value node can
     * commit on a later render than the one its click dispatched into, so a single read taken right
     * after the click can catch the control between empty and holding the right answer. choiceLanded
     * answered that with a bounded retry - up to 500ms across eleven reads of the exact same
     * predicate a bare read would have used once - and withdrawRefusedChoice took one more such read
     * before it would clear anything.
     *
     * Every OTHER control-verification in this file never got that treatment, because the race is a
     * property of a controlled component's render lagging its own click, not of react-select
     * specifically, and nothing here restricts a controlled radio, checkbox or native select from the
     * same lag. Traced 2026-08-20 against a fresh run on the real account minutes after PR #77 went
     * live: Mytos, Optiver and DGA all reported "did not persist" / "did not stay selected" on
     * fields whose stored answers were correct and unchanged on retry - pronouns, a terms-and-
     * conditions checkbox, a yes/no relocation and work-authorization toggle, and discipline/location
     * selects among them - the same product-facing symptom as the react-select race, on control
     * shapes pickRadioOption, the lone-checkbox arm and selectNativeOption's callers had only ever
     * read once.
     *
     * This is deliberately NOT a looser check. It runs the exact same predicate the caller already
     * had - isChecked, verifyFilled - and asks it again on the same schedule, so a genuinely wrong or
     * different value that fails on read one still fails on read eleven; nothing here is cleared, so
     * there is no analogue of withdrawRefusedChoice's confirm-before-clear gate to add - only more
     * chances for a correct answer that has not painted yet to be recognised as correct. */
    const settleVerified = async (check) => {
      for (let elapsed = 0; elapsed <= 500; elapsed += 50) {
        if (await check()) return true;
        if (elapsed < 500) await page.waitForTimeout(50).catch(() => undefined);
      }
      return false;
    };
    /* A NATIVE SELECT IS A CHOICE CONTROL EVEN WHEN THE CALLER SAYS FILL.
     *
     * Discovery gives the caller a durable selector and the control type, but a later action still
     * arrives as an ordinary fill when the selector identifies one exact field. The runner owns the
     * DOM and must dispatch from the element it actually reached. locator.fill() cannot operate on a
     * select, so the three profile-backed Lever questions on production packet c1ddd420 were all
     * resolved correctly and then left empty by the final write.
     *
     * One helper serves both selector-based fill and fillByLabelText so the two paths cannot choose
     * different option semantics. Label first, value second: Lever uses the same text for both,
     * while other native forms may expose only one of them. The option snapshot matters because
     * selectOption auto-waits for a requested option. Trying a label that is not present before its
     * matching value, or trying any unmatched answer, otherwise spends the full action timeout on
     * every speculative call.
     *
     * The snapshot is also what makes the choice answerable: chooseOptionIndex reads the WHOLE list
     * before it commits, so an exact answer beats a looser candidate that happens to sit above it,
     * and an ambiguous list is refused instead of resolved by position. See chooseOptionIndex for
     * why a select cannot be allowed the containment rule the rest of the runner uses.
     *
     * WHAT THE WRITE IS ADDRESSED BY, and why the two tiers differ. The snapshot and the write are
     * separated by an await, and a board that re-renders its options in that gap moves every index.
     * Writing by index takes whatever now sits at that position, which on a reordered list is a
     * different declaration; writing by label makes Playwright re-resolve the name against the live
     * DOM, so a reorder either finds the same option or finds nothing. Measured on this tree: with
     * the option list reordered in that window, the index write landed on "I do not require
     * sponsorship" for a stored "I do not require sponsorship now, but will in the future", and the
     * label write landed on the stored answer. verifyFilled catches the index case and the field
     * fails closed, so nothing false is submitted, but a fill that could have been right should be
     * right. So each tier writes by the thing it MATCHED on - the label tier by label, the value
     * tier by value - and neither carries a position across the await. The exact tier already
     * refuses a list where two options normalise to the same label or share one value, so the string
     * each tier hands back is unique in the list it was read from. */
    const selectNativeOption = async (field, wanted) => {
      const choices = await field.evaluate((element) => {
        if (!(element instanceof HTMLSelectElement)) return [];
        return [...element.options].map((option) => ({
          label: option.label || option.textContent || '',
          value: option.value || ''
        }));
      }).catch(() => []);
      if (!choices.length) return false;
      const byLabel = chooseOptionIndex(choices.map((choice) => choice.label), wanted);
      const byValue = byLabel === -1 ? chooseOptionIndex(choices.map((choice) => choice.value), wanted) : -1;
      if (byLabel === -1 && byValue === -1) return false;
      const address = byLabel === -1
        ? { value: choices[byValue].value }
        : { label: choices[byLabel].label };
      try {
        // Bounded, because addressing by string means Playwright AUTO-WAITS for that string. An
        // option that is genuinely gone from the live list would otherwise spend the full default
        // timeout proving it, on a field the run is about to hand back anyway.
        await field.selectOption(address, { timeout: 8000 });
        return true;
      } catch {
        return false;
      }
    };
    /* THE SELECTOR NAMED A QUESTION, NOT A CONTROL.
     *
     * Measured on production packet 59fb48ae (Deepgram, Ashby, 2026-08-09). Every question on that
     * form was handed to the runner with a selector that resolves to its own control - '#_systemfield_name',
     * '[name="477fc43f-..."]', '#caf77bb7-...' - except one. Ashby renders 'Expected Graduation Year'
     * as a react-datepicker whose input carries no id and no name at all:
     *
     *   <div class="_fieldEntry_..." data-field-path="407cc864-...">
     *     <label for="407cc864-...">Expected Graduation Year</label>
     *     <div class="react-datepicker-wrapper"><div class="react-datepicker__input-container">
     *       <input type="text" placeholder="Pick date..." required></div></div></div>
     *
     * so discovery had nothing to name but the question's own wrapper, and the fill action arrived
     * pointed at a DIV. locator.fill() on a div throws 'Element is not an <input>, <textarea>,
     * <select> or [contenteditable]', the action is optional so the throw became one line in
     * 'skipped', and the field stayed empty through the whole run. That is the entire reason the
     * packet reported '"Expected Graduation Year" is required and is still empty': not the date
     * format, not the widget - the write never reached a control.
     *
     * EXACTLY ONE candidate, or none. A wrapper holding two controls speaks for two questions, and
     * writing the answer into whichever came first in DOM order is how a value lands on somebody
     * else's question. That is the same refusal nearestQuestionText and questionOptionBlock already
     * make, for the same reason.
     */
    const FILLABLE_WITHIN = 'input:not([type="file"]):not([type="hidden"]):not([type="checkbox"])'
      + ':not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';
    /* A combobox that is not an input is still THE control. Discovery now emits Rippling's
     * '<div role="combobox">' and Lever's Select2 span as questions, and a fill action naming one
     * of them must reach the combobox dispatch below, not die here as "not a control Litos can
     * type into". A bare opener qualifies only when it holds no real form control of its own -
     * the same wrapper bound discovery applies, hidden and aria-hidden backing controls ignored. */
    const BARE_OPENER_WITHIN = '[role="combobox"], [aria-haspopup="listbox"]';
    const isBareOpener = (element) => (
      (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox')
      && !/^(?:INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
      && !element.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select:not([aria-hidden="true"])')
    );
    const fillTargetWithin = async (locator) => {
      const itself = await locator.evaluate((element, selector) => element.matches(selector), FILLABLE_WITHIN).catch(() => false);
      if (itself) return locator;
      const inside = locator.locator(FILLABLE_WITHIN);
      if ((await inside.count().catch(() => 0)) === 1) return inside.first();
      const bareItself = await locator.evaluate(isBareOpener).catch(() => false);
      if (bareItself) return locator;
      const openers = locator.locator(BARE_OPENER_WITHIN);
      if ((await openers.count().catch(() => 0)) === 1) {
        const first = openers.first();
        if (await first.evaluate(isBareOpener).catch(() => false)) return first;
      }
      return null;
    };
    /* A CONTROL THAT DEMANDS A DATE, and how much of one.
     *
     * Read off the DOM, never off the answer. The previous test was
     * (the answer is already YYYY-MM-DD) AND (the placeholder mentions a date), which can only
     * recognise a date control on a run that was handed a date to begin with. The Deepgram field is
     * a date control whatever it is handed, and it was handed the string "2028".
     *
     * Only real evidence of a PICKER counts. A plain text box whose placeholder happens to contain
     * the word "date" is free text and must keep taking what it is given verbatim; a box that says
     * "Pick date..." is a widget saying so. The three signals below are the ones the corpus has:
     * the native types, react-datepicker's own wrapper (Ashby, and it is the most common React
     * datepicker on these boards), and a placeholder written as an instruction to pick.
     */
    const dateControlPrecisionOf = async (field) => await field.evaluate((element) => {
      const type = (element.getAttribute('type') || '').toLowerCase();
      if (type === 'date') return 'day';
      if (type === 'month') return 'month';
      if (element.closest && element.closest(
        '.react-datepicker-wrapper, .react-datepicker__input-container, [class*="datepicker" i], [class*="date-picker" i]'
      )) return 'day';
      if (/\b(?:pick|choose|select)\b\s*(?:a|an|the)?\s*date\b/i.test(element.getAttribute('placeholder') || '')) return 'day';
      return '';
    }).catch(() => '');
    const MONTH_WORDS = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    /* WHAT CALENDAR POINT A PIECE OF TEXT NAMES, and how precisely.
     *
     * Used twice and in both directions: once on the answer Litos was given, and once on whatever
     * the control says after the write. Precision is the whole point of the function - a graduation
     * answer routinely names less of a date than a date control insists on, and the difference
     * between those two is the only thing standing between a stored fact and an invented one.
     *
     * A SEASON IS READ AS A YEAR AND NOTHING MORE. "Spring 2028" names a term, and which month a
     * term begins in is the school's business, not Litos's: spring terms end in April, May and June
     * at different institutions. Reading it as a month would be a guess wearing the clothes of a
     * parse.
     */
    const calendarPointOf = (text) => {
      const raw = clean(text);
      if (!raw) return null;
      const iso = raw.match(/\b((?:19|20)\d{2})-(\d{1,2})(?:-(\d{1,2}))?\b/);
      if (iso) {
        return { year: Number(iso[1]), month: Number(iso[2]), day: iso[3] ? Number(iso[3]) : 0, precision: iso[3] ? 'day' : 'month' };
      }
      const named = raw.match(new RegExp('\\b(' + MONTH_WORDS.map((name) => name.slice(0, 3)).join('|')
        + ')[a-z]*\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?,?\\s*((?:19|20)\\d{2})\\b', 'i'));
      if (named) {
        const month = MONTH_WORDS.findIndex((name) => name.startsWith(named[1].toLowerCase())) + 1;
        if (month > 0) {
          return { year: Number(named[3]), month, day: named[2] ? Number(named[2]) : 0, precision: named[2] ? 'day' : 'month' };
        }
      }
      const slashed = raw.match(/\b(\d{1,2})[/.](\d{1,2})[/.]((?:19|20)\d{2})\b/);
      if (slashed) {
        // Written down in the order it was read. Which of the two small numbers is the month is not
        // decided here: see sameCalendarPoint, which is deliberately order-blind about them.
        return { year: Number(slashed[3]), month: Number(slashed[1]), day: Number(slashed[2]), precision: 'day' };
      }
      const monthOnly = raw.match(/\b(\d{1,2})[/.]((?:19|20)\d{2})\b/);
      if (monthOnly) return { year: Number(monthOnly[2]), month: Number(monthOnly[1]), day: 0, precision: 'month' };
      const year = raw.match(/\b((?:19|20)\d{2})\b/);
      if (year) return { year: Number(year[1]), month: 0, day: 0, precision: 'year' };
      return null;
    };
    /* DOES WHAT THE CONTROL NOW SAYS NAME THE POINT WE ASKED FOR.
     *
     * The read-back is compared as a DATE and not as a string, which is the defect class the two
     * fixes above this one are both about: a widget that normalises "2028-05-01" to "05/01/2028" has
     * kept the answer, and verifyFilled's string comparison calls that a lost fill. Same shape as
     * the phone country rendered as "+971".
     *
     * ORDER-BLIND ABOUT THE TWO SMALL NUMBERS, on purpose. A control's display order is its own
     * business - 05/01/2028 and 01/05/2028 are the same day written by two boards - and nothing here
     * relies on guessing which convention a board uses. What keeps that safe is the WRITE, not the
     * read: the forms written below are ISO and the month spelled out, and neither can be parsed
     * into a different month by anyone.
     */
    const sameCalendarPoint = (shown, wanted) => {
      if (!shown || !wanted) return false;
      if (shown.year !== wanted.year) return false;
      if (wanted.precision === 'year') return shown.precision === 'year';
      if (shown.precision === 'year') return false;
      if (wanted.day && shown.day) {
        return (shown.month === wanted.month && shown.day === wanted.day)
          || (shown.month === wanted.day && shown.day === wanted.month);
      }
      return shown.month === wanted.month || (shown.day && shown.day === wanted.month && shown.month === wanted.day);
    };
    /* THE CONVENTION, WRITTEN DOWN ONCE.
     *
     * A month-precision graduation date going into a control that insists on a day is written as the
     * FIRST DAY OF THAT MONTH. This is a convention and not a fabrication, and the difference is
     * worth stating plainly:
     *
     *   - The year and the month are exactly what is on file and are not touched. Those are the two
     *     things a graduation question is screened on.
     *   - The first of the month is the canonical widening of a month-precision date. It is what
     *     ISO 8601 means by 2028-05, what every date library returns for the same input, and what
     *     this very widget writes on its own when handed "May 2028".
     *   - No reader can take a different month or a different year out of it.
     *
     * A BARE YEAR IS REFUSED INSTEAD, and that asymmetry is the whole rule. Widening a year to a day
     * means choosing a month: twelve choices, eleven of them false, and the one the widget picks for
     * itself is January - measured on the live Deepgram form, where typing "2028" and tabbing off
     * leaves 01/01/2028 sitting in a field about a person who graduates in May. That is not a
     * missing day, it is a wrong fact about when she stops being a student, and it is the fact an
     * internship screens on. So the control is left empty and the run says exactly what was missing.
     */
    const dateWriteForms = (point, precision) => {
      const pad = (value) => String(value).padStart(2, '0');
      const month = MONTH_WORDS[point.month - 1];
      const name = month ? month[0].toUpperCase() + month.slice(1) : '';
      // A day on file going into a month control loses the day, which the control asked it to.
      // Losing detail the control cannot hold is not the same act as inventing detail it demands.
      if (precision === 'month') {
        return [point.year + '-' + pad(point.month), name ? name + ' ' + point.year : ''].filter(Boolean);
      }
      const day = point.day || 1;
      // ISO first, then the month spelled out. Both are unambiguous to a parser and to a person, and
      // between them they cover every control the corpus has met. The slash forms are deliberately
      // absent: 05/01/2028 asks the board to guess, and a board that guesses wrong writes a date in
      // the wrong month that reads back as a clean success.
      return [
        point.year + '-' + pad(point.month) + '-' + pad(day),
        name ? name + ' ' + day + ', ' + point.year : ''
      ].filter(Boolean);
    };
    /* WRITE IT, COMMIT IT, READ IT BACK, AND ERASE ANYTHING THE CONTROL ADDED BY ITSELF.
     *
     * The commit is a real Tab keypress and it is not optional. Measured on the live Deepgram form:
     * locator.fill() plus dispatched input and change events - which is what every other fill on
     * this page does - leaves react-datepicker holding the raw text and holding NO date, so the
     * employer's own validator still calls the field empty. Only a Tab keydown makes it parse. Every
     * value fails without it, including a perfectly shaped one.
     *
     * The erase at the end is the honesty half. A control that turned what it was given into
     * something more precise has made a statement the applicant did not make, and leaving it there
     * is worse than leaving the field empty, because an empty required field is reported to her and
     * a plausible wrong date is not.
     */
    const fillDateControl = async (field, requested, precision) => {
      const wanted = calendarPointOf(requested);
      if (!wanted) return { outcome: 'unreadable' };
      // Refused against a day control AND against a month control, because both of them demand a
      // month and a year does not name one.
      if (wanted.precision === 'year') return { outcome: 'too-coarse', wanted };
      for (const form of dateWriteForms(wanted, precision)) {
        await field.fill(form).catch(() => undefined);
        await field.evaluate((element) => {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => undefined);
        await field.press('Tab').catch(() => field.evaluate((element) => element.blur()).catch(() => undefined));
        await page.waitForTimeout(120).catch(() => undefined);
        const shown = await field.evaluate((element) => String(element.value || '')).catch(() => '');
        const asked = wanted.precision === 'month' && precision === 'day'
          ? { year: wanted.year, month: wanted.month, day: 1, precision: 'day' }
          : wanted;
        if (sameCalendarPoint(calendarPointOf(shown), asked)) return { outcome: 'filled', shown };
      }
      const left = await field.evaluate((element) => String(element.value || '')).catch(() => '');
      if (clean(left)) {
        await field.fill('').catch(() => undefined);
        await field.evaluate((element) => {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => undefined);
        await field.press('Tab').catch(() => undefined);
      }
      return { outcome: 'not-kept', wanted, left };
    };
    /* The one place the outcomes above are turned into words, so the 'fill' and 'fillByLabelText'
     * branches cannot drift into describing the same failure two different ways. */
    const recordDateFill = (result, label, requested) => {
      if (!label) return result.outcome === 'filled';
      if (result.outcome === 'filled') { filledFields.push(label); return true; }
      if (result.outcome === 'too-coarse') {
        skipped.push(label + ': this control is a date picker and needs a full date, but the answer on file is only the year "'
          + clean(requested) + '", and picking a month for you could put the wrong one on the application, so it is left for you');
        return false;
      }
      if (result.outcome === 'unreadable') {
        skipped.push(label + ': this control is a date picker and "' + clean(requested) + '" is not a date Litos can read, left for you');
        return false;
      }
      skipped.push(label + ': the date "' + clean(requested)
        + '" did not stay on this picker, so the control was cleared rather than left showing something you did not say');
      return false;
    };
    /* IS THE NEXT QUESTION STILL REACHABLE, or is something sitting on top of it.
     *
     * Measured on the live Deepgram Ashby form: filling 'Expected Graduation Year' opens a May 2028
     * calendar that does NOT close when the value is committed, and it renders over the question
     * below it - over the control AND over its label. document.elementFromPoint at the centre of the
     * following control returns the calendar, so anything aimed there afterwards hits the calendar
     * instead of the field, and the screenshot of the 'filled' form shows the applicant a question
     * she cannot read.
     *
     * The measurement is deliberately 'is the next control reachable' and not 'is a calendar open'.
     * Which widget it is does not matter and there is no list of them worth keeping.
     *
     * Three narrowings, and each one is a false positive this would otherwise have:
     *   - Only text-entry controls count as 'the next question'. A checkbox, radio or file input is
     *     routinely 1px or opacity:0 with its real chrome painted by a sibling, so hit-testing one
     *     reports 'covered' on a page where nothing is covering anything.
     *   - The thing on top has to be FLOATING - inside an absolute, fixed or sticky ancestor. That is
     *     what an overlay IS, and it is what separates a picker from ordinary layout.
     *   - A control outside the viewport is answered 'no' rather than guessed at. elementFromPoint
     *     has nothing to say about it.
     */
    const nextControlIsCovered = async (field) => await field.evaluate((element) => {
      const TEXT_ENTRY = 'input:not([type]), input[type="text"], input[type="tel"], input[type="email"],'
        + ' input[type="url"], input[type="number"], input[type="search"], input[type="password"],'
        + ' input[type="date"], input[type="month"], input[type="week"], textarea, select, [role="combobox"]';
      const root = element.closest('form') || element.ownerDocument.body;
      const controls = Array.prototype.slice.call(root.querySelectorAll(TEXT_ENTRY));
      const index = controls.indexOf(element);
      if (index < 0) return false;
      const floating = (node) => {
        for (let at = node; at && at !== element.ownerDocument.body; at = at.parentElement) {
          const position = getComputedStyle(at).position;
          if (position === 'absolute' || position === 'fixed' || position === 'sticky') return true;
        }
        return false;
      };
      for (let i = index + 1; i < controls.length; i += 1) {
        const next = controls[i];
        if (next === element || element.contains(next) || next.contains(element)) continue;
        const box = next.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        const over = element.ownerDocument.elementFromPoint(x, y);
        if (!over) return false;
        if (over === next || next.contains(over) || over.contains(next)) return false;
        return floating(over);
      }
      return false;
    }).catch(() => false);
    /* DISMISSING THAT OVERLAY, AND WHY IT IS NOT A KEYSTROKE AT THE PAGE.
     *
     * There is recorded history here. An unaimed global 'press Enter', queued to commit a value,
     * reached the FORM instead and submitted it: five bounced applications and five emailed
     * Greenhouse security codes. So a dismissal has to satisfy two things at once. It has to reach
     * the overlay, and it has to be incapable of sending the application even if it lands somewhere
     * unintended.
     *
     * Escape aimed at the field satisfies both. It is delivered to one named element rather than to
     * whatever happens to hold focus; every picker measured here and live closes on it; and Escape
     * has no submitting behaviour on any control in any browser - there is no arrangement of focus
     * in which this key sends a form. Blur is the second attempt for the same two reasons: aimed at
     * the one element, and incapable of submitting. Nothing here CLICKS. A click needs a point to
     * land on, and any point on a real employer's page may turn out to be a control.
     *
     * The run-level submit guard above would catch a stray submit anyway. It is deliberately not
     * leaned on: a guard is a net, and the thing over the net should still be the right thing.
     *
     * An overlay that survives both is REPORTED rather than fought. Telling the applicant the form
     * was left with something covering a question is a true statement she can act on, and it is
     * better than escalating to a blind click at coordinates.
     *
     * Costs ZERO actions. It runs inside the fill that opened the overlay, so it cannot displace a
     * field at the MANAGED_ACTION_LIMIT boundary.
     */
    const dismissOverlayAfterFill = async (field, label) => {
      if (!(await nextControlIsCovered(field))) return;
      await field.press('Escape').catch(() => undefined);
      await page.waitForTimeout(80);
      if (!(await nextControlIsCovered(field))) return;
      await field.evaluate((element) => { if (typeof element.blur === 'function') element.blur(); }).catch(() => undefined);
      await page.waitForTimeout(80);
      if (await nextControlIsCovered(field) && label) {
        skipped.push(label + ': a picker overlay stayed open over the next question after Escape and blur');
      }
    };
    /* THE DIAL CODE THE FORM ALREADY HAS, read off the form rather than assumed from the board.
     *
     * Cresta's live form rejected '+971 567417451' with 'Phone number is too short' while the
     * country control beside it already read +971. Combining a selector holding +971 with a field
     * that also holds +971 gives a string no numbering plan parses, and the phone-input libraries
     * these forms use report that as a length error. The application could not be submitted.
     *
     * The rule is NOT 'this board strips'. It was exactly that, for exactly one board, and the same
     * defect then turned up on another. It is: when the phone field has a SEPARATE control already
     * showing THIS number's own dial code, the field is for the national number and the dial code
     * does not go in it. Both halves are required, and the second half is what keeps the
     * mirror-image defect away. A form with no country control, or one showing a different country,
     * or one showing a country NAME and no dial code, still receives the full international number,
     * because stripping the country off a number nothing else carries would be the worse of the two
     * bugs: it produces a number the employer cannot dial and nothing on the page says so.
     *
     * The decision this feeds is phoneForPortalField in the backend, and it is pinned there by
     * src/lib/phoneCountryControl.test.ts. This is the same rule at the one place that has a live
     * DOM to ask; the runner is a standalone script and cannot import it.
     */
    const separateDialCodesFor = async (field) => await field.evaluate((element) => {
      const attr = (name) => element.getAttribute(name) || '';
      const type = attr('type').toLowerCase();
      const hint = (attr('name') + ' ' + attr('id') + ' ' + attr('aria-label') + ' ' + attr('placeholder') + ' ' + attr('autocomplete')).toLowerCase();
      // Narrow on purpose. A broad match here would rewrite an unrelated numeric answer that
      // happened to sit next to something with a plus sign in it.
      if (type !== 'tel' && !/phone|mobile|(^|[^a-z])tel([^a-z]|$)/.test(hint)) return [];
      const dialCodesIn = (control) => {
        if (control === element || control.contains(element) || element.contains(control)) return [];
        let text = '';
        if (control.tagName === 'SELECT') {
          const selected = control.selectedOptions && control.selectedOptions[0];
          text = String(control.value || '') + ' ' + (selected ? String(selected.textContent || '') : '');
        } else {
          text = String(control.getAttribute('aria-label') || '') + ' '
            + String(control.value || '') + ' ' + String(control.textContent || '');
        }
        const found = [];
        const pattern = /\+\s?(\d{1,4})/g;
        let match = pattern.exec(text);
        while (match) { found.push(match[1]); match = pattern.exec(text); }
        return found;
      };
      // Nearest group outwards, stopping at the first level that holds a dial code, and never
      // crossing the form or the page. A phone field's country control sits beside it in its own
      // group; a dial code found past that boundary belongs to some other field.
      let node = element.parentElement;
      for (let depth = 0; node && depth < 4 && !/^(?:BODY|FORM|MAIN|SECTION|ARTICLE|HTML)$/.test(node.tagName); depth += 1) {
        const found = [];
        const controls = node.querySelectorAll(
          'select, [class*="select__single-value"], [class*="PhoneInputCountry"], [class*="iti__selected"], [role="combobox"], button'
        );
        for (let i = 0; i < controls.length; i += 1) {
          const codes = dialCodesIn(controls[i]);
          for (let j = 0; j < codes.length; j += 1) found.push(codes[j]);
        }
        if (found.length > 0) return found;
        node = node.parentElement;
      }
      return [];
    }).catch(() => []);
    const phoneValueForField = async (field, value) => {
      const wanted = String(value === undefined || value === null ? '' : value).trim();
      // No leading '+' means there is no dial code in the value to remove and no claim to act on.
      if (wanted.charAt(0) !== '+') return value;
      const digits = wanted.replace(/\D/g, '');
      if (!digits) return value;
      const codes = await separateDialCodesFor(field);
      const dial = codes
        // '>' and not '>=': a value that is nothing BUT its dial code would otherwise be stripped to
        // an empty field, which is a worse answer than an odd one.
        .filter((code) => code && digits.length > code.length && digits.indexOf(code) === 0)
        .sort((a, b) => b.length - a.length)[0];
      if (!dial) return value;
      return digits.slice(dial.length);
    };
    // Three states, not two, and the third one is the point. 'chosen' means the widget is showing an
    // answer and we can read it; 'empty' means it is positively showing its placeholder, so we KNOW
    // nothing is answered; 'unknown' means this is not a widget whose answered state can be read, and
    // no conclusion may be drawn from it either way.
    const readChoiceState = async (container) => await container.evaluate((element) => {
      const widget = element.closest('[class*="select__control"]')
        || element.closest('[class*="select__container"], [class*="select-shell"]')
        || element;
      // The chosen value is rendered as its own node, and reading it beats reading the widget:
      // the widget's textContent also carries the question label, and a label is quite capable of
      // containing the answer word ("...currently enrolled in a degree program?" contains "no").
      const chosenNodes = [...(widget.querySelectorAll?.(
        '[class*="select__single-value"], [class*="select__multi-value__label"]'
      ) || [])];
      const chosen = chosenNodes[0] || widget.querySelector(
        '[class*="select__single-value"], [class*="select__multi-value__label"]'
      );
      if (chosen) return {
        kind: 'chosen',
        value: chosen.textContent || '',
        values: (chosenNodes.length > 0 ? chosenNodes : [chosen]).map((node) => node.textContent || ''),
        multiValue: (chosenNodes.length > 0 ? chosenNodes : [chosen]).every((node) => (
          String(node.className || '').includes('select__multi-value__label')
        )),
        semanticValues: (chosenNodes.length > 0 ? chosenNodes : [chosen]).map((node) => (
          node.getAttribute?.('aria-label') || node.getAttribute?.('data-value')
            || node.getAttribute?.('title') || node.textContent || ''
        ))
      };
      // Still showing "Select...", so nothing was chosen. Saying so rather than falling through to
      // textContent stops the label from being mistaken for an answer.
      if (widget.querySelector('[class*="select__placeholder"]')) return { kind: 'empty', value: '' };
      return { kind: 'unknown', value: element.textContent || '' };
    }).catch(() => ({ kind: 'unknown', value: '' }));
    /* A COMBOBOX THAT IS AN <input> PUBLISHES ITS CHOICE IN ITS OWN VALUE, and textContent can
     * never see it. Measured on the live Easy Dynamics Rippling form (2026-08-20, field-77
     * "Please identify your race"): clicking the "Asian" row leaves the search input holding
     * value="Asian" with the menu closed, no chosen-value node and no select__* class anywhere -
     * so readChoiceState calls it 'unknown', the verifier refused a correct fill as unreadable,
     * and every run parked over an answer that was plainly on the form.
     *
     * DELIBERATELY NOT AN ARM OF readChoiceState. The same input is where a search query is
     * typed, and a query is not a choice: promoting any closed-menu input value to 'chosen'
     * leaks into every reader of that state - the arrival read, the clear check, the
     * left-on-the-form skip - and lets a fill that merely TYPED the answer verify itself
     * against its own keystrokes, the exact read-your-own-search-box tautology the fill
     * branch's bare-opener refusal exists to avoid. That was tried and reviewed out. What this
     * returns is only EVIDENCE; the one caller weighs it against the row that was clicked, and
     * a value that is not byte-for-byte that whole row proves nothing and changes nothing.
     *
     * Null while the menu is open, because an open menu means the input is mid-conversation
     * and its value is whatever was last typed into it. */
    const readCommittedSearchInputValue = async (container) => await container.evaluate((element) => {
      const input = (element.matches && element.matches('input[role="combobox"]'))
        ? element : element.querySelector?.('input[role="combobox"]');
      if (!input) return null;
      if (input.getAttribute('aria-expanded') === 'true') return null;
      return String(input.value || '');
    }).catch(() => null);
    // READS THE ANSWER THE EMPLOYER WOULD SEE, not the container the fill happened to be scoped to.
    // The container handed in by the 'fill' branch is resolved as the nearest ancestor holding a
    // combobox, and on a React Select that is '.select__input-container' - a div whose only child is
    // the invisible search input. Its textContent is the empty string no matter how correctly the
    // control was answered, so this reported "choice value did not persist after fill" for controls
    // that were visibly and correctly set. Measured on the live Redwood Materials Greenhouse form
    // (2026-08-08): four questions answered No/Yes/Yes/Yes, all four verified false.
    // A verification that reads a different place from the one the value lands in is worse than no
    // verification, because it turns a good fill into a reported failure and a real failure into
    // noise indistinguishable from it.
    /* THE ROW THAT WAS CLICKED, and THE ANSWER IT WAS CLICKED FOR, so the second rule below has
     * something to verify against.
     *
     * Written by fillCustomChoice and read only by the call that immediately follows it. Never
     * consulted anywhere else: the second rule is worth nothing without the click that produced it,
     * and a leftover row from an earlier control would be exactly the kind of verification-by-
     * coincidence the rule above it exists to avoid.
     */
    let lastClickedOptionText = '';
    let lastClickedOptionAnswer = '';
    /* AND WHETHER THE CLICK WAS MADE BY THE LIST-SHAPED TIERS, carrying the answer it was made
     * for. chooseFromOfferedRows (inside fillCustomChoice) commits a row the answer does not
     * name - the sole statement of a one-option consent, the band that contains a graded value,
     * the year of a month-and-year answer - so the clicked-row rule in verifyChoiceInContainer,
     * which demands the row CONTAIN the answer, would withdraw exactly the rows those tiers are
     * for. This is the provenance that lets the verifier ask the right question instead: is the
     * control holding the WHOLE row that tier clicked, for the answer this action is filling.
     * Empty for every click the name tiers make, so nothing about their verification changes. */
    let lastChooserTierAnswer = '';
    /* THE STATE THE CONTROL WAS IN WHEN THIS RUN REACHED IT, written by fillCustomChoice and read by
     * the withdrawal below. A refused click has to be put back, and "back" is this. */
    let lastChoiceArrival = { kind: 'empty', value: '' };
    // See fillCustomChoice: true once this call has opened a candidate control, so a caller can tell
    // a block with no drivable control from a control whose list did not carry the answer.
    let lastChoiceControlOpened = false;
    /* WHY A REFUSAL NEEDS WORDS. Every chooser below can now decline a control it could once resolve
     * by position, and "no option matched" is the wrong sentence for a list that offered two. The
     * applicant reads these lines and finishes the field herself, and the two cases ask different
     * things of her: one means her answer is not on the list, the other means the list holds two
     * answers and Litos will not pick between them. Written here, read by whichever branch of the
     * action loop ends up reporting the field.
     */
    let lastChoiceRefusal = '';
    /* AND WHY A REFUSAL NEEDS A COUNT AS WELL AS WORDS. A refusal is final for the tier that made it,
     * because every tier returns straight out of clickMatchingOption. It was NOT final for the
     * control: fillCustomChoice went on to run searchFor, which types into the widget and re-enters
     * the same tier stack against a menu the search has filtered, and a filtered menu can offer one
     * row where the whole menu offered two. So the ambiguity that produced the refusal could be
     * narrowed away by the very next step, and the answer the refusal was protecting her from could
     * then be clicked. Nothing measured had reached it, which is exactly why it is worth closing
     * structurally rather than waiting for the case that does.
     *
     * A counter rather than a comparison of the sentence, because two controls in one block can
     * refuse for the same reason and produce the same string, and 'lastChoiceRefusal' is deliberately
     * not cleared between them. */
    let choiceRefusals = 0;
    const refuseChoice = (reason) => { lastChoiceRefusal = reason; choiceRefusals += 1; return false; };
    // ONE SENTENCE FOR ONE VERDICT, whatever the board rendered the question as. A radio group, a
    // row of pills and a React Select that all offer two near matches and no exact one are the same
    // situation, and the applicant should not have to work out from three different wordings that
    // they are.
    /* ONE SENTENCE FOR ONE VERDICT, whatever the board rendered the question as, and the count is in
     * it because the two cases read differently to the person finishing the field. One near match is
     * "this list has something close to your answer and it is not your answer"; several is "this
     * list has several and Litos will not pick between them". Neither is "your answer is not here",
     * which is what she used to be told, and neither is a reason to click anything: on the
     * sponsorship and work-authorisation family a near match IS a different declaration. */
    const nearMissChoiceReason = (value, count) => (count > 1
      ? 'more than one of the options offered is a near match for "' + clean(value)
        + '" and none of them is it exactly, so choosing between them would be a guess,'
        + ' left for you to choose'
      : 'the closest option offered is a near match for "' + clean(value)
        + '" rather than exactly it, so it may be a different answer, left for you to choose');
    // WHAT A CHOICE THAT COULD NOT BE READ BACK IS TOLD, as opposed to one that was lost. The runner
    // clicked a row and the control does not publish what it is holding, so the honest report is
    // "confirm this", not "this did not take". See verifyChoiceInContainer.
    const unreadableChoiceReason = 'the answer was entered but this control does not report what it'
      + ' is holding, so Litos could not read it back: please confirm it';
    // The sentence an unanswerable control comes back with, and the one place a chooser's own
    // refusal is allowed to replace it. lastChoiceRefusal is cleared at the top of every action, so
    // this can only ever report an attempt made for THIS field.
    const unmatchedReason = (value) => lastChoiceRefusal
      || ('no option matched "' + clean(value) + '", left for you to choose');
    /* A VERIFICATION THAT CAN ONLY AGREE WITH THE CHOOSER IS NOT A VERIFICATION, and this one could
     * only agree. Its first rule was optionMatches - the same bidirectional containment predicate
     * that had just chosen the row - plus a second containment clause on top of it. So on exactly
     * the family this whole file is about, sponsorship and work authorisation, where every option is
     * a containment relative of its neighbours, it was a tautology: whatever the chooser picked, this
     * agreed, and a control left holding "I do not require sponsorship" for a stored "I do not
     * require sponsorship now, but will in the future" was reported filled. That is the same defect
     * verifyFilled was fixed for on the native path, and it is fixed the same way here.
     *
     * FIRST RULE, and it mirrors verifyFilled's select branch exactly: the control has to hold the
     * ANSWER, by the exact rule that was allowed to choose it.
     *
     * THEN A NEAR MISS FAILS CLOSED, EXPLICITLY. optionMatches is still consulted, but only ever to
     * REFUSE. A control showing something that is a containment relative of the answer without being
     * the answer is showing a different declaration, and no rule below may rescue it.
     *
     * WHAT THIS GIVES UP, SAID PLAINLY, AND IT IS NOT A NARROW CASE. readChoiceState only recognises
     * a React Select: select__single-value, select__multi-value__label, select__placeholder. Every
     * OTHER custom combobox that reaches here, Select2 among them, comes back 'unknown', and what
     * 'unknown' hands over is the whole block's text, which on some blocks is the question and every
     * option at once. The clause that went accepted exactly that: any blob containing the answer
     * counted as the answer. So this now refuses on a shape where the answer may well have landed:
     * measured on a Select2-shaped combobox, the runner clicks the RIGHT row and this returns false.
     *
     * Which is why that case does not get the "did not persist" sentence. It did persist; it could
     * not be read back, and those are two different things to tell someone who is about to go and
     * redo the field. lastChoiceUnreadable carries the difference out to the caller. What is not
     * negotiable is the verdict: readChoiceState's own contract says no conclusion may be drawn from
     * 'unknown' either way, and drawing a positive one out of a blob was the part that was wrong.
     */
    let lastChoiceUnreadable = false;
    const verifyChoiceInContainer = async (
      container,
      expected,
      clickedOptionText,
      clickedForAnswer,
      chooserTierAnswer,
      directControl = null,
    ) => {
      lastChoiceUnreadable = false;
      /* AND A JAPANESE ANSWER IS NOT A BLANK. normalized() keeps only [a-z0-9], so it erases a
       * Japanese, Arabic, Cyrillic, Greek or Chinese string entirely, and optionMatchesExactly
       * refuses anything that normalises away on its first line. On a non-Latin form that would
       * verify nowhere and every correctly answered control would come back as lost, which is the
       * defect the sibling non-Latin fix exists to prevent, arriving through the exact tier instead
       * of the containment one. So when either side normalises away, the comparison falls back to
       * the CLEANED text, lowercased, so \u0414\u0430 still matches \u0434\u0430. It stays an EQUALITY at both
       * tiers: raw equality is strictly stricter than normalised equality, it is only ever reached
       * on pairs the normalised comparison could not judge, and two blanks can no longer satisfy it
       * because a blank rendered value never equals a non-empty answer. */
      const holdsAnswer = (shownText, wanted) => answerOptions(wanted).some((option) => {
        const shownNormal = normalized(shownText);
        const optionNormal = normalized(option);
        if (shownNormal && optionNormal) return shownNormal === optionNormal;
        const shownRaw = clean(shownText).toLowerCase();
        return Boolean(shownRaw) && shownRaw === clean(option).toLowerCase();
      });
      /* A NEAR MISS ON A SCRIPT normalized() ERASES, which optionMatches cannot see.
       *
       * optionMatches returns false on its first line for anything that normalises to nothing, so
       * the refusal below it fired for every Latin near miss and for no non-Latin one. That gap is
       * not theoretical and it is not symmetric with Latin, because of how the languages negate:
       *
       *   English  "I do not require sponsorship"  does NOT contain  "I require sponsorship"
       *   Chinese  "不需要工作签证担保"              DOES contain      "需要工作签证担保"
       *   Japanese "ビザのサポートは必要ありません"    DOES contain      "ビザのサポートは必要"
       *   Korean   "스폰서십이 필요하지 않습니다"      DOES contain      "스폰서십이 필요"
       *
       * Chinese, Japanese and Korean negate with a bound prefix or a trailing auxiliary rather than
       * a separate leading word, so the negation of an answer is a SUPERSTRING of it. Every guard
       * this file has was off at once on that shape: optionMatches saw nothing, and the clicked-row
       * rule below then accepted it, because the row and the rendered value are the same string and
       * the provenance clause is true by construction. Measured through the four-argument call the
       * action loop actually makes, all five pairs verified TRUE.
       *
       * So containment is asked again, raw, and only for pairs normalising cannot judge. It is
       * containment WITHOUT equality: equality is holdsAnswer's job and has already answered.
       *
       * NO LENGTH FLOOR, which is where this deliberately differs from the Latin rule it mirrors.
       * optionMatches only counts containment above six normalised characters, and that floor is
       * what lets a widget rendering "No, I am not a protected veteran" verify against a stored
       * "No". There is no equivalent number here: a Japanese affirmative is two characters and a
       * Chinese one is one, so any floor that admits "はい" inside "はい、必要です" also admits
       * "需要工作签証担保" inside its own negation. On a script this file cannot read, "the widget
       * said more than the answer" and "the widget said the opposite of the answer" are the same
       * shape, so both are handed back. That costs a confirmation on a correct fill and it is the
       * only direction worth failing in.
       *
       * WHAT SEPARATES A RENDERING FROM A STATEMENT IS LETTERS, and it is the same discriminator
       * paddedWholeName uses on the chooser side, which is the point: the two halves agree on what
       * "extra material" means. A widget that renders the answer plus a dial code has added no
       * letters and is showing the answer; every negator in these scripts is a letter. So
       * "日本 +81" still verifies against "日本" while "不需要工作签証担保" does not verify against
       * "需要工作签証担保".
       */
      const addsOnlyNonLetters = (longer, shorter) => {
        const index = longer.indexOf(shorter);
        if (index === -1) return false;
        return !/\p{L}/u.test(longer.slice(0, index) + longer.slice(index + shorter.length));
      };
      const nearMiss = (shownText, wanted) => {
        if (optionMatches(shownText, wanted)) return true;
        const shownRaw = clean(shownText).toLowerCase();
        if (!shownRaw) return false;
        return answerOptions(wanted).some((option) => {
          const optionRaw = clean(option).toLowerCase();
          if (!optionRaw || optionRaw === shownRaw) return false;
          // Latin pairs are optionMatches's business and its verdict above is final for them.
          if (normalized(shownText) && normalized(option)) return false;
          if (shownRaw.includes(optionRaw)) return !addsOnlyNonLetters(shownRaw, optionRaw);
          if (optionRaw.includes(shownRaw)) return !addsOnlyNonLetters(optionRaw, shownRaw);
          return false;
        });
      };
      const state = await readChoiceState(container);
      if (state.kind === 'empty') return false;
      lastChoiceUnreadable = state.kind === 'unknown';
      const text = state.value;
      if (holdsAnswer(text, expected) || declineMatches(text, expected)) { lastChoiceUnreadable = false; return true; }
      /* A ROLE-LESS GREENHOUSE QUESTION WRAPPER CAN PUBLISH A COMMITTED VALUE WITHOUT ANY OF THE
       * selected-value classes readChoiceState recognises. The live Jump degree field is exactly
       * that shape: #question_<digits> wraps one search input, the option click closes its owned
       * menu and replaces Select... with one visible degree value, but the wrapper still reads as
       * unknown. This is a second read, not trust in the chooser. It is accepted only when:
       *   - the caller passed the exact input it drove;
       *   - one label in this question names one provider-owned #question_<digits> root containing
       *     that sole input;
       *   - the clicked row exactly names the reviewed answer;
       *   - the input is empty and its declared menu is closed;
       *   - no visible Select or Choose placeholder remains;
       *   - and exactly one visible non-option leaf in that root is the whole clicked row.
       * A loose job-description match, an open menu row, a typed search query, a second matching
       * value, or an ordinary text question all fail this gate. */
      if (state.kind === 'unknown' && directControl && clean(clickedOptionText || '')
        && optionMatchesExactly(clickedOptionText, expected)
        && optionMatchesExactly(clickedForAnswer, expected)) {
        const committedInQuestion = await container.evaluate((element, payload) => {
          const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const visible = (node) => {
            if (!node || node.getClientRects().length === 0) return false;
            const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
          };
          const labels = [...element.querySelectorAll('label[for]')].filter((label) => (
            /^question_\d+$/.test(label.getAttribute('for') || '')
          ));
          const bindings = labels.map((label) => {
            const root = document.getElementById(label.getAttribute('for'));
            const inputs = root && element.contains(root)
              ? (root.matches('input') ? [root] : [...root.querySelectorAll('input')])
              : [];
            return { root, inputs };
          }).filter((binding) => binding.root && binding.inputs.length === 1);
          if (bindings.length !== 1) return false;
          const root = bindings[0].root;
          const input = bindings[0].inputs[0];
          if (cleanText(input.value)) return false;
          if (input.getAttribute('aria-expanded') === 'true') return false;
          const menuId = cleanText(input.getAttribute('aria-controls') || input.getAttribute('aria-owns'));
          const menu = menuId ? document.getElementById(menuId.split(/\s+/)[0]) : null;
          if (menu && visible(menu) && menu.querySelector('[role="option"]')) return false;
          const placeholder = [...element.querySelectorAll('*')].some((node) => {
            if (!visible(node)) return false;
            const ownText = [...node.childNodes]
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => child.textContent || '')
              .join(' ');
            return /^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i.test(cleanText(ownText));
          });
          if (placeholder) return false;
          const exactValues = [...element.querySelectorAll('*')].filter((node) => {
            if (!visible(node) || cleanText(node.textContent).toLowerCase() !== payload.row) return false;
            if (node.matches('[role="option"], [role="listbox"]') || node.closest('[role="option"], [role="listbox"]')) return false;
            if (node.matches('label, label *') || node.closest('label')) return false;
            return ![...node.children].some((child) => cleanText(child.textContent).toLowerCase() === payload.row);
          });
          return exactValues.length === 1;
        }, { row: clean(clickedOptionText).toLowerCase() }).catch(() => false);
        if (committedInQuestion) { lastChoiceUnreadable = false; return true; }
      }
      /* THE ROW THAT WAS CLICKED IS SITTING IN THE WIDGET'S OWN INPUT, on a control readChoiceState
       * cannot read. Measured on the live Easy Dynamics Rippling form: the race question is an
       * '<input role="combobox">' whose committed choice lands in input.value with the menu closed,
       * so state.kind is 'unknown' here, the block-text near-miss below fires (the block's text
       * contains the answer beside its label), and a correct fill was refused as unreadable on
       * every run - the same three attentions re-minted forever.
       *
       * WHAT MAKES THIS A READ AND NOT THE TAUTOLOGY: the value must be byte-for-byte the WHOLE
       * row this call clicked. A residual search query can only equal the whole clicked row when
       * the query WAS that entire row name, and a menu offering a row named exactly what was typed
       * is the exact tier's own match; a wrong row reached by a widened query never equals the
       * query that found it ("Computer Science" is not "Computer Science and Engineering"). The
       * AND THE HELD ROW STILL HAS TO BE THE ANSWER, under the same reading a readable widget
       * gets. A widened click of "South Asian" for the answer "Asian" persists as a value that
       * equals its row, but on a React Select that exact commit is refused by the near-miss rule
       * and withdrawn; accepting it here because the widget is harder to read would make
       * unreadability a privilege. So the held row must satisfy holdsAnswer itself, or be a
       * list-shaped tier's recorded commit - a band or sole-consent row does not contain its
       * answer by construction, and its provenance already travels in chooserTierAnswer. */
      if (state.kind === 'unknown' && clean(clickedOptionText || '')) {
        const committed = await readCommittedSearchInputValue(container);
        const heldRow = clean(committed || '').toLowerCase();
        if (heldRow && heldRow === clean(clickedOptionText).toLowerCase()) {
          const rowIsTheAnswer = holdsAnswer(committed, expected) || declineMatches(committed, expected);
          const listTier = Boolean(clean(chooserTierAnswer || '')) && holdsAnswer(chooserTierAnswer, expected);
          if (rowIsTheAnswer || listTier) { lastChoiceUnreadable = false; return true; }
        }
      }
      /* A near miss is a refusal, and it only counts as a READ the runner managed when the widget
       * published its chosen value. On an 'unknown' container what came back is the whole block's
       * text, which routinely contains the answer somewhere, so treating that as a near miss would
       * clear the unreadable flag on exactly the shape the flag exists for and send her the wrong
       * sentence. Measured: a correctly clicked Select2 control reported "value did not persist". */
      if (nearMiss(text, expected)) {
        if (state.kind === 'chosen') lastChoiceUnreadable = false;
        return false;
      }
      /* SECOND RULE: A WIDGET MAY RENDER WHAT IT IS HOLDING IN A SHORTER FORM THAN THE MENU ROW THAT
       * SET IT, AND THAT IS NOT A LOST ANSWER.
       *
       * Measured 2026-08-09 against the live employer forms behind this user's stored reports, all
       * 24 of them, at job-boards.greenhouse.io/embed/job_app. Greenhouse renders the phone Country
       * field as a React Select whose MENU ROW reads "United Arab Emirates +971" and whose CHOSEN
       * value renders as a flag element plus the text "+971", and nothing else:
       *
       *   <div class="select__single-value"><div class="iti__flag iti__ae"></div><span>+971</span></div>
       *
       * readChoiceState reads that node, which is the right node - the value HAD landed on 23 of the
       * 24 forms. The two rules above then compared "+971" against the requested "United Arab
       * Emirates", found nothing in common, and the runner reported an answer it had actually left
       * on the form as one it had lost. That single control accounts for 43 of the 45 stored
       * "choice value did not persist after fill" reports across 133 packets.
       *
       * So this rule verifies against the row that was CLICKED instead of against the answer text.
       * The old version re-asked optionMatches whether that row carried the answer, which is the
       * tautology again one level down.
       *
       * WHAT THE PROVENANCE CLAUSE ACTUALLY DOES, and it is not the tightening. clickMatchingOption
       * is only ever called with the value this action is filling, and it only ever records a member
       * of answerOptions of that value, so for any click made during this call the clause is true by
       * construction. It is a STALENESS check: it is what stops a row left behind by an earlier
       * control, or by a fillCustomChoice that returned true without clicking anything, from standing
       * in for a click that never happened on this one. That is worth having and it is all it is.
       *
       * THE TIGHTENING IS THE NEAR-MISS REFUSAL two lines above, which runs before this rule and
       * cannot be reached past. "+971" has nothing in common with "United Arab Emirates" and reaches
       * here; "I am authorized to work" is a containment relative of "I am authorized to work only
       * with a student visa" and never does, even though it too is a substring of the row that was
       * clicked. That line is the one that makes this verifier able to disagree with the chooser.
       *
       * Compared on the CLEANED text rather than the normalised text, because normalising strips
       * punctuation and "+1" would then read as a substring of "united arab emirates 971". The
       * two-character floor is the same guard from the other side: a single character is a substring
       * of almost any row and proves nothing.
       */
      const row = clean(clickedOptionText || '').toLowerCase();
      const shown = clean(text).toLowerCase();
      /* A ROW THE LIST-SHAPED TIERS CHOSE DOES NOT CONTAIN THE ANSWER, BY CONSTRUCTION, and the
       * clicked-row rule below would therefore withdraw every one of their correct commits: a
       * one-option consent's "I consent to the above." does not contain "Yes", "3.50 - 4.00" does
       * not contain "3.89/4.0", and "2028" does not contain "May 2028". For those clicks the
       * honest question is not "does the row carry the answer" - the tier's own suite pins that
       * the tier may say it does - but "did the row the tier clicked PERSIST as the control's
       * value". So this accepts exactly that, and nothing looser:
       *   - the click was made by chooseFromOfferedRows FOR the answer this action is verifying
       *     (the provenance travels in chooserTierAnswer and is '' for every name-tier click, so
       *     their verification is unchanged);
       *   - the control publishes a chosen value (an 'unknown' widget keeps the unreadable
       *     treatment it has);
       *   - and that value is the WHOLE clicked row, not a fragment of it. The near-miss refusal
       *     above still runs first and still cannot be reached past. */
      if (clean(chooserTierAnswer || '') && holdsAnswer(chooserTierAnswer, expected)
        && state.kind === 'chosen' && row && shown && row === shown) {
        lastChoiceUnreadable = false;
        return true;
      }
      if (!row || shown.length < 2 || !row.includes(shown)) return false;
      // Script-aware for the same reason the first rule is: comparing the clicked answer against the
      // expected one through normalized() alone reads two non-Latin strings as one blank, and this
      // rule would then accept a row clicked for a different answer entirely.
      if (!holdsAnswer(clickedForAnswer, expected)) return false;
      /* AND THE ROW HAS TO CARRY THE ANSWER IT WAS CLICKED FOR. Without this the rule reads "some
       * row was clicked for this answer and the control is showing part of that row", which says
       * nothing about whether the row was ever the answer. Raw containment of the answer in the row,
       * which is a property every tier that can click already guarantees: the exact tiers match the
       * whole name, the padded tier adds only non-letters, and the Latin widened tier is that
       * containment asked forwards. It is not the predicate that made the choice, so it can and does
       * disagree with one, and it is what stops the clicked-row rule being the tautology one level
       * down that the first rule used to be. */
      if (!row.includes(clean(clickedForAnswer).toLowerCase())) return false;
      lastChoiceUnreadable = false;
      return true;
    };
    /* A REFUSED ROW IS STILL SELECTED ON THE FORM, AND UNTIL NOW NOTHING TOOK IT BACK.
     *
     * The widened tier clicks a row that contains the answer and the verifier above then refuses it,
     * so the run reports the field as one it could not fill. What it does not say, and what was
     * true, is that the FALSE row is now the control's answer. Measured on the React Select
     * rendering of a stored "I am authorized to work in the United States" against a menu offering
     * only "...only with a student visa": filled=false, skipped said the value did not persist, and
     * the page was left holding the student-visa declaration. fillCustomChoice's own belt and braces
     * cannot help, because it only fires for a control that was ALREADY answered when the run
     * arrived, and the ordinary case is an empty one.
     *
     * TWO THINGS, BECAUSE ONE OF THEM CAN FAIL. The withdrawal below undoes the click where the
     * control offers a way to undo it; the mark it leaves when it cannot is what the pre-submit gate
     * reads, so a control still holding something this run could not confirm stops the submit
     * instead of riding along inside it. A wrong answer is worse than a blank one, and blank was the
     * only thing that stopped a run.
     *
     * THE UNDO IS THE CONTROL'S OWN CLEAR AFFORDANCE, which is the one place in this file where
     * clicking one is right. CLEAR_CONTROL_RE exists so that fillCustomChoice never touches these -
     * a React Select's "Clear selections" indicator sits in the same container as its combobox and
     * clicking it wiped a correct answer - and the same reading is what finds it here. One regex,
     * two opposite jobs, and they cannot drift apart.
     *
     * IT IS SEARCHED FOR OVER A WIDER SET OF NODES THAN THE OPENERS, and that is not symmetry for
     * its own sake. CHOICE_CONTROLS is a list of things that might OPEN a menu, so it is buttons and
     * comboboxes; the real react-select clear is neither. Read out of react-select's own source
     * (packages/react-select/src/components/indicators.tsx): ClearIndicator renders a plain '<div>'
     * carrying 'aria-hidden="true"', an SVG with no text, and no aria-label or title of any kind. It
     * is not a button, it is not focusable, and it has no accessible name, so nothing in the opener
     * list can see it and nothing that reads a name can identify it. The class is the only handle it
     * gives, which is why the search below is over class-shaped selectors too.
     *
     * WHAT IS DELIBERATELY NOT TOUCHED: a control readChoiceState calls 'unknown'. It publishes
     * nothing, so there is no evidence the click landed on it at all, and clearing it would as
     * readily destroy a correct answer as remove a false one. That case is marked and not touched,
     * which is the same verdict its skip sentence already gives: confirm it.
     *
     * AND IT IS BOUNDED TO THE WIDGET, NOT TO THE QUESTION'S BLOCK, WHICH IS THE WHOLE SAFETY ARGUMENT.
     *
     * A wide search over the block plus a list of words to avoid was tried and leaked twice. First it
     * pressed '<button aria-label="Remove file">', the node readSubmitReadiness reads as proof that a
     * resume was uploaded, so a withdrawal could delete her resume to take back a menu row. That was
     * answered by naming files in a deny-list. Then, measured on the next pass, the same search
     * pressed "Remove education", "Remove this employment entry" and "Close": Greenhouse and Lever
     * render a repeated-section remove beside the very row that carries the School and Discipline
     * selects, and a run that pressed it destroyed an education entry and reported only that a choice
     * did not persist. Mehek cannot see that happened and this runner cannot put it back.
     *
     * A deny-list is the wrong instrument for that, and its failure mode is exactly what happened: it
     * has to enumerate every destructive neighbour anyone will ever render, and the next reader will
     * add a word rather than fix the scope. The list is gone. What replaces it is the one true
     * statement available here: A CHOICE CONTROL'S CLEAR LIVES INSIDE THAT CHOICE CONTROL. So the
     * search is bounded to the widget shell, and a node outside the widget is not a candidate however
     * it is named. "Remove education" is not inside the select, so it cannot be pressed, and neither
     * can whatever the next board renders next to a select.
     *
     * BOTH DIRECTIONS, because the two call paths hand in different containers. The fill branch
     * resolves the nearest ancestor holding a combobox, which on a React Select is
     * '.select__input-container', so the shell is an ANCESTOR of the container; fillByLabelText
     * resolves the question's block, so the shell is a DESCENDANT. Searching one direction only would
     * silently lose the withdrawal on the other path, which fails closed but for no reason.
     *
     * DOWNWARDS IS ASKED FIRST, AND THE ORDER IS THE WHOLE OF IT. Asking for both at once, as
     * '(ancestor-or-self::*[SHELL] | descendant::*[SHELL])[1]', put 19c's defect straight back:
     * XPath sorts a union in DOCUMENT ORDER, so '[1]' is the OUTERMOST node in it and never the
     * nearest. This is a substring test on an unbounded ancestor axis, so a layout wrapper whose
     * class merely CONTAINS a shell name is that outermost node. Measured on a grid of two questions
     * under '<div class="select-shell-grid">': the withdrawal pressed "Remove education" and wiped
     * the neighbouring question's already verified answer, and reported only that this question's
     * choice did not persist.
     *
     * Nor does the obvious repair help, and it is named here so it is not tried a third time.
     * 'ancestor-or-self::*[SHELL][1]' on a reverse axis really does give the NEAREST ancestor, but
     * it throws the downward direction away with the ordering. Wherever the question's label sits
     * outside the widget, which is how a repeated section renders and is exactly 19c's education
     * row, the container is the ROW: the widget is below it and the only thing at or above it is a
     * wrapper, or nothing shell-shaped at all. Measured on 19c with that repair in place, the
     * withdrawal pressed nothing and left "...for any employer" sitting on the form.
     *
     * What decides it is the direction, before any axis: a DESCENDANT shell means the container is a
     * question BLOCK holding a widget, so that widget is the one. Only a container with nothing
     * shell-shaped under it is itself PART of one, which is the fill path.
     *
     * AND WHERE NO SHELL CAN BE IDENTIFIED, NOTHING IS PRESSED, INCLUDING ON CONTROLS THIS RUNNER
     * CAN READ. The two tests are not the same test and it is worth saying so plainly, because an
     * earlier reading of this comment claimed they were and concluded they could not disagree. The
     * shell test above is three class families. readChoiceState is two of them, then two further
     * fallbacks this has no equivalent for: 'closest("[class*=select__control]").parentElement', and
     * failing that the container element itself. So a widget rendering '.select__control' and
     * '.select__single-value' with no container class at all reads back 'chosen' here and offers
     * this no shell to search, and the withdrawal is a silent no-op on it.
     *
     * That is not left dangerous, but it is not this function that makes it safe, and the difference
     * matters to whoever edits either test next. Driven through confirmAndSubmit on exactly that
     * shape: the withdrawal presses nothing, the control is still holding "...only with a student
     * visa", the submit button is never clicked, and the run reports "atomic confirmation blocked
     * submission". What carries it is the mark withdrawRefusedChoice writes when this returns false,
     * plus the pre-submit gate that refuses to send a form carrying one. A withdrawal that cannot
     * identify what belongs to this control has nothing honest to press, and pressing anyway is the
     * defect above. */
    const CHOICE_SHELL_CLASSES = 'contains(@class,"select__container") or contains(@class,"select-shell")'
      + ' or contains(@class,"select2-container")';
    const markChoice = async (container, kind) => await container.evaluate(
      (element, payload) => element.setAttribute('data-litos-unverified-choice', payload), kind
    ).catch(() => undefined);
    const unmarkChoice = async (container) => await container.evaluate(
      (element) => element.removeAttribute('data-litos-unverified-choice')
    ).catch(() => undefined);
    const clearChoiceControl = async (container) => {
      // Two asks in a fixed order, not one union. See the direction paragraph above: a union is
      // sorted in document order, so it hands back the outermost match and a wrapper named like a
      // shell wins it. Downwards first, and only a container with no shell under it is part of one.
      const shellDown = container.locator('xpath=(descendant::*[' + CHOICE_SHELL_CLASSES + '])[1]');
      const shellUp = container.locator('xpath=ancestor-or-self::*[' + CHOICE_SHELL_CLASSES + '][1]');
      const shell = (await shellDown.count()) > 0 ? shellDown : shellUp;
      if ((await shell.count()) === 0) return false;
      const controls = shell.locator(CLEAR_CONTROLS);
      const total = await controls.count();
      for (let index = 0; index < total; index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        const hay = await control.evaluate((element) => ['aria-label', 'title', 'class', 'data-testid', 'name']
          .map((attribute) => element.getAttribute(attribute) || '').join(' ').toLowerCase()).catch(() => '');
        if (!CLEAR_CONTROL_RE.test(hay)) continue;
        await control.click().catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
        if ((await readChoiceState(container)).kind !== 'chosen') return true;
      }
      return false;
    };
    const withdrawRefusedChoice = async (container, clickedOptionText, clickedForAnswer, expected, directControl = null) => {
      // Nothing was clicked during this call, so this call has nothing on the form to take back. The
      // provenance rule the clicked-row tier already relies on, asked for the opposite purpose.
      if (!clean(clickedOptionText || '')) return false;
      const arrival = lastChoiceArrival;
      const now = await readChoiceState(container);
      /* THE ROW THAT WAS CLICKED WAS THE ANSWER, ON A CONTROL THAT CANNOT SAY SO.
       *
       * readChoiceState only recognises a React Select, so every other custom combobox comes back
       * 'unknown' and the verifier refuses it whatever it is holding. Marking all of those stopped
       * the submit, and that cost was measured and is too high: Greenhouse serves Select2, the runner
       * clicks the RIGHT row, and the application was then withheld. On a required control the block
       * predates this branch, so the new cost fell entirely on non-required unreadable controls, on
       * every board that renders any question as a combobox that is not a React Select.
       *
       * The row this run clicked and the answer it was clicked FOR are both already recorded, and
       * when they are the same string the exact tier matched a row named exactly her answer. There is
       * nothing to withhold a submit over: what is on the control is what she asked for, and the only
       * thing missing is the widget's willingness to read it back, which is what the skip sentence
       * already tells her.
       *
       * Asked of the strings and not of which tier ran, deliberately. Select2's rows carry no
       * role=option at all, so an exactly-named Select2 row can only ever be reached by a widened
       * query, and a tier flag would mark exactly the case this exists to spare.
       */
      if (now.kind === 'unknown') {
        const clickedTheAnswer = clean(clickedOptionText).toLowerCase()
          === clean(clickedForAnswer || '').toLowerCase();
        if (clickedTheAnswer) await unmarkChoice(container);
        else await markChoice(container, 'unreadable');
        return false;
      }
      // Positively empty. Either the click never took or something already undid it, and either way
      // there is no false answer sitting on the form.
      if (now.kind === 'empty') { await unmarkChoice(container); return false; }
      /* Re-entering fillCustomChoice to put an earlier answer back would overwrite the two sentences
       * the caller is about to read, so they are held across the withdrawal. The verdict is already
       * made; what happens here can only change the FORM, never the report. */
      const heldRefusal = lastChoiceRefusal;
      const heldUnreadable = lastChoiceUnreadable;
      /* ONE MORE READ, AGAINST THE STATE THIS FUNCTION IS ABOUT TO ACT ON, BEFORE ANYTHING IS PRESSED.
       *
       * choiceLanded's settle loop above already gives a React Select up to 500ms across ten reads to
       * publish the value it was just clicked to hold, and on every control measured so far that is
       * enough. It is a bound, not a guarantee: the loop's LAST read and this function's FIRST read
       * are still two separate reads of a live page, or the control was clicked but its render is
       * gated behind something other than the plain repaint the loop is timed for. Either way, 'now'
       * two lines up already told us the control is holding SOMETHING ('chosen', not 'empty' and not
       * 'unknown') - what had not been asked, until now, is whether that something is the answer.
       *
       * So it is asked, once, with the exact same verifier and the exact same provenance the settle
       * loop just ran out of retries on. A confirmed match here is not a coincidence the caller gets
       * to be suspicious of: verifyChoiceInContainer is the one function in this file allowed to
       * disagree with the chooser, and if it now agrees, the control is holding the answer by the
       * same rule choiceLanded's own successful path accepts. Clearing it anyway - which is every
       * line below this block - would take a correctly answered field and report it as one this run
       * lost, on a control this run itself just emptied.
       *
       * 'expected' is optional and the old behaviour stands when it is not supplied: there is then
       * nothing to confirm the control wrong against, and guessing would be worse than the unreadable
       * treatment above already gives it. */
      if (expected !== undefined
        && await verifyChoiceInContainer(
          container,
          expected,
          clickedOptionText,
          clickedForAnswer,
          lastChooserTierAnswer,
          directControl,
        )) {
        await unmarkChoice(container);
        lastChoiceRefusal = heldRefusal;
        lastChoiceUnreadable = false;
        return true;
      }
      let restored = await clearChoiceControl(container);
      if (arrival.kind === 'chosen') {
        await fillCustomChoice(container, arrival.value).catch(() => undefined);
        const after = await readChoiceState(container);
        restored = after.kind === 'chosen'
          && clean(after.value).toLowerCase() === clean(arrival.value).toLowerCase();
      }
      lastChoiceRefusal = heldRefusal;
      lastChoiceUnreadable = heldUnreadable;
      if (restored) await unmarkChoice(container);
      else await markChoice(container, 'different');
      return false;
    };
    /* THE ONE ELEMENT A BLUR CAN BE SENT TO, for the same reason clearChoiceControl is bounded to
     * the widget shell and not the question block: blurring something outside this control blurs
     * whatever the PAGE happens to have focused, which after a fill sequence can be anything.
     * directControl is trusted first because it is the exact element fillCustomChoice drove.
     *
     * WHEN directControl IS NOT KNOWN, ASK THE PAGE WHAT IS FOCUSED - do not guess by selector.
     * The first cut of this searched 'container' for the first node matching a fixed opener-shape
     * list, and .first() is DOM ORDER, not "the element this fill drove". Three of this file's own
     * call sites hand choiceLanded a container wider than one widget: a repeated section's own
     * "Remove education" button (the exact shape CLEAR_CONTROLS' own comment, a few hundred lines
     * up, already documents as reachable by a block-wide search), a multi-value combobox's earlier
     * chip-remove control, or a sibling question sharing one wrapper - any of these sorts ahead of
     * the actually-focused control and gets blurred instead, which is a silent no-op: the real
     * control stays focused, the reread below sees the exact state the first read already saw, and
     * the whole point of this function is defeated without anything failing loudly.
     *
     * document.activeElement is not a guess. It is the one thing the page itself can say was left
     * focused by the click that drove the fill, and it needs no shape list to enumerate. Scoped to
     * 'container' so a focus that has already moved elsewhere on the page - a description this
     * fill never touched - is not blurred on this control's behalf. */
    const blurDrivenChoiceControl = async (container, directControl) => {
      if (directControl) {
        await directControl.evaluate((element) => element.blur()).catch(() => undefined);
        return;
      }
      await container.evaluate((element) => {
        const active = element.ownerDocument && element.ownerDocument.activeElement;
        if (active && element.contains(active)) active.blur();
      }).catch(() => undefined);
    };
    /* THE VERDICT AND WHAT IT COSTS THE FORM, IN ONE CALL, so that no branch of the action loop can
     * take the first without the second. Every fillCustomChoice call site in this file goes through
     * this and none of them calls the verifier directly: the defect that made this necessary is
     * exactly one call site of four doing something the other three did, and a fifth is only a
     * matter of time. verifyChoiceInContainer stays a pure reading of the control, which is what
     * lets it be unit-tested against a container that is nothing but a state. */
    const choiceLanded = async (container, expected, directControl = null) => {
      // React-controlled choices can publish their selected value on a later render. Give that
      // exact value a bounded window before withdrawing anything the option click may have set.
      for (let elapsed = 0; elapsed <= 500; elapsed += 50) {
        if (await verifyChoiceInContainer(
          container,
          expected,
          lastClickedOptionText,
          lastClickedOptionAnswer,
          lastChooserTierAnswer,
          directControl,
        )) {
          /* A VERIFIED READ TAKEN WHILE THE CONTROL IS STILL FOCUSED CAN STILL BE AN UNFINISHED
           * COMMIT, and this file already has the measured shape for it: #96 (Rescue blurred
           * Greenhouse choice fills) found the live Jump degree control reading back correctly
           * WHILE FOCUSED and then Greenhouse's own blur validation clearing it, because the click
           * had driven the DOM's visible state without ever driving whatever bookkeeping a real
           * user interaction leaves behind. #96 fixed that for Greenhouse's ROLE-LESS TEXT search
           * input specifically, in the plain-fill branch below; it never reached this function, so
           * every OTHER portal's custom combobox routed through fillCustomChoice kept trusting a
           * single read taken before the one event this runner always sends next - moving on to
           * fill the following field, which blurs this one. Measured live against a Deepgram
           * Ashby "Current Location" field, 2026-08-21: the packet-audit review's own
           * required-field scan called the control empty while this function's un-reverified read
           * had already reported it filled, from the SAME run.
           *
           * So the same discipline is applied here, generically: blur the control this call
           * actually drove and ask the SAME verifier again before trusting the first answer.
           *
           * THE REREAD GETS THE SAME BUDGET AS THE READ IT FOLLOWS, not a single fixed wait. A
           * one-shot check 150ms after the blur was tried first and rejected: this loop's own
           * comment above states why a fixed wait is not trusted for a controlled component's
           * render lagging its own click, and a blur-triggered validation (Ashby's own included -
           * an autocomplete backed by a geocoder query, see the IMC Trading location field a few
           * hundred lines below) is no less capable of lagging past 150ms than the click was. Reusing
           * settleVerified gives the post-blur read the identical up-to-500ms/eleven-read bound the
           * pre-blur read already gets, so a control that settles slowly is rescued instead of
           * being reported lost, and a control that stays answered still returns on its first poll
           * - the fixture suite below pins that this changes no existing verdict. A control that
           * empties itself on blur and stays empty for the whole window is exactly what the
           * applicant needs told, and falling through to the withdrawal below is what already
           * tells her: mark it and let the pre-submit gate hold the run rather than send it. */
          await blurDrivenChoiceControl(container, directControl);
          if (await settleVerified(() => verifyChoiceInContainer(
            container,
            expected,
            lastClickedOptionText,
            lastClickedOptionAnswer,
            lastChooserTierAnswer,
            directControl,
          ))) {
            await unmarkChoice(container);
            return true;
          }
          break;
        }
        if (elapsed < 500) await page.waitForTimeout(50).catch(() => undefined);
      }
      // withdrawRefusedChoice now gets one more look at 'expected' before it presses anything, and a
      // confirmed match there is exactly as landed as one the loop above caught. See its own comment
      // for why clearing on that path would be destroying a correct answer to report a false loss.
      return await withdrawRefusedChoice(
        container,
        lastClickedOptionText,
        lastClickedOptionAnswer,
        expected,
        directControl,
      );
    };
    /* AN ANSWER THAT IS A BUTTON, not an input.
     *
     * D-01, the fill half. Ashby renders every yes/no question as two plain buttons -
     * '<button>Yes</button><button>No</button>' - beside one input[type=checkbox] that is
     * display:none and holds the value. Nothing about that markup is an option: the buttons have no
     * role, no value and no aria-checked, and the checkbox's label is the QUESTION rather than an
     * answer. So the checkbox arm of fillByLabelText read the one input in the block, compared the
     * whole question text against "Yes", found no match, and left the control untouched. Measured on
     * production packet 245c827a: both work-eligibility questions had answers resolved from the
     * stored profile and neither reached the page. The extension's own Ashby adapter records the
     * same finding from live testing and answers these by clicking the pill.
     *
     * Scoped to ONE question's container, always. Matching a string as short as "Yes" anywhere on a
     * page is how a legal acknowledgement elsewhere on the form gets agreed to, which is the one
     * mistake here the applicant cannot undo.
     *
     * Pointer events before the click because the pills are React-controlled and a bare click can be
     * reverted by the next re-render, and the retry is gated on the selected-state signal so a press
     * that DID take is never pressed a second time and toggled back off.
     */
    const SELECTED_PILL_CLASS = /_active_|_selected_|_checked_/;
    const pickOptionPill = async (container, wanted) => {
      if (!clean(wanted)) return false;
      // Not filtered by type. A <button> with no type attribute reports type "submit" by HTML
      // default, and that is exactly what these pills are; the real submit control is excluded by
      // the text list instead.
      const pills = container.locator('button');
      const total = await pills.count();
      if (total === 0) return false;
      const ACTION_TEXT = /upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i;
      /* EVERY CANDIDATE IS READ BEFORE ANY IS TAKEN. This loop used to break on the first
       * optionMatches hit, which is bidirectional containment, so on the ordinary sponsorship and
       * work-authorisation vocabulary it took whichever line the employer rendered first. Both
       * directions of that are a false declaration under her name. The whole list now goes to
       * chooseOptionIndex, which is the same ranking the native path uses and, since the containment
       * tier came out of it, the same floor: exact or nothing.
       *
       * THE LENGTH CEILING WAS PART OF THE DEFECT AND IS RAISED, AND RAISING IT ALONE WAS NOT SAFE.
       * It was 40 characters, which is shorter than every truthful answer on this family: "I do not
       * require sponsorship now, but will in the future" is 56. It was never ranking anything, it was
       * deleting whichever candidate happened to be long, so a two-row list under the ceiling still
       * clicked the false row and a list where the ceiling hid the false row only refused by
       * accident. Measured while this was being fixed: raising the ceiling to 200 with a containment
       * tier still in place turned one of those accidental refusals into a false work-authorisation
       * declaration, because the newly admitted row was then the only containment relative on the
       * list. The ceiling now only has to exclude prose; exactness does the rest.
       */
      const texts = [];
      const eligible = [];
      for (let index = 0; index < total; index += 1) {
        const pill = pills.nth(index);
        if (!await pill.isVisible().catch(() => false)) continue;
        const text = clean(await pill.textContent().catch(() => ''));
        if (!text || text.length > 200 || ACTION_TEXT.test(text)) continue;
        texts.push(text);
        eligible.push(pill);
      }
      const chosen = chooseOptionIndex(texts, wanted);
      if (chosen === -1) {
        const near = texts.filter((text) => optionMatches(text, wanted)).length;
        return near ? refuseChoice(nearMissChoiceReason(wanted, near)) : false;
      }
      const match = eligible[chosen];
      if (!match) return false;
      const press = async () => {
        await match.evaluate((element) => {
          const options = { bubbles: true, cancelable: true, view: window };
          try { element.dispatchEvent(new PointerEvent('pointerdown', options)); } catch (error) { /* older engines */ }
          element.dispatchEvent(new MouseEvent('mousedown', options));
          element.dispatchEvent(new MouseEvent('mouseup', options));
          element.click();
        }).catch(() => undefined);
        await page.waitForTimeout(200).catch(() => undefined);
      };
      await press();
      const stuck = async () => await match.evaluate((element, source) => {
        const test = new RegExp(source);
        return test.test(String(element.className || ''))
          || element.getAttribute('aria-pressed') === 'true'
          || element.getAttribute('aria-checked') === 'true'
          || element.getAttribute('aria-selected') === 'true'
          || /^(?:on|true|active|selected|checked)$/i.test(element.getAttribute('data-state') || '');
      }, SELECTED_PILL_CLASS.source).catch(() => false);
      if (!await stuck()) await press();
      // The caller records a filled field only on a selection it can still read back, for the same
      // reason verifyChoiceInContainer exists: a press that did not take must not be reported as an
      // answer, because the required-field gate is what should then speak for it.
      return await stuck();
    };
    /* AN ANSWER THAT IS A RADIO BUTTON, and the group it is allowed to touch.
     *
     * D-02. Measured on the live Skydio Ashby form (jobs.ashbyhq.com/skydio, 2026-08-09), the same
     * board and the same four questions as production packet 13bccb2d. Ashby renders each EEO
     * question as a real radio group:
     *
     *   <fieldset><label for="_systemfield_eeoc_gender">Gender</label>
     *     <div><span><input type="radio" id="...-labeled-radio-0" name="...eeoc_gender"></span>
     *          <label for="...-labeled-radio-0">Male</label></div>
     *     ... Female, Decline to self-identify
     *
     * Two separate things were wrong and both are fixed here, because either one alone still loses
     * the answer.
     *
     *  1. THE BLOCK THE ANSWER LANDED IN WAS NOT THE QUESTION'S BLOCK. The anchor was
     *     page.getByText(text).first(), and the first element on that page containing the word
     *     "gender" is the EEO preamble - "Skydio provides equal employment opportunities ... without
     *     regard to race, color, religion, sex, gender identity ...". Its nearest ancestor holding an
     *     input is the whole self-identification SECTION, which on the measured form carries eleven
     *     radios spanning two questions: Gender's three and Race's eight. So the Race answer
     *     "Decline to self-identify" matched Gender's "Decline to self-identify" first, in DOM order,
     *     and set the GENDER control - overwriting the gender answer set moments earlier and leaving
     *     Race untouched. An answer landing on a question it was not written for is the worst outcome
     *     available here, and it was happening on every Ashby EEO block in the corpus.
     *
     *  2. THE ANSWER WAS VERIFIED AGAINST A CONTROL NOBODY HAD TOUCHED. After ticking option n, the
     *     branch fell through to verifyFilled(field), and that field is the FIRST input in the block.
     *     For any answer that is not option 0 that reads back unchecked, so a radio that WAS ticked
     *     was reported "value did not persist after fillByLabelText" - the exact line all four Skydio
     *     fields came back with. Same defect class as verifyChoiceInContainer: a verification that
     *     reads a different place from the one the value lands in turns a good fill into a reported
     *     failure.
     *
     * So the option is clicked and read back ON ITSELF, and nothing else is consulted.
     */
    const optionTextOf = async (option) => await option.evaluate((element) => {
      const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      const wrapping = element.closest('label');
      const visibleText = (node) => {
        if (!node) return '';
        if (typeof node.innerText === 'string') return node.innerText;
        return node.textContent || '';
      };
      return (visibleText(byFor) || visibleText(wrapping) || element.getAttribute('aria-label') || element.value || '').trim();
    }).catch(() => '');
    /* Ashby paints the radio with a sibling span and leaves the input itself 24x24 and clickable, so
     * check() is enough there. The label click is the fallback for boards that clip the input out of
     * the layout, where check() cannot reach it but a person clicks the words. */
    const pickRadioOption = async (scope, wanted) => {
      if (!clean(wanted)) return 'no-answer';
      const choices = scope.locator('input[type=checkbox], input[type=radio]');
      const total = await choices.count();
      // Same change as pickOptionPill, for the same reason and through the same function: every
      // option's label is read before any option is ticked. The old break-on-first-hit was
      // containment in DOM order, and an EEO or work-authorisation group is exactly where that
      // picks a neighbouring declaration.
      const texts = [];
      for (let index = 0; index < total; index += 1) {
        texts.push(await optionTextOf(choices.nth(index)));
      }
      const chosen = chooseOptionIndex(texts, wanted);
      if (chosen === -1) {
        const near = texts.filter((text) => text && optionMatches(text, wanted)).length;
        if (!near) return 'no-option';
        refuseChoice(nearMissChoiceReason(wanted, near));
        return 'near-miss';
      }
      const match = choices.nth(chosen);
      const isChecked = async () => await match.evaluate((element) => element.checked === true).catch(() => false);
      await match.check({ timeout: 5000 }).catch(() => undefined);
      if (!await isChecked()) {
        await match.evaluate((element) => {
          const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          (byFor || element.closest('label') || element).click();
        }).catch(() => undefined);
      }
      // See settleVerified's own comment: a controlled radio or checkbox can commit its checked
      // state on a render after the one the check()/label-click above dispatched into, and a single
      // read straight afterward can catch it between the two. Measured 2026-08-20 on Optiver's
      // pronoun and terms-and-conditions controls and DGA's relocation and work-authorization
      // radios: the click landed, and the one fixed-wait read this used to make (150ms, once) still
      // caught several of them mid-repaint and reported "the option was clicked and did not stay
      // selected" for an option that, a moment later, had.
      return await settleVerified(isChecked) ? 'checked' : 'not-checked';
    };
    /* THE BLOCK THAT OWNS ONE QUESTION'S OPTIONS.
     *
     * Walked up from the question's own label rather than down from a container, because the
     * container is exactly what went wrong above. fieldset, data-field-path, role=radiogroup and
     * role=group are the four ways a board says "these options belong together"; Ashby uses the first
     * two, Greenhouse and Lever use the last two, and a board that says nothing falls back to the
     * container the caller already resolved.
     */
    const questionOptionBlock = async (anchor, fallback) => {
      const block = anchor.locator(
        'xpath=ancestor-or-self::*[(self::fieldset or @data-field-path or @role="radiogroup" or @role="group"'
        + ' or contains(@class,"_fieldEntry_")) and .//input[@type="radio" or @type="checkbox"]][1]'
      ).first();
      if ((await block.count()) > 0) return block;
      return fallback;
    };
    /* Two named radio groups inside one block are TWO QUESTIONS. Radios in one question share a name
     * - that is what makes them mutually exclusive - so more than one name is proof the block is not
     * a single question, and an option list read across it can answer the wrong one. Checkboxes are
     * deliberately not counted: Greenhouse gives every checkbox in a multi-select its own name, so
     * counting them would refuse a control that is working.
     */
    const radioGroupNames = async (scope) => await scope.evaluate((element) => {
      const names = new Set();
      for (const input of element.querySelectorAll('input[type="radio"]')) {
        if (input.name) names.add(input.name);
      }
      return [...names];
    }).catch(() => []);
    // Whether a keystroke aimed at this element can still do the job it was queued for. Only ever
    // asked about Enter on a choice control: see the press branch below.
    const choiceControlIsClosed = async (target) => await target.evaluate((element) => {
      const combobox = element.getAttribute('role') === 'combobox'
        ? element
        : (element.closest('[role="combobox"]') || element.querySelector('[role="combobox"]'));
      if (!combobox) return false;
      return combobox.getAttribute('aria-expanded') !== 'true';
    }).catch(() => false);
    // A control that already holds a matching answer is left alone, and a control that holds ANY
    // answer is never emptied on the way to looking for a better one.
    //
    // A caller sends several candidate values for one control on purpose: a stored major sentence,
    // then the individual fields of study inside it, because only the page knows which of them its
    // taxonomy actually contains. That is only safe if a later, weaker candidate cannot undo an
    // earlier correct one, and until now it could, in two separate ways. Measured on the live Five
    // Rings Greenhouse form (2026-08-08), where "Discipline" was correctly set to "Computer Science"
    // and then emptied again before the run ended:
    //   1. control.fill(''). On a React Select the search box is empty whenever a value is
    //      selected, so Playwright's empty fill lands as a backspace on an empty input, and React
    //      Select's backspaceRemovesValue deletes the selected value. Verified directly: an empty fill
    //      turned "Computer Science" back into the placeholder; typing the next candidate straight
    //      in, with no empty fill first, did not.
    //   2. The clear button. The control list below deliberately includes plain buttons, and a React
    //      Select renders its "Clear selections" indicator as one, sitting inside the same container
    //      as the combobox. Clicking it wiped the answer. Verified directly on the same form.
    // This is one of the two ways '"Discipline" is required and is still empty' was reaching real
    // applications: the right answer was selected and then thrown away by a candidate that matched
    // nothing. The other is the unscoped option click documented inside fillCustomChoice below.
    /* AND \b IS THE WRONG BOUNDARY FOR A CLASS NAME, which is where these words actually live.
     *
     * '_' is a word character to a JavaScript regex, so \b does not match between '__' and 'clear'.
     * Every real clear control this runner meets is named with underscores or hyphens, and the two
     * that were checked against their own sources both failed the old pattern:
     *
     *   " select__indicator select__clear-indicator css-1xc3v61-indicatorContainer "   react-select
     *   " select2-search-choice-close "                                                select2
     *
     * The fixture that was supposed to be covering this had been written with an aria-label the real
     * widget does not have, so the pattern was being tested against a string only the fixture
     * produced. react-select's ClearIndicator carries 'aria-hidden="true"' and NO accessible name at
     * all (packages/react-select/src/components/indicators.tsx), so the class is the only thing there
     * is to match on, and this pattern could not match it.
     *
     * The boundary is therefore "not a letter or digit on either side", which treats '_' and '-' as
     * the separators they are in a class name while still refusing a word that merely starts the same
     * way: 'closest-office' does not match 'close', and 'select__control--menu-is-closed' does not
     * either. 'close' is new to the list and is select2's word for this.
     */
    const CLEAR_CONTROL_RE = /(?<![a-z0-9])(?:clear|remove|deselect|reset|close)(?![a-z0-9])/;
    // The one list of things that might OPEN a choice menu. Openers are buttons and comboboxes, which
    // is why the withdrawal above does not reuse this list: the real react-select clear is a bare
    // div and appears in none of these.
    const CHOICE_CONTROLS = '[role="combobox"], [aria-haspopup="listbox"], .select2-choice, .select2-container, [class*="select2-choice"], [class*="select2-container"], button, [role="button"]';
    // What a withdrawal may press, and it is deliberately loose because it is no longer what bounds
    // the search. The openers, plus the class-named indicators that are not controls in any
    // accessible sense, plus anything carrying a name at all so a widget that does label its clear is
    // still found. What keeps this safe is WHERE it is applied: clearChoiceControl runs it inside the
    // widget shell and nowhere else, so a destructive neighbour sitting in the same question block is
    // not a candidate however it is named. CLEAR_CONTROL_RE then decides which of these is the clear.
    const CLEAR_CONTROLS = CHOICE_CONTROLS
      + ', [class*="clear"], [class*="close"], [class*="remove"], [class*="deselect"], [class*="reset"], [aria-label], [title]';
    const fillCustomChoice = async (container, wanted, directControl = null) => {
      // Cleared on every call, so the row this function publishes can only ever be the row THIS call
      // clicked. Nothing costs an action here: reading an option's own text is a DOM read, and the
      // ceiling normalizeManagedActions enforces counts queued actions, not round trips.
      lastClickedOptionText = '';
      lastClickedOptionAnswer = '';
      lastChooserTierAnswer = '';
      // Whether this call ever got as far as OPENING something. It separates "this block holds no
      // control I can drive" from "I drove the control and its list does not carry her answer",
      // which are the same 'false' to the caller and are opposite sentences to the applicant.
      lastChoiceControlOpened = false;
      const alreadyAnswered = await readChoiceState(container);
      // Published for the withdrawal above, which has to know what "put it back" means before this
      // function has clicked anything.
      lastChoiceArrival = alreadyAnswered;
      if (alreadyAnswered.kind === 'chosen' && optionMatches(alreadyAnswered.value, wanted)) return true;
      /* A provider-owned input id can name a React Select search control even when that input has
       * no combobox role or popup attribute. In that measured Greenhouse shape, the surrounding
       * widget classes prove the control kind and the caller can pass the exact input here. Keeping
       * this explicit avoids widening CHOICE_CONTROLS to every text input inside a question. */
      const controls = directControl ?? container.locator(CHOICE_CONTROLS);
      // Wait for the menu THIS control owns, then only ever click inside it.
      //
      // The old fallback locator swept the whole page for 'li, [data-value]' and clicked the first
      // node containing the answer text. Measured live on 2026-08-08, opening Discipline on the DRW
      // and Virtu Greenhouse forms with the answer "Computer Science":
      //   DRW   clicked <li>Are pursuing a bachelor's, master's or PhD in mathematics, economics,
      //         physics, statistics, computer science or any engin...</li>
      //   Virtu clicked <li>Excellent academic background in Computer Science, Electrical
      //         Engineering or related field</li>
      // Both are bullet points in the JOB DESCRIPTION. Both made this function return true, so the
      // caller recorded the field as answered, and both controls were still showing "Select..." when
      // the employer's own validator ran. That is where '"Discipline" is required and is still empty'
      // came from on those two boards, with the right option sitting unclicked in the open menu.
      //
      // Two things went wrong together and both are fixed here. The scope was the page rather than
      // the menu; and the correctly scoped attempt was made as an instantaneous count() 150ms after
      // the click, before the menu had rendered, so the page-wide sweep was reached every time. The
      // menu now gets the same bounded grace the optional pre-check already gives asynchronous
      // controls, and there is no page-wide sweep left to fall through to.
      /* BOTH DIRECTIONS, for the same measured reason clearChoiceControl reads both. The fill
       * branch hands in '.select__input-container', so the shell is an ANCESTOR of the container;
       * fillByLabelText hands in the question's BLOCK, so the shell is a DESCENDANT, and the
       * ancestor-only read left scopedMenu unset on every combobox that arrived by label. That
       * unset scope is not a smaller version of the same behaviour, it is three behaviours gone at
       * once: waitForMenu degrades to a flat 150ms pause that the measured Greenhouse menus
       * (555-563ms) always lose, menuIsPortalled can never become true so the R-076 portalled
       * menus are unreachable, and widenRoot falls back to a container that holds no rows. On a
       * form where the backend's trimmer leaves each question ONE fillByLabelText, that one action
       * is the label path, so the highest-volume rendering lost all three exactly where no retry
       * exists. Downwards first, per the ordering note on clearChoiceControl: only a container
       * with nothing shell-shaped under it is itself part of one. */
      const shellDown = container.locator('xpath=(descendant::*[' + CHOICE_SHELL_CLASSES + '])[1]');
      const shellUp = container.locator('xpath=ancestor-or-self::*[' + CHOICE_SHELL_CLASSES + '][1]');
      const scopedMenu = (await shellDown.count()) > 0
        ? shellDown
        : ((await shellUp.count()) > 0 ? shellUp : undefined);
      /* THE MENU THE OPENED CONTROL SAYS IS ITS OWN, read off the control after it is opened and
       * never guessed. See menuRoot below for what it replaces and why.
       *
       * Set from aria-controls, falling back to aria-owns for the ARIA 1.1 spelling. The APG's
       * combobox pattern makes this the author's own statement of which element is the popup: "The
       * combobox element has aria-controls set to a value that refers to the element that serves as
       * the popup. Note that aria-controls only needs to be set when the popup is visible." Which is
       * exactly when this is read: after the click, after the menu wait.
       *
       * react-select sets it, conditionally and correctly, in its own source
       * (packages/react-select/src/Select.tsx): '...(menuIsOpen && { "aria-controls":
       * this.getElementId("listbox") })'. A widget that does NOT declare its menu simply gets no
       * page-wide arm and is handed back, which is the direction this file fails in.
       */
      let declaredMenu = null;
      const readDeclaredMenu = async (control) => {
        const owns = await control.evaluate((element) => {
          const referenced = element.getAttribute('aria-controls') || element.getAttribute('aria-owns') || '';
          const id = String(referenced).trim().split(/\s+/)[0] || '';
          if (id) return id;
          /* THE MENU NAMED BY CONVENTION INSTEAD OF BY REFERENCE. Rippling's bare div combobox
           * ('<div role="combobox" id="field-90">', measured live on ats.rippling.com, Easy
           * Dynamics, 2026-08-20) portals its popup to '<div role="listbox" id="field-90-list">'
           * and sets NO aria-controls or aria-owns anywhere, so the declared-menu read came back
           * empty, menuRoot had nowhere it was allowed to look, and the correct answer sat
           * unclicked in the open portal - R-076's exact shape, one attribute short. The {id}-list
           * suffix is the same author statement one convention over, and it is accepted only when
           * the node exists RIGHT NOW and carries role="listbox", so it can only ever name a menu,
           * never widen to an arbitrary element. */
          if (element.id) {
            const conventional = document.getElementById(element.id + '-list');
            /* Visible rows required, not just the role: a page could carry another question's
             * permanently rendered listbox under a colliding name, and a closed or empty node
             * proves nothing about THIS control. A menu that has not rendered yet simply fails
             * this read and is picked up by the next poll of waitForMenu below. */
            if (conventional && conventional.getAttribute('role') === 'listbox'
              && [...conventional.querySelectorAll('[role="option"]')]
                .some((row) => row.getClientRects().length > 0)) return element.id + '-list';
          }
          return '';
        }).catch(() => '');
        const id = String(owns).trim();
        declaredMenu = id ? page.locator('[id="' + id.replace(/["\\]/g, '\\$&') + '"]') : null;
      };
      // Anything that is genuinely part of an option list. A bare 'li' still qualifies, but only
      // inside a listbox or a select2 results panel, never loose in the page.
      const OPTION_NODES = '[role="option"], [class*="select__option"], [role="listbox"] li,'
        + ' [role="listbox"] [class*="option"], .select2-result, .select2-results li, [class*="select2-result"]';
      const optionsRoot = () => (scopedMenu ?? page).locator(OPTION_NODES);
      /* WHERE THE MENU ACTUALLY RENDERED, because a recognised shell is not proof it renders there.
       *
       * R-076, measured on the live DV Trading Greenhouse board (job-boards.greenhouse.io, the
       * Remix React UI, 2026-08-18): the graduation-range React Select carries a
       * "select-shell remix-css-...-container" ancestor, so scopedMenu is set, and it PORTALS its
       * menu to <body> in a .select__menu-portal node. Every query in this function was bounded to
       * the shell, which never holds a row, so the runner opened the control, typed the correct
       * reviewed answer into the search box, found nothing it was allowed to click, pressed Escape,
       * and the widget dropped the uncommitted text on blur. The control ended empty and the report
       * said the value did not persist. The comment that used to stand on menuRoot below called this
       * case known and unchanged; this flag is what changes it.
       *
       * True exactly when the shell holds no option nodes while the menu the OPENED control names
       * through aria-controls holds some. That menu is the author's own statement of which popup
       * belongs to this combobox (see readDeclaredMenu above), so scoping to it is not a widening:
       * it is the same one-question boundary the shell was standing in for, found where the widget
       * actually put it. Another question's rows are exactly as unreachable as before, and every
       * ambiguity guard still applies on the new root.
       */
      let menuIsPortalled = false;
      /* AND THE MENU THAT RENDERED BESIDE ITS SHELL, which is the same lesson one door over. A
       * recognised shell is not proof the menu renders inside it (that is menuIsPortalled, above),
       * and it is not proof the widget declares its menu either: Select2 v3 does neither. Its
       * .select2-container holds the chosen value and the search box, its results list renders
       * OUTSIDE it, and it says no aria-controls at all. Measured on the choice-parity Select2
       * fixture after the both-directions shell read landed: the label path now finds the shell
       * DOWN from the question block, every tier searches that shell, the shell never holds a row,
       * and "Computer Science" sits unclicked in the open list one sibling away. Before that
       * change the label path had no scopedMenu and the widened tier searched the question BLOCK,
       * which is what found the row for as long as it did.
       *
       * So a shell that holds no rows and declares no menu is no better informed than a bare
       * control, and it degrades to exactly the bare control's boundary: this question's own
       * container. That is not a widening. The container is the block the whole file already
       * treats as one question, every ambiguity guard runs unchanged on it, and another question's
       * rows remain exactly as unreachable as before. */
      let menuIsBesideShell = false;
      const readMenuPortal = async () => {
        menuIsPortalled = Boolean(scopedMenu && declaredMenu)
          && (await scopedMenu.locator(OPTION_NODES).count()) === 0
          && (await declaredMenu.locator(OPTION_NODES).count()) > 0;
        menuIsBesideShell = Boolean(scopedMenu) && !menuIsPortalled
          && (await scopedMenu.locator(OPTION_NODES).count()) === 0
          && (await container.locator(OPTION_NODES).count()) > 0;
      };
      // Bounded, and only spent where it can buy something. With a recognisable widget the wait is
      // for THAT widget's own menu and ends the moment it renders. With no recognisable widget there
      // is nothing specific to wait for, so this keeps the old flat pause rather than charging every
      // control on the form the full timeout for a menu that was never coming.
      //
      // Polled over BOTH places the widget's menu can be, re-reading the declared menu each pass
      // because aria-controls is only required to exist while the popup is visible: a shell whose
      // widget portals its menu never renders a row inside itself, and waiting on the shell alone
      // charged the portalling control the full timeout for a menu that was already open on the
      // page. See menuIsPortalled above for the measured case.
      const waitForMenu = async (control, timeout) => {
        if (!scopedMenu) {
          /* A bare control has no shell to watch, but it can still NAME its menu - by reference,
           * or by the {id}-list convention that only reads true once the popup has visible rows.
           * The flat 150ms pause was measured too short for exactly the widgets this matters on
           * (this file's own Greenhouse async menus arrive at 555-563ms), and the choosers below
           * never re-read, so a menu that rendered at 500ms was simply lost. Poll the declared
           * read on the same cadence as the shelled branch, bounded by the same deadline. */
          const bareDeadline = Date.now() + timeout;
          for (;;) {
            await readDeclaredMenu(control);
            if (declaredMenu
              && await declaredMenu.locator(OPTION_NODES).first().isVisible().catch(() => false)) return;
            if (await container.locator(OPTION_NODES).first().isVisible().catch(() => false)) return;
            if (Date.now() >= bareDeadline) return;
            await page.waitForTimeout(50).catch(() => undefined);
          }
        }
        const deadline = Date.now() + timeout;
        for (;;) {
          if (await optionsRoot().first().isVisible().catch(() => false)) return;
          await readDeclaredMenu(control);
          if (declaredMenu
            && await declaredMenu.locator(OPTION_NODES).first().isVisible().catch(() => false)) return;
          // The third place the widget's menu can be: beside its shell, inside the question's own
          // block. Select2 v3 renders there and declares nothing, so without this check that shape
          // paid the full timeout for a menu that was already open. See menuIsBesideShell.
          if (await container.locator(OPTION_NODES).first().isVisible().catch(() => false)) return;
          if (Date.now() >= deadline) return;
          await page.waitForTimeout(50).catch(() => undefined);
        }
      };
      /* THE NAME OF AN OPTION IS COMPUTED BY PLAYWRIGHT, NEVER BY THIS FILE.
       *
       * An earlier attempt at the fix below read the rows itself, as textContent with aria-label and
       * title behind it, and compared them with normalized(). Every one of those two decisions was
       * wrong, and each produced its own defect:
       *   - the accessible name is aria-labelledby, then aria-label, then content, then title. A row
       *     reading '<div role="option" aria-label="Bachelor s Degree">BS</div>' is named
       *     "Bachelor's Degree" and looks like "BS" to a textContent read, and a row named only by
       *     aria-labelledby has no text at all;
       *   - normalized() keeps only [a-z0-9], so a stored "C++" becomes "c", which is a substring of
       *     "computer science"; "C++" and "C#" become the same string; and a stored "はい" becomes
       *     the empty string and matches nothing at all, on exactly the non-Latin forms the sibling
       *     commit exists to support;
       *   - and enumerating the rows through OPTION_NODES, a CSS selector, sees aria-hidden rows
       *     that the role engine correctly refuses, so an aria-hidden ghost duplicate can win on DOM
       *     order and swallow the click.
       * Re-deriving the accessible name by hand is a losing game. Every tier below is a Playwright
       * role query, so the name is computed by the same engine that computed it before this change.
       */
      const clickIfPresent = async (locator) => {
        const first = locator.first();
        if ((await first.count()) === 0) return false;
        if (!await first.isVisible().catch(() => false)) return false;
        lastClickedOptionText = clean(await first.textContent().catch(() => ''));
        await first.click();
        return true;
      };
      /* NEVER THE PAGE. The widest this can be is a menu the opened control DECLARED it owns.
       *
       * Bounding the exact tier to the question's own block first, and reaching wider only when the
       * block offered nothing, was not enough, and the reasoning that said it was is worth keeping
       * because it is a nice-sounding piece of nonsense: "a question whose own block holds no rows
       * is exactly the shape a portal produces". True, and it is ALSO exactly the shape of a question
       * that simply does not offer her answer. The two are indistinguishable from inside the block,
       * so the fallback fired on both.
       *
       * Measured in Chromium: Q1 an always-rendered background-check consent listbox offering
       * Yes / No, Q2 a button combobox whose menu is portalled to <body> and offers only "Maybe" and
       * "Prefer not to say", one action asking for Q2 = "No". Q2's block holds no rows, so the
       * fallback ran, and the only "No" on the page was Q1's. Q1 came back holding "No". The submit
       * gate stopped the run, so nothing false was filed, but a consent she never gave was ticked on
       * the form, the withdrawal and its mark are bound to Q2's container so neither could reach it,
       * and no line in the report named Q1 at all. The skip line then sends her to finish the form by
       * hand, on a form carrying a consent she did not give.
       *
       * So the fallback is not "the page". It is the element the control names through aria-controls,
       * which is the author's own statement of which popup belongs to this combobox and is required
       * to be present exactly while the popup is visible. A portalled menu is still reached, because
       * a portalling widget has to name its menu to be operable at all; a control that names nothing
       * loses the wider arm and is handed back. Q1's rows are no longer reachable from Q2 by any
       * query, which is the property that was missing.
       *
       * A React Select that portals its menu has a shell ancestor, so scopedMenu is set, and the
       * shell does not contain the portalled menu. That control used to be handed back from here,
       * which on the live Greenhouse Remix boards is R-076: the shell wins, holds no rows, and the
       * correct answer sits unclicked in the open portal. menuIsPortalled (above) detects exactly
       * that shape after the control is opened, and hands BOTH roots the menu the control itself
       * declared, which is the same author-stated one-question boundary this comment defends.
       */
      const menuRoot = () => (menuIsPortalled
        ? declaredMenu
        : (menuIsBesideShell ? container : scopedMenu ?? declaredMenu));
      /* THE SAME ROOT, BOUNDED, FOR ANYTHING THAT IS NOT AN EXACT MATCH.
       *
       * scopedMenu is only ever set for a React Select or a Select2, so menuRoot() falls back to the
       * whole PAGE for every other control, and a widened query against the whole page is a query
       * for "some row, anywhere, that contains her answer". That is how a job-description bullet got
       * clicked before the menu scoping landed, and the rule that was removed above ran page-wide
       * against fragments of her answer on Ashby and Workday, where nothing sets scopedMenu.
       *
       * AN EXACT NAME IS NOT SAFE TO LOOK FOR WIDELY EITHER, and the comment that used to stand here
       * said it was. It read: "a row named exactly her answer is her answer wherever it is rendered".
       * That is false on every form that asks two questions with the same rows, which is every form
       * carrying a Yes/No pair. Measured in Chromium: Q1 an always-rendered background-check consent
       * listbox offering Yes / No, Q2 a button combobox for sponsorship offering Yes / No, one action
       * asking for Q2 = "No". The page-wide exact query matched Q1's row first, clickIfPresent takes
       * .first(), and the run ticked a consent it was never asked about while leaving the question it
       * WAS asked about empty and reporting that question filled. Changing Q1's rows to "Yes, I
       * consent" / "No, I do not consent" so the exact tier cannot fire made the same run answer Q2
       * correctly and leave Q1 alone, which isolates the wide query as the mechanism.
       *
       * So exactness is looked for in THIS question's own block first, and anything wider is reached
       * only when the block offers nothing at all AND the control named its own menu. See menuRoot
       * above for why "the block offered nothing" was not on its own a safe reason to look further.
       *
       * The ambiguity guard on the wider arm is not sufficient on its own and is not what makes this
       * safe. Two questions sharing a "No" is routine, so a guard alone would refuse controls that
       * work today; the scoping is what makes the refusal rare and the answer right.
       */
      const widenRoot = () => (menuIsPortalled
        ? declaredMenu
        : (menuIsBesideShell ? container : scopedMenu ?? container));
      /* WHICH OF THE MATCHED NODES ARE ROWS THE MENU IS OFFERING, and it is not all of them.
       *
       * The ambiguity guards below refuse a tier that offers two, so counting NODES rather than rows
       * would refuse controls that are working, and clicking .first() of the nodes would click
       * something that is not a row at all. Select2 v3 is the case that forces this, and it is in
       * OPTION_NODES because Greenhouse serves it:
       *
       *   <ul class="select2-results">
       *     <li class="select2-result"><div class="select2-result-label">Computer Science</div></li>
       *     <li class="select2-result"><div class="select2-result-label">Economics</div></li>
       *
       * '[class*="select2-result"]' matches the LIST, every row, and every row's own label. Measured
       * on this markup: a hasText query matched three nodes for one answer, the first of them was the
       * whole list, and clicking it landed on whichever row happened to sit under the list's centre
       * point. That is the row-by-position defect wearing different clothes, and it predates the
       * ambiguity guard.
       *
       * Two rules, and between them they name the row:
       *   - a match that holds another match saying something DIFFERENT is a container of rows and
       *     is not itself an offer;
       *   - a match whose ancestor match says exactly the SAME thing is that ancestor's own label
       *     rather than a second offer, so the OUTERMOST of an identical chain is what is returned.
       *     On a one-row Select2 list that is the <ul> and not the <li>, which is correct to click
       *     because a one-row list is entirely its row, and is worth knowing rather than assuming.
       * Hidden nodes are dropped first, and 'hidden' has to mean all three ways a duplicate hides:
       * display:none has no client rects, visibility:hidden HAS them, and a zero-size measurement
       * node has a rect of zero area. Testing rect count alone counted the last two as offers and
       * refused controls that were working, which is the failure this helper exists to prevent.
       *
       * WHAT IT STILL CANNOT SEE, said plainly rather than claimed away: a VIRTUALISED menu only
       * renders the rows in view, so a second near match scrolled out of the viewport is not in
       * 'nodes' at all and the guard above cannot fire for it. This helper counts what the page has
       * rendered, and on a virtualised list that is a floor and not a total. React Select virtualises
       * only above a row threshold most employer question menus never reach, and the tiers that lead
       * here are anchored on the answer rather than on position, but a long virtualised taxonomy is
       * a list where a widened tier can still take one of two.
       * Indices are returned rather than a count so the caller clicks the row it counted.
       */
      const offeredRows = async (rows) => await rows.evaluateAll((nodes) => {
        const textOf = (node) => (node.textContent || '').replace(/\s+/g, ' ').trim();
        const shown = (node) => {
          if (node.closest('[aria-hidden="true"]')) return false;
          const view = node.ownerDocument && node.ownerDocument.defaultView;
          if (view && view.getComputedStyle(node).visibility === 'hidden') return false;
          return [...node.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
        };
        const live = nodes.filter(shown);
        return live.filter((node) => {
          if (live.some((other) => other !== node && node.contains(other) && textOf(other) !== textOf(node))) return false;
          return !live.some((other) => other !== node && other.contains(node) && textOf(other) === textOf(node));
        }).map((node) => nodes.indexOf(node));
      }).catch(() => []);
      const escapeName = (value) => String(value).replace(/[.*+?^{}()|[\]\\$]/g, '\\$&');
      // A whole-name match, case-insensitive. Playwright's own exact:true is case SENSITIVE, and an
      // employer who prints "COMPUTER SCIENCE" is spelling the same answer. Matches here are a
      // strict subset of the inexact query on the very same string, so this can only choose a
      // different row among rows that were already acceptable. It cannot reach a new one.
      const wholeName = (option) => new RegExp('^\\s*' + escapeName(option) + '\\s*$', 'i');
      /* THE SAME WHOLE-NAME MATCH, WITH THE EMPLOYER'S PUNCTUATION FORGIVEN, and it is the tier that
       * was missing.
       *
       * wholeName is a literal, so it asks the employer to have typed the answer character for
       * character. The other three renderings do not: chooseOptionIndex normalises punctuation away
       * before comparing, so a stored "I do not require sponsorship now, but will in the future"
       * reaches an employer's row written without the comma on a native select, a radio group and a
       * pill row, and missed it on the React Select. That miss was not a refusal. It fell through to
       * the widened tiers, whose query still carries the comma, and then to the shorter-name rule,
       * which clicked "I do not require sponsorship". One character of employer punctuation flipped
       * the answer on the highest-volume Greenhouse rendering.
       *
       * Built as a pattern rather than by reading the rows, because the row's NAME is Playwright's
       * to compute: see clickIfPresent for the five defects that reading them here produced. The
       * pattern accepts exactly what normalized() equality accepts, its own alphanumeric words in
       * order with any run of non-alphanumerics between them, so this tier and chooseOptionIndex's
       * normalised tier are the same rule expressed twice for two different engines.
       *
       * An answer with no [a-z0-9] in it at all, which is every non-Latin answer, produces no pattern
       * and is skipped: the literal tier above already matches those exactly, and a pattern built
       * from nothing would match everything.
       */
      const looseWholeName = (option) => {
        const words = normalized(option).split(' ').filter(Boolean);
        if (!words.length) return null;
        return new RegExp('^[^a-z0-9]*' + words.map(escapeName).join('[^a-z0-9]+') + '[^a-z0-9]*$', 'i');
      };
      /* THE WIDENED TIER, FOR AN ANSWER normalized() CANNOT SEE, AND WHY IT IS A DIFFERENT QUERY.
       *
       * The widened tier below asks Playwright for a row whose name CONTAINS the answer. In Latin
       * that is survivable and load-bearing: it is how a stored "Yes" reaches "Yes, I am authorized
       * to work in the United States", and how "United Arab Emirates" reaches the row
       * "United Arab Emirates +971" that 43 of 45 stored reports turn on.
       *
       * On Chinese, Japanese and Korean it is the defect. Those languages negate with a bound prefix
       * or a trailing auxiliary, so the row that says the OPPOSITE of the answer contains the answer:
       * 不需要工作签证担保 contains 需要工作签证担保. A substring query matches exactly one row, the
       * ambiguity guard sees nothing to guard, and the runner clicks the negation and reports it
       * filled. Measured in Chromium on four languages before this change.
       *
       * So for an answer that normalises away, the row may carry EXTRA MATERIAL BUT NO EXTRA
       * LETTERS. That keeps the one case the widening exists for, a dial code or a code in brackets
       * appended to the answer, and refuses the one that reverses it, because every negator in these
       * scripts is a letter. It is expressed as a pattern rather than by reading the rows, for the
       * same reason every other tier here is: the row's name is Playwright's to compute.
       */
      const paddedWholeName = (option) => new RegExp(
        '^[^\\p{L}]*' + escapeName(clean(option)) + '[^\\p{L}]*$', 'iu'
      );
      const clickMatchingOption = async (target) => {
        const took = (option) => { lastClickedOptionAnswer = clean(option); return true; };
        /* EXACT FIRST, ACROSS THE WHOLE LIST AND ACROSS EVERY ANSWER, before any widened tier runs.
         *
         * This used to interleave: for one answer it tried exact, then the two widened queries, and
         * only then moved to the next answer. So a row named exactly "I agree" lost to a row merely
         * containing "Yes", which is DOM position deciding a declaration again, one level up from
         * the case below. chooseOptionIndex ranks the native path the same way and this is the same
         * ranking: her own words first, then the authorised restatements in order, and inside one
         * rank the whole list is searched before anything looser is considered.
         *
         * The rows themselves are still named by Playwright and never by this file: see the comment
         * on clickIfPresent for the five defects that reading them here produced. wholeName is
         * exactness expressed as a role query, and it is not vulnerable to the normalise collision
         * chooseOptionIndex has to guard against, because it never normalises: "10+" and "10" are
         * two different names to the role engine.
         */
        /* THIS QUESTION'S OWN BLOCK FIRST, AND THE CONTROL'S OWN DECLARED MENU AFTER THAT. See the
         * comments on menuRoot and widenRoot for the two measurements behind that order: a page-wide
         * exact query answered a different question than the one it was asked about, and the harm
         * class is the one this file calls the worst outcome available here, a consent ticked under
         * her name that nobody asked for.
         *
         * Both arms count offered rows before clicking, because even a declared menu can hold two
         * rows of one name and .first() would pick between them by DOM order. Two rows named exactly
         * the same thing inside ONE block is a different situation from two anywhere else, but it is
         * refused in both places: inside one block it means the block holds two questions, which is
         * the shape D-02 already refuses everywhere else in this file.
         *
         * THREE VERDICTS AND NOT TWO, because "no row anywhere is named this" and "the rows named
         * this cannot be told apart" have to travel differently: the first moves on to the next
         * answer and then to the widened tiers, the second ends the whole attempt with a sentence,
         * exactly as the widened tiers below already end it. Returning a bare false conflated them
         * and would have let a refusal fall through into a looser rule. */
        const takeNamed = async (name, option) => {
          const own = widenRoot().getByRole('option', { name });
          const mine = await offeredRows(own);
          if (mine.length > 1) { refuseChoice(nearMissChoiceReason(option, mine.length)); return 'refused'; }
          if (mine.length === 1) return await clickIfPresent(own.nth(mine[0])) ? 'took' : 'none';
          // No declared menu means there is nowhere wider this is allowed to look. See menuRoot.
          const wide = menuRoot();
          if (!wide) return 'none';
          const anywhere = wide.getByRole('option', { name });
          const offers = await offeredRows(anywhere);
          if (offers.length === 0) return 'none';
          if (offers.length > 1) { refuseChoice(nearMissChoiceReason(option, offers.length)); return 'refused'; }
          return await clickIfPresent(anywhere.nth(offers[0])) ? 'took' : 'none';
        };
        for (const option of answerOptions(target)) {
          const verdict = await takeNamed(wholeName(option), option);
          if (verdict === 'took') return took(option);
          if (verdict === 'refused') return false;
        }
        /* THE SAME TWO ROOTS IN THE SAME ORDER for the punctuation-tolerant name, and for the same
         * reason: this tier is exactness with the employer's commas forgiven, so a wide query here
         * reaches another question's rows exactly as the literal one did. It already refused a page
         * offering two, which is what kept it out of the measurement above; refusing is not
         * answering, and a question whose own block holds its rows should be answered from them. */
        for (const option of answerOptions(target)) {
          const pattern = looseWholeName(option);
          if (!pattern) continue;
          /* THE SAME COLLISION REFUSAL chooseOptionIndex makes, for the same reason and at the same
           * point. Forgiving punctuation is what makes "C++", "C#" and "C" one pattern, so a menu
           * offering two of them has been asked a question this tier cannot answer, and the literal
           * tier above has already had its chance to settle it. */
          const verdict = await takeNamed(pattern, option);
          if (verdict === 'took') return took(option);
          if (verdict === 'refused') return false;
        }
        /* THEN THE WIDENED TIERS, AND A WIDENED TIER MAY NOT GUESS.
         *
         * These are the two queries that shipped, in the order they shipped, and both ask the same
         * thing: is there a row that CONTAINS this answer. What they did not ask is how many, and
         * clickIfPresent takes .first(). Measured: a stored "I am authorized to work in the United
         * States" against a menu offering "I am authorized to work in the United States for any
         * employer" and "I am authorized to work in the United States only with a student visa"
         * matched both and clicked the first, which is a false work-authorisation declaration
         * decided by the employer's rendering order.
         *
         * So a widened tier is used only when the menu offers exactly one row, and two rows end the
         * whole attempt rather than falling through to a looser rule: a menu that is ambiguous under
         * containment is not made less ambiguous by asking it something vaguer. Exactly the refusal
         * the shorter-name rule below already made, applied to the tiers above it.
         */
        for (const option of answerOptions(target)) {
          // Two substring queries for an answer normalising can judge, and one padded-name query for
          // an answer it cannot. See paddedWholeName: on a script where the negation of an answer
          // contains the answer, a substring query is a query for the opposite of what was asked.
          const queries = normalized(option)
            ? [
              widenRoot().getByRole('option', { name: option, exact: false }),
              widenRoot().locator(OPTION_NODES).filter({ hasText: option })
            ]
            : [widenRoot().getByRole('option', { name: paddedWholeName(option) })];
          for (const rows of queries) {
            const offers = await offeredRows(rows);
            if (offers.length === 0) continue;
            if (offers.length > 1) return refuseChoice(nearMissChoiceReason(option, offers.length));
            if (await clickIfPresent(rows.nth(offers[0]))) return took(option);
          }
        }
        /* THE RULE THAT USED TO RUN LAST, AND WHY IT IS GONE INSTEAD OF GUARDED.
         *
         * It clicked a menu row named by a contiguous run of the answer's own words, so that an
         * employer offering "Bachelor's Degree" against a stored "Bachelor's Degree in Computer
         * Science" could be answered. Its guard was the same two-rows refusal every tier above has.
         *
         * That guard cannot fire on the case that matters, and this is the whole reason it is
         * removed rather than tightened. The guard needs TWO runs on the menu; the dangerous shape
         * is a menu that simply does not offer her full answer, where exactly one run matches:
         *
         *   stored: "No, I do not require sponsorship now, but will in the future"
         *   menu:   "No, I do not require sponsorship" / "Yes, I require sponsorship now"
         *
         * Measured in Chromium: one run matched, it was clicked, optionMatches' third clause then
         * verified it, and the field was reported filled. The prefix is the exact reversal of the
         * answer. Same shape for "I am authorized to work" against a stored "I am authorized to
         * work only with a student visa".
         *
         * There is no structural test that separates that from the degree case, because they are
         * the same structure: a prefix run of the answer with the remainder dropped. What differs is
         * whether the dropped remainder was material, and "now, but will in the future" is material
         * by definition while "in Computer Science" is not. Deciding that here would mean a list of
         * qualifying words, which fails OPEN on every word not on the list, on the one family where
         * failing open is a false legal declaration.
         *
         * So the reach goes. A menu that offers only a part of her answer is handed back, which is
         * what this function does with false, and which is what it did before this rule was added.
         */
        return false;
      };
      /* REAL ROWS, NOT THE WIDGET TELLING HER THERE ARE NONE.
       *
       * OPTION_NODES' loose class match ('[class*="option"]') is right for every existing caller,
       * which only ever runs it against a menu that already has at least one real row to find. It
       * is wrong for a caller whose whole question is "are there zero": react-select's own empty
       * state renders as '<div class="select__menu-notice select__menu-notice--no-options">No
       * options</div>', and "no-options" contains the substring "option". Measured directly against
       * this exact fixture shape: unfiltered, OPTION_NODES counted that notice as one offered row,
       * so a query that returned genuinely nothing read back as "found one option" and the narrowed
       * retry below never ran at all. This drops any offered row whose own class name contains
       * "notice" without narrowing OPTION_NODES itself, which every other tier in this file still
       * depends on staying exactly as loose as it is. Indices are returned, not a count, for the
       * same reason offeredRows returns them: the caller that wants the ONE surviving row still
       * needs to say which one. */
      const realOfferedRows = async (root) => {
        const rows = root.locator(OPTION_NODES);
        const shown = await offeredRows(rows);
        if (shown.length === 0) return { rows, indices: shown };
        const isNotice = await rows.evaluateAll(
          (nodes, indices) => indices.map((index) => /\bnotice\b/i.test(nodes[index].className || '')),
          shown,
        ).catch(() => shown.map(() => false));
        return { rows, indices: shown.filter((_, position) => !isNotice[position]) };
      };
      /* HOW MANY ROWS THE MENU IS OFFERING RIGHT NOW, unfiltered by name - the same primitive
       * chooseFromOfferedRows uses, reused here for a narrower question: not "which row matches",
       * only "did the search return anything at all". Scoped to menuRoot() for the reason menuRoot
       * exists: an unscoped query on the live Optiver form returns the phone-country picker's 244
       * permanently-rendered rows, which is not "the search returned results". */
      const renderedRowCount = async () => {
        const root = menuRoot();
        if (!root) return 0;
        return (await realOfferedRows(root)).indices.length;
      };
      /* A REMOTE-SEARCHED FIELD'S ZERO IS A DIFFERENT FACT FROM A CLOSED LIST'S ZERO.
       *
       * Every other tier in this file treats "the menu offers nothing named this" as the question
       * having no such option, correctly, because a closed list (a country dropdown, a Yes/No pair,
       * a school picker) is exhaustive: what it does not offer does not exist on the form. A
       * server-searched location field is not exhaustive - it is a live geocoder answering ONE
       * query string - so a stored answer written for a different kind of field can be a real place
       * and still return nothing, because the QUERY was never one the geocoder resolves.
       *
       * Measured live on IMC Trading's Greenhouse form, 2026-08-20: her stored city answer is
       * "Dubai, U.A.E." - correct and required verbatim on every plain free-text city field - and a
       * real Google-Places-backed combobox returns ZERO results for that exact string. The same
       * field returns "Dubai, United Arab Emirates" as its first and only result for "Dubai" alone.
       * The country abbreviation is not a spelling difference the matching tiers below can forgive;
       * it is a query the geocoder never runs.
       *
       * SCOPED AS NARROWLY AS THE EVIDENCE ALLOWS. This fires only when the untouched typed value
       * produced a menu with LITERALLY NOTHING in it - never when rows exist but none match, which
       * is clickMatchingOption's job and must not be pre-empted by a query rewrite. It only tries
       * the text before the first comma, once, and only when a comma is present: "Yes, I agree" and
       * a stored discipline with a comma in it never reach this branch, because a real consent or
       * taxonomy list is closed and a genuine zero there means what it always meant. And it takes
       * the result ONLY if narrowing produces EXACTLY ONE row, whose own text confirms it opens with
       * the city she actually typed - the geocoder's own single answer to the only query that could
       * ever have worked, not a guess among several candidates. */
      const takeNarrowedGeocodeMatch = async (control, option) => {
        if (!option.includes(',')) return false;
        if ((await renderedRowCount()) !== 0) return false;
        const city = option.slice(0, option.indexOf(',')).trim();
        if (!city) return false;
        await control.fill(city).catch(async () => {
          await page.keyboard.press('Control+A').catch(() => undefined);
          await page.keyboard.press('Backspace').catch(() => undefined);
          await page.keyboard.type(city, { delay: 5 }).catch(() => undefined);
        });
        await page.waitForTimeout(1200).catch(() => undefined);
        await readDeclaredMenu(control);
        await readMenuPortal();
        const root = menuRoot();
        if (!root) return false;
        const { rows, indices: offers } = await realOfferedRows(root);
        if (offers.length !== 1) return false;
        const rowText = clean(await rows.nth(offers[0]).textContent().catch(() => ''));
        if (!rowText || !rowText.toLowerCase().startsWith(city.toLowerCase())) return false;
        if (!await clickIfPresent(rows.nth(offers[0]))) return false;
        /* BOTH PROVENANCE VARIABLES, never just one - the same pair chooseFromOfferedRows sets for
         * its own list-shaped tiers (a band, a sole consent row, a date component), because this is
         * that same shape: the clicked row's text ("Dubai, United Arab Emirates") does not, and
         * structurally cannot, contain the stored answer's text ("Dubai, U.A.E.") the way an
         * ordinary name-tier click's row does. verifyChoiceInContainer's chosen-path acceptance for
         * that shape is gated on chooserTierAnswer specifically (see its own comment: "the
         * provenance travels in chooserTierAnswer and is '' for every name-tier click") - setting
         * only lastClickedOptionAnswer, as an ordinary name-tier commit does, would leave this
         * click correctly made and then WITHDRAWN by the verifier for not containing text it was
         * never going to contain. */
        lastClickedOptionAnswer = clean(option);
        lastChooserTierAnswer = clean(option);
        return true;
      };
      const searchFor = async (control, target) => {
        for (const option of answerOptions(target)) {
          // Only blank the search box when the widget is holding nothing. See (1) above.
          if ((await readChoiceState(container)).kind !== 'chosen') {
            await control.fill('').catch(() => undefined);
          }
          await control.fill(option).catch(async () => {
            await page.keyboard.press('Control+A').catch(() => undefined);
            await page.keyboard.press('Backspace').catch(() => undefined);
            await page.keyboard.type(option, { delay: 5 }).catch(() => undefined);
          });
          // A flat settle here rather than waitForMenu: after typing, the menu is usually ALREADY
          // showing the pre-filter list, so waiting for "a visible option" would return instantly and
          // match against rows the search is about to replace.
          await page.waitForTimeout(1200).catch(() => undefined);
          // Typing is what makes some widgets render a menu at all, so where that menu landed is
          // re-read after the settle: a server-searched React Select that portals shows its first
          // rows only now, and the portal verdict taken before typing would still say false.
          await readDeclaredMenu(control);
          await readMenuPortal();
          if (await takeNarrowedGeocodeMatch(control, option)) return true;
          const refusalsBefore = choiceRefusals;
          if (await clickMatchingOption(target)) return true;
          // And a refusal ends the search too, rather than being narrowed away by the next query.
          // See the control loop below for the shape this closes.
          if (choiceRefusals !== refusalsBefore) return false;
        }
        return false;
      };
      /* THE TIERS THAT JUDGE THE LIST, NOT THE ROW, run over the control's own menu.
       *
       * clickMatchingOption asks Playwright's role engine about one row at a time, and that is the
       * right instrument for every tier that matches the answer against a row's NAME. It cannot ask
       * the questions chooseOptionIndex's widened tiers ask, because those are properties of the
       * WHOLE list: soleOptionIndex is a length check, gradedBandIndex needs every band and the
       * list's own ceiling, dateComponentIndex needs to know its hit is unique. So the same chooser
       * the native select, radio and pill renderings already share runs here over the menu's
       * offered rows, which closes the one rendering it never reached. Measured live on the
       * Optiver Greenhouse form 2026-08-19: "I consent to the above." is a react-select whose
       * single statement row a stored "Yes" can never name-match, so the one protected
       * fillByLabelText the backend's trimmer leaves each question on a 14-question form opened
       * the control, matched nothing, and committed nothing, while the answer sat in the packet.
       *
       * THE ROWS ARE READ AS RENDERED TEXT, and that is a deliberate, bounded exception to the
       * rule on clickIfPresent. The name-shaped defects that rule lists cannot reprice these
       * tiers: chooseOptionIndex refuses every ambiguity it can see (two rows normalising to the
       * answer, two candidate bands, two date parts, two differently-worded refusals, and ANY list
       * of two under soleOptionIndex), offeredRows has already dropped hidden and aria-hidden
       * nodes, and choiceLanded still reads the committed value back afterwards. A row whose text
       * misleads is therefore refused or withdrawn, never resolved by position.
       *
       * AND ONLY EVER OVER menuRoot() - the control's own shell, or the menu the opened control
       * declared through aria-controls - never the container and never the page. An unscoped
       * [role="option"] on the live Optiver form returns 244 nodes, because Greenhouse renders the
       * phone-country picker's full country list permanently; a chooser handed that list would be
       * choosing among countries.
       *
       * ONLY EVER ON THE UNFILTERED MENU. searchFor types into the widget, and a filtered list can
       * offer one row where the full list offered two: under soleOptionIndex that is not a
       * narrowed ambiguity, it is a fabricated one-option control, and an affirmative answer would
       * then commit whichever statement happened to survive the filter. So the control loop runs
       * this once, after the name tiers and before any typing, and searchFor never re-enters it. */
      const chooseFromOfferedRows = async (wanted) => {
        const root = menuRoot();
        if (!root) return false;
        const rows = root.locator(OPTION_NODES);
        const offers = await offeredRows(rows);
        if (offers.length === 0) return false;
        const texts = [];
        for (const index of offers) {
          texts.push(clean(await rows.nth(index).textContent().catch(() => '')));
        }
        const chosen = chooseOptionIndex(texts, wanted);
        if (chosen === -1) return false;
        if (!await clickIfPresent(rows.nth(offers[chosen]))) return false;
        lastClickedOptionAnswer = clean(wanted);
        lastChooserTierAnswer = clean(wanted);
        return true;
      };
      const total = await controls.count();
      for (let index = 0; index < total; index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        // See (2) above. A control whose job is to erase the answer can never be the control that
        // sets it, so there is nothing to lose by never touching it.
        const clears = await control.evaluate((element) => {
          const hay = ['aria-label', 'title', 'class', 'data-testid', 'name']
            .map((attribute) => element.getAttribute(attribute) || '')
            .join(' ')
            .toLowerCase();
          return hay;
        }).catch(() => '');
        if (CLEAR_CONTROL_RE.test(clears)) continue;
        lastChoiceControlOpened = true;
        await control.click().catch(() => undefined);
        // Sized on measurement, not a guess: on a live Greenhouse education form the asynchronously
        // loaded School and Discipline menus arrived 563ms and 555ms after the control was touched.
        // The old flat 150ms expired before either, which is how the page-wide sweep was reached.
        await waitForMenu(control, 1200);
        // Read AFTER the wait, because aria-controls is only required to be there while the popup is
        // visible and react-select adds it from the same state that renders the menu.
        await readDeclaredMenu(control);
        await readMenuPortal();
        const refusalsBefore = choiceRefusals;
        if (await clickMatchingOption(wanted)) return true;
        /* A REFUSAL ENDS THE CONTROL, not just the tier that made it. Without this, searchFor typed
         * into the widget and re-entered the whole tier stack against a menu the search had filtered,
         * and a filtered menu can offer one row where the full menu offered two: the ambiguity that
         * caused the refusal gets narrowed away and the row it was protecting her from gets clicked.
         * Nothing measured had reached that, and it is closed here because it is one line and the
         * alternative is finding out. The next control in the loop is skipped for the same reason:
         * one question is being answered, and a refusal is this function's answer for it. */
        if (choiceRefusals !== refusalsBefore) {
          await page.keyboard.press('Escape').catch(() => undefined);
          return false;
        }
        // The list-shaped tiers, on the menu the click just opened and before any typing filters
        // it. See chooseFromOfferedRows for why this must not run again after searchFor types.
        if (await chooseFromOfferedRows(wanted)) return true;
        if (await searchFor(control, wanted)) return true;
        if (choiceRefusals !== refusalsBefore) {
          await page.keyboard.press('Escape').catch(() => undefined);
          return false;
        }
        await page.keyboard.press('Escape').catch(() => undefined);
      }
      // Belt and braces for anything the two rules above did not anticipate: if this control was
      // answered when we arrived and is not answered now, put the answer back. A candidate that
      // matched nothing must leave the form exactly as it found it.
      if (alreadyAnswered.kind === 'chosen') {
        const now = await readChoiceState(container);
        if (now.kind !== 'chosen') {
          for (let index = 0; index < total; index += 1) {
            const control = controls.nth(index);
            if (!await control.isVisible().catch(() => false)) continue;
            await control.click().catch(() => undefined);
            await page.waitForTimeout(150).catch(() => undefined);
            if (await searchFor(control, alreadyAnswered.value)) break;
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        }
      }
      return false;
    };
    // THE PRE-SUBMIT GATE.
    //
    // Reads the form the way the EMPLOYER's own validator reads it, immediately before the final
    // click, and separates two things that look identical in a screenshot:
    //
    //   1. a required control that is genuinely still empty. This must stop the submit. Pressing
    //      submit here either bounces off client-side validation or, worse, sends an application
    //      with blank answers under the applicant's name.
    //   2. error text left over from an EARLIER validation pass. Measured on the live Redwood
    //      Materials Greenhouse form on 2026-08-08: one stray Enter ran the employer's validator
    //      while the form was half filled, six "is required" messages rendered, and not one of them
    //      cleared when the fields were subsequently filled correctly - "Phone is required." was
    //      still on screen underneath a filled phone number, and the four React Selects still said
    //      "This field is required." underneath their correct answers. Submitting that form then
    //      passed validation cleanly with zero errors.
    //
    // So error TEXT alone is never a reason to refuse. A message blocks only when the control it
    // belongs to is also empty. Refusing on text alone would have thrown away a complete, correct
    // application, which is the same harm as sending a broken one and harder to notice.
    /* ─── the emailed security code ───────────────────────────────────────────────────────────
     *
     * Greenhouse answers an unauthenticated applicant's submit by emailing an 8-character code and
     * rendering a code field on the form: "A verification code was sent to <address>. To submit
     * your application, enter the 8-character code to confirm you're a human." The application is
     * NOT filed until that code is entered and the form is submitted again. Measured on the Cresta
     * preview screenshot of 2026-08-08, and against three code emails from
     * no-reply@us.greenhouse-mail.io timestamped to the same minute as three runs.
     *
     * READ OFF THE CONTROL, NEVER OFF PROSE. Two rules, and both are paid for:
     *   - the trigger is the code INPUT GROUP. A sentence on the page is not evidence: this repo
     *     already shipped a pre-submit gate that keyed on validation TEXT and, on a form carrying
     *     stale "is required" messages over filled fields, would have refused a complete
     *     application. Text is a description of a state, not the state.
     *   - and it is emphatically not the '* indicates a required field' legend, which is on every
     *     Greenhouse form ever rendered, including every form with no challenge at all.
     *
     * The address IS read from prose, and only from the prose inside the control's own group, and
     * only once the control has already been found. It is a detail carried by a state that
     * something else established, never the thing that establishes it.
     */
    const readSecurityCodeChallenge = () => page.evaluate(() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const CODE_NAME = /security\s*code|verification\s*code|one[\s-]*time\s*(code|passcode)|passcode|\botp\b/i;
      const accessibleName = (element) => {
        const labelledBy = element.getAttribute('aria-labelledby');
        const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
        const own = element.labels && element.labels[0];
        const parts = [
          element.getAttribute('aria-label'),
          referenced && referenced.textContent,
          own && own.textContent,
          element.getAttribute('placeholder'),
          element.getAttribute('name'),
          element.id
        ];
        return parts.map((part) => (part || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
      };
      const typed = [...document.querySelectorAll('input')].filter((element) => (
        isVisible(element) && !/checkbox|radio|file|hidden|submit|button|image|reset/.test(element.type || 'text')
      ));
      // (a) The control says what it is. autocomplete="one-time-code" is the platform's own name for
      //     this, and it is what assistive technology and password managers key on too.
      let boxes = typed.filter((element) => /one-time-code/i.test(element.getAttribute('autocomplete') || ''));
      // (b) The boxed pattern: a run of single-character inputs sharing a parent. Four is the
      //     smallest real code length in the wild; Greenhouse renders eight. maxLength === 1 is the
      //     structural signature and no ordinary form field carries it.
      if (boxes.length === 0) {
        const byParent = new Map();
        for (const element of typed) {
          if (element.maxLength !== 1) continue;
          const parent = element.parentElement;
          if (!parent) continue;
          if (!byParent.has(parent)) byParent.set(parent, []);
          byParent.get(parent).push(element);
        }
        for (const group of byParent.values()) {
          if (group.length >= 4 && group.length > boxes.length) boxes = group;
        }
      }
      // (c) A single field that names itself. Last, because it is the weakest signal: it is the only
      //     branch that reads words rather than shape, and it reads only the control's OWN
      //     accessible name, never the page around it.
      if (boxes.length === 0) {
        const named = typed.filter((element) => CODE_NAME.test(accessibleName(element)));
        if (named.length === 1) boxes = named;
      }
      if (boxes.length === 0) return null;
      // Sized off the control when it is a box group, and off its maxlength when it is one field.
      // Never off the sentence, which says "8-character" on Greenhouse today and is free to stop
      // saying it tomorrow.
      const fieldCount = boxes.length > 1 ? boxes.length : (boxes[0].maxLength > 0 ? boxes[0].maxLength : 0);
      // Where the code went. Scoped to the group the control lives in - the nearest ancestor that
      // also holds the explanatory sentence - so an unrelated address elsewhere on the page (a
      // recruiting contact, an anti-fraud notice) cannot be reported as the applicant's.
      let scope = boxes[0].parentElement;
      let address = '';
      for (let depth = 0; depth < 6 && scope; depth += 1) {
        // The label repeats in groups so the trailing sentence stop cannot be eaten as part of the
        // domain: "...sent to mehekmandal05@gmail.com." must not yield an address ending in a dot,
        // which is an address that does not exist and would be shown to the applicant as hers.
        const match = (scope.innerText || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
        if (match) { address = match[0]; break; }
        scope = scope.parentElement;
      }
      return {
        kind: 'security_code',
        fieldCount,
        sentTo: address || null,
        // The control's own accessible name, bounded. Diagnostic only: nothing branches on it.
        label: accessibleName(boxes[0]).slice(0, 120) || null
      };
    }).catch(() => null);

    /* WHAT THE PAGE SAID AFTER THE SUBMIT CLICK, READ OFF THE STATE THE ATS RENDERS.
     *
     * Until now nothing in this runner read the answer to "did it go through". The caller scraped
     * the whole body for a confirmation-ish sentence (RECEIPT_PROOF_RE, which matches the bare word
     * "success"), and a run that could not scrape one was reported as unverifiable. That is the
     * wrong instrument twice over: an unsubmitted application page carries plenty of encouraging
     * prose, and a submitted one can confirm without using any of the words in the list.
     *
     * ASHBY, measured 2026-08-09 from the live Skydio posting's own bundle
     * (cdn.ashbyprd.com/frontend_non_user/87a4960/assets/index-BFELy06m.js). On success Ashby mounts
     *
     *     <div class="ashby-application-form-success-container">
     *       <div role="status" aria-live="polite"> Success <p>{applicationSubmittedSuccessMessage}</p>
     *
     * and on refusal the sibling 'ashby-application-form-failure-container', headed "We couldn't
     * submit your application". Both class names are Ashby's published styling hooks - they are
     * enumerated in the bundle as a public API for customer CSS - which is what makes them a
     * legitimate thing to key off rather than a scrape of today's markup. The success SENTENCE is
     * the org's own 'theme.applicationSubmittedSuccessMessage', which for Skydio is "Thank you for
     * submitting your application..." and for an org that has not set one is Ashby's default "Your
     * application was successfully submitted." - so the sentence is per-employer and the CONTAINER
     * is not. The container is what this keys on; the sentence is carried along as the evidence a
     * person can read.
     *
     * The order is strongest evidence first, and every arm names what it saw. An arm that cannot
     * see anything returns 'unknown' rather than guessing, because "we do not know" is a state this
     * system is allowed to be in and a wrong "submitted" is not. */
    const readSubmitOutcome = () => page.evaluate(() => {
      const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
      /* VISIBLE MEANS A PERSON COULD SEE IT, and every cheap approximation of that has already been
       * caught lying here. Requiring width AND height to both be zero passes a container collapsed
       * to zero height with hidden overflow, which is what a React success panel looks like for the
       * whole of its mount-then-animate-open, and for the entire life of one that never opens.
       * Either dimension being zero is enough to disqualify. Zero opacity and a node parked at a
       * large negative offset are the other two ways this markup hides, and all three were measured
       * being reported as confirmed submissions over a live form. */
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.bottom < 0 || rect.right < 0) return false;
        if (rect.left > (document.documentElement.clientWidth || 0)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        return true;
      };
      const visibleOne = (selector) => [...document.querySelectorAll(selector)].find(isVisible) || null;
      // Published ATS state hooks. One entry per confirmed reading; nothing speculative belongs
      // here, because a wrong entry here writes 'submitted' onto an application nobody received.
      const CONFIRMED_CONTAINERS = ['.ashby-application-form-success-container'];
      const REJECTED_CONTAINERS = ['.ashby-application-form-failure-container'];
      const CONFIRMED_TEXT = /thank you for (?:submitting|applying)|thanks for (?:applying|your application)|your application (?:has been |was )?(?:successfully )?(?:submitted|received)|application (?:has been )?(?:submitted|received)|we(?:'| ha)ve received your application/i;
      const REJECTED_TEXT = /we could ?n[o']?t submit your application|your application could not be submitted|there was a problem (?:submitting|with your application)/i;
      /* THE FORM IS THE COUNTER-WITNESS, so it has to be hard to miss. Probing only for file, email
       * and textarea controls missed a form whose email field is type="text", which is common, and
       * that single miss let the weakest arm below confirm a submission with the Submit button still
       * on the page. A live submit control is the least ambiguous evidence that nothing was sent. */
      /* A SUBMIT-SHAPED BUTTON IS THE FORM SAYING IT IS STILL HERE, whatever it is wrapped in.
       * Measured on the live transparent-hiring.breezy.hr form (2026-08-20, runs 549604ee and
       * b966c219): breezy renders its application in plain divs - no <form> element, the email
       * field is type="text", and the file input hides behind an Upload Resume button - so every
       * selector below missed and this read reported the fully rendered, fully submittable form
       * as GONE. That miss disarmed the client-validation arm (gated on the form being present)
       * and, worse, it is the gate every confirmation arm leans on: a body-text "thank you" on a
       * breezy page would have confirmed an application over a live form. The button text is
       * matched whole and closed (submit / apply / send application shapes), so a link that
       * merely mentions applying cannot count; a confirmation page renders none of these. */
      const SUBMIT_SHAPED_BUTTON = /^(?:submit(?:\s+(?:your\s+)?application)?|apply(?:\s+now)?|send(?:\s+(?:your\s+)?application)?)$/i;
      const submitShapedButton = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
        .some((node) => isVisible(node) && SUBMIT_SHAPED_BUTTON.test(clean(node.innerText || node.value || '')));
      const formStillPresent = Boolean(visibleOne([
        'input[type=file]', 'input[type=email]', 'textarea',
        'form button[type=submit]', 'form input[type=submit]',
      ].join(', '))) || submitShapedButton;
      for (const selector of REJECTED_CONTAINERS) {
        const node = visibleOne(selector);
        if (node) return { state: 'rejected', source: 'ats_state', evidence: selector, message: clean(node.innerText).slice(0, 600), formStillPresent };
      }
      /* A FORM THAT SAYS ITS ERRORS OUT LOUD HAS REFUSED THE PRESS, and the form still standing is
       * the PROOF, not the doubt. Measured on the live transparent-hiring.breezy.hr form
       * (run 549604ee, 2026-08-20): Send was pressed, the network witness recorded not one request
       * to any breezy host, and the receipt shows the reason on screen twice - "A response is
       * required" beside a required Ziggeo video recorder, and "Your application contains errors"
       * directly under the pressed button. Every arm below is gated on the form being GONE, so
       * this exact page - the clearest not-sent a page can say - was reported as "never showed a
       * confirmation it could read" and the applicant was sent to look for an application that
       * provably never left the browser.
       *
       * Client validation is the ONE rejection the live form corroborates rather than
       * contradicts: an ATS failure panel over a live form is ambiguous (the Ashby arm above
       * rightly falls to unverified there), but a validation sentence EXISTS only while the form
       * does. So this arm requires the form to still be present, requires the sentence to sit in
       * a leaf node (a page-sized container matching by concatenation is not the message), and
       * matches only wording that names the application's own errors - never a bare "required",
       * which decorates half the labels on every form. */
      const VALIDATION_REFUSAL_RE = /your application (?:contains|has) errors|please (?:fix|correct) the errors? (?:above|below|highlighted)/i;
      if (formStillPresent) {
        const leaves = [...document.querySelectorAll('div, p, span, label, small')]
          .filter((node) => node.children.length === 0 && isVisible(node));
        const refusal = leaves.find((node) => VALIDATION_REFUSAL_RE.test(node.textContent || ''));
        if (refusal) {
          const missing = leaves.filter((node) => /^\s*a response is required\.?\s*$/i.test(node.textContent || '')).length;
          return {
            state: 'rejected',
            source: 'client_validation',
            evidence: 'validation_message',
            message: (clean(refusal.textContent).slice(0, 300)
              + (missing > 0 ? ' (' + missing + ' required response' + (missing === 1 ? '' : 's') + ' still missing on the form)' : '')),
            formStillPresent
          };
        }
      }
      /* GREENHOUSE CONFIRMS BY ROUTING, NOT BY RENDERING A PANEL.
       *
       * Read on 2026-08-10 out of the bundle the Cresta board serves live: on an ok response the
       * application component does window.parent.postMessage('greenhouse.confirmation') and then
       * window.location.assign(confirmationPath), where confirmationPath is the board's own
       * '/embed/job_app/confirmation?for=<company>&token=<id>'. So the evidence that a Greenhouse
       * application was filed is that the browser is standing on Greenhouse's confirmation route
       * with the form gone. It is a far better witness than the sentence on the page: fetched
       * read-only, the Cresta confirmation route says "Thank you for applying. Your application has
       * been received.", which the body-text arm below would also match - but it would match it on
       * any page that happened to carry those words.
       *
       * ITS OWN SOURCE TAG, and NOT the 'ats_state' the container arm below uses, which is the whole
       * point rather than bookkeeping. This arm is derived from location: hostname and pathname, set
       * by where the browser actually IS, and an employer page cannot write itself onto Greenhouse's
       * hostname. The container arm is derived from a CSS class the page prints, and that class is
       * published for customer styling, so any page at all can mint one. The two are not the same
       * kind of evidence and must not answer to the same name: securityCodeVerdict lets the strong
       * one overturn a challenge control that is still standing, and letting a forgeable class do
       * that would hand any page the power to have a refused code reported as accepted.
       *
       * EU DATA REGION. Greenhouse serves boards for EU-resident customers from job-boards.eu and
       * boards.eu on the same domain, and without the optional label those hosts fell through this
       * arm to the body-text one. On a security-code screen that is the difference between a filed
       * EU application being reported accepted and being reported refused, because body text is no
       * longer allowed to decide that. Not a regression, it was never matched, but this change is
       * what made it load-bearing.
       *
       * Gated on the form being gone for the same reason every other arm is. A route match with an
       * application form still on screen is not a confirmation, it is a page mid-navigation. */
      const greenhouseConfirmation = /(^|\.)(?:job-boards|boards)\.(?:eu\.)?greenhouse\.io$/i.test(location.hostname)
        && /\/(?:application_)?confirmation\/?$/i.test(location.pathname);
      if (greenhouseConfirmation && !formStillPresent) {
        const body = clean(document.body ? document.body.innerText : '');
        return {
          state: 'confirmed',
          source: 'ats_route',
          evidence: 'greenhouse:' + location.pathname,
          message: body.slice(0, 600) || 'Greenhouse confirmation page',
          formStillPresent
        };
      }
      /* A CONTAINER IS NOT A CONFIRMATION. Ashby's success container is mounted by the same React
       * tree that renders the form, and an empty one over a live form was being read as a filed
       * application: the worst output this system can produce, because she is told it went and never
       * follows up. Three things have to agree before this arm speaks, and all three were observed
       * disagreeing: the container is visible, it actually says something, and the form it replaces
       * is gone. Any other combination falls through to 'unknown', which is a state the caller now
       * knows how to carry. */
      for (const selector of CONFIRMED_CONTAINERS) {
        const node = visibleOne(selector);
        if (!node) continue;
        const message = clean(node.innerText).slice(0, 600);
        if (!message || formStillPresent) {
          return { state: 'unknown', source: 'ats_state_unconfirmed', evidence: selector, message: message || null, formStillPresent };
        }
        return { state: 'confirmed', source: 'ats_state', evidence: selector, message, formStillPresent };
      }
      // A live region is the page telling assistive technology that something just happened, which
      // is a far narrower claim than "these words appear somewhere on the page". aria-live="off"
      // is the value that means DO NOT announce, so a node carrying it is not the page saying
      // anything; it was matched by the bare [aria-live] selector and confirmed a live form once.
      for (const node of [...document.querySelectorAll('[role=status], [role=alert], [aria-live]:not([aria-live="off"])')]) {
        if (!isVisible(node)) continue;
        const text = clean(node.innerText);
        if (!text) continue;
        if (REJECTED_TEXT.test(text)) return { state: 'rejected', source: 'live_region', evidence: node.getAttribute('role') || 'aria-live', message: text.slice(0, 600), formStillPresent };
        // Gated on the form being gone for the same reason the body-text arm is: an announcement
        // over a form that is still there, still filled and still submittable has not confirmed it.
        if (CONFIRMED_TEXT.test(text) && !formStillPresent) return { state: 'confirmed', source: 'live_region', evidence: node.getAttribute('role') || 'aria-live', message: text.slice(0, 600), formStillPresent };
      }
      /* THE WEAKEST ARM, AND IT IS GATED ON THE FORM BEING GONE. Body text alone was the old
       * instrument and it is the one that has to be able to say no: a confirmation sentence over a
       * form that is still sitting there, still filled, still submittable is not a confirmation. */
      const body = clean(document.body ? document.body.innerText : '');
      if (!formStillPresent && CONFIRMED_TEXT.test(body)) {
        const sentence = (body.match(CONFIRMED_TEXT) || [''])[0];
        return { state: 'confirmed', source: 'page_text', evidence: 'body', message: clean(body.slice(Math.max(0, body.indexOf(sentence)), body.indexOf(sentence) + 400)), formStillPresent };
      }
      /* NO ARM RECOGNISED THIS PAGE, and the old shape threw that fact away: message/evidence went
       * back null, so a genuinely new ATS shape (no live confirmation evidence exists for breezy.hr
       * or workable.com anywhere in this codebase or the vault, measured 2026-08-20) left no residue
       * to build a real arm from. It costs nothing to keep what the page actually said - state stays
       * 'unknown' and no verdict anywhere reads this arm's message for the unknown state, so nothing
       * downstream can mistake it for a confirmation. It is the ONLY way the next real Workable or
       * breezy send produces ground truth instead of another silent unverified dead end. */
      return { state: 'unknown', source: 'unmatched_page_text', evidence: location.href, message: body.slice(0, 600) || null, formStillPresent };
    }).catch(() => ({ state: 'unknown', source: null, evidence: null, message: null, formStillPresent: null }));

    /* IS A HUMAN ACTUALLY BEING ASKED FOR ANYTHING, read off the widget rather than off a class name.
     *
     * THE DEFECT THIS REPLACES, measured on the applicant's own packets: the old test was a single
     * count of 'iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]' with no visibility
     * test, no badge exclusion and no token read. reCAPTCHA v3 and invisible v2 render
     * <div class="grecaptcha-badge"> on pages that ask a person for NOTHING - the score comes from
     * behaviour and the token is minted on submit - and that div matches [class*="captcha" i]. So
     * every Greenhouse and Ashby page carrying the badge reported a challenge. 48 of 158 application
     * packets were labelled "CAPTCHA requires your attention" on that basis, which made this the
     * single largest blocker in the pipeline and almost all of it was noise.
     *
     * THE ASYMMETRY THIS IS TUNED TO. A false "no captcha" lets a submit run into a wall, and the
     * post-submit readers see no receipt: one wasted click, recoverable. A false "captcha" strands a
     * finished application and hands it back to a person to redo by hand. So a challenge is reported
     * only on POSITIVE evidence of a real, visible, unsolved one, and a probe that cannot see at all
     * reports nothing rather than inventing a wall.
     *
     * FIVE CHECKS, ported from hasUnresolvedCaptcha in the backend's portalSubmission.ts so the two
     * layers stop disagreeing by construction. Translated, not copied: that one probes node by node
     * with locators, this one collects with ONE locator and decides in ONE page-side pass.
     *
     *   1. VISIBLE. A node with a zero dimension, display:none, visibility:hidden or opacity 0 is not
     *      being shown to anyone. Same rule as readSubmitOutcome above, for the same reason.
     *   2. NOT THE BADGE. Matched with closest(), never a self-or-descendant check: the badge is a
     *      CONTAINER whose child anchor iframe matches iframe[src*="captcha" i] on its own, and its
     *      own class list is not a descendant of itself. closest() covers both in one probe. If v3
     *      scores the session badly it escalates to a real widget, and that widget renders OUTSIDE
     *      the badge, so closest() returns null and it is counted normally.
     *   3. NOT AN INVISIBLE WIDGET, unless a bframe is VISIBLE. A form that mounts its own
     *      <div class="g-recaptcha" data-size="invisible"> outside the badge is the shape the badge
     *      exclusion does not watch. The bframe is the load-bearing half: reCAPTCHA renders the
     *      image-grid popup in a SECOND iframe whose src carries 'bframe', and an ESCALATED invisible
     *      widget still declares itself invisible. Presence alone is not enough, and testing only
     *      presence was a measured regression: reCAPTCHA MOUNTS the bframe collapsed and keeps it
     *      mounted after the popup closes, so a page showing nobody anything carried one and the
     *      invisible exclusion switched itself off over a form with no challenge on it.
     *   4. AN OPEN POPUP BEATS ANY TOKEN. If a bframe is on screen, the provider is asking a person
     *      right now, so whatever sits in the response field is stale by construction. This is the
     *      only staleness signal a DOM read can honestly produce.
     *   5. UNSOLVED. Something rendered plus at least one response field that does not hold a real
     *      token. Read off the DOM PROPERTY, which is why this runs in the page: g-recaptcha-response
     *      is a <textarea> with no value ATTRIBUTE at all, so an attribute read reports every solved
     *      widget as unsolved. Widget count is deliberately not compared to token count, because
     *      providers render a variable number of visible nodes per widget, so "3 nodes, 1 token" is
     *      one solved widget and not two missing ones.
     *
     * COLLECTED WITH A LOCATOR, NOT document.querySelectorAll, and that is a capability and not a
     * style choice. Playwright's CSS engine pierces OPEN SHADOW ROOTS; querySelectorAll stops at the
     * boundary. An embedded widget mounted in a shadow root was invisible to the first version of
     * this and visible to the selector it replaced, which is a straight regression against what the
     * runner could already see.
     *
     * NO CANDIDATE CAP, and the reason it went is narrower than the reason first written here. The
     * first version capped the scan at 20 nodes, and the comment claimed the cap bounded per-node
     * round trips. It never did: that cap lived INSIDE a single page.evaluate, as a slice of a
     * querySelectorAll result, so every node it dropped was already in the page and cost nothing to
     * look at. What it actually did was run BEFORE the visibility and badge filters, so twenty hidden
     * nodes whose class names merely contain "captcha" used it up and a real widget behind them was
     * never examined. That is the whole defect and the whole reason the cap is gone. Nothing replaces
     * it because nothing needs to: measured on this shape, 1000 nodes decide in 14ms, 100000 in
     * 1203ms and 500000 in 2359ms, one round trip, linear, no throw. */
    const CAPTCHA_SELECTORS = {
      challenge: [
        'iframe[src*="captcha" i]',
        'iframe[src*="challenges.cloudflare.com" i]',
        '[class*="captcha" i]',
        '[id*="captcha" i]',
        '[data-sitekey]'
      ].join(', '),
      response: [
        'textarea[name*="captcha-response" i]',
        'input[name*="captcha-response" i]',
        'textarea[id*="captcha-response" i]',
        'input[id*="captcha-response" i]',
        'textarea[name="cf-turnstile-response"]',
        'input[name="cf-turnstile-response"]'
      ].join(', '),
      bframe: 'iframe[src*="/recaptcha/"][src*="bframe" i]',
      badge: '.grecaptcha-badge',
      invisible: '[data-size="invisible"], iframe[src*="size=invisible" i]',
      /* WHAT COUNTS AS A TOKEN AT ALL. Every provider mints an encoded blob hundreds of characters
       * long, so this floor sits far below any real one and above every placeholder: an empty field,
       * a whitespace field, and the short literals a restored form or a test harness leaves behind
       * ('null', 'undefined', 'expired'). It buys exactly one thing, that a short leftover value
       * stops reading as a solved widget, and it is honest about what it cannot buy: a
       * correctly-shaped token that a provider has expired SERVER SIDE is indistinguishable from a
       * fresh one in the DOM, by this layer or by the backend. Check 4 is the only real answer to
       * that, and it only speaks when the provider puts a popup on screen.
       *
       * TWO KNOWN FALSE POSITIVES, both deliberate. Cloudflare's documented test token
       * 'XXXX.DUMMY.TOKEN.XXXX' is 21 characters and hCaptcha's
       * '10000000-aaaa-bbbb-cccc-000000000001' is 36, so both sit under this floor and both are
       * genuinely solved states that get called unsolved. They are test-key states rather than
       * anything an employer serves, the miss fails toward "CAPTCHA requires your attention" which
       * strands rather than lies, and the selector this replaced flagged those pages too. Raising the
       * floor to admit them would let every short leftover value back in, which is the direction that
       * costs an application. */
      minTokenLength: 40
    };

    /* Pure, and separated from the locator on purpose: this is the half that decides, so it is the
     * half a test has to be able to drive with real nodes. It takes its whole request as an
     * argument rather than closing over anything because evaluateAll serializes the function into
     * the page, where nothing from this scope exists.
     *
     * TWO MODES, ONE COPY OF isVisible, and the single copy is the whole reason the second mode
     * lives in here rather than beside the extract handler that calls it.
     *
     * 'unresolvedCaptcha' is this runner's own blocker predicate. 'visibleValues' answers the
     * question the BACKEND could not ask: its managed path reads captcha evidence through the
     * extract contract, which returns attribute values and nothing else, so it had no way to learn
     * that a widget container has no box. It therefore read "a data-sitekey is present" as "a person
     * is being shown something", and on 2026-08-12 a read-only sweep of 30 live postings measured
     * the consequence: three Lever postings permanently blocked on an hCaptcha container that is
     * 1380x0, holds two visibility:hidden iframes, and shows nobody anything. This runner's own
     * predicate said false on all three, and so did the backend's direct-Playwright predicate. The
     * managed path was the outlier, and it was the outlier because it was the one layer with no
     * layout read.
     *
     * ONE COPY OF THE CAPTCHA VISIBILITY RULE, and the claim is deliberately that narrow. This file
     * holds seven isVisible helpers, at roughly lines 1326, 1440, 1676, 1829, 1913, 2415 and 2694,
     * and they are NOT redundant: the submit-outcome reader disqualifies a node parked off screen,
     * the security-code reader treats one zero dimension as still visible, and this one disqualifies
     * either zero dimension. They answer different questions and their differences are load-bearing.
     * What must not exist is a second copy of THIS one, because the two callers below are answering
     * the same question about the same page, and a second copy is how the managed path and this
     * runner came to disagree in the first place. So the rule lives here once and is serialized into
     * the page by both of them. Consolidating the other five would be a separate change and a worse
     * one; it would flatten distinctions each of them was measured into. */
    const captchaSnapshot = (nodes, request) => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        return true;
      };
      /* THE NODE OR ANYTHING IT PAINTS, and the difference between those two readings is a defect
       * that was measured rather than imagined.
       *
       * The caller's selectors here match widget CONTAINERS and reCAPTCHA frames. Nothing in them
       * can match an hCaptcha or a Turnstile frame, so on those two providers the container is the
       * caller's ONLY channel. A container carrying height:0 under the default overflow:visible has
       * a border box of 1380x0 while its 303x78 checkbox sits in flow, fully painted, and waiting to
       * be clicked. Asking isVisible of the container alone answers "nothing here" about a page a
       * person is looking at, and THIS runner's own predicate, which walks the frames as nodes in
       * their own right, says the opposite on the same DOM.
       *
       * That is the same failure this whole mode exists to end, pointed the other way: one layer
       * blind to what another can see. A caller that discards a correct blocker sends an application
       * into a challenge it cannot clear, which is the direction that costs an application outright
       * rather than stranding one.
       *
       * The measured Lever page is unaffected, and that is what makes the widened rule safe rather
       * than a retreat: every descendant there is visibility:hidden or 1x1, so the subtree answer is
       * false exactly where the node answer was. querySelectorAll does not cross an iframe boundary,
       * so a bframe that is mounted and collapsed still reports nothing, and regression D holds.
       *
       * ONE ENTRY PER VISIBLE NODE, and the cardinality is as load-bearing as the filter. The plain
       * extract reads locator.first(), so a page holding two widgets returns one value and the
       * backend cannot tell which one it got. Every rule it writes that subtracts one list of site
       * keys from another then degenerates on exactly the page it was written for, because reCAPTCHA
       * keys are issued per domain and two widgets on one employer page usually SHARE a key.
       * Returning every visible match, in DOM order, is what makes that subtraction a multiset
       * operation over nodes instead of a guess about the runner's echo semantics. */
      if (request.mode === 'visibleValues') {
        const paintsAnything = (element) => isVisible(element)
          || Array.prototype.some.call(element.querySelectorAll('*'), isVisible);
        return nodes
          .filter(paintsAnything)
          .map((node) => (request.attribute
            ? node.getAttribute(request.attribute)
            : (node.innerText || node.textContent || '')));
      }
      const sel = request.selectors;
      const bframeOpen = nodes.some((node) => node.matches(sel.bframe) && isVisible(node));
      let visibleChallenges = 0;
      for (const node of nodes) {
        if (!node.matches(sel.challenge)) continue;
        if (!isVisible(node)) continue;
        if (node.closest(sel.badge)) continue;
        if (!bframeOpen && (node.matches(sel.invisible) || node.closest(sel.invisible))) continue;
        visibleChallenges += 1;
      }
      if (visibleChallenges === 0) return false;
      if (bframeOpen) return true;
      const tokens = nodes
        .filter((node) => node.matches(sel.response))
        .map((node) => String(node.value == null ? '' : node.value).trim());
      if (tokens.length === 0) return true;
      return tokens.some((token) => token.length < sel.minTokenLength);
    };

    const readUnresolvedCaptcha = () => page
      .locator([CAPTCHA_SELECTORS.challenge, CAPTCHA_SELECTORS.response, CAPTCHA_SELECTORS.bframe].join(', '))
      .evaluateAll(captchaSnapshot, { mode: 'unresolvedCaptcha', selectors: CAPTCHA_SELECTORS })
      // Fails OPEN, and it is the only probe in this file that does. Everywhere else "we could not
      // see" means "assume the worse state"; here the worse state IS the false alarm, because it is
      // the one that strands a finished application. A read that throws saw no widget, no token and
      // no badge, so it has no evidence of a challenge and must not manufacture one.
      .catch(() => false);

    /* NETWORK IDLE IS NOT A CLIENT STATE TRANSITION. A React application can accept the physical
     * submit click, schedule its verification step for a later browser task, and make no request or
     * navigation that Playwright can wait on. The controlled portal reproduced this exactly: the
     * authorized click was recorded, then the immediate end-of-run reads saw the old form, no code
     * control, and no receipt. The caller therefore had neither a continuation token nor a state it
     * could safely retry.
     *
     * Wait only for evidence that can decide the application: a security-code control, a confirmed
     * receipt, or an explicit refusal. Polling the same typed readers keeps prose from becoming a
     * trigger, and the short deadline bounds the cost on an employer page that remains genuinely
     * ambiguous. This is deliberately not a blind sleep: a synchronous receipt returns on the first
     * pass, while a client-rendered challenge gets the browser tasks it needs to commit.
     *
     * securityCodeSettles is false for exactly one caller: the run that has just RESUBMITTED with a
     * code in the boxes. There the code control is the thing under test, not evidence of anything
     * settling, and a wait that returned the moment it saw one would return before the page had
     * changed at all. Everywhere else a challenge appearing is a real terminal state. */
    const waitForPostSubmitApplicationState = async ({ securityCodeSettles = true } = {}) => {
      /* EVERY ATS GETS THE WINDOW THAT WAS ONLY EVER MEASURED ON ONE OF THEM.
       *
       * 3 seconds was the budget for every board except Greenhouse, and it is not enough time for a
       * single-page application to post a resume upload and re-render a success panel. Measured on
       * the owner's account 2026-08-16: the ONLY family that ever produced a readable receipt is
       * Greenhouse, the one family holding the longer window. Skydio and kos.ai on Ashby and Pony.ai
       * on Workable each pressed Send and each came back no_confirmation_state; Pony.ai did it
       * twice, on two separate runs, from a form Litos had filled completely. Scale AI on Greenhouse,
       * run minutes later through the same code, confirmed from the page on the first attempt.
       *
       * WHAT AN EXPIRED WINDOW COSTS, which is why the trade is not close. The application may well
       * be at the employer, but Litos cannot say so, so it parks at unverified: the applicant is sent
       * to go and look, the duplicate guard then blocks every future application to that posting, and
       * the only way out is her answering a question she often cannot answer either, because a board
       * that has taken an application does not show it back to her.
       *
       * WHAT A LONGER WINDOW COSTS: nothing on a page that decides, because the loop returns on the
       * first confirmed, rejected or code-control read. It is paid only on a page that stays
       * genuinely ambiguous, and there it is browser time against an application the applicant would
       * otherwise have to chase by hand.
       *
       * 12s rather than a bigger number because the run budget is 90s (MANAGED_RUN_TIMEOUT_MS) and a
       * submit happens at the end of a run that has already filled the form. Greenhouse has been
       * spending 8s of that budget in production without trouble, so 12s is 4s past a figure already
       * known to fit, not a guess at the ceiling. The exact settle time for Ashby and Workable has
       * NOT been measured - there is no way to measure it without submitting to a real employer - so
       * this raises a floor that was demonstrably too low rather than claiming to have found the
       * right one. If an Ashby receipt still fails to land, this constant is the first thing to
       * revisit, and it should be raised with the run budget rather than inside it.
       *
       * The host check that used to select between 8s and 3s is gone rather than left as a ternary
       * with two equal arms. Greenhouse's own reason for a longer window - it can paint its exact
       * code control after the ordinary receipt-settle window - is satisfied by a uniform figure
       * that is longer than the 8s it had, and the branch was the only reader of the hostname.
       */
      /* 30 SECONDS, AND INJECTABLE.
       *
       * Mehek's call, and the reasoning is hers: employers do not reliably email a confirmation, so
       * the page after Submit is the only witness, and three seconds is nowhere near enough for a
       * single-page application to post a resume upload and re-render a success panel.
       *
       * Costs nothing on a page that decides - the loop returns on the first confirmed, rejected or
       * code-control read - so this is only ever spent where the page stays genuinely ambiguous, and
       * there it buys a receipt instead of an unverified packet the applicant has to chase.
       *
       * It fits the 90s run budget (MANAGED_RUN_TIMEOUT_MS) with room: the submit is the last thing a
       * run does, and Greenhouse has been spending 8s of that budget in production without trouble.
       *
       * Injectable so a test can choose its own window instead of depending on wall-clock coincidence
       * between a fixture timeout, this deadline and the 15s receipt-observation TTL. Clamped to 30s,
       * because this decides how long a run holds a browser open. */
      const POST_SUBMIT_SETTLE_MS = (() => {
        const clamp = (value) => Math.min(value, 30_000);
        // Per-run first: the delayed-receipt replay needs its own exact window and must outrank the
        // suite-wide default below.
        const requested = Number(input && input.postSubmitSettleMs);
        if (Number.isFinite(requested) && requested > 0) return clamp(requested);
        /* THEN THE SUITE-WIDE DEFAULT, and this exists for a measured reason.
         *
         * At 30s the verify suite exceeded a 20 MINUTE ci budget, then exceeded 30 minutes after the
         * budget was raised - 30m15s, cancelled, no assertion failure. Every replay case that ends on
         * a genuinely ambiguous submit spends the whole window before giving up, and there are many.
         * Raising the budget again just moves the wall.
         *
         * So the suite sets this and production does not. A sandbox run has no such variable and gets
         * the full 30s, which is the whole point of the change. */
        const fromEnv = Number(typeof process !== 'undefined' && process.env && process.env.LITOS_POST_SUBMIT_SETTLE_MS);
        if (Number.isFinite(fromEnv) && fromEnv > 0) return clamp(fromEnv);
        return 30_000;
      })();
      const deadline = Date.now() + POST_SUBMIT_SETTLE_MS;
      while (Date.now() < deadline) {
        if (securityCodeSettles && await readSecurityCodeChallenge()) return;
        const outcome = await readSubmitOutcome();
        if (outcome.state === 'confirmed' || outcome.state === 'rejected') return;
        await page.waitForTimeout(50).catch(() => undefined);
      }
    };

    /* DID THE EMPLOYER TAKE THE CODE. One function, because there are two places that answer this and
     * a copy is how one of them stays wrong.
     *
     * ONLY AN UNFORGEABLE RECEIPT MAY OUTRANK A STANDING CONTROL. Two separate reasons stack here,
     * and the predicate has to satisfy both.
     *
     * FIRST, EVERY WEAK ARM IS UNGATED ON THIS PATH. readSubmitOutcome gates its lesser arms on
     * formStillPresent, which looks for input[type=file], input[type=email], textarea,
     * form button[type=submit] or form input[type=submit]. Greenhouse renders the code as eight
     * maxLength=1 input[type=text] boxes, which match none of them, and by the time the code screen
     * exists the application form itself is already gone. So formStillPresent is false on this whole
     * path whatever is really happening, the body-text arm runs unopposed, and any
     * confirmation-shaped sentence on the page flips the verdict. Measured on the shipped readers: a
     * refused code on a screen carrying "Thank you for applying" read as ACCEPTED through source
     * 'page_text', both with a bare <button> inside a form and in the React shape with no <form>
     * element at all. The only shape that survived did so because the control happened to spell
     * type="submit" literally, which is not a property any employer owes us.
     *
     * SECOND, AND THIS IS WHY THE TEST IS 'ats_route' AND NOT 'ats_state'. Narrowing to the ATS's own
     * state was not narrow enough, because two different things carried that one name. The container
     * arm keys on '.ashby-application-form-success-container', a CSS class the page prints and that
     * Ashby publishes for customer styling: any page can write it, including a Greenhouse code screen
     * that has just refused a code. Measured, a page with no Ashby involvement at all minted a
     * confirmed/ats_state receipt purely from the class string. The route arm keys on location, which
     * is set by where the browser actually IS and which no employer markup can forge. Only that one
     * is allowed to overturn a challenge the page is still showing.
     *
     * This is the single predicate on this path where being wrong means telling an applicant a
     * refused application is filed, so it takes evidence nobody can print. The Cresta fix survives
     * intact: in production that confirmation is exactly the route arm. Everything else is unchanged,
     * and deliberately still generous in the safe direction: an explicit refusal is a refusal
     * whatever its source, a standing control is a refusal, and a cleared control with nothing
     * contrary is acceptance. A forged CONTAINER can now only ever produce a false refusal, which
     * costs a re-check rather than a lost application. */
    const securityCodeVerdict = (receipt, challengeStanding) => (
      receipt.state === 'confirmed' && receipt.source === 'ats_route'
        ? 'accepted'
        : ((receipt.state === 'rejected' || challengeStanding) ? 'rejected' : 'accepted')
    );

    /* Type a code the applicant supplied into the control found above, and say what happened.
     *
     * WHAT GREENHOUSE'S WIDGET ACTUALLY DOES, read on 2026-08-10 out of the bundle the Cresta board
     * serves live (job-boards.cdn.greenhouse.io/assets/entry.client-Da_lLnMl.js), not guessed:
     *
     *   - eight inputs, a hardcoded count, ids security-input-0 through security-input-7, type=text,
     *     maxLength 1, aria-required, inside <div class="email-verification__wrapper"> under
     *     <fieldset id="email-verification">. There is NO autocomplete="one-time-code" on them, so
     *     the platform-name branch of the detector never fires on Greenhouse and the maxLength-1
     *     group branch is what finds it. That is why the group branch is not a fallback.
     *   - it AUTO-ADVANCES. Its onChange writes the character, joins all eight box values, and calls
     *     select() on the NEXT box's ref. So one focus and eight keystrokes puts one character in
     *     each box, and typing eight characters is right rather than typing one and moving on.
     *   - it also DISTRIBUTES A PASTE from the pasted box rightwards, which is a second correct way
     *     in and needs a real clipboard event to reach; typing needs none, so typing is what this
     *     does.
     *   - and the submit button is DISABLED the moment the challenge appears and re-enabled only
     *     when the joined value is exactly eight characters long. That is the part that made the
     *     wait below necessary rather than tidy: setFormDisabled(false) is a React state update, so
     *     the button is still disabled for a render after the last character lands, and
     *     confirmAndSubmitPass filters its candidates on !disabled and would report the form's own
     *     submit as missing.
     *
     * Focus-and-type first, then per-box filling for a group that does not auto-advance, then the
     * whole-value fill for a single field.
     *
     * NEVER GUESSES A CODE. It types the one it was handed or it reports that it could not. */
    const enterSecurityCode = async (code) => {
      const marked = await page.evaluate(() => {
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          return (rect.width > 0 || rect.height > 0) && getComputedStyle(element).visibility !== 'hidden';
        };
        const typed = [...document.querySelectorAll('input')].filter((element) => (
          isVisible(element) && !/checkbox|radio|file|hidden|submit|button|image|reset/.test(element.type || 'text')
        ));
        let boxes = typed.filter((element) => /one-time-code/i.test(element.getAttribute('autocomplete') || ''));
        if (boxes.length === 0) {
          const byParent = new Map();
          for (const element of typed) {
            if (element.maxLength !== 1) continue;
            const parent = element.parentElement;
            if (!parent) continue;
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent).push(element);
          }
          for (const group of byParent.values()) {
            if (group.length >= 4 && group.length > boxes.length) boxes = group;
          }
        }
        if (boxes.length === 0) return 0;
        boxes.forEach((element, index) => element.setAttribute('data-litos-security-code-box', String(index)));
        return boxes.length;
      }).catch(() => 0);
      if (marked === 0) return 'no_control';
      const first = page.locator('[data-litos-security-code-box="0"]');
      await first.click().catch(() => undefined);
      await page.keyboard.type(code, { delay: 30 }).catch(() => undefined);
      const readBack = () => page.evaluate(() => [...document.querySelectorAll('[data-litos-security-code-box]')]
        .map((element) => element.value || '').join('')).catch(() => '');
      if ((await readBack()) !== code) {
        for (let index = 0; index < marked; index += 1) {
          const value = marked === 1 ? code : (code[index] || '');
          const box = page.locator('[data-litos-security-code-box="' + index + '"]');
          await box.fill(value).catch(() => undefined);
          await box.evaluate((element) => {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => undefined);
        }
      }
      if ((await readBack()) !== code) return 'not_entered';
      /* THE CHARACTERS ARE IN THE BOXES AND THE FORM IS NOT NECESSARILY READY YET.
       *
       * Greenhouse re-enables its submit button from React state, not from the keystroke:
       * setFormDisabled(false) runs when the joined value reaches eight characters, and the button's
       * disabled attribute changes when that render commits. Handing confirmAndSubmitPass a button
       * that is still disabled costs the whole run, because its candidate filter drops disabled
       * controls and it then raises 'Atomic submit control was missing or ambiguous' over a form
       * that was about to be perfectly submittable - and a submit is the one thing that cannot be
       * retried, so there is no second chance to notice.
       *
       * A GUARD, AND HONESTLY LABELLED AS ONE. React flushes a discrete input event synchronously,
       * and the readBack round trip above costs at least one task on the page, so in the measured
       * case the button is already enabled by the time this runs and the loop exits on its first
       * check having cost nothing. It is here for the case where it is not, which is silent and
       * total when it happens. It never decides anything either: a form whose submit stays disabled
       * still gets its one honest attempt below and fails there with the reason, rather than being
       * reported from here as a code that was not entered. The code IS entered, which is what
       * readBack just proved. */
      const submitReady = async () => page.evaluate(() => {
        const codeBox = document.querySelector('[data-litos-security-code-box="0"]');
        const form = codeBox && codeBox.closest('form');
        if (!form) return true;
        return [...form.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]')]
          .some((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const visible = (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
            const disabled = Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true';
            return visible && !disabled;
          });
      }).catch(() => true);
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline && !(await submitReady())) {
        await page.waitForTimeout(50).catch(() => undefined);
      }
      return 'entered';
    };

    const readSubmitReadiness = (scope = null) => {
      const scan = (root = document) => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '');
      // An ATS can keep fallback copy and closed-menu options in the DOM without rendering them.
      // textContent reads those implementation details; innerText reads the label a person sees.
      // Fall back only in non-layout DOMs where innerText is not implemented. An implemented but
      // empty innerText is meaningful, as with a successfully rendered <object>'s fallback copy.
      const renderedText = (node) => {
        if (!node) return '';
        return typeof node.innerText === 'string' ? node.innerText : (node.textContent || '');
      };
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      // The block that owns one question: its label, its control, and its error line.
      //
      // The two Ashby entries are new and are what let this gate see an Ashby question at all. Ashby
      // renders every question as '<div class="_fieldEntry_<hash> ashby-application-form-field-entry"
      // data-field-path="...">', which matches none of the classic selectors above, so widgetOf fell
      // back to element.parentElement - the pill row or the input wrapper - and labelOf then found no
      // <label> inside it and reported the question as unlabelled. 'data-field-path' is Ashby's own
      // per-question attribute and is the more durable of the two; the hashed class is kept because a
      // board serving an older bundle carries the class and not the attribute.
      const widgetOf = (element) => element.closest(
        '[class*="select__container"], .field, .field-wrapper, .file-upload, fieldset, [role="group"],'
        + ' [data-field-path], [data-input-type], [class*="_fieldEntry_"]'
      ) || element.parentElement || element;
      /* THE LABEL THAT WRAPS ITS CONTROL AND NEVER NAMES IT.
       *
       * '<label>First name<input required></label>' is a legal HTML label association and carries no
       * "for" attribute, so the byFor lookup below finds nothing, widgetOf falls back to the label
       * itself, and its querySelector('label') then finds no label INSIDE it. Greenhouse's
       * first-name, last-name and resume fields are all built this way. Without this candidate the
       * walk below is all that is left, and it answers with the block's FIRST label, so all three
       * fields came back named "First name" and the message dedupe then collapsed them into one:
       * two genuinely empty required fields vanished from the blocker list entirely.
       *
       * Disqualified when the label wraps MORE than one control, because a label speaking for
       * several controls speaks for none in particular. The legend and aria-labelledby candidates
       * already serve that case.
       */
      const wrappingLabelTextOf = (element) => {
        const wrapper = element && element.closest && element.closest('label');
        if (!wrapper) return '';
        if (wrapper.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length > 1) return '';
        return renderedText(wrapper);
      };
      /* The question a control sits under, when the control itself is labelled with nothing useful.
       *
       * Restored here from the end-of-run scan this gate replaced, where it was the only reason an
       * Ashby datepicker blocker read "Are you currently enrolled in a degree program? If so,
       * expected graduation date?" instead of "Pick date...". Losing it would have made the blocker
       * name the widget rather than the question, which is the same defect as naming a UUID.
       *
       * A BLOCK HOLDING MORE THAN ONE CONTROL IS REJECTED, because its first label is then somebody
       * else's. Measured against the SmartRecruiters fixture, whose resume input sits bare inside an
       * <spl-dropzone> with no label of any kind: without this test the walk reached the form's
       * field grid and reported the missing resume as "First Name", so the applicant was told a
       * field she had already filled was empty and never told the resume was missing. A wrong name
       * is worse than no name, so an ambiguous block yields nothing.
       */
      const genericControlText = (value) => /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/i.test(clean(value));
      const nearestQuestionText = (start) => {
        let block = start && start.parentElement;
        for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
          if (!block.matches || !block.matches('div, section, li, fieldset')) continue;
          if (block.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length > 1) return '';
          const candidate = block.querySelector('label, legend, .question, h3, h4');
          const text = clean(renderedText(candidate));
          if (text && !genericControlText(text)) return text;
        }
        return '';
      };
      const labelOf = (widget, element) => {
        /* A LABEL THAT LIVES INSIDE THE CONTROL IT NAMES IS THE CONTROL'S RENDERED VALUE, and a
         * blocker named by it tells the applicant what the widget currently shows, not what the
         * employer asks. Measured on the live jobs.lever.co Mytos university picker, 2026-08-20:
         * Select2's '<span role="combobox">' points aria-labelledby at its OWN selection span, so
         * this gate named the required university field "Select a university or college" - the
         * placeholder - while the employer's words, "Which was the most recent university you
         * attended?", sat one sibling over in div.application-label. Worse, that "label" changes
         * the moment an option lands, so the same field is called two different things across one
         * run. A reference is a label only when it points OUTSIDE the control that carries it;
         * a self-contained one is dropped here so the later candidates can find the real heading.
         * References carried by the WIDGET (the question block) are untouched: a block whose
         * label lives inside the block is the normal case, not self-labelling. */
        /* The drop keys on the CARRIER of the reference, not on which parameter slot it arrived
           in: two call sites pass the control itself in the widget slot (the marked-unverified
           arm, and the required-scan's reversed-argument call), and a slot-keyed guard let the
           Select2 span's self-reference straight through both. A carrier is judged self-labelling
           only when it is combobox-shaped - a question BLOCK whose label lives inside it is the
           normal case and stays. Every id resolves, not just the first: the hybrid retrofit
           aria-labelledby="own-value external-heading" must yield the heading, not nothing. */
        const referenceLabelOf = (carrier) => {
          if (!carrier || !carrier.getAttribute) return null;
          const ids = (carrier.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
          const comboShaped = carrier.getAttribute('role') === 'combobox'
            || carrier.getAttribute('aria-haspopup') === 'listbox';
          for (const id of ids) {
            const target = root.querySelector('#' + CSS.escape(id));
            if (!target) continue;
            if (comboShaped && carrier.contains(target)) continue;
            return target;
          }
          return null;
        };
        const proxyCombobox = widget
          ? widget.querySelector('[role="combobox"][aria-labelledby], [aria-haspopup="listbox"][aria-labelledby]')
          : null;
        const referenced = referenceLabelOf(widget) || referenceLabelOf(element);
        const proxyReferenced = referenceLabelOf(proxyCombobox);
        const byFor = element && element.id && root.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        const legend = widget && widget.querySelector('legend');
        const own = widget && widget.querySelector('label, .label, .upload-label, legend');
        /* A GROUPED CHOICE IS LABELLED WITH ITS OPTION, and wrappingLabelTextOf below returns it.
         *
         * questionLabel was taught this and the required-field scan was not, so after the Lever
         * label fix shipped the two disagreed about the same control: choice resolution correctly
         * said "what degree are you currently pursuing" while this scan still reported the blocker
         * as "High School Diploma". Measured on a fresh Belvedere packet, 2026-08-17.
         *
         * Narrow on purpose. It requires ALL of: a radio or checkbox, more than one input sharing
         * its name (so a lone "I agree" checkbox, whose own label IS its question, is untouched),
         * and a question container that publishes its own text. Anything else falls through to the
         * candidate order below exactly as before. */
        const groupedChoiceQuestion = (() => {
          if (!element || (element.type !== 'radio' && element.type !== 'checkbox')) return '';
          const name = element.getAttribute('name');
          if (!name) return '';
          if (root.querySelectorAll('input[name="' + CSS.escape(name) + '"]').length < 2) return '';
          const container = element.closest('li.application-question, fieldset, [role="radiogroup"], [role="group"]');
          const heading = container && container.querySelector('.application-label, legend');
          if (!heading || heading.querySelector('input, textarea, select')) return '';
          return renderedText(heading);
        })();
        /* A COMBOBOX THAT SAYS ONLY WHAT IT IS, NEVER WHAT IT ASKS - the gate's copy of the rule
         * discovery already applies, so the blocker line and the question say the same words.
         * Measured on the live ats.rippling.com Easy Dynamics form, 2026-08-20: the required
         * work-authorization control is '<div id="field-63" role="combobox" aria-label="Select"
         * aria-required="true">' and this gate reported it as "Select" - widget furniture - while
         * the employer's question, "Are you currently authorized to work in the U.S.?", sits in a
         * plain div beside the widget, in no label element any candidate above can reach. The
         * furniture aria-label is demoted, not dropped: it comes back as the last resort below,
         * because "Select" is still one notch better than an unnamed required field when the
         * sibling walk finds nothing either. */
        const FURNITURE_LABEL = /^(?:search|select(?: one| an option)?|choose(?: one| an option)?|start typing.*|type to search.*)?[.…\s]*$/i;
        const ownAriaLabel = (element && element.getAttribute && element.getAttribute('aria-label')) || '';
        const furnitureAriaLabel = Boolean(element && element.getAttribute
          && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox')
          && clean(ownAriaLabel) && FURNITURE_LABEL.test(clean(ownAriaLabel)));
        /* The nearest preceding sibling on the way up that holds no controls of its own - the same
         * walk, with the same two stop rules, that discovery's combobox arm uses to recover these
         * labels, kept in step by hand like everything else the two passes share. Twelve, not six:
         * on the live Rippling form the question div sits ten parents above the widget. A sibling
         * that IS or HOLDS a control is the previous question and ends the walk; the one exception
         * is a widget's own hidden backing control (Select2 leaves its 1x1 aria-hidden <select>
         * as the immediate previous sibling of the span it renders), which belongs to THIS
         * question and is stepped past. Placed after every label-shaped candidate, so it can only
         * ever name a control that would otherwise be unnamed or furniture-named. */
        const besideQuestionText = (() => {
          /* Openers only. On a plain unlabeled text input this walk would borrow whatever
             preceding text sits within twelve levels - a section heading, an intro paragraph -
             and a wrong name is worse than no name (the rule the handle-only refusal below
             already states). The combobox shapes are the ones measured to carry their question
             in a plain sibling div, so they are the only shapes that pay the walk's risk. */
          const opener = (element && element.getAttribute
            && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox'))
            /* A widget's hidden backing control is the same question as the widget that renders
               it: the required Select2 <select> is aria-hidden while the span beside it carries
               the combobox role, and the gate flags the SELECT. Either face of the widget may be
               the one that arrives here. */
            || (element && element.getAttribute && element.getAttribute('aria-hidden') === 'true')
            || Boolean(widget && widget.querySelector
              && widget.querySelector('[role="combobox"], [aria-haspopup="listbox"]'));
          if (!opener) return '';
          let above = element;
          for (let depth = 0; above && depth < 12; depth += 1, above = above.parentElement) {
            /* Step past the widget's own hidden backing control AT THIS LEVEL - 'continue' here
               would ascend a level and put the flat-markup question div (label, hidden select,
               rendered span as siblings) forever out of reach, since one level up it is a child,
               not a preceding sibling. */
            let beside = above.previousElementSibling;
            while (beside && beside.matches && beside.matches('input, textarea, select')
              && beside.getAttribute('aria-hidden') === 'true') beside = beside.previousElementSibling;
            if (!beside) continue;
            if (beside.querySelector && beside.querySelector('input, textarea, select, [role="combobox"], button')) break;
            if (beside.matches && beside.matches('input, textarea, select, [role="combobox"], button')) break;
            const besideText = clean(renderedText(beside));
            if (besideText && besideText.length <= 200 && !genericControlText(besideText)) return besideText;
            if (besideText) break;
          }
          return '';
        })();
        for (const candidate of [
          renderedText(referenced),
          groupedChoiceQuestion,
          renderedText(byFor),
          wrappingLabelTextOf(element),
          renderedText(proxyReferenced),
          renderedText(legend),
          renderedText(own),
          furnitureAriaLabel ? '' : ownAriaLabel,
          widget && widget.getAttribute('aria-label'),
          nearestQuestionText(element),
          besideQuestionText,
          furnitureAriaLabel ? ownAriaLabel : ''
        ]) {
          const text = clean(candidate);
          if (!text) continue;
          if (genericControlText(text)) continue;
          // A machine identifier is not a label. Greenhouse names custom questions with UUIDs and
          // numeric tokens, and "question_19302464004 is required" tells the applicant nothing.
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) continue;
          // \p{L} and not [a-z]: a Japanese, Arabic or Cyrillic label is a label. An ASCII-only test
          // classifies every non-Latin label as a machine id and throws it away, so the control ends
          // up with no name at all and the applicant is told an unnamed field is required. The other
          // two copies of this judgement already ask it this way, the backend's fieldLabel.ts and
          // isProviderHandleOnly in this same runner; this one was the copy left behind.
          if (!/\p{L}/u.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      };
      // Does the control that was flagged required have an answer? Asked of THE CONTROL, and widened
      // to what surrounds it only where the answer genuinely does not live on the control itself.
      //
      // R-103. This used to be asked of the enclosing WIDGET, and its first check was "does anything
      // inside you render a React Select value". On Greenhouse the phone number input and its
      // country select share one <fieldset class="phone-input">, so an answered country made the
      // whole fieldset read as answered and an empty required #phone was invisible to this gate.
      // Measured live and read-only on the Redwood Materials form, 2026-08-08, with the form
      // otherwise complete: clearing #first_name or #email was caught by name, and clearing #phone
      // produced ZERO blockers. "Phone is required." is one of the six messages from the incident
      // this gate was built for, so the gate was blind to the field it exists to catch. Any required
      // control sharing a block with an answered choice control has the same shape; Greenhouse's
      // phone field is simply the one that ships on every form.
      const CHOICE_SHELL = '[class*="select__container"], [class*="select-shell"]';
      // The value a React Select renders, scoped to that select's OWN shell rather than to the block
      // around it, which is the whole of the fix. Returns null when the element is not a choice
      // control at all, so the caller can fall through rather than treat "not a select" as "empty".
      const CHOICE_CONTROL = '[class*="select__control"]';
      const CHOICE_OPENER = '[role="combobox"], [aria-haspopup="listbox"]';
      const reactChoiceBinding = (element) => {
        if (!element?.closest) return null;
        const outerShell = element.closest(CHOICE_SHELL);
        if (!outerShell) return null;
        const boundaryOf = (candidate) => candidate?.closest?.(CHOICE_CONTROL)
          || candidate?.closest?.(CHOICE_SHELL)
          || null;
        const hiddenBacking = String(element.tagName || '').toUpperCase() === 'INPUT'
          && String(element.type || '').toLowerCase() === 'hidden';
        if (!hiddenBacking) {
          // A class such as "select-shell-grid" can be a layout wrapper. Prefer the nearest
          // select__control when it owns exactly one opener, so a separate input in that grid cannot
          // either borrow this answer or make the answered choice look empty.
          const scope = element.closest(CHOICE_CONTROL) || outerShell;
          const answerControls = [...new Set(scope.querySelectorAll(
            'input:not([type="hidden"]), textarea, select, ' + CHOICE_OPENER
          ))].filter((candidate) => boundaryOf(candidate) === scope);
          const openers = [...new Set(scope.querySelectorAll(CHOICE_OPENER))]
            .filter((candidate) => boundaryOf(candidate) === scope);
          if (answerControls.length !== 1 || openers.length !== 1
            || answerControls[0] !== openers[0] || element !== openers[0]) return null;
          return { shell: outerShell, scope, opener: openers[0] };
        }
        const requiredBackings = [...outerShell.querySelectorAll(
          'input[type="hidden"][required], input[type="hidden"][aria-required="true"]'
        )].filter((candidate) => candidate.closest(CHOICE_SHELL) === outerShell);
        if (requiredBackings.length !== 1 || requiredBackings[0] !== element) return null;
        const openers = [...new Set(outerShell.querySelectorAll(CHOICE_OPENER))]
          .filter((candidate) => candidate.closest(CHOICE_SHELL) === outerShell);
        if (openers.length !== 1) return null;
        const opener = openers[0];
        const owner = opener.closest(CHOICE_CONTROL) || opener;
        const sameControl = owner !== opener && element.closest(CHOICE_CONTROL) === owner;
        const adjacentBacking = element.parentElement === outerShell
          && (element.previousElementSibling === owner || element.nextElementSibling === owner);
        return sameControl || adjacentBacking
          ? { shell: outerShell, scope: owner === opener ? outerShell : owner, opener }
          : null;
      };
      const chosenValueOf = (element) => {
        const binding = reactChoiceBinding(element);
        if (!binding) return null;
        const selected = [...binding.scope.querySelectorAll(
          '[class*="select__single-value"], [class*="select__multi-value__label"]'
        )].some((candidate) => (
          candidate.closest(CHOICE_CONTROL) || candidate.closest(CHOICE_SHELL)
        ) === binding.scope);
        if (selected) return true;
        // Still showing "Select...", so nothing was chosen. Returning false rather than falling
        // through stops the question label from being mistaken for an answer.
        const placeholder = [...binding.scope.querySelectorAll('[class*="select__placeholder"]')]
          .some((candidate) => (
            candidate.closest(CHOICE_CONTROL) || candidate.closest(CHOICE_SHELL)
          ) === binding.scope);
        if (placeholder) return false;
        return null;
      };
      const select2SourceAnswered = (element) => {
        const sourceTag = String(element?.tagName || '').toUpperCase();
        const sourceType = String(element?.type || '').toLowerCase();
        if (!(sourceTag === 'SELECT' || (sourceTag === 'INPUT' && sourceType === 'hidden'))
          || !element.classList?.contains('select2-offscreen')
          || !element.id) return null;
        const shell = element.previousElementSibling;
        if (!shell?.matches('.select2-container') || shell.id !== 's2id_' + element.id) return null;
        if (widgetOf(element) !== widgetOf(shell)) return null;
        if (shell.querySelectorAll(':scope > .select2-choice').length !== 1) return null;
        return Boolean(clean(element.value));
      };
      // Greenhouse's uploader REMOVES the file input once the upload finishes and replaces it with a
      // filename chip, so "no input[type=file] with files" is true of a block already given a file.
      // On the embed form the input survives instead and carries the file, so both are checked.
      const uploadHasFile = (scope) => {
        if (!scope) return false;
        if (scope.querySelector('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]')) return true;
        for (const input of scope.querySelectorAll('input[type="file"]')) {
          if (input.files && input.files.length > 0) return true;
        }
        return false;
      };
      /* An option chosen from a row of PLAIN BUTTONS, which is how Ashby renders every yes/no
       * question: '<button>Yes</button><button>No</button>' plus one 'input[type=checkbox]' that is
       * 'display:none' and carries the value. Neither the buttons nor the checkbox has a role, a
       * value or an aria-checked, so nothing above this can tell "No" apart from "unanswered" - the
       * checkbox is unchecked in both cases.
       *
       * The selected pill is marked by a class, and that is the only signal Ashby gives. Verified in
       * Ashby's own stylesheet, 2026-08-09: '._active_1svni_57{background-color:var(--colorPrimary900)
       * ...}' sits in the same CSS module as '._option_1svni_32', the pill class, and is the rule
       * that paints the chosen pill. The hash changes between bundles, so match the module-name
       * fragment rather than the whole class. '_selected_'/'_checked_' and the ARIA states are
       * accepted alongside it because other boards spell the same state those ways, and reading a
       * state that is genuinely set can only make this gate quieter, never louder.
       *
       * The broad reader remains for required custom button widgets that have no native control.
       * Checkbox and radio controls use the stricter Ashby-only reader below instead.
       */
      const PILL_SELECTED = /_active_|_selected_|_checked_/;
      const chosenPillOf = (scope) => {
        if (!scope || !scope.querySelectorAll) return null;
        const pills = [...scope.querySelectorAll('button')].filter((button) => {
          const text = clean(button.textContent);
          return text.length > 0 && text.length <= 40
            && !/upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i.test(text);
        });
        if (pills.length === 0) return null;
        return pills.some((pill) => PILL_SELECTED.test(String(pill.className || ''))
          || pill.getAttribute('aria-pressed') === 'true'
          || pill.getAttribute('aria-checked') === 'true'
          || pill.getAttribute('aria-selected') === 'true'
          || /^(?:on|true|active|selected|checked)$/i.test(pill.getAttribute('data-state') || ''));
      };
      // Null means "not this exact Ashby control", so normal checkbox and radio peer logic continues.
      const chosenAshbyYesNoOf = (subject) => {
        if (!subject?.closest || !subject?.querySelectorAll) return null;
        const field = subject.matches?.('[data-field-path], [class*=\"_fieldEntry_\"]')
          ? subject
          : subject.closest('[data-field-path], [class*=\"_fieldEntry_\"]');
        if (!field) return null;
        const checkboxes = [...field.querySelectorAll('input[type=\"checkbox\"]')].filter((input) => (
          input.closest('[data-field-path], [class*=\"_fieldEntry_\"]') === field
        ));
        const control = subject instanceof HTMLInputElement && subject.type === 'checkbox'
          ? subject
          : checkboxes.length === 1 ? checkboxes[0] : null;
        if (!control || checkboxes.length !== 1 || checkboxes[0] !== control) return null;
        const fieldPath = field.getAttribute('data-field-path');
        if (!fieldPath || control.name !== fieldPath) return null;
        const scope = control.closest('[class*=\"_yesno_\"]');
        if (!scope || !field.contains(scope)) return null;
        const answerPills = [...scope.querySelectorAll('button')].filter((pill) => (
          pill.closest('[class*=\"_yesno_\"]') === scope
          && isVisible(pill)
          && /^(?:yes|no)$/i.test(clean(pill.textContent))
        ));
        if (answerPills.length !== 2
          || answerPills.filter((pill) => /^yes$/i.test(clean(pill.textContent))).length !== 1
          || answerPills.filter((pill) => /^no$/i.test(clean(pill.textContent))).length !== 1) return null;
        return answerPills.some((pill) => PILL_SELECTED.test(String(pill.className || ''))
          || pill.getAttribute('aria-pressed') === 'true'
          || pill.getAttribute('aria-checked') === 'true'
          || pill.getAttribute('aria-selected') === 'true'
          || /^(?:on|true|active|selected|checked)$/i.test(pill.getAttribute('data-state') || ''));
      };
      const semanticChoiceGroup = (element) => element?.closest?.(
        '[role="group"][aria-labelledby], [role="group"][aria-label],'
        + ' [role="radiogroup"][aria-labelledby], [role="radiogroup"][aria-label]'
      ) || null;
      const hasAnswer = (element) => {
        if (!element) return false;
        const select2Answer = select2SourceAnswered(element);
        if (select2Answer !== null) return select2Answer;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
          // A combobox input holds the SEARCH text, which react-select clears on selection. Its
          // emptiness says nothing about whether an option was chosen, so read what the select
          // renders instead - but only for THIS select.
          const chosen = chosenValueOf(element);
          if (chosen !== null) return chosen;
          if (element.type === 'hidden') return false;
          if (element.type === 'file') return uploadHasFile(element.parentElement);
          if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.checked) return true;
            // Ashby's hidden yes/no checkbox is unchecked whether the applicant picked "No" or picked
            // nothing, so the pills beside it are the only place the answer is legible. Asked before
            // the peer-group walk because that walk reads the same unchecked inputs.
            const pill = chosenAshbyYesNoOf(element);
            if (pill !== null) return pill;
            const semanticGroup = semanticChoiceGroup(element);
            if (semanticGroup) {
              return [...semanticGroup.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
                .some((peer) => peer.checked);
            }
            if (!element.name) return false;
            // One answered radio answers its whole group, and only the checked member carries it.
            for (const peer of (element.form || document).querySelectorAll('input[name="' + CSS.escape(element.name) + '"]')) {
              if (peer.checked) return true;
            }
            return false;
          }
          return Boolean(clean(element.value));
        }
        // Not a form control at all. Greenhouse marks its uploader required with a
        // <div role="group" aria-required="true"> and leaves the file input itself unmarked, so the
        // flagged element is a container. This is the one case where widening is the right answer,
        // because a container has no value of its own to read.
        if (uploadHasFile(element)) return true;
        const chosen = chosenValueOf(element);
        if (chosen !== null) return chosen;
        const pill = chosenPillOf(element);
        if (pill !== null) return pill;
        /* A BARE COMBOBOX HOLDS ITS ANSWER AS ITS RENDERED TEXT, and this gate could not read it.
         * Measured live on ats.rippling.com (Easy Dynamics, 2026-08-20): the fill landed "Yes" on
         * the work-authorization div - the run's own preview screenshot shows it - and this gate
         * still reported '"Are you currently authorized to work in the U.S.?" is required and is
         * still empty', because a div is none of the tag arms above and holds no child control for
         * the loop below. The rendered text IS the value for this shape; furniture words are what
         * the widget says when it holds nothing, judged by the same vocabulary the label demotion
         * uses (BARE_OPENER_FURNITURE below, pinned equal to its two siblings by the drift test). */
        if (element.getAttribute
          && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox')
          && !element.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select')) {
          const BARE_OPENER_FURNITURE = /^(?:search|select(?: one| an option)?|choose(?: one| an option)?|start typing.*|type to search.*)?[.…\s]*$/i;
          /* Three empty-state readings, because a tenant can configure its own placeholder and a
           * placeholder read as an answer is a silent skip of a required field - the one direction
           * this file forbids. (1) the shared furniture vocabulary; (2) text that merely restates
           * the widget's own aria-label ("Select" / "Select", the measured Rippling empty state);
           * (3) placeholder-shaped grammar - an imperative select/choose/pick opening or a bare
           * "none selected". A real ANSWER that happens to open with those words ("Choose not to
           * disclose") reads as empty and keeps its blocker, which fails toward a person looking
           * at an answered control - the direction this gate is allowed to be wrong in. */
          const PLACEHOLDER_SHAPED = /^(?:--\s*)?(?:please\s+)?(?:select|choose|pick)\b|^none\s+selected$/i;
          const rendered = clean(renderedText(element));
          if (!rendered) return false;
          const openerAriaLabel = clean(element.getAttribute('aria-label') || '');
          if (openerAriaLabel && rendered.toLowerCase() === openerAriaLabel.toLowerCase()) return false;
          return !BARE_OPENER_FURNITURE.test(rendered) && !PLACEHOLDER_SHAPED.test(rendered);
        }
        for (const control of element.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
          if (hasAnswer(control)) return true;
        }
        return false;
      };
      const required = [];
      const seen = new Set();
      // Keyed on the CONTROL, not the block, so a block holding two required controls can report
      // both. Greenhouse's phone fieldset holds exactly that: the country select and the number.
      // The error scan below hands back the same element object the required scan flagged, so the
      // two still do not report one field twice.
      // A checkbox or radio GROUP is one question wearing many inputs, and every one of them is
      // "required and still empty" until one is chosen. Reporting each separately turned three
      // unanswered Greenhouse questions into seventeen blockers named after their options, and on
      // Lever's 34-language checkbox list it turns one question into thirty-four. The end-of-run
      // scan this gate replaced deduped on the group name for exactly that reason; keying 'seen' on
      // the control alone lost it, so the group name is carried here too.
      const reportedGroups = new Set();
      const note = (widget, element, why) => {
        const key = element || widget;
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (!isVisible(widget)) return;
        // After the visibility test, so an invisible member cannot claim the group and silence the
        // visible one beside it.
        const choice = element && (element.type === 'checkbox' || element.type === 'radio');
        const groupKey = choice
          ? (semanticChoiceGroup(element) || element.name || '')
          : '';
        if (groupKey) {
          if (reportedGroups.has(groupKey)) return;
          reportedGroups.add(groupKey);
        }
        if (hasAnswer(element)) return;
        const label = labelOf(widget, element);
        required.push({
          label,
          why,
          message: label
            ? '"' + label + '" is required and is still empty'
            : 'A required field on the form has no label Litos can read, and is still empty'
        });
      };
      /* THE HUMAN CHECK IS NOT EIGHT UNANSWERED QUESTIONS.
       *
       * Greenhouse's security-code widget renders eight single-character inputs and puts
       * aria-required="true" on every one of them (read 2026-08-10 out of the bundle the Cresta
       * board serves live). The attribute loop below therefore claims all eight the moment the
       * challenge appears, and an applicant waiting on an email would be handed eight blocker
       * sentences telling her a required field is empty, under the one honest sentence telling her
       * to go and read her mailbox. She would go looking for form fields to fill.
       *
       * A previous fixture asserted this could not happen; it asserted it against markup that
       * carried no aria-required, so it was proving something about the fixture. Excluded on the
       * SHAPE of the control - a run of four or more one-character inputs sharing a parent, or the
       * platform's own autocomplete name - which is the same structural signal
       * readSecurityCodeChallenge keys on, and not on any word anywhere on the page.
       *
       * It is not a hole in the gate. These boxes are not a question the applicant can answer from
       * her profile, they are answered by the code endpoint, and the challenge itself is reported
       * separately and much more usefully as humanVerification. */
      const securityCodeBoxes = new Set();
      {
        const typed = [...root.querySelectorAll('input')].filter((element) => (
          !/checkbox|radio|file|hidden|submit|button|image|reset/.test(element.type || 'text')
        ));
        for (const element of typed) {
          if (/one-time-code/i.test(element.getAttribute('autocomplete') || '')) securityCodeBoxes.add(element);
        }
        const byParent = new Map();
        for (const element of typed) {
          if (element.maxLength !== 1) continue;
          const parent = element.parentElement;
          if (!parent) continue;
          if (!byParent.has(parent)) byParent.set(parent, []);
          byParent.get(parent).push(element);
        }
        for (const group of byParent.values()) {
          if (group.length >= 4) for (const element of group) securityCodeBoxes.add(element);
        }
      }
      // Native required, plus aria-required. React Select's input carries aria-required="true" and
      // no a "required" attribute at all, so a gate built only on [required] cannot see an unanswered
      // Greenhouse screener question - which is precisely the control this gate exists to catch.
      for (const element of root.querySelectorAll(
        '${SUBMIT_READINESS_POLICY.requiredAttributes}'
      )) {
        if (element.disabled) continue;
        if (securityCodeBoxes.has(element)) continue;
        if (!isVisible(element) && !isVisible(widgetOf(element))) continue;
        note(widgetOf(element), element, 'required');
      }
      /* D-01. THE REQUIRED MARKER THAT IS NEITHER AN ATTRIBUTE NOR AN ARIA STATE.
       *
       * Measured on the live Deepgram Ashby posting, 2026-08-09, the form behind the packet that
       * shipped as "Done - 5 checked" with three required fields empty: SIX controls carry the
       * 'required' attribute and ZERO carry aria-required. The three empty ones - "Current Location",
       * and the two work-eligibility yes/no questions - carry neither, so both loops above are blind
       * to them and the run reported no blockers at all.
       *
       * Ashby marks a required question with a class on the question's own <label>, and paints the
       * asterisk from it: '._required_f7cvd_91:after{color:var(--colorNegative600);content:"*"}',
       * read out of Ashby's stylesheet on the same day. Three hashed variants of that rule ship in
       * one bundle ('_required_f7cvd_91', '_required_1e3gg_37', '_required_kyg4m_26'), so the match
       * is on the module-name fragment, not on a whole class name.
       *
       * WHY THIS IS NOT THE 2026-08-08 MISTAKE. An earlier pre-submit gate matched the form's own
       * legend text, "* indicates a required field", and so would have refused EVERY Greenhouse
       * submission there is (see LEGEND_TEXT below, which is what remains of it). This reads no page
       * text whatsoever. It reads a class on ONE specific question's label element, which is the same
       * kind of per-control machine signal as 'required' and 'aria-required' - the employer's own
       * markup saying "this field, in particular". It cannot fire on a page-level notice because a
       * page-level notice is not a field label, and it cannot fire on a form that does not use this
       * convention because the class simply is not there. Greenhouse, Lever, Workable, SmartRecruiters
       * and the rest render no '_required_' class at all, so on those families this loop finds nothing
       * and the two above continue to do all the work.
       *
       * note() dedupes on the control, so a field caught by BOTH the attribute loop and this one is
       * still reported once.
       */
      // Shared by both marker loops: the control a marked label speaks for, handed to note().
      // 'for=' first, because Ashby sets it even where the input it names has no id of its own (the
      // location combobox), in which case the lookup misses and the block's first real control is
      // the right answer. A file input is excluded from the fallback for the same reason hasAnswer
      // treats uploads specially: the widget, not the input, is what holds the evidence of an
      // upload. widgetFallback is the block itself, and is passed only by the class arm below.
      const noteMarkedLabel = (marker, widgetFallback) => {
        const widget = widgetOf(marker);
        if (!widget || !isVisible(widget)) return;
        const named = marker.getAttribute('for');
        const controls = [...widget.querySelectorAll(
          'input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"]'
        )];
        const explicitlyRequired = controls.filter((candidate) => marker.contains(candidate)
          && !candidate.disabled
          && (candidate.required || candidate.getAttribute('aria-required') === 'true'));
        const target = (named && widget.querySelector('#' + CSS.escape(named)))
          // Workable wraps its country-code combobox and required phone input in one starred label,
          // with the combobox first in DOM order. The star belongs to the one descendant Workable
          // actually marks required, not to that adjacent opener. Prefer that unambiguous machine
          // signal only when the marked label owns that control. A broad widget fallback can be
          // the entire form, and must not borrow an unrelated required field. Retain the existing
          // first-control fallback for zero or multiple marked descendants.
          || (explicitlyRequired.length === 1 ? explicitlyRequired[0] : null)
          || controls[0]
          || (widgetFallback ? widget : null);
        if (!target || target.disabled) return;
        note(widget, target, 'required');
      };
      for (const marker of root.querySelectorAll('${SUBMIT_READINESS_POLICY.requiredClassMarkers}')) {
        // An Ashby question block with no readable control still has to block, which is where PR #22
        // measured this arm.
        noteMarkedLabel(marker, true);
      }
      /* AND THE SAME MARK ON GREENHOUSE, WHERE IT IS A LITERAL ASTERISK IN THE LABEL TEXT.
       *
       * Ashby's asterisk is a ':after' pseudo-element and appears in no label text, which is why the
       * arm above reads a class. Greenhouse prints the character itself: measured read-only on the
       * live zscaler posting, 19 of its 30 labels carry a standalone "*", and on yugabyte 3 of 23.
       * So the same employer statement, "this field in particular", is spelled two different ways
       * and a gate that knows only one of them is blind on the other family. Both are per-control:
       * this reads the text of ONE <label> or <legend> that speaks for ONE control, never the page.
       *
       * THE 2026-08-08 MISTAKE IS THE ONE NOT TO REPEAT. The form's own legend, "* indicates a
       * required field", was the ONLY thing an early gate found on a complete application, and
       * refusing there would have blocked every Greenhouse submission there is. A page-level notice
       * is a <p>, not a label, so it cannot reach this loop at all; ASTERISK_LEGEND excludes the
       * same sentence a second time for the boards that do print it inside a label block.
       *
       * No widget fallback here, because "a <label> somewhere carries a star and I could not find
       * its control" is not evidence that an application is incomplete.
       *
       * The asterisk test is labelMarksRequired's, character for character (the backend's
       * questionDiscovery.ts), so discovery and this gate cannot disagree about which fields the
       * employer marked required.
       *
       * MEASURED CONTRIBUTION, read-only against live forms on 2026-08-09. On the zscaler and
       * yugabyte Greenhouse postings this loop adds ZERO blockers: every field it finds already
       * carries 'required' or aria-required, so the whole gate returns the same 21 and 3 messages it
       * returned without it. On the Deepgram, Ramp and Linear Ashby forms it matches ZERO labels,
       * because Ashby prints no asterisk anywhere. It earns its place on the one shape neither
       * attribute loop can see: a Greenhouse screener question marked with a red asterisk and
       * nothing else.
       */
      const ASTERISK_MARK = /${SUBMIT_READINESS_POLICY.asteriskMark}/;
      const ASTERISK_LEGEND = /${SUBMIT_READINESS_POLICY.asteriskLegend}/i;
      for (const marker of root.querySelectorAll('label, legend')) {
        const markerText = (marker.textContent || '').replace(/\s+/g, ' ').trim();
        if (!ASTERISK_MARK.test(markerText) || ASTERISK_LEGEND.test(markerText)) continue;
        noteMarkedLabel(marker, false);
      }
      // Visible validation messages, matched back to the control they accuse. An unmatched message,
      // or one over an empty control, blocks; one over a filled control is stale and is only
      // reported.
      const stale = [];
      const unmatched = [];
      const ERROR_TEXT = /${SUBMIT_READINESS_POLICY.errorText}/i;
      // A form's own legend says "* indicates a required field", and it matched the line above.
      // Measured on the live Redwood Materials form: that legend was the ONLY thing the gate found
      // on a completely and correctly filled application, so the gate would have refused to submit
      // every Greenhouse application there is. A gate that blocks everything is not caution.
      const LEGEND_TEXT = /${SUBMIT_READINESS_POLICY.legendText}/i;
      for (const element of root.querySelectorAll('*')) {
        if (element.children.length > 0) continue;
        const text = clean(element.textContent);
        if (!text || text.length > 160 || !ERROR_TEXT.test(text) || LEGEND_TEXT.test(text)) continue;
        if (!isVisible(element)) continue;
        // What this loop is looking for is the error line the form renders under a control. The
        // test below is what keeps it from reading the control's own question instead.
        const widget = widgetOf(element);
        if (!widget || widget === element) { unmatched.push(text); continue; }
        // A message sitting in a block that holds no control at all is not a field error. It is the
        // form's legend or a page-level notice, and attributing it to a field invents a blocker.
        const controls = [...widget.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]')];
        if (controls.length === 0) continue;
        /* THE FIELD'S OWN QUESTION IS NOT THE FIELD'S OWN COMPLAINT.
         *
         * A <label for="..."> naming a control in this very block is the employer ASKING, and
         * reading it as the employer REFUSING blocks a field on the strength of its own wording.
         *
         * THE COMMENT THAT USED TO STAND HERE SAID THIS COULD NOT HAPPEN: "the label of a required
         * question reads '... *', never 'is required', so this does not pick up labels". Half of
         * that is true and it is the wrong half. A REQUIRED Greenhouse label carries
         * <span aria-hidden="true">*</span> inside it, so it is not a leaf and never reaches this
         * loop at all. An OPTIONAL one is a bare leaf <label>, and ERROR_TEXT contains
         * "please provide". So the assumption held for exactly the fields it was written about and
         * failed on every other one.
         *
         * Measured read-only against the live Greenhouse markup on 2026-08-13. Scale AI's
         * question_8788020005 is labelled "If yes, please provide further explanation below." and
         * carries aria-required="false", no required attribute and no asterisk; DV Trading's
         * question_8954179005 is the same shape. Four Scale AI packets and three DV Trading packets
         * stopped on a field neither employer requires, and each was additionally told "1 required
         * field has no question you can answer in Litos" about it, because a field the employer
         * left optional correctly has no question record.
         *
         * THIS OPENS NO HOLE ON A REQUIRED FIELD. Every field this loop can reach that the employer
         * really does mark required is already reached by the three loops above it - the native and
         * aria-required scan, the _required_ class marker, and the asterisk marker - and note()
         * keys on the control, so a genuinely required field caught there is untouched by anything
         * skipped here. Akuna's question_67727968 is that case, character for character: the same
         * "please provide" wording, aria-required="true" and an asterisk, and it still blocks. What
         * is given up is a field whose ONLY evidence of being required is that its own label happens
         * to contain a word from ERROR_TEXT, which was never evidence.
         *
         * AND IT IS BOUNDED TO THE FIRST LABEL NAMING THAT CONTROL, WHICH IS THE QUESTION.
         *
         * "Some label names this control" was the first spelling of this rule and it was too wide,
         * because <label for> is also the most common cross-framework shape for an inline field
         * ERROR. jQuery Validation's default errorElement IS a label, it sets for=idOrName(element),
         * and its default text "This field is required." is a member of ERROR_TEXT above. Measured
         * in a real browser on this branch: '<label class="error" for="q_start">This field is
         * required.</label>' and '<label class="error-message" for="applicant_phone">Phone cannot be
         * blank</label>' each blocked before the rule existed and blocked nothing after it, with
         * both suites green. confirmAndSubmit does not catch what falls through here - its candidate
         * scan is built from [required], aria-required, the _required_ class and asterisk markers,
         * and a field required only by the form's rendered message matches none of them.
         *
         * The question label is authored WITH the field; the validator's complaint is appended to it
         * afterwards. So being FIRST is the discrimination, and it is what the querySelector in the
         * fragment is doing. Held on employer-shaped markup by own-question-readiness-dom.test.js.
         *
         * NOT CLOSED, and named rather than left to be rediscovered: a validator that PREPENDS its
         * error, and a control whose only <label> is the error because its question is rendered as a
         * <span> or <div>, both put the complaint first and are still skipped. Measured on both
         * shapes. Neither is a regression from this narrowing, which only ever adds blockers back.
         *
         * ONE STATEMENT, SHARED, RATHER THAN TWO THAT AGREE. The same test was written into the
         * backend's copy of this gate as its PR #527 and never reached here, which is why the
         * sentences above went on being produced for the whole life of that fix. It is now
         * interpolated from SUBMIT_READINESS_POLICY at the top of this file, whose hash both repos
         * pin and this file's boot check enforces. The fragment may only name bindings both copies
         * share: this scan calls its root 'root' and the backend calls its own 'scanRoot', so it
         * reaches for 'widget', which is the same name in both. */
        ${SUBMIT_READINESS_POLICY.ownQuestionSkip}
        // WHICH control does the message accuse? A block can hold several: Greenhouse's phone field
        // is a fieldset holding the country select and the number, and its uploader holds both the
        // resume and the cover letter. Reading the block as a whole gets this wrong in both
        // directions, so prefer a control that says it is required and is still empty.
        const marked = controls.filter((candidate) => candidate.required || candidate.getAttribute('aria-required') === 'true');
        let culprit = null;
        if (marked.length > 0) {
          culprit = marked.find((candidate) => !hasAnswer(candidate)) || null;
        } else if (!controls.some((candidate) => hasAnswer(candidate))) {
          // Nothing here claims to be required, so the message is the only signal there is. It may
          // block, but only when NOTHING in the block has been answered. Blaming an empty OPTIONAL
          // control (a cover letter sitting beside a filled resume) for someone else's message is
          // how a complete application gets refused, which is the harm this gate exists to avoid.
          culprit = controls[0];
        }
        if (!culprit) { stale.push(text); continue; }
        // note() keys on the control, and this is the same element object the required scan flags,
        // so a field already reported is not reported twice for carrying the matching error line.
        note(widget, culprit, 'error');
      }
      /* A CONTROL THIS RUN ANSWERED AND COULD NOT CONFIRM, which every rule above is blind to.
       *
       * Everything else in this scan asks "is this required field EMPTY". A choice control holding a
       * wrong answer is not empty, so it passed the gate: hasAnswer reads the rendered value, finds
       * one, and says yes. Measured on a React Select offering only "I am authorized to work in the
       * United States only with a student visa" against that stored answer without the last four
       * words - the widened tier clicked the row, the verifier refused it, the field was reported to
       * the applicant as one whose "choice value did not persist", the control was left holding the
       * student-visa declaration, and this scan returned zero blockers. The run then pressed Submit.
       * A wrong answer is worse than a blank one and blank was the only thing that stopped a run.
       *
       * NOT READ OFF THE PAGE, and that distinction is the whole reason this is allowed to block.
       * The attribute is written by the runner itself at the moment a click is refused, exactly like
       * the submit-scope and security-code markers, so this is the run reading its own record rather
       * than a gate keying on employer text - which is the 2026-08-08 mistake that would have
       * refused every Greenhouse application there is. Nothing an employer renders can produce it,
       * and a control that verifies clean has its mark removed in the same breath.
       *
       * TWO KINDS, because the applicant is told different things. 'different' means the control
       * published a value and it is not her answer and the withdrawal could not take it back;
       * 'unreadable' means the control publishes nothing, so the run genuinely does not know what it
       * left there. Neither is evidence that the form is safe to send.
       *
       * NAMED FROM THE MARKED BLOCK ITSELF FIRST, because the mark is written on the question's own
       * container and that container already holds the question's label. Going through widgetOf
       * first gets this wrong whenever the container matches none of the widget selectors: it falls
       * back to parentElement, which on a Select2 block is the FORM, and the form's first label is
       * somebody else's question. Measured on this repo's own select2 gate fixture, where a blocker
       * about the field of study came back named "Full name". A wrong name is worse than no name.
       */
      const marked = [...root.querySelectorAll('[data-litos-unverified-choice]')];
      if (root.nodeType === 1 && root.hasAttribute('data-litos-unverified-choice')) marked.unshift(root);
      for (const element of marked) {
        if (!isVisible(element)) continue;
        const widget = widgetOf(element);
        const inner = element.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]');
        const named = labelOf(element, inner || element) || labelOf(widget, element);
        const subject = named ? '"' + named + '"' : 'A choice field on the form';
        required.push({
          label: named,
          why: 'unconfirmed',
          message: element.getAttribute('data-litos-unverified-choice') === 'unreadable'
            ? subject + ' was answered by Litos and this control does not report what it is holding,'
              + ' so what it is now carrying could not be confirmed'
            : subject + ' was answered by Litos and is now showing something that is not that answer'
        });
      }
      return {
        // Deduped by message, because keying on the control means one React Select can be flagged
        // twice: an unanswered one carries aria-required on BOTH its combobox input and the hidden
        // input react-select keeps beside it, and the two resolve to the same question and the same
        // label. Measured on the empty live Redwood form: 15 entries covering 8 distinct fields.
        blocking: [...new Set(required.map((entry) => entry.message))],
        stale: [...new Set(stale)],
        unmatched: [...new Set(unmatched.filter((text) => !stale.includes(text)))]
      };
      };
      const failed = { blocking: ['Required-field readiness scan failed'], stale: [], unmatched: [] };
      return scope ? scope.evaluate(scan).catch(() => failed) : page.evaluate(scan).catch(() => failed);
    };
    /* Commit answers that the page paints as filled while its own validation still calls them
     * unanswered. This action does not search for a convenient place to click. It marks the exact
     * affected control in the current DOM, commits that control using events appropriate to its
     * field type, then reads the same validation state back. An unresolved control is proof of
     * failure and the following submit is withheld. */
    const confirmAndSubmitPass = async (action) => {
      const chooserHash = crypto.createHash('sha256')
        .update(action.chooserPolicy.finalPattern + '\n' + action.chooserPolicy.exclusionPattern)
        .digest('hex');
      if (chooserHash !== action.chooserPolicy.grammarHash) {
        throw new Error('Atomic submit chooser grammar hash mismatch');
      }
      /* THE SUBMISSION SCOPE IS NOT ALWAYS A <form>, AND ON ASHBY IT NEVER IS.
       *
       * This filter used to require element.closest('form'). Measured on the live kos.ai Ashby
       * application page: document.querySelectorAll('form').length === 0, with 4 inputs, 1 textarea
       * and 2 file inputs fully rendered, and the Submit Application button sitting inside a plain
       * div#form. Every Ashby application therefore produced an empty viable list and threw
       * "Atomic submit control was missing or ambiguous" before anything was clicked.
       *
       * The scope is what the whole pass binds to: the required-field scan root, the readiness
       * scan root, the fingerprint subject and the sameNode witness. So it is resolved once, here,
       * and stamped onto the DOM so Playwright addresses the exact node rather than re-deriving it.
       * Five rules, in order, and the last four all exist to keep a scope from being trusted on a
       * page that has not earned it:
       *
       *   1. a form ancestor, but only a form that is plausibly the application itself. See
       *      isApplicationSurface: a button that merely sits inside SOME form is not a submit;
       *   2. otherwise a container, but ONLY if no candidate anywhere on the page is viable under
       *      rule 1, so a page the current code can already submit is untouched;
       *   3. a button inside a form never reaches rule 2. If its own form is not the application,
       *      it has no scope at all, because a stray form's control is not this run's submit;
       *   4. the container is the nearest ancestor holding a field control, and it is accepted only
       *      when every required field on its own tree, outside any form, is inside it. Where a
       *      form was refused under rule 1, the container must additionally be one this run wrote
       *      inside, or be named by the control itself, so that refusing a form withholds the
       *      click rather than relocating it onto a decoy that collects a little more;
       *   5. never body and never documentElement, because "the whole page" is not a scope. */
      const readSubmitChoices = async () => await page.locator(action.selector).evaluateAll((elements, chooser) => {
        const FIELD_CONTROLS = 'input:not([type="hidden"]), textarea, select, [role="combobox"], input[type="file"]';
        const REQUIRED_CONTROLS = 'input:not([type="hidden"])[required], textarea[required], select[required], [aria-required="true"]';
        const WIDGET = '[class*="select__container"], .field, .field-wrapper, fieldset, [role="group"],'
          + ' [data-field-path], [class*="_fieldEntry_"]';
        const ASTERISK_MARK = /\*(?:\s|$)|(?:^|\s)\*/;
        const ASTERISK_LEGEND = /\*\s*(?:indicates|denotes|means|marks|=)/i;
        /* The clear has to cross shadow roots because the READ-BACK does. document.querySelectorAll
         * stops at a shadow boundary, a Playwright CSS locator pierces it, so a marker written
         * inside a shadow tree used to survive every later clear and be found again on the next
         * pass. A retained page that binds and clicks once would then see two nodes carrying the
         * same index and throw for the rest of the session. The candidate marker is cleared for the
         * same reason: it is read back by exactly the same kind of locator. */
        const clearMarkers = (root) => {
          for (const attribute of ['data-litos-submit-scope-v2', 'data-litos-submit-candidate-v2']) {
            for (const stale of root.querySelectorAll('[' + attribute + ']')) stale.removeAttribute(attribute);
          }
          for (const node of root.querySelectorAll('*')) if (node.shadowRoot) clearMarkers(node.shadowRoot);
        };
        clearMarkers(document);
        const isVisible = (element) => {
          if (!element || !element.getBoundingClientRect) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const widgetOf = (element) => element.closest(WIDGET) || element.parentElement || element;
        /* WHAT MAKES A CONTAINER THE APPLICATION, rather than merely a box that holds a field.
         *
         * The innermost box holding one field can be smaller than the application: a consent block,
         * or a final section with the submit in it. Binding that box would scan its one field, find
         * it answered, and click with an employer's required question elsewhere on the page still
         * empty. So a container is only accepted when every required field on its own tree, outside
         * any form, is inside it.
         *
         * Climbing until that is true was the alternative, and it is worse. A required field
         * outside the innermost box is either part of the application or someone else's furniture,
         * and nothing in a formless DOM says which. Climbing answers "part of the application"
         * every time, which swallows a job-alert email into the scope and then blocks on it
         * forever, with no stopping point short of body. Refusing answers "this run does not know",
         * which is true, and it fails closed exactly as an unresolvable submit already does.
         *
         * Controls inside a <form> are exempt: they belong to that form's own submission, so a
         * newsletter form beside a formless application cannot veto the application. */
        const requiredOutside = (scopeNode) => {
          const root = scopeNode.getRootNode();
          const byId = (id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id));
          const required = new Set();
          const add = (control) => {
            if (!control || control.closest('form')) return;
            if (!isVisible(widgetOf(control))) return;
            required.add(control);
          };
          const fromMarker = (marker) => {
            const named = marker.getAttribute('for');
            return (named && byId(named)) || widgetOf(marker).querySelector(FIELD_CONTROLS) || null;
          };
          for (const control of root.querySelectorAll(REQUIRED_CONTROLS)) add(control);
          for (const marker of root.querySelectorAll('label[class*="_required_"], legend[class*="_required_"]')) {
            add(fromMarker(marker));
          }
          for (const marker of root.querySelectorAll('label, legend')) {
            const text = String(marker.textContent || '').replace(/\s+/g, ' ').trim();
            if (!ASTERISK_MARK.test(text) || ASTERISK_LEGEND.test(text)) continue;
            add(fromMarker(marker));
          }
          return [...required].some((control) => !scopeNode.contains(control));
        };
        const containerOf = (element) => {
          let node = element.parentElement;
          while (node) {
            if (node === document.body || node === document.documentElement) return null;
            if (node.querySelector(FIELD_CONTROLS)) return node;
            node = node.parentElement;
          }
          return null;
        };
        /* WHAT MAKES A NODE THE APPLICATION, rather than merely a box the page happens to carry.
         *
         * Asked of a <form> to decide whether a control inside it is this run's submit, and asked
         * of a container in the one place where refusing a form would otherwise move the click; see
         * refusedFormExists below.
         *
         * Measured in Chromium on an Ashby application page, which renders no <form> of its own,
         * carrying one unrelated stray form: with "is it inside any form at all" as the only test,
         * a newsletter form whose button says "Submit" took the click, and a filter form whose
         * button says "Apply" took the click. The real application submit was never pressed. Worse
         * than losing the click: a stray form holding a final-intent control also satisfies rule 2
         * above, so it vetoes the container path and silently disables every formless application
         * on that page.
         *
         * So a form has to show that it is an intake surface. Three kinds of evidence, any one of
         * which is enough, and no evidence means no scope:
         *
         *   - THIS RUN WROTE INTO IT. addressedSelectors carries the selector of every fill,
         *     upload and select action the caller aimed at this page. A form holding one of those
         *     controls is the form this run was filling. This is the only evidence that survives a
         *     one-field application, and it is what a real run almost always has. It is also the
         *     one that goes missing on a continuation phase, whose selectors were written against
         *     the previous DOM, which is why the refusal path below has to be safe on its own;
         *   - IT COLLECTS WHAT AN APPLICATION COLLECTS. Two or more text-entry controls, or a file
         *     input beside at least one other field. A newsletter asks for an email and nothing
         *     else; a search box asks for one string; a filter is made of selects. An application
         *     asks for a name AND contact details, and nearly always a resume. The resume is not
         *     the sole gate on purpose: kos.ai on Ashby takes name, email and a resume file input
         *     and nothing more, and forms with no upload at all still have to pass;
         *   - THE CONTROL NAMES THE APPLICATION. Only the chooser's strongest tier, the one
         *     already scored 3 by the pinned grammar, which is a control reading "submit
         *     application" or "send my application" rather than a bare "submit" or "apply". A page
         *     that puts that sentence on a button has said which form it belongs to.
         *
         * Everything here is structure or the run's own record, not a list of forbidden words: a
         * blocklist of "newsletter", "subscribe", "search" is exactly the finite phrase list this
         * codebase has had bypassed before, and it would not have caught the filter form measured
         * above, whose button says "Apply". The one word-free exception is role="search", which is
         * the page declaring in ARIA what the form is, not us guessing from its label.
         *
         * Counting ignores CSS visibility on purpose. Every ATS in production hides its resume
         * input behind a styled dropzone, so a visibility test would throw away the file signal on
         * the exact forms it exists for. The control that gets clicked is still filtered on
         * visibility, one level up, which is where that test belongs. */
        const TEXT_ENTRY_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'week', 'time']);
        const isTextEntry = (control) => {
          /* A CHOICE IS NOT INTAKE. A filter panel is built of selects and comboboxes and a search
           * box is one string, so none of them count towards the two this test asks for. They are
           * still fields, so they still satisfy the file-input rule below, which is what keeps an
           * application whose questions are all dropdowns beside a resume. A React Select renders
           * its own input[type=text], which is why the role is read before the type. */
          const role = String(control.getAttribute('role') || '').toLowerCase();
          if (role === 'combobox' || role === 'listbox' || role === 'searchbox') return false;
          if (control.getAttribute('aria-haspopup') === 'listbox') return false;
          const tag = control.tagName.toLowerCase();
          if (tag === 'textarea') return true;
          if (tag !== 'input') return false;
          const type = String(control.getAttribute('type') || 'text').toLowerCase();
          return type !== 'search' && TEXT_ENTRY_TYPES.has(type);
        };
        const addressed = new Set();
        for (const selector of chooser.addressed || []) {
          let node = null;
          // document.querySelector, singular, because the fill it stands for used locator.first().
          try { node = document.querySelector(selector); } catch { node = null; }
          if (node) addressed.add(node);
        }
        const writtenInto = (node) => [...addressed].some((control) => node.contains(control));
        const intakeEvidence = new Map();
        const isApplicationSurface = (node, score) => {
          if (String(node.getAttribute('role') || '').toLowerCase() === 'search') return false;
          if (score >= 3) return true;
          if (!intakeEvidence.has(node)) {
            const fields = [...node.querySelectorAll(FIELD_CONTROLS)];
            const textEntry = fields.filter(isTextEntry);
            const files = fields.filter((control) => control.matches('input[type="file"]'));
            intakeEvidence.set(node, writtenInto(node) || textEntry.length >= 2 || (files.length >= 1 && fields.length >= 2));
          }
          return intakeEvidence.get(node);
        };
        /* WHAT A CONTAINER NEEDS WHEN IT IS DISPLACING A FORM THIS RUN REFUSED, which is strictly
         * more than the intake test above.
         *
         * Intake is a threshold, and a threshold is something a decoy can simply be over. A
         * formless "Talk to a recruiter" widget asking a name and an email, or a "Join our talent
         * pool" widget asking an email and a CV, satisfies exactly the test a three-select
         * self-identification form fails, and React pages render widgets like those with no <form>
         * at all, for the same reason Ashby renders none. Measured in Chromium: with intake as the
         * gate, both of those widgets took the click on pages main submits correctly.
         *
         * Counting fields on both sides and taking the larger is no better, because the decoy wins
         * that comparison by holding one more input. So the gate is the two things a decoy cannot
         * manufacture by being slightly richer: THIS RUN WROTE INSIDE IT, or the control names the
         * application outright. Both are statements about this run and this page rather than about
         * how much a box collects.
         *
         * This is only reachable when a form was refused. Where no form is in play, the PR 42
         * container rules stand untouched, which is why a formless page with a single field still
         * submits exactly as it does today. */
        const canDisplaceRefusedForm = (container, score) => score >= 3 || writtenInto(container);
        const markScope = (node, index) => {
          const current = node.getAttribute('data-litos-submit-scope-v2');
          const tokens = current ? current.split(/\s+/).filter(Boolean) : [];
          if (!tokens.includes(String(index))) tokens.push(String(index));
          node.setAttribute('data-litos-submit-scope-v2', tokens.join(' '));
        };
        const rows = elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible = (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
        const form = element.closest('form');
        const text = String(element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const finalPattern = new RegExp(chooser.finalPattern, 'i');
        const exclusionPattern = new RegExp(chooser.exclusionPattern, 'i');
        const finalVerification = /^(?:verify(?:\s+(?:code|email|identity|application))?|confirm\s+(?:code|email|identity|application)|submit\s+(?:verification|code))$/i.test(text);
        const canonicalFinal = finalPattern.test(text) && !exclusionPattern.test(text);
        const finalIntent = chooser.submitKind === 'verification'
          ? finalVerification || canonicalFinal
          : canonicalFinal;
        let score = 0;
        if (chooser.submitKind === 'verification' && finalVerification) score = 3;
        else if (/\b(?:submit|send)\s+(?:your\s+|my\s+|the\s+|this\s+)?application\b/i.test(text)) score = 3;
        else if (/\bfinish\s+(?:and|&)\s+apply\b|^\s*apply\s+now\s*$/i.test(text)) score = 2;
        else if (finalIntent) score = 1;
        element.setAttribute('data-litos-submit-candidate-v2', String(index));
        return { element, index, visible, disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), form, finalIntent, text, score };
        });
        /* THE CONTAINER PATH ENGAGES ONLY WHERE THE FORM PATH FOUND NOTHING AT ALL.
         *
         * A page that declares a form and puts a plausible final control inside it has told us
         * where its application is. Letting a formless control compete there is how a page-level
         * "Apply Now" in a header, which outscores an in-form "Submit", takes the click off the
         * real submit that shipped code presses today. So the container path is disabled outright
         * as soon as any candidate is viable under the form rule, which makes this change a strict
         * addition: on every page the current code can already submit, it still selects exactly
         * what it selects today.
         *
         * "Viable under the form rule" now means the form is the application, not that a form
         * exists. A stray newsletter form used to satisfy this test on its own and switch the
         * container path off, which is how one unrelated form with an unfortunate button label
         * disabled every Ashby, Paylocity and BambooHR application on the page it sat on.
         *
         * REFUSING A FORM MUST NOT MOVE THE CLICK, which is the other half of that and the more
         * dangerous half. A refused form also stops counting here, so a page whose real application
         * form cannot be confirmed would let a formless region compete that nothing had switched
         * off before. Measured in Chromium on two ordinary pages, both of which main submits
         * correctly: a voluntary self-identification continuation page whose only controls are
         * three selects, and a one-question screening form, each under a sticky "Apply Now" bar
         * carrying an email box. The form is refused, the bar's container is accepted, and the bar
         * takes the click. The conjunction is not exotic, and it is worst exactly where the
         * strongest evidence is weakest: a continuation phase, whose recorded selectors were
         * written against the previous DOM.
         *
         * So when a viable final control sits in a form this run refused, the container has to earn
         * the displacement, and an intake threshold does not do it: see canDisplaceRefusedForm. It
         * has to be a container this run wrote inside, or a control that names the application.
         * Where no form is in the running at all, nothing has been refused and PR 42's container
         * rules stand exactly as they are: nearest field-bearing ancestor, every required field
         * outside a form inside it, never body. That is the whole delta, and it is why a formless
         * page carrying a single field still submits exactly as it does today. */
        const applicationFormOf = (row) => (row.form && isApplicationSurface(row.form, row.score) ? row.form : null);
        const inPlay = (row) => row.visible && !row.disabled && row.finalIntent;
        const formCandidateExists = rows.some((row) => inPlay(row) && Boolean(applicationFormOf(row)));
        const refusedFormExists = rows.some((row) => inPlay(row) && row.form && !applicationFormOf(row));
        const containerCache = new Map();
        return rows.map((row) => {
          const applicationForm = applicationFormOf(row);
          let scopeNode = applicationForm;
          let scopeKind = applicationForm ? 'form' : null;
          // row.form, not scopeNode: a control whose own form is not the application has no scope
          // at all. Letting it climb to a container would hand the stray form the click by another
          // route, and the container it would find is not the form its click would submit.
          if (!row.form && !formCandidateExists) {
            const container = containerOf(row.element);
            if (container && (!refusedFormExists || canDisplaceRefusedForm(container, row.score))) {
              if (!containerCache.has(container)) containerCache.set(container, !requiredOutside(container));
              if (containerCache.get(container)) {
                scopeNode = container;
                scopeKind = 'container';
              }
            }
          }
          if (scopeNode) markScope(scopeNode, row.index);
          return {
            index: row.index, visible: row.visible, disabled: row.disabled,
            hasScope: Boolean(scopeNode), scopeKind, finalIntent: row.finalIntent, text: row.text, score: row.score
          };
        });
      }, { ...action.chooserPolicy, submitKind: action.submitKind, addressed: [...new Set(addressedSelectors)] }).catch(() => null);
      const viableAmong = (rows) => {
        const list = Array.isArray(rows) ? rows.filter((choice) => choice.visible && !choice.disabled && choice.hasScope && choice.finalIntent) : [];
        list.sort((a, b) => b.score - a.score || a.index - b.index);
        return list;
      };
      let choices = await readSubmitChoices();
      let viable = viableAmong(choices);
      /* A SEND CONTROL THE FORM ITSELF IS HOLDING DISABLED over one unanswered opt-in.
       *
       * Measured on the live Easy Dynamics Rippling form (2026-08-20): with every required field
       * filled and the resume uploaded, the Apply button stays aria-disabled="true", and it
       * enables the moment the 'sms_opt_in' radio pair gets an answer. The pair carries no label
       * element, no aria-required and no question structure - only a paragraph of copy about text
       * message updates - so discovery cannot mint a question for it, no action ever reaches it,
       * and the submit pass then reported "could not find the button" about a button that was on
       * screen the whole run.
       *
       * WHAT IS DONE, AND ITS WHOLE EXTENT: when the only reason no candidate is viable is that
       * every final-intent control is DISABLED, unanswered radio pairs whose NAME says they are a
       * communications opt-in are answered with their DECLINE member, once, and the candidates are
       * re-read. Decline, never accept, for the same rule the cookie-banner default follows: the
       * privacy-preserving option on a consent prompt. Declining a marketing channel grants
       * nothing away and states no fact about the applicant, which is what makes it answerable
       * without her - an ACCEPT here would be a consent she never gave and stays out of reach of
       * this pass by construction (the decline member is identified by its own wording).
       *
       * Bounded by NAME, not by page copy: the name is the tenant's own machine word for the
       * control ('sms_opt_in'), and a name-anchored gate cannot be widened by whatever sentence
       * sits nearby. A group with no identifiable decline member is left alone, and the pass
       * falls through to the same refusal it would have raised anyway. */
      if (viable.length === 0 && Array.isArray(choices)
        && choices.some((choice) => choice.visible && choice.finalIntent && choice.disabled)) {
        const declined = await page.evaluate(() => {
          const OPTIN_NAME = /(?:^|[_-])(?:sms|text|email|marketing|news(?:letter)?|updates?)[_-]?opt[_-]?in/i;
          const DECLINE_VALUE = /^(?:false|no|0|decline[d]?)$/i;
          /* ANCHORED AND ONE-SIDED, and the review that tightened this is worth keeping in mind.
           * The first cut accepted 'opt out' and a bare mid-sentence 'no' anywhere in the label,
           * and fell back to parentElement when a radio had no label of its own. Measured in
           * Chromium: stock TCPA copy on the ACCEPT option ('Yes, text me. Reply STOP to opt out
           * anytime.') matched, a shared parent handed both members the same paragraph so the
           * first (accept) radio matched, and 'no spam ever' on an accept label matched. All
           * three clicked the opt-IN and recorded a decline that never happened. So: the label is
           * the radio's OWN <label> or nothing, every member must have a distinct one, exactly
           * one member may read as a decline, and a label that also reads as an acceptance is
           * disqualified from being that member. */
          const DECLINE_WORDING = /^\s*no\b|\bdo\s*(?:not|n[’']t)\s+consent\b|\bdecline\b/i;
          const ACCEPT_WORDING = /\byes\b|\bagree\b|\bsign\s+me\s+up\b|\b(?:text|email|send)\s+me\b|\bopt\s*in\b/i;
          const groups = new Map();
          for (const radio of document.querySelectorAll('input[type="radio"][name]')) {
            const name = radio.getAttribute('name') || '';
            if (!OPTIN_NAME.test(name)) continue;
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(radio);
          }
          const declinedNames = [];
          for (const [name, members] of groups) {
            if (members.some((radio) => radio.checked)) continue;
            let decline = members.find((radio) => DECLINE_VALUE.test(String(radio.value || '')));
            if (!decline) {
              const labelled = members.map((radio) => ({ radio, node: radio.closest('label') }));
              const nodes = labelled.map((entry) => entry.node);
              const distinct = nodes.every(Boolean) && new Set(nodes).size === members.length;
              if (distinct) {
                const declineReads = labelled.filter(({ node }) => {
                  const text = String(node.textContent || '');
                  return DECLINE_WORDING.test(text) && !ACCEPT_WORDING.test(text);
                });
                if (declineReads.length === 1) decline = declineReads[0].radio;
              }
            }
            if (!decline) continue;
            decline.click();
            decline.dispatchEvent(new Event('input', { bubbles: true }));
            decline.dispatchEvent(new Event('change', { bubbles: true }));
            declinedNames.push(name);
          }
          return declinedNames;
        }).catch(() => []);
        if (Array.isArray(declined) && declined.length > 0) {
          await page.waitForTimeout(600).catch(() => undefined);
          for (const name of declined) {
            filledFields.push('question:' + name
              + ' (an unanswered communications opt-in was holding the send button disabled; Litos declined it for you)');
          }
          choices = await readSubmitChoices();
          viable = viableAmong(choices);
        }
      }
      const selected = viable[0];
      const ambiguous = !selected || (viable[1] && viable[1].score === selected.score);
      if (ambiguous) throw new Error('Atomic submit control was missing or ambiguous');
      const submitLocator = page.locator('[data-litos-submit-candidate-v2="' + selected.index + '"]');
      const submitHandle = await submitLocator.elementHandle();
      const scopeKind = selected.scopeKind;
      // The marker is written by the same pass that scored the control, so this addresses the exact
      // node the walk resolved. The count check is the one that was here before: exactly one scope,
      // or nothing is clicked.
      const scope = page.locator('[data-litos-submit-scope-v2~="' + selected.index + '"]');
      if (!submitHandle || await scope.count() !== 1) throw new Error('Atomic submit control had no exact application form');
      const scopeHandle = await scope.elementHandle();
      const binding = await submitHandle.evaluate((element, bound) => {
        const root = bound.scope;
        const formShape = {
          scopeKind: bound.scopeKind,
          id: root.id || null,
          action: bound.scopeKind === 'form' ? root.getAttribute('action') || null : null,
          method: bound.scopeKind === 'form' ? root.getAttribute('method') || null : null,
          controls: [...root.querySelectorAll('input, textarea, select, button, [role="button"]')].map((control) => ({
            tag: control.tagName.toLowerCase(), id: control.id || null, name: control.getAttribute('name') || null,
            type: control.getAttribute('type') || null, label: control.getAttribute('aria-label') || null
          }))
        };
        const submitShape = { tag: element.tagName.toLowerCase(), id: element.id || null, name: element.getAttribute('name') || null, type: element.getAttribute('type') || null, text: String(element.innerText || element.value || '').replace(/\s+/g, ' ').trim() };
        return { formShape, submitShape };
      }, { scope: scopeHandle, scopeKind });
      const formFingerprint = crypto.createHash('sha256').update(JSON.stringify(binding.formShape)).digest('hex');
      const submitFingerprint = crypto.createHash('sha256').update(formFingerprint + ':' + JSON.stringify(binding.submitShape)).digest('hex');
      const candidates = await scope.evaluate((root, boundFingerprint) => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const renderedText = (node) => {
          if (!node) return '';
          return typeof node.innerText === 'string' ? node.innerText : (node.textContent || '');
        };
        const isVisible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const widgetOf = (element) => element.closest(
          '[class*="select__container"], .field, .field-wrapper, fieldset, [role="group"],'
          + ' [data-field-path], [data-input-type], [class*="_fieldEntry_"]'
        ) || element.parentElement || element;
        const labelOf = (element, widget) => {
          const labelledBy = (element.getAttribute && element.getAttribute('aria-labelledby'))
            || (widget.getAttribute && widget.getAttribute('aria-labelledby'));
          const proxyLabelledBy = widget.querySelector
            && widget.querySelector('[role="combobox"][aria-labelledby], [aria-haspopup="listbox"][aria-labelledby]')
              ?.getAttribute('aria-labelledby');
          const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
          const proxyReferenced = proxyLabelledBy && document.getElementById(proxyLabelledBy.split(/\s+/)[0]);
          const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          const wrapping = element.closest && element.closest('label');
          const own = widget.querySelector && widget.querySelector('legend, label, .question, h3, h4');
          /* A GROUPED CHOICE IS LABELLED WITH ITS OPTION, and the wrapping label below returns it.
           *
           * THIS IS THE SECOND labelOf. The runner declares one at readSubmitReadiness and this one
           * in the atomic required-field scan, with the arguments in the opposite order, and THIS is
           * the one whose text becomes the blocker the applicant reads. Teaching only the other one
           * left the two disagreeing about the same control: choice resolution correctly said "what
           * degree are you currently pursuing" while the blocker still read "High School Diploma".
           * Measured on a fresh Belvedere packet 2026-08-17, after the questionLabel fix shipped.
           *
           * Narrow on purpose, and identical to the rule in the other copy: a radio or checkbox, more
           * than one input sharing its name so a lone "I agree" keeps its own label, and a question
           * container that publishes its own text. Everything else falls through unchanged. */
          const groupedChoiceQuestion = (() => {
            if (element.type !== 'radio' && element.type !== 'checkbox') return '';
            const name = element.getAttribute && element.getAttribute('name');
            if (!name) return '';
            if (document.querySelectorAll('input[name="' + CSS.escape(name) + '"]').length < 2) return '';
            const container = element.closest
              && element.closest('li.application-question, fieldset, [role="radiogroup"], [role="group"]');
            const heading = container && container.querySelector('.application-label, legend');
            if (!heading || heading.querySelector('input, textarea, select')) return '';
            return renderedText(heading);
          })();
          return clean(
            renderedText(referenced)
            || groupedChoiceQuestion
            || renderedText(byFor)
            || renderedText(wrapping)
            || renderedText(proxyReferenced)
            || element.getAttribute?.('aria-label')
            || renderedText(own)
          ).slice(0, 120);
        };
        const CHOICE_SHELL = '[class*="select__container"], [class*="select-shell"]';
        const CHOICE_CONTROL = '[class*="select__control"]';
        const CHOICE_OPENER = '[role="combobox"], [aria-haspopup="listbox"]';
        const reactChoiceBinding = (element) => {
          if (!element?.closest) return null;
          const outerShell = element.closest(CHOICE_SHELL);
          if (!outerShell) return null;
          const boundaryOf = (candidate) => candidate?.closest?.(CHOICE_CONTROL)
            || candidate?.closest?.(CHOICE_SHELL)
            || null;
          const hiddenBacking = String(element.tagName || '').toUpperCase() === 'INPUT'
            && String(element.type || '').toLowerCase() === 'hidden';
          if (!hiddenBacking) {
            const scope = element.closest(CHOICE_CONTROL) || outerShell;
            const answerControls = [...new Set(scope.querySelectorAll(
              'input:not([type="hidden"]), textarea, select, ' + CHOICE_OPENER
            ))].filter((candidate) => boundaryOf(candidate) === scope);
            const openers = [...new Set(scope.querySelectorAll(CHOICE_OPENER))]
              .filter((candidate) => boundaryOf(candidate) === scope && isVisible(candidate));
            if (answerControls.length !== 1 || openers.length !== 1
              || answerControls[0] !== openers[0] || element !== openers[0]) return null;
            return { shell: outerShell, scope, opener: openers[0] };
          }
          const requiredBackings = [...outerShell.querySelectorAll(
            'input[type="hidden"][required], input[type="hidden"][aria-required="true"]'
          )].filter((candidate) => candidate.closest(CHOICE_SHELL) === outerShell);
          if (requiredBackings.length !== 1 || requiredBackings[0] !== element) return null;
          const openers = [...new Set(outerShell.querySelectorAll(CHOICE_OPENER))]
            .filter((candidate) => candidate.closest(CHOICE_SHELL) === outerShell && isVisible(candidate));
          if (openers.length !== 1) return null;
          const opener = openers[0];
          const owner = opener.closest(CHOICE_CONTROL) || opener;
          const sameControl = owner !== opener && element.closest(CHOICE_CONTROL) === owner;
          const adjacentBacking = element.parentElement === outerShell
            && (element.previousElementSibling === owner || element.nextElementSibling === owner);
          return sameControl || adjacentBacking
            ? { shell: outerShell, scope: owner === opener ? outerShell : owner, opener }
            : null;
        };
        const reactChoiceAnswered = (binding) => [...binding.scope.querySelectorAll(
          '[class*="select__single-value"], [class*="select__multi-value__label"]'
        )].some((candidate) => (
          candidate.closest(CHOICE_CONTROL) || candidate.closest(CHOICE_SHELL)
        ) === binding.scope);
        /* Ashby stores a yes/no answer in a checkbox, but "No" and unanswered are both unchecked.
         * The selected sibling pill is the only state that separates them. Bind it to this exact
         * data-field-path, backing checkbox and visible Yes/No container before trusting that state. */
        const PILL_SELECTED = /_active_|_selected_|_checked_/;
        const chosenAshbyYesNoOf = (subject) => {
          if (!subject?.closest || !subject?.querySelectorAll) return null;
          const field = subject.matches?.('[data-field-path], [class*=\"_fieldEntry_\"]')
            ? subject
            : subject.closest('[data-field-path], [class*=\"_fieldEntry_\"]');
          if (!field) return null;
          const checkboxes = [...field.querySelectorAll('input[type=\"checkbox\"]')].filter((input) => (
            input.closest('[data-field-path], [class*=\"_fieldEntry_\"]') === field
          ));
          const control = subject instanceof HTMLInputElement && subject.type === 'checkbox'
            ? subject
            : checkboxes.length === 1 ? checkboxes[0] : null;
          if (!control || checkboxes.length !== 1 || checkboxes[0] !== control) return null;
          const fieldPath = field.getAttribute('data-field-path');
          if (!fieldPath || control.name !== fieldPath) return null;
          const pillScope = control.closest('[class*=\"_yesno_\"]');
          if (!pillScope || !field.contains(pillScope)) return null;
          const answerPills = [...pillScope.querySelectorAll('button')].filter((pill) => (
            pill.closest('[class*=\"_yesno_\"]') === pillScope
            && isVisible(pill)
            && /^(?:yes|no)$/i.test(clean(pill.textContent))
          ));
          if (answerPills.length !== 2
            || answerPills.filter((pill) => /^yes$/i.test(clean(pill.textContent))).length !== 1
            || answerPills.filter((pill) => /^no$/i.test(clean(pill.textContent))).length !== 1) return null;
          return answerPills.some((pill) => PILL_SELECTED.test(String(pill.className || ''))
            || pill.getAttribute('aria-pressed') === 'true'
            || pill.getAttribute('aria-checked') === 'true'
            || pill.getAttribute('aria-selected') === 'true'
            || /^(?:on|true|active|selected|checked)$/i.test(pill.getAttribute('data-state') || ''));
        };
        const semanticChoiceGroup = (element) => element?.closest?.(
          '[role="group"][aria-labelledby], [role="group"][aria-label],'
          + ' [role="radiogroup"][aria-labelledby], [role="radiogroup"][aria-label]'
        ) || null;
        const chosenValue = (element, widget) => {
          if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
            if (element.checked) return true;
            const pill = chosenAshbyYesNoOf(element);
            if (pill !== null) return pill;
            const semanticGroup = semanticChoiceGroup(element);
            if (semanticGroup) {
              return [...semanticGroup.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
                .some((peer) => peer.checked);
            }
            if (element.name) {
              return [...(element.form || document).querySelectorAll('input[name="' + CSS.escape(element.name) + '"]')]
                .some((peer) => peer.checked);
            }
            return false;
          }
          if (element instanceof HTMLSelectElement) return Boolean(clean(element.value));
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (element instanceof HTMLInputElement && element.type === 'file') return Boolean(element.files && element.files.length > 0);
            const binding = reactChoiceBinding(element);
            if (binding && reactChoiceAnswered(binding)) return true;
            return Boolean(clean(element.value));
          }
          const uploadedFile = element.querySelector && element.querySelector('input[type="file"]');
          if (uploadedFile && uploadedFile.files && uploadedFile.files.length > 0) return true;
          if (element.querySelector && element.querySelector('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]')) return true;
          for (const choice of element.querySelectorAll?.(CHOICE_OPENER) || []) {
            const binding = reactChoiceBinding(choice);
            if (binding && reactChoiceAnswered(binding)) return true;
          }
          /* A BARE OPENER PUBLISHES ITS COMMITTED CHOICE AS ITS OWN RENDERED TEXT, and nothing
           * above can see it: no inner input to hold a value, no react-select nodes, no
           * aria-selected child. Measured on the live Easy Dynamics Rippling form (2026-08-20):
           * the two required '<div role="combobox" aria-label="Select">' work-authorization
           * selects were filled with their resolved answers, readSubmitReadiness's own bare-opener
           * arm read them as answered, and THIS scan still called them "required field is empty" -
           * so the run found the send button, held the press, and reported a confirmation failure
           * over two committed answers. The reading below is the same three-empty-state gate that
           * arm uses, byte for byte where it counts: furniture, the aria-label restatement, and
           * placeholder-shaped grammar all read as EMPTY, which fails toward a person looking at
           * an answered control - the one direction this scan is allowed to be wrong in. */
          if (element.getAttribute
            && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox')
            && !element.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select')) {
            const BARE_OPENER_FURNITURE = /^(?:search|select(?: one| an option)?|choose(?: one| an option)?|start typing.*|type to search.*)?[.…\s]*$/i;
            const PLACEHOLDER_SHAPED = /^(?:--\s*)?(?:please\s+)?(?:select|choose|pick)\b|^none\s+selected$/i;
            const rendered = clean(typeof element.innerText === 'string' ? element.innerText : (element.textContent || ''));
            if (rendered) {
              const openerAriaLabel = clean(element.getAttribute('aria-label') || '');
              const restated = openerAriaLabel && rendered.toLowerCase() === openerAriaLabel.toLowerCase();
              if (!restated && !BARE_OPENER_FURNITURE.test(rendered) && !PLACEHOLDER_SHAPED.test(rendered)) return true;
            }
          }
          return Boolean(widget.querySelector(
            'input:checked, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"],'
            + ' button[class*="_active_"], button[class*="_selected_"], button[class*="_checked_"]'
          ));
        };
        const errorText = (widget) => [...widget.querySelectorAll('*')].some((node) => {
          if (node.children.length > 0 || !isVisible(node)) return false;
          const text = clean(node.textContent);
          return text.length <= 160 && /\bis required\b|\brequires an answer\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b/i.test(text);
        });
        const hasValidationIssue = (element) => {
          const nativeMissing = Boolean(element.validity && element.validity.valueMissing);
          return nativeMissing || element.getAttribute?.('aria-invalid') === 'true';
        };
        const select2Binding = (control) => {
          if (!control) return null;
          let source = null;
          let shell = null;
          const isSource = (element) => Boolean(
            (element instanceof HTMLSelectElement
              || (element instanceof HTMLInputElement && element.type === 'hidden'))
            && element.classList.contains('select2-offscreen')
            && element.id
          );
          if (isSource(control)) {
            source = control;
            shell = document.getElementById('s2id_' + source.id);
          } else {
            shell = control.closest?.('.select2-container[id^="s2id_"]') || null;
            const sourceId = shell?.id.slice('s2id_'.length) || '';
            source = sourceId ? document.getElementById(sourceId) : null;
          }
          if (!isSource(source)
            || !shell?.matches('.select2-container')
            || shell.id !== 's2id_' + source.id
            || source.previousElementSibling !== shell
            || widgetOf(source) !== widgetOf(shell)
            || !root.contains(source)
            || !root.contains(shell)) return null;
          const targets = [...shell.querySelectorAll(
            ':scope > .select2-choice'
          )].filter((candidate) => isVisible(candidate));
          if (targets.length !== 1) return null;
          return { source, shell, opener: targets[0] };
        };
        const controls = new Map();
        const canonicalControl = (control) => {
          if (!control) return null;
          const select2 = select2Binding(control);
          if (select2) return select2.source;
          const reactChoice = reactChoiceBinding(control);
          if (reactChoice) return reactChoice.opener;
          return control;
        };
        const addControl = (control) => {
          const canonical = canonicalControl(control);
          if (!canonical || !root.contains(canonical)) return;
          const validationSources = controls.get(canonical) || new Set([canonical]);
          validationSources.add(control);
          const select2 = select2Binding(control);
          if (select2) {
            validationSources.add(select2.source);
            validationSources.add(select2.opener);
          }
          controls.set(canonical, validationSources);
        };
        for (const control of root.querySelectorAll(
          'input[required], textarea[required], select[required], [aria-required="true"]'
        )) addControl(control);
        for (const marker of root.querySelectorAll('label[class*="_required_"], legend[class*="_required_"]')) {
          const block = widgetOf(marker);
          const named = marker.getAttribute('for');
          const control = (named && document.getElementById(named))
            || block.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]')
            || block;
          addControl(control);
        }
        const ASTERISK_MARK = /\*(?:\s|$)|(?:^|\s)\*/;
        const ASTERISK_LEGEND = /\*\s*(?:indicates|denotes|means|marks|=)/i;
        for (const marker of root.querySelectorAll('label, legend')) {
          const text = clean(marker.textContent);
          if (!ASTERISK_MARK.test(text) || ASTERISK_LEGEND.test(text)) continue;
          const block = widgetOf(marker);
          const named = marker.getAttribute('for');
          const control = (named && document.getElementById(named))
            || block.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]')
            || block;
          addControl(control);
        }
        for (const stale of root.querySelectorAll(
          '[data-litos-required-confirm], [data-litos-required-confirm-source], [data-litos-select2-confirm]'
        )) {
          stale.removeAttribute('data-litos-required-confirm');
          stale.removeAttribute('data-litos-required-confirm-source');
          stale.removeAttribute('data-litos-select2-confirm');
        }
        const out = [];
        let index = 0;
        const seenGroups = new Set();
        for (const [element, validationSources] of controls) {
          const widget = widgetOf(element);
          if (!isVisible(widget)) continue;
          const choice = element instanceof HTMLInputElement && /radio|checkbox/.test(element.type);
          const groupKey = choice
            ? (semanticChoiceGroup(element) || element.name || '')
            : '';
          if (groupKey && seenGroups.has(groupKey)) continue;
          if (groupKey) seenGroups.add(groupKey);
          index += 1;
          const marker = 'litos-required-confirm-' + index;
          element.setAttribute('data-litos-required-confirm', marker);
          for (const source of validationSources) {
            source.setAttribute('data-litos-required-confirm-source', marker);
          }
          const rawType = element instanceof HTMLInputElement ? (element.type || 'text').toLowerCase() : '';
          const select2 = select2Binding(element);
          if (select2) select2.opener.setAttribute('data-litos-select2-confirm', marker);
          const type = select2?.source === element
            ? 'select2'
            : element.getAttribute?.('role') === 'combobox'
            ? 'combobox'
            : element instanceof HTMLSelectElement
            ? 'select'
            : element instanceof HTMLInputElement
              ? rawType === 'radio' || rawType === 'checkbox' || rawType === 'file'
                ? rawType
                : /^(?:date|month|week|time|datetime-local)$/.test(rawType)
                  ? 'date'
                  : 'text'
              : element instanceof HTMLTextAreaElement
                ? 'text'
                : element.querySelector?.('input[type="file"]')
                  ? 'file'
                  : 'custom';
          const ownId = element.id && /^[A-Za-z_][\w:-]*$/.test(element.id) ? '#' + element.id : null;
          const ownName = element.getAttribute?.('name');
          const pathOwner = element.closest?.('[data-field-path]');
          const fieldPath = pathOwner && pathOwner.getAttribute('data-field-path');
          const quotedSelector = (attribute, value) => {
            if (!value || /[\r\n]/.test(value)) return null;
            if (!value.includes('"')) return '[' + attribute + '="' + value + '"]';
            if (!value.includes("'")) return '[' + attribute + "='" + value + "']";
            return null;
          };
          const nameSelector = quotedSelector('name', ownName);
          const pathSelector = quotedSelector('data-field-path', fieldPath);
          let durableSelector = ownId && root.querySelectorAll(ownId).length === 1
            ? ownId
            : nameSelector && root.querySelectorAll(nameSelector).length === 1
              ? nameSelector
              : pathSelector && root.querySelectorAll(pathSelector).length === 1
                ? pathSelector
                : null;
          if (!durableSelector) {
            // The fallback identity is opaque but deterministic for this exact form scan. It is
            // bound to the form fingerprint and DOM-order index, so it cannot be mistaken for a
            // portal-owned selector or silently reused after the form shape changes.
            const stableId = 'v2-' + boundFingerprint.slice(0, 24) + '-' + index;
            element.setAttribute('data-litos-stable-id-v1', stableId);
            const stableSelector = '[data-litos-stable-id-v1="' + stableId + '"]';
            if (root.querySelectorAll(stableSelector).length === 1) durableSelector = stableSelector;
          }
          out.push({
            marker,
            selector: durableSelector,
            label: labelOf(element, widget) || null,
            fieldType: type === 'combobox' ? 'react-select' : type,
            answered: chosenValue(element, widget)
              || [...validationSources].some((source) => chosenValue(source, widget)),
            affected: [...validationSources].some(hasValidationIssue) || errorText(widget)
          });
        }
        return out;
      }, formFingerprint).catch(() => null);
      if (!Array.isArray(candidates)) throw new Error('Atomic required-field scan failed');
      const requiredControls = candidates.filter((candidate) => candidate.selector).map((candidate) => ({
        selector: candidate.selector,
        label: candidate.label,
        fieldType: candidate.fieldType,
        matchCount: 1
      }));
      const attempts = [];
      const unresolved = [];
      let retries = 0;
      let reactConfirmationMarker = 0;
      const replayExactSelect2Selection = async (target, marker) => {
        const opener = scope.locator(
          '[data-litos-select2-confirm="' + String(marker).replace(/["\\]/g, '\\$&') + '"]'
        );
        if (await opener.count() !== 1 || !await opener.first().isVisible().catch(() => false)) {
          return false;
        }
        const before = await target.evaluate((source, expectedMarker) => {
          const cleanText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
          const isSource = source instanceof HTMLSelectElement
            || (source instanceof HTMLInputElement && source.type === 'hidden');
          if (!isSource || !source.id || !source.classList.contains('select2-offscreen')) return null;
          const shell = source.previousElementSibling;
          if (!shell?.matches('.select2-container') || shell.id !== 's2id_' + source.id) return null;
          const openers = [...shell.querySelectorAll(':scope > .select2-choice')].filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = getComputedStyle(candidate);
            return (rect.width > 0 || rect.height > 0)
              && style.display !== 'none'
              && style.visibility !== 'hidden';
          });
          if (openers.length !== 1
            || openers[0].getAttribute('data-litos-select2-confirm') !== expectedMarker) return null;
          const displays = [...shell.querySelectorAll(':scope > .select2-choice .select2-chosen')];
          if (displays.length !== 1) return null;
          const display = cleanText(displays[0].textContent);
          const sourceValue = cleanText(source.value);
          if (!display || !sourceValue) return null;
          // Select2 v3 renders its popup outside the field. Start only from a closed target with no
          // active global popup, otherwise the one #select2-drop on the page may belong to another
          // question and an exact-text row can still change that question instead of this one.
          if (shell.classList.contains('select2-dropdown-open')
            || document.querySelectorAll('#select2-drop.select2-drop-active').length !== 0) return null;
          const jquery = window.jQuery;
          if (typeof jquery !== 'function') return null;
          const instance = jquery(source).data?.('select2');
          if (!instance || instance.container?.[0] !== shell || typeof instance.id !== 'function') return null;
          if (source instanceof HTMLSelectElement) {
            const selected = [...source.options].filter((option) => option.selected);
            const semanticMatches = [...source.options].filter(
              (option) => cleanText(option.label || option.textContent) === display
            );
            if (selected.length !== 1 || semanticMatches.length !== 1
              || selected[0] !== semanticMatches[0]
              || cleanText(selected[0].value) !== sourceValue) return null;
          }
          return {
            sourceId: source.id,
            sourceKind: source instanceof HTMLSelectElement ? 'select' : 'hidden',
            sourceValue,
            semantic: display
          };
        }, marker).catch(() => null);
        if (!before) return false;

        const opened = await opener.first().click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        if (!opened) return false;
        const close = async () => {
          await opener.first().press('Escape').catch(() => undefined);
          await opener.first().evaluate((element) => element.blur()).catch(() => undefined);
        };
        const dropdown = page.locator('#select2-drop.select2-drop-active:visible');
        if (await dropdown.count() !== 1) {
          await close();
          return false;
        }
        const exactRows = dropdown.getByRole('option', { name: before.semantic, exact: true });
        if (await exactRows.count() !== 1 || !await exactRows.first().isVisible().catch(() => false)) {
          await close();
          return false;
        }
        const rowMatchesSource = await exactRows.first().evaluate((row, proof) => {
          const cleanText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
          const source = document.getElementById(proof.sourceId);
          const shell = source?.previousElementSibling;
          const dropdown = row.closest('#select2-drop.select2-drop-active');
          if (!source || !shell?.matches('.select2-container')
            || shell.id !== 's2id_' + proof.sourceId
            || !shell.classList.contains('select2-dropdown-open')
            || !dropdown
            || document.querySelectorAll('#select2-drop.select2-drop-active').length !== 1) return false;
          const jquery = window.jQuery;
          if (typeof jquery !== 'function') return false;
          const wrapped = jquery(source);
          const instance = wrapped.data?.('select2');
          const result = row.closest('.select2-result');
          const data = result && jquery(result).data?.('select2-data');
          if (!instance || instance.container?.[0] !== shell
            || instance.dropdown?.[0] !== dropdown
            || (instance.results?.[0] && !instance.results[0].contains(row))
            || typeof instance.id !== 'function' || data == null) return false;
          return cleanText(row.textContent) === proof.semantic
            && cleanText(instance.id(data)) === proof.sourceValue;
        }, before).catch(() => false);
        if (!rowMatchesSource) {
          await close();
          return false;
        }
        const safeOptionActivation = await exactRows.first().evaluate((row) => {
          const activations = [
            row.closest('button, input'),
            ...row.querySelectorAll('button, input')
          ].filter(Boolean);
          return activations.every((activation) => {
            if (!activation.form) return true;
            if (activation instanceof HTMLButtonElement) return activation.type !== 'submit';
            if (activation instanceof HTMLInputElement) return !/^(?:submit|image)$/i.test(activation.type);
            return true;
          });
        }).catch(() => false);
        if (!safeOptionActivation) {
          await close();
          return false;
        }
        const selected = await exactRows.first().click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        if (!selected) {
          await close();
          return false;
        }
        const recommitted = await target.evaluate((source, proof) => {
          const cleanText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
          const shell = source.previousElementSibling;
          const displayNode = shell?.querySelector(':scope > .select2-choice .select2-chosen');
          const stateMatches = () => {
            if (!shell?.matches('.select2-container') || shell.id !== 's2id_' + proof.sourceId
              || cleanText(source.value) !== proof.sourceValue
              || cleanText(displayNode?.textContent) !== proof.semantic) return false;
            if (!(source instanceof HTMLSelectElement)) return true;
            const selectedOptions = [...source.options].filter((option) => option.selected);
            return selectedOptions.length === 1
              && cleanText(selectedOptions[0].value) === proof.sourceValue
              && cleanText(selectedOptions[0].label || selectedOptions[0].textContent) === proof.semantic;
          };
          if (!stateMatches()) return false;
          let usedSelect2Api = false;
          const jquery = window.jQuery;
          if (typeof jquery === 'function') {
            const wrapped = jquery(source);
            const instance = wrapped.data?.('select2');
            if (instance?.container?.[0] === shell && typeof wrapped.select2 === 'function') {
              try {
                wrapped.select2('val', proof.sourceValue, true);
                usedSelect2Api = true;
              } catch {}
            }
          }
          if (!usedSelect2Api) {
            source.dispatchEvent(new Event('input', { bubbles: true }));
            source.dispatchEvent(new Event('change', { bubbles: true }));
          }
          source.blur();
          return stateMatches();
        }, before).catch(() => false);
        await close();
        if (!recommitted) return false;
        await page.waitForTimeout(100).catch(() => undefined);
        return target.evaluate((source, proof) => {
          const cleanText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
          const shell = source.previousElementSibling;
          const display = shell?.querySelector(':scope > .select2-choice .select2-chosen');
          if (!shell?.matches('.select2-container') || shell.id !== 's2id_' + proof.sourceId
            || cleanText(source.value) !== proof.sourceValue
            || cleanText(display?.textContent) !== proof.semantic) return false;
          if (!(source instanceof HTMLSelectElement)) return true;
          const selected = [...source.options].filter((option) => option.selected);
          return selected.length === 1
            && cleanText(selected[0].value) === proof.sourceValue
            && cleanText(selected[0].label || selected[0].textContent) === proof.semantic;
        }, before).catch(() => false);
      };
      // A required React Select can still carry an invalid marker after its answer is visible. The
      // visual node is not necessarily the semantic option, though: country controls commonly show
      // "+971" after choosing "United Arab Emirates +971". Replaying that abbreviation searches
      // for a different answer and, on a multi-select, replaying the first chip toggles it off.
      //
      // The control's currently-open listbox is the only safe place to recover the original semantic
      // answer. It must name the popup itself, exactly one option must declare itself selected, and
      // that option's text must resolve through Playwright's exact accessible-name query exactly once.
      // Anything else is left invalid for the final readiness check to block. In particular, two
      // selected rows means multi-select, where confirmation remains click/Escape/blur only and never
      // clicks an already-selected row.
      const replayExactReactSelection = async (target) => {
        const before = await readChoiceState(target);
        if (before.kind !== 'chosen') return { answerPreserved: false };
        // choiceLanded may have to withdraw a failed recommit. Bind that rollback to this control's
        // current answer, never to the last unrelated choice filled earlier in the action list.
        lastChoiceArrival = before;
        const beforeValues = (Array.isArray(before.values) ? before.values : [before.value])
          .map((value) => clean(value));
        const opened = await target.click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        if (!opened) return { answerPreserved: false, arrival: before };
        const menuId = await target.evaluate((element) => (
          element.getAttribute('aria-controls') || element.getAttribute('aria-owns') || ''
        )).catch(() => '');
        const menu = menuId
          ? page.locator('[id="' + String(menuId).trim().split(/\s+/)[0].replace(/["\\\\]/g, '\\\\$&') + '"]')
          : null;
        if (!menu || await menu.count() !== 1) return { answerPreserved: false, arrival: before };
        const selectedRows = menu.getByRole('option', { selected: true });
        const selectedCount = await selectedRows.count();
        /* Greenhouse's React Select does not consistently publish aria-multiselectable on the
         * listbox. The rendered multi-value chip is the other widget-owned declaration of the same
         * shape. It is read before opening, then required to remain a multi-value chip afterwards. */
        const multiValue = before.multiValue === true
          || await menu.getAttribute('aria-multiselectable').catch(() => null) === 'true';
        if (multiValue) {
          // Clicking any selected row in a multi-select removes that value. Opening, closing and
          // blurring is enough to replay the field lifecycle, but only if every displayed chip and
          // every selected menu row survived the open unchanged.
          const afterOpen = await readChoiceState(target);
          const afterValues = (Array.isArray(afterOpen.values) ? afterOpen.values : [afterOpen.value])
            .map((value) => clean(value));
          const stableChips = afterOpen.kind === 'chosen'
            && afterOpen.multiValue === true
            && afterValues.length === beforeValues.length
            && afterValues.every((value, index) => value === beforeValues[index]);
          if (!stableChips) return { answerPreserved: false, multiValue: true, arrival: before };
          if (selectedCount === beforeValues.length) {
            return { answerPreserved: true, multiValue: true, arrival: before };
          }
          /* Greenhouse multi-selects can publish no aria-selected state at all. In that one shape,
           * preserve without clicking only when every distinct stable chip names exactly one visible
           * option in this control's own listbox and that row cannot submit. A partial selected state
           * remains contradictory and fails closed. */
          if (selectedCount !== 0
            || new Set(beforeValues.map((value) => value.toLowerCase())).size !== beforeValues.length) {
            return { answerPreserved: false, multiValue: true, arrival: before };
          }
          let presentExactRows = 0;
          for (const value of beforeValues) {
            const exactRows = menu.getByRole('option', { name: value, exact: true });
            const exactCount = await exactRows.count();
            if (exactCount > 1) {
              return { answerPreserved: false, multiValue: true, arrival: before };
            }
            if (exactCount === 0) continue;
            if (!await exactRows.first().isVisible().catch(() => false)) {
              return { answerPreserved: false, multiValue: true, arrival: before };
            }
            presentExactRows += 1;
            const submitCapable = await exactRows.first().evaluate((element) => {
              const selector = 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]';
              return Boolean(element.closest(selector) || element.querySelector(selector));
            }).catch(() => true);
            if (submitCapable) return { answerPreserved: false, multiValue: true, arrival: before };
          }
          /* React Select commonly hides selected values from the open menu. In that shape the
           * stable chip is the positive state and the bound listbox proves the control opened. Do
           * not confuse an empty or still-loading menu with that omission: require at least one
           * other visible, non-submit option, and reject mixed present/omitted chip evidence. */
          if (presentExactRows === 0) {
            const optionRows = menu.getByRole('option');
            let safeVisibleOptions = 0;
            for (let index = 0; index < await optionRows.count(); index += 1) {
              const row = optionRows.nth(index);
              if (!await row.isVisible().catch(() => false)) continue;
              const submitCapable = await row.evaluate((element) => {
                const selector = 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]';
                return Boolean(element.closest(selector) || element.querySelector(selector));
              }).catch(() => true);
              if (submitCapable) return { answerPreserved: false, multiValue: true, arrival: before };
              safeVisibleOptions += 1;
            }
            if (safeVisibleOptions === 0) {
              return { answerPreserved: false, multiValue: true, arrival: before };
            }
          } else if (presentExactRows !== beforeValues.length) {
            return { answerPreserved: false, multiValue: true, arrival: before };
          }
          return { answerPreserved: true, multiValue: true, arrival: before };
        }
        if (selectedCount !== 1) return { answerPreserved: false, arrival: before };
        // The rendered value can be an abbreviation such as "+971". The unique selected menu row is
        // the semantic answer, so read it from that row instead of trusting display-only attributes.
        const semanticAnswer = clean(await selectedRows.first().evaluate((element) => (
          element.getAttribute('aria-label') || element.textContent || ''
        )).catch(() => ''));
        if (!semanticAnswer) return { answerPreserved: false, arrival: before };
        const semanticHints = (Array.isArray(before.semanticValues)
          ? before.semanticValues : beforeValues
        ).map((value) => clean(value));
        const authoritativeHints = semanticHints.filter(
          (value, index) => value && value.toLowerCase() !== clean(beforeValues[index]).toLowerCase()
        );
        const semanticLower = semanticAnswer.toLowerCase();
        const matchesArrival = authoritativeHints.length > 0
          ? authoritativeHints.some((value) => value.toLowerCase() === semanticLower)
          : beforeValues.some((value) => {
              const display = clean(value).toLowerCase();
              if (semanticLower === display) return true;
              return display.length >= 2
                && !/\p{L}/u.test(display)
                && display.includes('+')
                && semanticLower.includes(display);
            });
        if (!matchesArrival) return { answerPreserved: false, arrival: before };
        const exactRows = menu.getByRole('option', { name: semanticAnswer, exact: true });
        if (await exactRows.count() !== 1 || !await exactRows.first().isVisible().catch(() => false)) {
          return { answerPreserved: false, arrival: before };
        }
        const marker = 'litos-react-confirm-' + (++reactConfirmationMarker);
        await selectedRows.first().evaluate((element, value) => {
          element.setAttribute('data-litos-react-confirm-selected', value);
        }, marker).catch(() => undefined);
        const selectedExactRow = await exactRows.first().getAttribute(
          'data-litos-react-confirm-selected'
        ).catch(() => null) === marker;
        await selectedRows.first().evaluate((element) => {
          element.removeAttribute('data-litos-react-confirm-selected');
        }).catch(() => undefined);
        if (!selectedExactRow) return { answerPreserved: false, arrival: before };
        const submitCapable = await exactRows.first().evaluate((element) => {
          const selector = 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]';
          return Boolean(element.closest(selector) || element.querySelector(selector));
        }).catch(() => true);
        if (submitCapable) return { answerPreserved: false, arrival: before };
        lastClickedOptionText = semanticAnswer;
        lastClickedOptionAnswer = semanticAnswer;
        // Re-aimed by hand here, so the tier provenance from any earlier fill must not ride along.
        lastChooserTierAnswer = '';
        const clicked = await exactRows.first().click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        return { answerPreserved: clicked, semanticAnswer, arrival: before };
      };
      const waitForReactArrival = async (target, arrival, semanticAnswer) => {
        const arrivalValues = (Array.isArray(arrival?.values) ? arrival.values : [arrival?.value])
          .map((value) => clean(value));
        for (let elapsed = 0; elapsed <= 3000; elapsed += 50) {
          const current = await readChoiceState(target);
          const currentValues = (Array.isArray(current.values) ? current.values : [current.value])
            .map((value) => clean(value));
          const sameDisplay = current.kind === 'chosen'
            && currentValues.length === arrivalValues.length
            && currentValues.every((value, index) => value === arrivalValues[index]);
          if (sameDisplay || (semanticAnswer && await verifyChoiceInContainer(
            target, semanticAnswer, semanticAnswer, semanticAnswer
          ))) return true;
          if (elapsed < 3000) await page.waitForTimeout(50).catch(() => undefined);
        }
        return false;
      };
      for (const candidate of candidates) {
        const runtimeSelector = '[data-litos-required-confirm="' + candidate.marker + '"]';
        const target = page.locator(runtimeSelector).first();
        const proofSelector = candidate.selector || '';
        const fieldType = candidate.fieldType;
        if (!proofSelector) {
          unresolved.push(candidate.label || 'Selectorless required field');
          continue;
        }
        if (await target.count() !== 1) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: 1, reason: 'required control selector did not resolve exactly once' });
          unresolved.push(candidate.label || proofSelector);
          continue;
        }
        if (!candidate.answered) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: 1, reason: 'required field is empty' });
          unresolved.push(candidate.label || proofSelector);
          continue;
        }
        if (!candidate.affected) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'already_committed', attemptCount: 1 });
          continue;
        }
        let outcome = 'still_requires_answer';
        const maxAttempts = 1 + action.maxRetries;
        let attemptNumber = 0;
        let reactArrivalValues = null;
        for (; attemptNumber < maxAttempts; attemptNumber += 1) {
          let answerPreserved = true;
          if (fieldType === 'radio') {
            await target.evaluate((element) => {
              const selected = element.checked ? element : (element.form || document).querySelector('input[name="' + CSS.escape(element.name) + '"]:checked');
              const label = selected && selected.id && document.querySelector('label[for="' + CSS.escape(selected.id) + '"]');
              (label || selected)?.click();
              selected?.blur();
            }).catch(() => undefined);
          } else if (fieldType === 'select2') {
            answerPreserved = await replayExactSelect2Selection(target, candidate.marker);
          } else if (fieldType === 'react-select') {
            const ownedControl = target.locator(
              'xpath=ancestor-or-self::*[contains(@class,"select__control")][1]'
            );
            const outerShell = target.locator(
              'xpath=ancestor-or-self::*[contains(@class,"select__container")'
              + ' or contains(@class,"select-shell")][1]'
            );
            const choiceScope = (await ownedControl.count()) === 1 ? ownedControl : outerShell;
            if ((await choiceScope.count()) === 1) {
              const replayed = await replayExactReactSelection(target);
              answerPreserved = replayed.answerPreserved;
              if (replayed.multiValue) {
                const arrivalValues = (Array.isArray(replayed.arrival?.values)
                  ? replayed.arrival.values : [replayed.arrival?.value]
                ).map((value) => clean(value));
                if (reactArrivalValues === null) {
                  reactArrivalValues = arrivalValues;
                } else if (arrivalValues.length !== reactArrivalValues.length
                  || arrivalValues.some((value, index) => value !== reactArrivalValues[index])) {
                  answerPreserved = false;
                }
              }
              if (answerPreserved && !replayed.multiValue) {
                // 'target' carries the marker attribute and is what this same branch presses
                // Escape and blurs a few lines down, so it is the exact element choiceLanded's own
                // blur step needs - not a guess over 'choiceScope', which can be the outer shell.
                answerPreserved = await choiceLanded(choiceScope, replayed.semanticAnswer, target).catch(() => false);
                if (!answerPreserved) {
                  await waitForReactArrival(
                    target, replayed.arrival, replayed.semanticAnswer
                  ).catch(() => false);
                }
              }
            } else {
              // Other unreadable comboboxes keep the existing confirmation behavior. Their exact
              // choice was established by the fill path, so do not force them through React Select's
              // value reader and turn a correct answer into a hard block.
              await target.click({ timeout: 2000 }).catch(() => undefined);
            }
            await target.press('Escape').catch(() => undefined);
            await target.evaluate((element) => element.blur()).catch(() => undefined);
          } else if (fieldType === 'custom') {
            answerPreserved = await target.evaluate((element) => {
              const selected = element.querySelector(
                '[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"],'
                + ' button[class*="_active_"], button[class*="_selected_"], button[class*="_checked_"]'
              );
              if (!selected) return false;
              const semanticText = String(selected.textContent || '').replace(/\s+/g, ' ').trim();
              selected.setAttribute('data-litos-confirm-custom-option', '1');
              const remainsSelected = () => {
                const current = element.querySelector('[data-litos-confirm-custom-option="1"]');
                if (!current) return false;
                const selectedState = current.getAttribute('aria-checked') === 'true'
                  || current.getAttribute('aria-selected') === 'true'
                  || current.getAttribute('aria-pressed') === 'true'
                  || /_active_|_selected_|_checked_/.test(String(current.className || ''));
                return selectedState && String(current.textContent || '').replace(/\s+/g, ' ').trim() === semanticText;
              };
              selected.focus();
              selected.click();
              if (!remainsSelected()) selected.click();
              selected.blur();
              return remainsSelected();
            }).catch(() => false);
          } else if (fieldType === 'file') {
            answerPreserved = await target.evaluate((element) => {
              const input = element.matches?.('input[type="file"]') ? element : element.querySelector?.('input[type="file"]');
              if (input && input.files && input.files.length > 0) return true;
              return Boolean(element.querySelector?.('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]'));
            }).catch(() => false);
          } else {
            answerPreserved = await target.evaluate((element) => {
              /* A Select2 source that reached this generic arm failed the identity checks that
               * would bind it to one exact rendered opener. Its nonempty source value is not enough
               * to prove which visible choice the application is carrying. */
              if (element.classList?.contains('select2-offscreen')) return false;
              element.focus();
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.blur();
              if (element instanceof HTMLInputElement
                && (element.type === 'radio' || element.type === 'checkbox')) {
                if (element.checked) return true;
                if (!element.name) return false;
                return [...(element.form || document).querySelectorAll(
                  'input[name="' + CSS.escape(element.name) + '"]'
                )].some((peer) => peer.checked);
              }
              if (element instanceof HTMLSelectElement
                || element instanceof HTMLInputElement
                || element instanceof HTMLTextAreaElement) {
                return Boolean(String(element.value || '').replace(/\s+/g, ' ').trim());
              }
              return true;
            }).catch(() => false);
          }
          await page.waitForTimeout(150).catch(() => undefined);
          /* Replay answers the narrow question this per-control attempt owns: did the exact answer
           * survive the employer control's commit lifecycle? Greenhouse can retain aria-invalid and
           * required copy after that answer survives, including on every filled custom question at
           * once. Treating those retained markers as a second verdict here contradicts the exhaustive
           * scoped readiness pass below, which already distinguishes a real empty control from stale
           * validation copy and separately blocks runner-marked unverified choices. */
          const stillAffected = !answerPreserved;
          if (!stillAffected) { outcome = 'confirmed'; break; }
          if (attemptNumber + 1 < maxAttempts) retries = 1;
        }
        if (outcome === 'confirmed') {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'confirmed', attemptCount: attemptNumber + 1 });
        } else {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: maxAttempts, reason: 'This requires an answer' });
          unresolved.push(candidate.label || proofSelector);
        }
      }
      // The same exhaustive detector used by prepare-time readiness is read again against this
      // exact bound form. No newsletter, search, or login form can contribute a blocker here.
      const scopedReadiness = await readSubmitReadiness(scope);
      unresolved.push(...scopedReadiness.blocking, ...scopedReadiness.unmatched.map(
        (text) => 'The bound application form still shows an unmatched validation error: ' + text
      ));
      const sameNode = Boolean(scopeHandle) && await submitHandle.evaluate(
        (element, bound) => {
          if (!element.isConnected) return false;
          if (bound.scopeKind === 'form') return element.closest('form') === bound.scope;
          return bound.scope.isConnected && bound.scope.contains(element);
        },
        { scope: scopeHandle, scopeKind }
      ).catch(() => false);
      let blockerReason = null;
      if (!sameNode) {
        blockerReason = 'submit_node_replaced';
        unresolved.push('Bound submit control or application form was replaced before submission');
      } else {
        const currentBinding = await submitHandle.evaluate((element, bound) => {
          const root = bound.scope;
          return {
            formShape: {
              scopeKind: bound.scopeKind,
              id: root.id || null,
              action: bound.scopeKind === 'form' ? root.getAttribute('action') || null : null,
              method: bound.scopeKind === 'form' ? root.getAttribute('method') || null : null,
              controls: [...root.querySelectorAll('input, textarea, select, button, [role="button"]')].map((control) => ({
                tag: control.tagName.toLowerCase(), id: control.id || null, name: control.getAttribute('name') || null,
                type: control.getAttribute('type') || null, label: control.getAttribute('aria-label') || null
              }))
            },
            submitShape: { tag: element.tagName.toLowerCase(), id: element.id || null, name: element.getAttribute('name') || null, type: element.getAttribute('type') || null, text: String(element.innerText || element.value || '').replace(/\s+/g, ' ').trim() }
          };
        }, { scope: scopeHandle, scopeKind }).catch(() => null);
        const currentFormFingerprint = currentBinding && crypto.createHash('sha256').update(JSON.stringify(currentBinding.formShape)).digest('hex');
        const currentSubmitFingerprint = currentBinding && crypto.createHash('sha256').update(currentFormFingerprint + ':' + JSON.stringify(currentBinding.submitShape)).digest('hex');
        if (currentFormFingerprint !== formFingerprint || currentSubmitFingerprint !== submitFingerprint) {
          blockerReason = 'form_identity_changed';
          unresolved.push('Bound application form or submit identity changed during confirmation');
        }
      }
      const blocked = unresolved.length > 0;
      if (!blocked) {
        armSubmitNetworkWatch();
        await submitHandle.click({ timeout: action.timeout || 10_000 });
        finalSubmitPressed = true;
      }
      return {
        pass: {
          submitKind: action.submitKind,
          scope: {
            scopeKind,
            formFingerprint,
            submitFingerprint,
            formMatchCount: 1,
            submitMatchCount: 1,
            requiredControlCount: requiredControls.length,
            sameNode
          },
          requiredControls,
          attempts,
          retries,
          unresolved: [...new Set(unresolved)],
          ...(blockerReason ? { blockerReason } : {}),
          submissionOutcome: blocked ? 'blocked' : 'clicked'
        }
      };
    };
    // A click is the final submit when the caller says so, or when it targets a submit control.
    // Both, rather than either, because the label is the caller's declared intent and the selector
    // is what actually gets pressed, and a gate that can be walked around by omitting a label is
    // not a gate.
    const isFinalSubmitAction = (action) => action.type === 'click' && (
      action.label === 'final_submit'
      || /\[\s*type\s*[~^$*|]?=\s*["']?submit/i.test(action.selector || '')
    );
    // R-100. The optional pre-check is 'await locator.count() === 0', an instantaneous DOM snapshot
    // with no auto-wait, and it used to apply to waitForSelector too. That cancelled the one action
    // whose entire job is to wait, by answering "not there" before its timeout ever started. Two
    // callers depend on that wait:
    //   - 'greenhouse_application_form_ready', an optional waitForSelector on the email and resume
    //     fields, queued right after clicking 'Apply for this job' because Greenhouse renders the
    //     application form a beat later. Skipped instantly, the run typed into a form that did not
    //     exist yet, which is what a run recording filled_fields: 0 looks like;
    //   - jobExtract's render delay, an optional waitForSelector on a selector that can never match,
    //     deliberately, so the run burns its full 5s and a client-rendered board can paint. Skipped
    //     instantly, page.goto's 'domcontentloaded' is all the run ever waits for, and 'extract' on
    //     body falls back from innerText to textContent and returns the inline stylesheet. Measured
    //     2026-08-08 on three live Ashby postings: 18,547 / 10,989 / 4,970 characters beginning
    //     "You need to enable JavaScript to run this app. body { overflow: hidden; }", none of them
    //     containing one word of the posting. Honoured, the same three return the real description.
    // So waitForSelector is exempt, and nothing else changes. An earlier version of this fix also
    // gave every OTHER optional action a 1500ms settle grace against a 5000ms run-wide budget, on
    // the theory that a control rendered a moment late deserved the same courtesy. Measured against
    // both branches on two live Greenhouse forms (Redwood Materials and DRW, 2026-08-08, the second
    // chosen because it has the asynchronously loaded education comboboxes the grace was justified
    // by), the grace produced identical filled_fields and identical blockers to no grace at all, and
    // cost +4336ms and +4298ms doing it: the whole budget went on speculative fallback selectors
    // that were never going to be on the page. A wait long enough to matter is the caller's to
    // declare with waitForSelector, which now works.
    let phase = 0;
    let currentInput = input;
    while (true) {
    assertRequiredCapabilities(currentInput.actions);
    extracted.length = 0;
    filledFields.length = 0;
    actionDiagnostics.length = 0;
    skipped.length = 0;
    discovered.length = 0;
    submitGateBlockers.length = 0;
    requiredFieldConfirmation = null;
    for (const action of currentInput.actions || []) {
     // Cleared once per ACTION rather than once per chooser, so a question that goes through two of
     // them keeps the refusal whichever one produced it, and no answer inherits a sentence from the
     // field before it. A chooser that succeeds never has its reason read.
     lastChoiceRefusal = '';
     try {
      const matches = action.selector ? page.locator(action.selector) : null;
      const matchCount = action.requireUnique && matches ? await matches.count() : null;
      if (action.requireUnique && matchCount !== 1) {
        throw new Error((action.label || action.type) + ': expected exactly one match for '
          + action.selector + ', found ' + String(matchCount ?? 0));
      }
      if (action.type === 'requireCapability') continue;
      const locator = matches ? matches.first() : null;
      // Recorded before the action runs, and recorded whether or not it succeeds. What this list
      // claims is only that the caller aimed this run at that control, which is what makes the
      // form around it the application. See the form viability rules in confirmAndSubmitPass.
      if (action.selector && (action.type === 'fill' || action.type === 'fillByLabelText'
        || action.type === 'upload' || action.type === 'select')) {
        addressedSelectors.push(action.selector);
      }
      // waitForSelector is exempt outright: its own timeout is the caller's declared, already-bounded
      // intent (normalizeManagedActions clamps it to 100-20000ms), and a pre-check that can answer
      // 'not there' before that timeout starts is the bug itself. An optional one that times out
      // lands in the catch below and is reported in 'skipped'.
      if (locator && action.optional && action.type !== 'waitForSelector' && await locator.count() === 0) {
        // Reported, not silent. The pre-check used to skip in complete silence, which is how several
        // deploys went by with fields quietly left empty and nothing in the run saying so. On a real
        // 70-action Greenhouse run this turns 19 reported skips into 63.
        skipped.push((action.label || action.type) + ': nothing matched ' + action.selector);
        continue;
      }
      if (isFinalSubmitAction(action)) {
        const validConfirmation = requiredFieldConfirmation
          && requiredFieldConfirmation.version === 1
          && requiredFieldConfirmation.status === 'confirmed'
          && Array.isArray(requiredFieldConfirmation.requiredControls)
          && Array.isArray(requiredFieldConfirmation.attempts)
          && Array.isArray(requiredFieldConfirmation.unresolved)
          && requiredFieldConfirmation.requiredControls.length === requiredFieldConfirmation.attempts.length
          && requiredFieldConfirmation.unresolved.length === 0
          && await page.locator(action.selector).count() === 1;
        if (!validConfirmation) {
          const failed = (requiredFieldConfirmation?.attempts || [])
            .filter((attempt) => attempt.outcome === 'failed')
            .map((attempt) => attempt.label ? '"' + attempt.label + '" could not be confirmed' : 'A selectorless required field could not be confirmed');
          if (failed.length === 0 && requiredFieldConfirmation?.unresolved) failed.push(...requiredFieldConfirmation.unresolved);
          if (failed.length === 0) failed.push('Required-field confirmation proof is missing or malformed');
          submitGateBlockers.push(...failed);
          skipped.push((action.label || 'final_submit') + ': submit withheld because required-field confirmation failed');
          continue;
        }
        const readiness = await readSubmitReadiness();
        const blocking = [...readiness.blocking, ...readiness.unmatched.map(
          (text) => 'The form is still showing "' + text + '" and Litos could not tell which field it belongs to'
        )];
        if (readiness.stale.length > 0) {
          // Recorded, never acted on. This is the line that explains a preview screenshot covered in
          // red over a form that is actually complete.
          skipped.push('pre_submit_gate: ignored ' + readiness.stale.length
            + ' stale validation message(s) left over from an earlier pass, over fields that are now filled');
        }
        if (blocking.length > 0) {
          // NOT pressed, and the run says why. Sending here is the one failure that cannot be
          // undone: an employer keeps the first application it receives.
          submitGateBlockers.push(...blocking);
          // "or could not be confirmed" is not padding: since the readiness scan learned to read the
          // run's own unconfirmed-choice marks, a field can block this gate while being visibly full,
          // and telling the applicant it is empty would send her looking for a blank box that is not
          // there.
          skipped.push((action.label || 'final_submit')
            + ': submit withheld, ' + blocking.length
            + ' required field(s) on the form are still empty or could not be confirmed');
          continue;
        }
      }
      if (action.type === 'discover') {
        // Scans the LIVE page for text-shaped custom questions (R-055 on the managed path: this
        // runner is the only place with an actual Page object mid-run, since /api/run is otherwise
        // stateless and one-shot). Ported from student-outreach-backend's DISCOVER_QUESTIONS_SCRIPT
        // and the extension's own candidateInputs()/questionLabel() - keep the three in sync by
        // hand.
        //
        // THE HAND-SYNCING FAILED ONCE, MEASURED. On 2026-08-11 a fix for Lever custom-question
        // labels was verified against 39 live employer forms, merged into the backend as PR 477 and
        // deployed, and the next real run was identical to the one before it: the same 7 discovered
        // questions, the same 9 filled fields, the same 8 blockers. THIS copy is the one that opens
        // employer forms, and it had not been touched. Nothing in either repo can notice that -
        // there is no shared module, no generated artefact and no test that reads both - so the note
        // above is the entire mechanism, and a note is not a mechanism. Anyone changing questionLabel
        // here should expect to change it three times, and should assume the other two have drifted
        // until they have read them.
        //
        // D-01. This used to scan text-shaped inputs ONLY, on the reasoning that the caller never
        // clicks a choice control so there was nothing useful to report. That reasoning was already
        // stale - the caller does answer choice questions, through fillByLabelText's select, radio
        // and checkbox arms - and the cost was measured on production packet 245c827a: Deepgram's
        // two work-eligibility questions render as Ashby pill groups, so discovery never saw them,
        // no question record was ever written for them, and the resolver was never given the chance
        // to answer them from the stored work_authorized and needs_sponsorship booleans it holds. A
        // question that is never discovered cannot be answered and cannot be asked; it is simply
        // absent, which is how a required field ends up empty with nothing complaining.
        //
        // ONE ENTRY PER QUESTION, not per control. A radio or checkbox group is one question wearing
        // several inputs, and reporting each input separately is what once turned three unanswered
        // Greenhouse questions into seventeen blockers named after their options.
        const found = await page.evaluate(() => {
          function clean(s) {
            return (s == null ? '' : s).replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
          }
          function renderedText(node) {
            if (!node) return '';
            return typeof node.innerText === 'string' ? node.innerText : (node.textContent || '');
          }
          function labelledByText(el) {
            const ids = clean(el && el.getAttribute && el.getAttribute('aria-labelledby')).split(/\s+/).filter(Boolean);
            return clean(ids.map((id) => renderedText(document.getElementById(id))).join(' '));
          }
          function isVisible(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }
          function isHoneypot(el) {
            const name = (el.getAttribute('name') || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            if (/\b(honeypot|hp_|bot[-_]?field|hidden[-_]?field)\b/.test(name + ' ' + id)) return true;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.opacity === '0' || (rect.width <= 1 && rect.height <= 1);
          }
          function questionLabel(el) {
            function genericControlText(value) {
              return /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/.test(clean(value).toLowerCase());
            }
            /* THE HEADING A CONTROL SITS UNDER. Ported from nearestQuestionText in the backend's
             * READ_SUBMIT_READINESS_SCRIPT, which is the walk that already names these very fields
             * in the blocker line the applicant reads, so a question recovered here and the blocker
             * about the same field say the same words.
             *
             * textContent, NOT innerText, and that is measured rather than inherited: Lever paints
             * its card headings text-transform:uppercase, and innerText reports the transformed
             * glyphs, so "Year of Graduation" comes back as "YEAR OF GRADUATION". That is the
             * employer's styling, not the employer's words.
             *
             * refuseAmbiguousBlock is the safety bound, and it is passed ONLY by the handle-only
             * fall-through below. A block holding more than one control ends the walk there, because
             * the first heading inside such a block speaks for one of the controls in particular and
             * borrowing it names the other one wrongly. Measured on the live Palantir Lever form on
             * 2026-08-11: the "High School Name & Graduation Year" card holds two controls, so the
             * walk stops and both stay honest handle-only rows, while the seven single-control cards
             * recover their own headings. A wrong question is worse than a missing one - the
             * resolver answers "High School Name" out of the education profile and would type her
             * UNIVERSITY into it.
             *
             * The OTHER caller, the long-standing tail below, passes nothing and keeps the unbounded
             * walk it has always had. It fires where the assembled string is empty or is generic
             * control text, never where a handle is present, so the ambiguity this bound guards
             * against is not the shape it sees, and narrowing it would only lose labels. */
            function nearestQuestionText(start, refuseAmbiguousBlock) {
              let block = start.parentElement;
              for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
                if (!block.matches('div, section, li, fieldset')) continue;
                if (refuseAmbiguousBlock && block.querySelectorAll(
                  'input:not([type="hidden"]), textarea, select, [role="combobox"]'
                ).length > 1) return '';
                const candidate = block.querySelector('label, legend, .question, h3, h4');
                const text = clean(renderedText(candidate)).toLowerCase();
                if (text && !genericControlText(text)) return text;
              }
              return '';
            }
            /* NOTHING BUT A PROVIDER HANDLE: every letter in this string belongs to a machine handle
             * this runner can name, so removing them all leaves no word a person wrote.
             *
             * The first six are the backend's PROVIDER_HANDLE_STRIPPERS, verbatim and in its order
             * (src/lib/questionDiscovery.ts). They have to agree, because the whole safety argument
             * for the fall-through below is that a string this calls handle-only is a string
             * normalizeDiscoveredLabel already reduces to '' and drops - so recovering it can only
             * add a question, never rename one. Order is load-bearing: the uuid strip is what turns
             * the middle bracket of cards[<uuid>][field0] into a bare "[ ]" for the next one to
             * clear.
             *
             * THE BREEZY STRIPPER AT THE END IS A DELIBERATE RUNNER-SIDE ADDITION, and the safety
             * argument shifts one notch rather than breaking: a Breezy questionnaire control
             * carries name="section_<epoch>_question_<n>" and nothing else a person wrote, so
             * without this line the stored label IS that handle - measured live on the
             * transparent-hiring.breezy.hr form 2026-08-19, every paragraph, date and later-section
             * question was stored under it and never reached the Apply screen. With it, the
             * fall-through recovers the <h3> heading the applicant actually reads. So this line
             * turns a garbage label into the employer's words, never renames one that already read
             * correctly, and the backend list should gain the same shape when it is next touched.
             *
             * \p{L} and not [a-z]: a Japanese or Arabic label is a label. */
            function isProviderHandleOnly(value) {
              const strippers = [
                /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
                /\bquestion_\d+\b/gi,
                /\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*--\d+\b/gi,
                /\[\s*\]/g,
                /\bcards\s*\[\s*field\d+\s*\]/gi,
                /\s*\*?\s+\d{2,5}\s*$/u,
                /\bsection_\d+_question_\d+\b/gi
              ];
              let rest = value == null ? '' : String(value);
              for (const stripper of strippers) rest = rest.replace(stripper, ' ');
              return !/\p{L}/u.test(rest);
            }
            const choice = el.type === 'radio' || el.type === 'checkbox';
            const group = el.closest(
              '[role="group"][aria-labelledby], [role="group"][aria-label],'
              + ' [role="radiogroup"][aria-labelledby], [role="radiogroup"][aria-label]'
            );
            const groupLabel = labelledByText(group) || (group ? group.getAttribute('aria-label') : null);
            if (groupLabel) return groupLabel.toLowerCase();
            const fieldset = el.closest('fieldset');
            const fieldsetChoices = fieldset && choice
              ? [...fieldset.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
              : [];
            /* A LABEL THAT LIVES INSIDE THE CONTROL IT NAMES IS THE CONTROL'S RENDERED VALUE.
             *
             * Select2 points aria-labelledby at its own selection span: measured on the live
             * jobs.lever.co Mytos university picker, 2026-08-20, '<span role="combobox"
             * aria-labelledby="select2-university-picker-...-container">' where that container is
             * the span's own child rendering whatever is currently chosen - which on an untouched
             * form is the placeholder, "Select a university or college". Reading it as the
             * question stores placeholder text where the employer's heading belongs (the same
             * defect class as the Teamtailor placeholder join), and worse, the "label" CHANGES the
             * moment an option is picked. A reference is only a label when it points OUTSIDE the
             * control; a self-contained one is ignored so the walks below can find the heading the
             * applicant actually reads. */
            /* Filtered PER ID, not all-or-nothing: the hybrid retrofit
               aria-labelledby="own-rendered-value external-heading" is a real pattern, and an
               every()-based verdict would keep the volatile rendered value in the stored question
               whenever any one id points outside. Each id is judged alone; only the external ones
               contribute text. */
            const externalReferenceIds = clean(el.getAttribute('aria-labelledby')).split(/\s+/)
              .filter(Boolean)
              .filter((id) => {
                const target = document.getElementById(id);
                return target && !el.contains(target);
              });
            const referencedLabel = clean(externalReferenceIds
              .map((id) => renderedText(document.getElementById(id))).join(' '));
            const referenceIds = clean(el.getAttribute('aria-labelledby'));
            const sameNamePeers = choice && el.name
              ? (fieldsetChoices.length > 0 ? fieldsetChoices : [...(el.form || document).querySelectorAll(
                  'input[type="radio"][name="' + CSS.escape(el.name) + '"], input[type="checkbox"][name="' + CSS.escape(el.name) + '"]'
                )]).filter((input) => input.name === el.name)
              : [el];
            const sharedChoiceReference = !choice || (referenceIds && sameNamePeers.length > 0
              && sameNamePeers.every((input) => clean(input.getAttribute('aria-labelledby')) === referenceIds));
            if (referencedLabel && sharedChoiceReference) return referencedLabel.toLowerCase();
            const fieldsetNames = new Set(fieldsetChoices.map((input) => input.name).filter(Boolean));
            const fieldsetOwnsChoice = !choice || fieldsetNames.size <= 1;
            const legend = fieldsetOwnsChoice && fieldset ? fieldset.querySelector('legend') : null;
            const legendText = clean(renderedText(legend));
            if (legendText) return legendText.toLowerCase();
            const labelEl = (el.labels && el.labels[0]) || (el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null);
            const labelText = renderedText(labelEl);
            const ariaLabel = el.getAttribute('aria-label') || '';
            // A radio or checkbox is labelled with its OPTION - "Male", "Yes", "Hispanic or Latino" -
            // and the applicant is answering the QUESTION above it. The pre-submit gate already
            // prefers the group's own text for exactly this reason; discovery has to agree with it,
            // or the same control is called two different things by two halves of one run.
            if (el.type === 'radio' || el.type === 'checkbox') {
              const owner = blockOf(el);
              // A label that speaks for ONE option is disqualified, however it says so: by wrapping
              // the input, or by naming a choice input in its "for". What is left is the block's own
              // heading. Without this test the search finds a SIBLING option's label and calls the
              // question "Female" - a group of options is full of labels that are not the question.
              /* .application-label is included ONLY here, inside the choice branch, and that
               * narrowness is the point. The runner records that adding it to the GENERIC walk was
               * measured and rejected because it resolved "High School Name*" to her university.
               * This branch's owner is one application-question, holding one question and its own
               * options, so that ambiguity cannot arise here. */
              /* h3 is here for Breezy, and only inside this choice branch, the same way
               * .application-label is only here for Lever. Breezy's questionnaire writes the
               * question in an <h3> inside the same li.question that holds the options - measured
               * live 2026-08-19, the first option of "English level" is "B1 (Intermediate) or
               * below", which the tenant auto-disqualifies, so a group labeled by its first option
               * asks the applicant to disqualify herself. An h3 inside ONE question's own block is
               * that question's heading; the generic walk already trusts h3 for the same reason. */
              const ownerLabel = owner && [...owner.querySelectorAll('label, legend, .application-label, h3')].find((candidate) => {
                if (candidate.querySelector('input, textarea, select')) return false;
                const named = candidate.getAttribute && candidate.getAttribute('for');
                if (!named) return true;
                const target = document.getElementById(named);
                return !(target && (target.type === 'radio' || target.type === 'checkbox'));
              });
              const ownerText = clean(renderedText(ownerLabel)).toLowerCase();
              if (ownerText && !genericControlText(ownerText)) return ownerText;
            }
            /* WHEN THE CONTROL CARRIES NO LABEL OF ITS OWN, the block's label beats the placeholder.
             *
             * The line below joins label + aria-label + placeholder + name + id and takes whatever
             * comes out, which is right on Greenhouse (real <label for>, so the join opens with the
             * question and the trailing name and id are how labelMarksRequired reads the employer's
             * "*" and how the education comboboxes are recognised by their "--0" handles) and wrong
             * wherever the control is anonymous. Both Ashby cases measured on packet 245c827a are
             * anonymous: the location combobox has no id, no name and no aria-label, so the join
             * produced its placeholder, "start typing...", as the question; and the yes/no mirror
             * input has only a name, so the join produced a bare UUID.
             *
             * Applied ONLY when the control has neither a <label for> nor an aria-label, so no form
             * that labels its inputs properly can be relabelled by this.
             */
            /* A COMBOBOX THAT SAYS ONLY WHAT IT IS, NEVER WHAT IT ASKS. Measured on the live
             * Rippling apply form (ats.rippling.com, Easy Dynamics, 2026-08-19): the widget's own
             * input carries aria-label "Search", placeholder "Search", a name randomized on every
             * render ("vh-v1lveguk" one run, "QBIQlS1zQx" the next) and an id like "field-34", and
             * the visible question - "Phone number", "Are you currently authorized to work in the
             * U.S.?" - sits in a plain div or span BESIDE the widget, never in a <label> element.
             * So the parts join below stored "search search vh-v1lveguk field-34" as the question,
             * which no saved answer can ever anchor to, and which is a NEW question on every
             * render because the name half rotates.
             *
             * The arm is double-gated so it cannot rename a labelled control: the element must be a
             * combobox opener with NO label text of its own, and everything it does say (aria-label,
             * placeholder) must be widget furniture - "search", "select", "select..." - words that
             * describe the control and not the question. Then the visible label is the text of the
             * nearest preceding sibling on the way up that holds no controls of its own; a sibling
             * holding controls is the PREVIOUS question and ends the walk, which is what keeps this
             * from borrowing a neighbour's heading. */
            const choiceOpenerHere = el.getAttribute('role') === 'combobox'
              || el.getAttribute('aria-haspopup') === 'listbox';
            const WIDGET_FURNITURE = /^(?:search|select(?: one| an option)?|choose(?: one| an option)?|start typing.*|type to search.*)?[.…\s]*$/i;
            if (choiceOpenerHere && !clean(labelText)
              && WIDGET_FURNITURE.test(clean(ariaLabel))
              && WIDGET_FURNITURE.test(clean(el.getAttribute('placeholder') || ''))) {
              // Twelve, not the walk's usual six: measured on the live form, the "Phone number"
              // label div is ten parents above the widget's input. What bounds the walk is not the
              // depth but the two stop rules below - a sibling holding controls is the previous
              // QUESTION and ends it.
              let above = el;
              for (let depth = 0; above && depth < 12; depth += 1, above = above.parentElement) {
                /* THE WIDGET'S OWN HIDDEN BACKING CONTROL IS NOT THE PREVIOUS QUESTION. Select2
                 * leaves the original <select> standing as the immediate previous sibling of the
                 * span it renders, 1x1, tabindex="-1" and aria-hidden="true" (measured on the live
                 * jobs.lever.co Mytos university picker, 2026-08-20). It belongs to THIS question,
                 * so the walk steps past it AT THIS LEVEL - 'continue' would ascend, and in flat
                 * markup (label div, hidden select, rendered span as siblings of one parent) the
                 * question div becomes a child one level up, never a preceding sibling, so it
                 * would be forever out of reach. A VISIBLE control sibling still ends the walk
                 * below, because that one really is the previous question's. */
                let beside = above.previousElementSibling;
                while (beside && beside.matches && beside.matches('input, textarea, select')
                  && beside.getAttribute('aria-hidden') === 'true') beside = beside.previousElementSibling;
                if (!beside) continue;
                if (beside.querySelector && beside.querySelector('input, textarea, select, [role="combobox"], button')) break;
                if (beside.matches && beside.matches('input, textarea, select, [role="combobox"], button')) break;
                const besideText = clean(renderedText(beside));
                if (besideText && besideText.length <= 200 && !genericControlText(besideText)) {
                  return besideText.toLowerCase();
                }
                if (besideText) break;
              }
            }
            if (!clean(labelText) && !clean(ariaLabel)) {
              const owner = blockOf(el);
              const ownerLabel = owner && owner.querySelector('label, legend');
              const ownerText = clean(renderedText(ownerLabel)).toLowerCase();
              if (ownerText && !genericControlText(ownerText)) return ownerText;
            }
            /* A PLACEHOLDER IS NOT PART OF A QUESTION'S NAME, unless it is all the control has.
             *
             * Measured on live Teamtailor forms (fully.teamtailor.com and moburst.teamtailor.com,
             * 2026-08-19/20): the phone question was stored as "phone phone number with country
             * code +1 201-555-0123 candidate[phone] candidate_phone" - visible label plus
             * PLACEHOLDER plus name plus id. The placeholder half is volatile between renders, so
             * consecutive discoveries mint the "same" question under two different labels;
             * downstream that flaps packet identity and every send attempt refuses with
             * packet_stale, forever. So a control that carries any written label (label text or
             * aria-label) is named WITHOUT its placeholder. A control whose only human text IS the
             * placeholder keeps it, because dropping it there would reduce the label to a bare
             * handle and lose the question (the Ashby "start typing..." shape the owner-walk above
             * already handles when it can).
             *
             * The name and id stay in the join, deliberately: the backend reads control handles
             * OUT of the stored label (LABEL_SECTION_HANDLE_RE and friends recover "school--0" and
             * the Greenhouse demographic ids from it), so dropping them here would orphan the
             * education option probes. Unlike a placeholder they are stable within one board's
             * render... where they are not (Rippling), the combobox arm above names the control
             * before this join runs. */
            const placeholderText = clean(labelText) || clean(ariaLabel) ? '' : (el.getAttribute('placeholder') || '');
            /* A LEVER CARD CONTROL WHOSE ONLY HUMAN TEXT IS ITS PLACEHOLDER is named by the
             * heading the applicant reads, not by the words inside the empty box.
             *
             * Measured on the live jobs.lever.co Mytos form, 2026-08-20: every text answer in the
             * education card is '<input class="card-field-input" placeholder="Type your response"
             * name="cards[<uuid>][fieldN]">' sitting under its own
             * '<div class="application-label"><div class="text">What degree did you complete at
             * the above university?...' - so the stored question was "Type your response", one
             * identical string for three different questions, and no saved answer can tell them
             * apart. Same class as the Teamtailor placeholder-volatility fix: the placeholder
             * describes the CONTROL, the .application-label states the QUESTION.
             *
             * NARROWER THAN THE WALK THE RUNNER ALREADY REJECTED, and the bound is kept. Adding
             * .application-label to the generic walk was measured and rejected because an
             * UNBOUNDED walk borrows a neighbouring card's heading. This arm never walks: it reads
             * the ONE .application-label that Lever renders as the immediate previous sibling of
             * the control's own .application-field, refuses it when that label block holds any
             * control, and refuses it when the surrounding li.application-question holds more than
             * one visible control - the same one-question-one-control shape the choice branch and
             * the Palantir refuseAmbiguousBlock bound already trust. A control with NO placeholder
             * is untouched: the handle-only fall-through below keeps its existing, measured
             * behavior, including refusing the two-control Palantir card. */
            const boundedSiblingCardLabel = () => {
              const fieldBlock = el.closest && el.closest('.application-field');
              const cardLabel = fieldBlock && fieldBlock.previousElementSibling;
              if (!cardLabel || !cardLabel.matches || !cardLabel.matches('.application-label')) return '';
              if (cardLabel.querySelector('input, textarea, select, [role="combobox"], button')) return '';
              const owner = el.closest('li.application-question') || fieldBlock.parentElement;
              if (!owner || owner.querySelectorAll(
                'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select, [role="combobox"]'
              ).length > 1) return '';
              const text = clean(renderedText(cardLabel));
              return text && text.length <= 200 && !genericControlText(text) ? text.toLowerCase() : '';
            };
            const leverCardHeading = placeholderText ? boundedSiblingCardLabel() : '';
            const parts = [labelText || '', ariaLabel, leverCardHeading || placeholderText, el.getAttribute('name') || '', el.id || ''];
            const own = clean(parts.join(' ')).toLowerCase();
            /* THE HANDLE THAT IS NOT A LABEL.
             *
             * own is the visible label, the aria-label and the placeholder concatenated with the
             * control's name and id, and returning it whenever it is merely non-empty means a field
             * carrying NOTHING but a name returns that name. Lever's custom questions are built that
             * way: the question text sits in a sibling div.application-label, never in a label
             * element, and the control carries only name="cards[<uuid>][field0]". So the label this
             * runner reports is the handle, normalizeDiscoveredLabel drops it as handle-only, and
             * the question is simply absent - no row on the Apply screen, no answer resolved, no
             * fill attempted, and the run comes back saying "University" is required and is still
             * empty while the packet holds USC Viterbi, 2028 and Computer Science.
             *
             * This is a port of the fall-through merged into the backend as PR 477. It had to be
             * made twice because it lives twice: the backend's questionDiscovery.ts, the extension,
             * and THIS runner each carry their own questionLabel, and the runner is the copy that
             * drives employer forms. The backend fix alone changed nothing about a real run.
             *
             * BOTH CONDITIONS, and both are needed:
             *   - nothing a person wrote (no label text, no aria-label, no placeholder), so a field
             *     with any human text keeps it and this branch cannot touch it; and
             *   - what survives is nothing but handles this runner can name, so a meaningful name or
             *     id - firstName, school, gpa - is still a label and is kept.
             *
             * That pair is exactly the set of fields whose label is thrown away downstream today,
             * which is why this cannot rename a question that already reads correctly: it only runs
             * where the stored label would have been the empty string. When the walk finds nothing
             * either, own is returned unchanged and the field is dropped as before - no heading is
             * invented for a field that has none.
             *
             * NOT tried again here, because the original author measured both and rejected them:
             * adding .application-label to the walk's candidates recovers four more fields and also
             * resolves "High School Name*" to "University of Southern California, Viterbi School of
             * Engineering"; and keying the regression diff on selector rather than index reports 93
             * false positives, because every radio in a group shares one name. */
            const written = clean([labelText || '', ariaLabel, el.getAttribute('placeholder') || ''].join(' '));
            if (own && !written && isProviderHandleOnly(own)) {
              const underHeading = nearestQuestionText(el, true);
              if (underHeading) return underHeading;
              /* A SELECT WITH NO HUMAN TEXT OF ITS OWN, in a card the heading walk refused. The
               * walk above rejects any level holding more than one control, and that is exactly
               * the shape of Lever's multi-question education card. Measured on the live
               * jobs.lever.co Mytos form, 2026-08-20 (packet 16f1c744): one card renders nine
               * questions - four of them required NATIVE selects (discipline, qualification
               * level, degree classification, UK visa) carrying nothing but
               * name="cards[<uuid>][fieldN]" - so all four were named by their handles, dropped
               * downstream as handle-only, and the run said a required field "has no label Litos
               * can read" about labels that were on the screen. Their questions sit in the
               * sibling .application-label, and the same bounded read the placeholder arm uses
               * (own label holds no control, one visible control per question) recovers them.
               * A FALLBACK, deliberately behind the heading walk: a one-question card keeps the
               * heading it has always been named by, so no stored Lever question changes its
               * words and no saved answer is orphaned by a rename.
               *
               * TEXTAREA for the same measured reason, same form, same day: the required
               * "What have you built..." card question is a textarea whose placeholder is EMPTY,
               * so the placeholder-gated arm cannot reach it either, and the run reported it as
               * "a required field has no label Litos can read". A text INPUT is deliberately
               * not included until a form shows the need: inputs routinely carry placeholders,
               * and the placeholder arm already recovers them. */
              if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
                const siblingLabel = boundedSiblingCardLabel();
                if (siblingLabel) return siblingLabel;
              }
            }
            const fallbackText = nearestQuestionText(el);
            if (own && !genericControlText(own)) return own;
            return fallbackText || own;
          }
          // The block that owns one question. Kept in step with widgetOf in the pre-submit gate: the
          // two Ashby entries are what make a pill group resolve to its question rather than to the
          // row of buttons.
          function blockOf(el) {
            /* li.application-question is Lever's, and it is here because .field does NOT match
             * application-field - a class selector matches whole tokens. Without it blockOf found
             * nothing on Lever, fell back to el.parentElement, and on a radio that IS the option's
             * own label element, so the choice branch searched inside one option and yielded nothing.
             * Measured on Belvedere Trading and Palantir 2026-08-17: every Lever packet came back
             * with required fields named "High School Diploma", "Yes", "Other" - each the first
             * OPTION of a question. One application-question holds one question and its own options,
             * so this is narrower than the card and cannot reintroduce the two-control ambiguity the
             * card bound exists to refuse. */
            /* li.question is Breezy's, for the same reason li.application-question is Lever's.
             * Measured on the live transparent-hiring.breezy.hr HR Assistant Intern form
             * (2026-08-19): each questionnaire question is one <li class="question"> holding an
             * <h3> heading and a <ul class="options"> of <label><input type="radio">…</label>
             * rows. Without it blockOf fell back to el.parentElement, which on a Breezy radio IS
             * the option's own <label>, so the question was named after its first option and the
             * option list held one row. One li.question holds one question and its own options,
             * so this is as narrow as the Lever entry above it. */
            return el.closest(
              'fieldset, [role="group"], [role="radiogroup"], [data-field-path],'
              + ' [data-input-type], [class*="_fieldEntry_"], [class*="select__container"], .field, .field-wrapper,'
              + ' li.application-question, li.question'
            ) || el.parentElement || el;
          }
          function choiceQuestionKey(el, block) {
            const semanticGroup = el.closest(
              '[role="group"][aria-labelledby], [role="group"][aria-label],'
              + ' [role="radiogroup"][aria-labelledby], [role="radiogroup"][aria-label]'
            );
            return semanticGroup || el.name || block;
          }
          /* Whether the EMPLOYER marks this question required, read three ways because the three
           * ATS families spell it three different ways and a gate that knows only one of them is
           * blind to the other two:
           *   - the HTML attribute, which Greenhouse and Lever set;
           *   - aria-required, which React Select sets on its own input;
           *   - a CSS-module class on the question's label, which is all Ashby gives. Verified in
           *     Ashby's stylesheet on 2026-08-09: ._required_<hash>:after renders the asterisk, and
           *     the asterisk is therefore a pseudo-element that appears in no label text anywhere.
           *     That is why the backend's labelMarksRequired, which looks for a literal "*" in the
           *     reported label, reads every Ashby field as optional - including, on packet 245c827a,
           *     the three that were required and empty.
           * No page text is read here. Each signal names one specific control or its own label.
           */
          function marksRequired(el, block) {
            if (el.required || el.getAttribute('aria-required') === 'true') return true;
            if (block && block.getAttribute && block.getAttribute('aria-required') === 'true') return true;
            const label = block && block.querySelector('label[class*="_required_"], legend[class*="_required_"]');
            return Boolean(label);
          }
          // A stable way back to this control on a LATER page load. The marker attribute below is
          // written into this page's DOM and is gone by the time the fill run opens the form again
          // (the two are separate stateless calls), so the backend refuses it and falls back to
          // matching by label text. An id, a name, or Ashby's own data-field-path survives the
          // reload and gives that fallback something better to use.
          function durableSelectorOf(el, block) {
            if (el.id && !/^[0-9]/.test(el.id)) return '#' + CSS.escape(el.id);
            const name = el.getAttribute && el.getAttribute('name');
            if (name) return '[name="' + name.replace(/["\\]/g, '\\$&') + '"]';
            const path = block && block.getAttribute && block.getAttribute('data-field-path');
            if (path) return '[data-field-path="' + path.replace(/["\\]/g, '\\$&') + '"]';
            /* A RENDERED WIDGET'S DURABLE NAME IS ITS BACKING SELECT'S. Measured on the live
             * jobs.lever.co Mytos university picker, 2026-08-20: the control discovery emits is
             * Select2's '<span role="combobox">', which carries no id, no name and no field path,
             * so the question shipped with no durable selector, the backend could not build a
             * fill action for it, and a required field whose answer sat resolved in the packet
             * ("University of Southern California", present verbatim among the select's 2,965
             * options) was reported "required and is still empty" on every run. The hidden
             * '<select class="select2-hidden-accessible" name="cards[<uuid>][field0]">' one node
             * over IS this question's control: filling it natively is what Select2 itself does on
             * a commit, and the fill branch already handles a select. Named only when the block
             * holds exactly ONE select and that select is widget-backing (aria-hidden or hidden
             * by the widget's own class), so a foreign control can never lend its name. */
            if (el.getAttribute && (el.getAttribute('role') === 'combobox'
              || el.getAttribute('aria-haspopup') === 'listbox') && block && block.querySelectorAll) {
              const selects = block.querySelectorAll('select');
              const backing = selects.length === 1 ? selects[0] : null;
              const backingHidden = backing && (backing.getAttribute('aria-hidden') === 'true'
                || /(?:^|\s)(?:select2-hidden-accessible|chosen-select)(?:\s|$)/.test(backing.className || ''));
              /* AND THE WIDGET THE OPENER LIVES IN MUST BE THE SELECT'S OWN. Select2 and Chosen
               * both render their widget as the select's immediate next sibling, so an opener
               * inside that sibling is this select's rendering and an opener anywhere else in the
               * block is some other question's. Without this, an unnamed input-backed combobox
               * sharing a broad block with one widgetized select could borrow a foreign name. */
              const widget = backingHidden && backing.nextElementSibling;
              const openerIsItsWidget = Boolean(widget && (widget === el || widget.contains(el)));
              const backingName = openerIsItsWidget && backing.getAttribute('name');
              if (backingName) return '[name="' + backingName.replace(/["\\]/g, '\\$&') + '"]';
              if (openerIsItsWidget && backing.id && !/^[0-9]/.test(backing.id)) return '#' + CSS.escape(backing.id);
            }
            return null;
          }
          // The choices a closed list actually offers, so the resolver can snap a stored answer onto
          // one of them instead of typing its own phrasing at a control that does not contain it.
          function optionsOf(el, block) {
            if (el.tagName === 'SELECT') {
              return [...el.options]
                .map((option) => clean(option.textContent || option.value))
                .filter((text) => text && !/^(select|choose|please|--)/i.test(text));
            }
            if (!block) return [];
            const texts = [];
            for (const input of block.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
              const byFor = input.id && document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
              const wrapping = input.closest('label');
              const text = clean(
                renderedText(byFor) || renderedText(wrapping) || labelledByText(input)
                || input.getAttribute('aria-label') || ''
              );
              const question = clean(questionLabel(input));
              // Ashby labels its hidden mirror input with the QUESTION, so a single "option" whose
              // text is the question is not an option list at all.
              if (text && text.length <= 80 && text.toLowerCase() !== question.toLowerCase()) texts.push(text);
            }
            for (const button of block.querySelectorAll('button')) {
              // The control under discovery can itself be a button-shaped or div-shaped combobox
              // opener now that non-form tags are scanned; its own furniture text ("Select") is
              // what it looks like closed, not one of the choices it offers.
              if (button === el || button.getAttribute('role') === 'combobox'
                || button.getAttribute('aria-haspopup') === 'listbox') continue;
              const text = clean(renderedText(button));
              if (!text || text.length > 40) continue;
              if (/upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i.test(text)) continue;
              texts.push(text);
            }
            return [...new Set(texts)];
          }
          /* D-01 AGAIN, ONE TAG FAMILY OVER: A COMBOBOX THAT IS NOT AN INPUT WAS NEVER SCANNED.
           *
           * The list below named form TAGS, so a choice control built out of a div or span was
           * invisible to discovery while remaining perfectly visible to the readiness gate, whose
           * control scans have always included [role="combobox"]. Measured live on
           * ats.rippling.com (Easy Dynamics, 2026-08-20): the two required work-authorization
           * questions are '<div id="field-63" role="combobox" aria-haspopup="listbox"
           * aria-label="Select" aria-required="true">' and its sponsorship twin #field-69 - no
           * input anywhere inside them - so the run's readiness gate reported a required control
           * named only "Select" while discovery had emitted nothing for it: no question record,
           * no resolver attempt, nothing the applicant could answer in Litos. The same run
           * discovered every INPUT-backed Rippling combobox (#field-20, #field-34, #field-42)
           * because those carry the role on the input itself. Lever's Select2 university picker
           * is the same shape one board over: the visible control is a <span role="combobox">
           * and the <select> behind it is a 1x1 aria-hidden honeypot-shaped element this scan
           * rightly drops.
           *
           * :not(input):not(select):not(textarea) keeps every existing candidate exactly as it
           * was: a combobox that IS a form control still enters through its own tag selector. */
          const els = Array.prototype.slice
            .call(document.querySelectorAll(
              'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"],'
              + ' input[type="date"], input[type="radio"], input[type="checkbox"], input:not([type]), textarea, select,'
              + ' [role="combobox"]:not(input):not(select):not(textarea),'
              + ' [aria-haspopup="listbox"]:not(input):not(select):not(textarea)'
            ))
            // A choice input is exempt from the visibility test and from readOnly. Ashby's yes/no
            // mirror input is display:none by design and is the only DOM node that names the
            // question; requiring it to be visible is requiring the question not to exist. Its BLOCK
            // still has to be visible, which is the honest form of the same check.
            .filter((el) => {
              if (el.closest('[id*="litos"]') || el.disabled) return false;
              const choice = el.type === 'radio' || el.type === 'checkbox';
              const choiceOpener = el.getAttribute('role') === 'combobox'
                || el.getAttribute('aria-haspopup') === 'listbox';
              // A non-form-tag opener that holds a real form control inside it is a WRAPPER, and
              // the control inside is the candidate this scan already judges on its own merits.
              // Older React-Select bundles put role="combobox" on the shell around their search
              // input; scanning both would mint two questions for one control. The Rippling
              // work-authorization divs and Lever's Select2 span hold no such control (measured
              // 2026-08-20: #field-63 has zero descendant inputs), so they stay.
              const bareOpener = choiceOpener && !/^(?:INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
              /* Three bounds on the bare-opener class, each measured against a way the bare scan
               * could mint garbage. Page chrome: a language switcher or sort menu in a header is
               * a listbox opener too, and only form tags kept it out before - an application
               * question does not live in header/footer/nav. Backing controls: the "real form
               * control inside" test ignores hidden and aria-hidden controls, because a
               * Chosen-style widget NESTS its 1x1 backing select inside the shell it renders, and
               * counting that as real re-opens the exact discovery/gate asymmetry this arm closes.
               * Nesting: when an opener holds another opener (headless-UI div shell around a
               * button opener), only the INNERMOST is scanned, or one control mints two records
               * under two selectors. */
              if (bareOpener && el.closest('header, footer, nav, [role="navigation"], [role="banner"], [role="contentinfo"]')) return false;
              if (bareOpener && el.querySelector(
                'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select:not([aria-hidden="true"])'
              )) return false;
              if (bareOpener && el.querySelector('[role="combobox"], [aria-haspopup="listbox"]')) return false;
              if (!choice && ((!choiceOpener && el.readOnly) || !isVisible(el))) return false;
              if (choice && !isVisible(blockOf(el))) return false;
              return !isHoneypot(el) || choice;
            });
          const out = [];
          const seenBlocks = new Set();
          let counter = 0;
          for (let i = 0; i < els.length; i += 1) {
            const el = els[i];
            const block = blockOf(el);
            const choice = el.type === 'radio' || el.type === 'checkbox';
            // One question, one entry. Keyed on the block for a pill or radio group, and on the
            // group name where several blocks share one; a text input is always its own question.
            if (choice) {
              const key = choiceQuestionKey(el, block);
              if (seenBlocks.has(key)) continue;
              seenBlocks.add(key);
            }
            const label = clean(questionLabel(el));
            if (!label) continue;
            counter += 1;
            const marker = 'data-litos-discovered-' + counter;
            el.setAttribute(marker, '1');
            const options = optionsOf(el, block);
            out.push({
              label: label,
              selector: '[' + marker + ']',
              durableSelector: durableSelectorOf(el, block),
              /* A bare opener reports 'text', never its tag's own .type: a <button> opener would
                 otherwise report 'submit', a value no consumer has ever been handed, and a <div>
                 has no .type at all. 'text' plus the role below is exactly the shape input-backed
                 comboboxes have always reported, so consumers keyed on either signal keep working. */
              inputType: el.tagName === 'TEXTAREA' ? 'textarea'
                : (el.tagName === 'SELECT' ? 'select'
                  : (/^(?:INPUT)$/.test(el.tagName) ? (el.type || 'text') : 'text')),
              // A React-select is still an <input type="text">. Its DOM role is the wire evidence
              // that distinguishes it from a genuine open text field such as end-year--0.
              role: el.getAttribute('role') || null,
              required: marksRequired(el, block),
              options: options.length > 0 ? options : null,
              maxLength: el.maxLength > 0 ? el.maxLength : null
            });
          }
          return out;
        });
        discovered.push(...found);
      }
      if (action.type === 'confirmAndSubmit') {
        /* A CODE WALL IS ALREADY THE APPLICATION SUBMIT'S RESULT.
         *
         * A retained Greenhouse page can begin this phase with the eight-box verification control
         * already standing and its submit button disabled until the code is complete. Running the
         * ordinary application confirmation against that DOM reports "Atomic submit control was
         * missing or ambiguous" before any click, which used to fall through to applicant copy that
         * falsely said a submission had been attempted. Do not click the application again. End the
         * application action here, let the zero-cost post-run challenge reader advertise the held
         * continuation, and allow only the later atomic verification action to enter the inbox code
         * and submit that existing challenge. */
        if (!action.securityCode && action.submitKind === 'application' && await readSecurityCodeChallenge()) {
          skipped.push('confirm_and_submit: employer security code challenge already standing');
          continue;
        }
        const passes = [];
        if (action.securityCode) {
          const entry = await enterSecurityCode(action.securityCode);
          if (entry !== 'entered') {
            securityCodeAttempt = { supplied: true, entered: false, outcome: entry, resubmitted: false };
            throw new Error('Security code was not entered before atomic verification');
          } else {
            // A continuation already sits on the changed verification DOM. Enter first, bind the
            // current verification submit second, and click exactly once. Clicking before entry can
            // reject or rotate the code and must remain structurally impossible.
            const verification = await confirmAndSubmitPass({ ...action, securityCode: undefined });
            passes.push(verification.pass);
            /* THE VERDICT IS THE RECEIPT, NOT THE CONTROL, and the difference cost a filed
             * application.
             *
             * This branch used to read the code control the instant networkidle resolved and call it
             * rejected if the control was still attached. On a client-rendered Greenhouse embed
             * networkidle resolves BEFORE React swaps the view, so the control is momentarily still
             * there and a perfect submission read as a refusal. Measured on the Cresta packet
             * (Greenhouse, Data Science Intern (Customer Success)): the attempt at 17:35:04Z was
             * recorded rejected, and at 17:36:04Z recruiting@cresta.ai wrote "Thank you for applying
             * to Cresta" to that packet's alias. The application was filed and the applicant was told
             * to go and file it again by hand.
             *
             * Two changes, and they belong together. Wait for a state the same way the sibling
             * application submit four lines below already does, and then let a CONFIRMED receipt
             * outrank the control: a page that has said the application is in is not waiting for a
             * code, whatever is still mounted while the view finishes changing. Control presence is
             * still what decides the ambiguous case, because on a genuine refusal Greenhouse renders
             * no receipt at all and the challenge is all there is to read. An explicitly REJECTED
             * receipt is honoured too, which the old shape could not do: it read a cleared control
             * over a failure panel as acceptance. What may outrank the control, and why it has to be
             * that narrow, is argued at securityCodeVerdict. */
            let codeOutcome = 'not_entered';
            if (verification.pass.submissionOutcome === 'clicked') {
              await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
              await waitForPostSubmitApplicationState({ securityCodeSettles: false });
              const receipt = await readSubmitOutcome();
              const still = await readSecurityCodeChallenge();
              codeOutcome = securityCodeVerdict(receipt, still);
            }
            securityCodeAttempt = {
              supplied: true,
              entered: true,
              resubmitted: verification.pass.submissionOutcome === 'clicked',
              outcome: codeOutcome
            };
          }
        } else {
          const application = await confirmAndSubmitPass(action);
          passes.push(application.pass);
          if (application.pass.submissionOutcome === 'clicked') {
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            await waitForPostSubmitApplicationState();
          }
        }
        const confirmed = passes.length === 1 && passes.every((pass) => pass.submissionOutcome === 'clicked' && pass.unresolved.length === 0 && pass.scope.sameNode === true);
        requiredFieldConfirmation = { version: 2, status: confirmed ? 'confirmed' : 'blocked', passes };
        if (!confirmed) {
          const failed = passes.flatMap((pass) => pass.attempts
            .filter((attempt) => attempt.outcome === 'failed')
            .map((attempt) => attempt.label ? '"' + attempt.label + '" could not be confirmed' : 'A required field could not be confirmed'));
          const unresolved = passes.flatMap((pass) => pass.unresolved);
          submitGateBlockers.push(...(failed.length > 0 ? failed : unresolved));
          skipped.push('confirm_and_submit: atomic confirmation blocked submission');
        }
        continue;
      }
      if (action.type === 'click') {
        // Armed BEFORE the click for the same reason finalSubmitPressed is set before the wait: the
        // response worth recording is the one the click itself causes, and a watch attached after
        // the click races the request it exists to see.
        if (isFinalSubmitAction(action)) armSubmitNetworkWatch();
        await locator.click();
        // RECORDED BEFORE THE WAIT, not after. A submit click that lands and then navigates, times
        // out, or takes the sandbox down with it has still been pressed, and "was the button
        // pressed" is the one fact the applicant's next move depends on. Setting it after the wait
        // would lose it in exactly the case that matters.
        if (isFinalSubmitAction(action)) finalSubmitPressed = true;
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        /* THE PAGE AFTER SEND IS THE ONLY PROOF, SO THE RUN HAS TO STAY AND WATCH IT.
         *
         * The confirmAndSubmit path has waited out the post-submit window since it existed; the
         * plain final-submit click never did. It waited for networkidle and moved on, and the
         * run's final text and screenshot are taken AFTER the action loop - so on a board that
         * confirms with a client-side transition after the submit XHR, the snapshot fires in the
         * gap between the network going quiet and the thank-you rendering. Measured live on the
         * Max Borges Workable form (2026-08-19): Send was pressed, the application was really
         * sent, and the backend's receipt reader reported the run "never showed a confirmation it
         * could read" because the snapshot predates the confirmation. Employers do not reliably
         * email a confirmation, so that snapshot is the applicant's only receipt.
         *
         * waitForPostSubmitApplicationState is the same bounded watch the atomic path uses: up to
         * 30 seconds on the SAME page, returning on the first read that is a confirmation, a
         * rejection, or a standing security-code challenge - so the snapshot taken after the loop
         * is from the first state worth reporting, and only a page that stays ambiguous for the
         * whole window is reported unconfirmed. The securityCode click keeps its own sequence
         * below, where the same watch already runs after the code is resubmitted. */
        if (isFinalSubmitAction(action) && !action.securityCode) {
          await waitForPostSubmitApplicationState();
        }
        /* THE SECOND HALF OF A GREENHOUSE SUBMIT, and the reason it is HERE rather than in its own
         * action.
         *
         * Greenhouse's answer to submit is not "filed" or "rejected", it is "prove you read this
         * mailbox": it emails a code and renders a code field, and the form has to be submitted
         * AGAIN with that code in it. So finishing takes three steps that only exist relative to
         * each other - click, type, click - and the middle one cannot be queued in advance, because
         * the control it types into does not exist until the first click has happened.
         *
         * The caller therefore hands the code to the submit click it already queues, and the two
         * extra steps cost ZERO extra actions. That is not a nicety. MANAGED_ACTION_LIMIT is 120 and
         * a real Greenhouse packet reconstructs to exactly 120, with the trim already having shaved
         * preferred_first_name and preferred_last_name off the end: every action added here would
         * have displaced a field the applicant expects to see filled.
         *
         * With no code supplied this does nothing at all. The challenge is then still standing when
         * the post-run scan reads it, and the caller is told what the page is waiting for.
         */
        if (action.securityCode && isFinalSubmitAction(action)) {
          // The control renders after the round trip the click just made, so it is worth one bounded
          // wait. Same shape as greenhouse_application_form_ready: declared, short, and optional.
          await page.waitForSelector('input[autocomplete*="one-time-code" i], input[maxlength="1"]', { timeout: 8000 })
            .catch(() => undefined);
          const entry = await enterSecurityCode(action.securityCode);
          if (entry !== 'entered') {
            securityCodeAttempt = { supplied: true, entered: false, outcome: entry, resubmitted: false };
            skipped.push('security_code: the code was not typed, ' + entry);
          } else {
            // Resubmitting is the whole point: Greenhouse's own email says "After you enter the
            // code, resubmit your application." A code typed into a form nobody sends changes
            // nothing.
            await locator.click().catch(() => undefined);
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            // The same verdict the atomic branch above makes, for the same measured reason: the
            // control is still attached while a client-rendered view swaps, so a receipt outranks it.
            // Two code paths reaching opposite conclusions about the same page is how one of them
            // stays wrong without anyone noticing.
            await waitForPostSubmitApplicationState({ securityCodeSettles: false });
            const receipt = await readSubmitOutcome();
            const still = await readSecurityCodeChallenge();
            securityCodeAttempt = {
              supplied: true,
              entered: true,
              resubmitted: true,
              outcome: securityCodeVerdict(receipt, still)
            };
          }
        }
      }
      if (action.type === 'fill') {
        const diagnosticControlId = String(action.selector || '').match(/^#(question_\d+)$/)?.[1] || '';
        const actionDiagnostic = diagnosticControlId ? {
          controlId: diagnosticControlId,
          locatorCount: await locator.count().catch(() => 0),
          targetResolved: false,
          targetVisible: false,
          targetTag: 'unknown',
          targetInChoiceShell: false,
          targetPlaceholderSignal: false,
          targetValuePlaceholderSignal: false,
          targetPseudoPlaceholderSignal: false,
          labelCount: 0,
          labelledQuestionCount: 0,
          locatorChoicePlaceholderCount: 0,
          labelChoicePlaceholderCount: 0,
          choicePeerCount: 0,
          nearbyChoiceIndicator: false,
          route: 'unresolved',
          choiceAttempted: false,
          choiceFilled: false,
          choiceLanded: false,
          choiceControlOpened: false,
          choiceUnreadable: false,
          choiceRefused: false,
          choiceStateKind: 'not_read',
          outcome: 'started'
        } : null;
        if (actionDiagnostic) actionDiagnostics.push(actionDiagnostic);
        // See fillTargetWithin. The selector is allowed to name the question rather than the
        // control, because for one shape of control that is the only name it has.
        const target = await fillTargetWithin(locator);
        if (!target) {
          if (actionDiagnostic) actionDiagnostic.outcome = 'target_unresolved';
          const message = 'the selector ' + action.selector
            + ' does not name a control Litos can type into, and the block it names holds no single field';
          if (action.label) skipped.push(action.label + ': ' + message);
          continue;
        }
        const datePrecision = await dateControlPrecisionOf(target);
        if (datePrecision) {
          const result = await fillDateControl(target, action.value || '', datePrecision);
          recordDateFill(result, action.label, action.value || '');
          await dismissOverlayAfterFill(target, action.label);
          continue;
        }
        const fillShape = await target.evaluate((element) => ({
          tag: element.tagName.toLowerCase(),
          placeholder: element.getAttribute('placeholder') || '',
          role: element.getAttribute('role') || '',
          ariaHaspopup: element.getAttribute('aria-haspopup') || '',
          ariaAutocomplete: element.getAttribute('aria-autocomplete') || ''
        })).catch(() => ({ tag: '', placeholder: '', role: '', ariaHaspopup: '', ariaAutocomplete: '' }));
        const targetInChoiceShell = fillShape.tag === 'input' && await target.evaluate((element) => Boolean(
          element.closest('[class*="select__control"], [class*="select__value-container"], [class*="select__input"], [class*="select2-search"]')
        )).catch(() => false);
        if (actionDiagnostic) {
          actionDiagnostic.targetResolved = true;
          actionDiagnostic.targetVisible = await target.isVisible().catch(() => false);
          actionDiagnostic.targetTag = ['input', 'select', 'textarea', 'button', 'div'].includes(fillShape.tag)
            ? fillShape.tag
            : 'other';
          actionDiagnostic.targetInChoiceShell = targetInChoiceShell;
          actionDiagnostic.targetPlaceholderSignal = /^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i.test(fillShape.placeholder);
        }
        /* Greenhouse also renders a role-less custom select whose durable #question_<digits>
         * selector can name either the wrapper or the inner search input. The live Jump Trading
         * degree control names the input while its Select placeholder is a sibling in the exact
         * label-bound question. It exposes neither the ARIA role nor the class convention above,
         * so the provider-owned question id and that visible placeholder are both required. An
         * ordinary text question never becomes a choice control merely because it shares the form. */
        const greenhouseQuestionId = String(action.selector || '').match(/^#(question_\d+)$/)?.[1] || '';
        const greenhouseQuestionLabel = greenhouseQuestionId
          ? page.locator('label[for="' + greenhouseQuestionId + '"]').first()
          : null;
        const greenhouseQuestionLabelCount = greenhouseQuestionLabel
          ? await greenhouseQuestionLabel.count().catch(() => 0)
          : 0;
        const greenhouseLabelledQuestion = greenhouseQuestionLabel
          ? greenhouseQuestionLabel.locator(
            'xpath=ancestor::*[(self::div or self::fieldset) and .//*[@id="' + greenhouseQuestionId + '"]][1]'
          )
          : null;
        const greenhouseLabelledQuestionCount = greenhouseLabelledQuestion
          ? await greenhouseLabelledQuestion.count().catch(() => 0)
          : 0;
        const locatorChoicePlaceholderCount = greenhouseQuestionId
          ? await locator.getByText(/^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i).count().catch(() => 0)
          : 0;
        const labelChoicePlaceholderCount = greenhouseLabelledQuestionCount > 0
          ? await greenhouseLabelledQuestion.getByText(
            /^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i
          ).count().catch(() => 0)
          : 0;
        /* A role-less Greenhouse search input can render its empty state without a placeholder
         * attribute or a text node. The live Jump degree control does exactly that while sharing
         * its field-shell structure with neighbouring controls that do publish combobox evidence,
         * and it renders a small down-caret in the same one-control shell. Both facts are required
         * for the peer arm, so a normal provider-owned text box cannot become a chooser merely
         * because another question on the form is a dropdown. */
        const greenhouseRolelessEvidence = greenhouseQuestionId
          ? await target.evaluate((element) => {
            const choicePlaceholder = (value) => /^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i.test(String(value || ''));
            const visible = (node) => {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
            };
            const ancestors = [];
            let cursor = element.parentElement;
            while (cursor && ancestors.length < 5 && cursor.tagName !== 'FORM' && cursor.tagName !== 'BODY') {
              ancestors.push(cursor);
              cursor = cursor.parentElement;
            }
            const oneControlShell = ancestors.find((node) => (
              node.querySelectorAll('input:not([type="hidden"]), textarea, select').length === 1
            )) || element.parentElement;
            const indicators = oneControlShell
              ? [...oneControlShell.querySelectorAll(
                'button, [role="button"], svg, [class*="indicator" i], [class*="dropdown" i], [class*="chevron" i], [class*="caret" i]'
              )].filter((node) => node !== element && visible(node))
              : [];
            const pseudoNodes = [element, ...ancestors];
            const pseudoPlaceholder = pseudoNodes.some((node) => ['::before', '::after'].some((part) => {
              const content = getComputedStyle(node, part).content || '';
              return choicePlaceholder(content.replace(/^['"]|['"]$/g, ''));
            }));
            const elementClass = String(element.className || '').trim();
            const parentClass = String(element.parentElement?.className || '').trim();
            const peerIds = new Set();
            for (const peer of document.querySelectorAll('input[id^="question_"]')) {
              if (peer === element) continue;
              const sameInputClass = elementClass && String(peer.className || '').trim() === elementClass;
              const sameParentClass = parentClass
                && String(peer.parentElement?.className || '').trim() === parentClass;
              if (!sameInputClass && !sameParentClass) continue;
              const peerChoice = peer.getAttribute('role') === 'combobox'
                || ['true', 'listbox'].includes(peer.getAttribute('aria-haspopup') || '')
                || peer.getAttribute('aria-autocomplete') === 'list'
                || Boolean(peer.closest(
                  '[class*="select__control"], [class*="select__value-container"], [class*="select__input"], [class*="select2-search"]'
                ));
              if (peerChoice && peer.id) peerIds.add(peer.id);
            }
            return {
              valuePlaceholder: choicePlaceholder(element.value),
              pseudoPlaceholder,
              choicePeerCount: peerIds.size,
              nearbyChoiceIndicator: indicators.length > 0
            };
          }).catch(() => ({
            valuePlaceholder: false,
            pseudoPlaceholder: false,
            choicePeerCount: 0,
            nearbyChoiceIndicator: false
          }))
          : {
            valuePlaceholder: false,
            pseudoPlaceholder: false,
            choicePeerCount: 0,
            nearbyChoiceIndicator: false
          };
        if (actionDiagnostic) {
          actionDiagnostic.labelCount = greenhouseQuestionLabelCount;
          actionDiagnostic.labelledQuestionCount = greenhouseLabelledQuestionCount;
          actionDiagnostic.locatorChoicePlaceholderCount = locatorChoicePlaceholderCount;
          actionDiagnostic.labelChoicePlaceholderCount = labelChoicePlaceholderCount;
          actionDiagnostic.targetValuePlaceholderSignal = greenhouseRolelessEvidence.valuePlaceholder;
          actionDiagnostic.targetPseudoPlaceholderSignal = greenhouseRolelessEvidence.pseudoPlaceholder;
          actionDiagnostic.choicePeerCount = greenhouseRolelessEvidence.choicePeerCount;
          actionDiagnostic.nearbyChoiceIndicator = greenhouseRolelessEvidence.nearbyChoiceIndicator;
        }
        const selectorShowsChoicePlaceholder = greenhouseQuestionId && (
          /^\s*(?:select|choose)(?:\.\.\.|\u2026)?\s*$/i.test(fillShape.placeholder)
          || locatorChoicePlaceholderCount > 0
          || labelChoicePlaceholderCount > 0
          || greenhouseRolelessEvidence.valuePlaceholder
          || greenhouseRolelessEvidence.pseudoPlaceholder
          || (greenhouseRolelessEvidence.choicePeerCount > 0
            && greenhouseRolelessEvidence.nearbyChoiceIndicator)
        );
        const targetInGreenhouseQuestionChoice = fillShape.tag === 'input'
          && Boolean(selectorShowsChoicePlaceholder);
        if (fillShape.tag === 'select') {
          if (actionDiagnostic) actionDiagnostic.route = 'native_select';
          const selected = await selectNativeOption(target, action.value || '');
          if (!selected) {
            if (actionDiagnostic) actionDiagnostic.outcome = 'native_option_unmatched';
            if (action.label) skipped.push(action.label + ': ' + unmatchedReason(action.value || ''));
            continue;
          }
          // See settleVerified: a native select's own DOM value is set synchronously by the click,
          // but a board that mirrors it into a controlled React value prop can still repaint the
          // rendered selectedIndex on a later tick, and this used to read verifyFilled exactly once.
          if (action.label && await settleVerified(() => verifyFilled(target, action.value || ''))) filledFields.push(action.label);
          else if (action.label) skipped.push(action.label + ': choice value did not persist after fill');
          if (actionDiagnostic) actionDiagnostic.outcome = filledFields.includes(action.label)
            ? 'native_committed'
            : 'native_uncommitted';
          continue;
        }
        if (fillShape.role === 'combobox' || fillShape.ariaHaspopup === 'true'
          || fillShape.ariaHaspopup === 'listbox' || fillShape.ariaAutocomplete === 'list'
          || targetInChoiceShell || targetInGreenhouseQuestionChoice) {
          if (actionDiagnostic) actionDiagnostic.route = 'custom_choice';
          let container;
          if (targetInChoiceShell) {
            container = target.locator('xpath=ancestor::*[' + CHOICE_SHELL_CLASSES + '][1]');
          } else if (targetInGreenhouseQuestionChoice) {
            container = greenhouseLabelledQuestionCount > 0 ? greenhouseLabelledQuestion : locator;
          } else {
            container = target.locator(
              'xpath=ancestor::*[(self::div or self::fieldset) and (.//*[@role="combobox"] or .//*[@aria-haspopup="listbox"] or .//*[@aria-haspopup="true"])][1]'
            );
          }
          // Read before the label is consulted, never behind it. Written as one short-circuit, a
          // labelless action skipped the verification entirely and, with it, the withdrawal that
          // takes a refused row back off the form. Nothing about whether the caller named a field
          // changes what this run owes the form.
          if (actionDiagnostic) actionDiagnostic.choiceAttempted = true;
          // Computed once and reused below: a labelled Greenhouse choice AND a targetInChoiceShell
          // fill both drive 'target' directly, so both fillCustomChoice and choiceLanded's own blur
          // step need the same element, not a guess across 'container'. One shared value means a
          // future third shape added here cannot update one call and silently miss the other.
          const driveTarget = targetInChoiceShell || targetInGreenhouseQuestionChoice ? target : null;
          const choiceFilled = await fillCustomChoice(
            container,
            action.value || '',
            driveTarget,
          );
          if (actionDiagnostic) {
            actionDiagnostic.choiceFilled = choiceFilled;
            actionDiagnostic.choiceControlOpened = lastChoiceControlOpened;
            actionDiagnostic.choiceUnreadable = lastChoiceUnreadable;
            actionDiagnostic.choiceRefused = Boolean(lastChoiceRefusal);
          }
          if (choiceFilled) {
            const landed = await choiceLanded(
              container,
              action.value || '',
              driveTarget,
            );
            if (actionDiagnostic) {
              actionDiagnostic.choiceLanded = landed;
              actionDiagnostic.choiceUnreadable = lastChoiceUnreadable;
              actionDiagnostic.outcome = landed ? 'choice_committed' : 'choice_uncommitted';
            }
            if (action.label && landed) filledFields.push(action.label);
            else if (action.label) {
              skipped.push(action.label + ': '
                + (lastChoiceUnreadable ? unreadableChoiceReason : 'choice value did not persist after fill'));
            }
            continue;
          }
          // No option matched, and this is a widget whose answered state can be read. Falling
          // through to the plain fill below would type the answer into the widget's SEARCH box and
          // then read it straight back out of that same box, so verifyFilled agreed and the field
          // was reported filled while the control still said "Select...". On the live Five Rings
          // form both Discipline candidates were reported filled and the employer's own validator
          // then called the field empty. A choice we could not make belongs to the applicant.
          const state = await readChoiceState(container);
          if (actionDiagnostic) {
            actionDiagnostic.choiceStateKind = ['chosen', 'empty', 'unknown'].includes(state.kind)
              ? state.kind
              : 'other';
            actionDiagnostic.choiceControlOpened = lastChoiceControlOpened;
            actionDiagnostic.choiceUnreadable = lastChoiceUnreadable;
            actionDiagnostic.choiceRefused = Boolean(lastChoiceRefusal);
          }
          if (state.kind !== 'unknown') {
            if (actionDiagnostic) actionDiagnostic.outcome = state.kind === 'chosen'
              ? 'choice_already_answered'
              : 'choice_unmatched';
            if (action.label) {
              skipped.push(state.kind === 'chosen'
                ? action.label + ': left the answer already on the form, "' + clean(state.value) + '"'
                : action.label + ': ' + unmatchedReason(action.value || ''));
            }
            continue;
          }
        }
        /* A bare opener that reached here had no option to click and no readable choice state.
           There is no box to type into - locator.fill on a div throws, the throw becomes one
           silent line in skipped, and the field reads as attempted. The choice was not made and
           it belongs to the applicant, said in the same words the readable-state arm uses. */
        if (await target.evaluate(isBareOpener).catch(() => false)) {
          if (actionDiagnostic) {
            actionDiagnostic.route = 'bare_opener';
            actionDiagnostic.outcome = 'choice_unmatched';
          }
          if (action.label) skipped.push(action.label + ': ' + unmatchedReason(action.value || ''));
          continue;
        }
        // What actually goes in the box. Identical to action.value for everything except a phone
        // field whose own group already carries this number's dial code; see phoneValueForField.
        const fillValue = await phoneValueForField(target, action.value || '');
        if (actionDiagnostic) actionDiagnostic.route = 'text';
        await target.fill(fillValue || '');
        await target.evaluate((element) => {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => undefined);
        // Verified against what was WRITTEN, not against what was asked for. Checking a stripped
        // phone against the international form would report a correct fill as a failed one.
        let textPersisted = await verifyFilled(target, fillValue || '');
        /* A provider-owned role-less search input can hold the typed query long enough for one
         * immediate read, then clear it when the custom selector repaints or the search input loses
         * focus. The live Jump degree control survived the original 650ms read while focused, then
         * Greenhouse validation blurred it and showed Select. Only exact #question_<digits> inputs
         * pay this bounded stability read and neutral blur. A real text field keeps its value when
         * blurred. When the text disappears, the same exact control gets one scoped chooser attempt
         * and must pass the ordinary committed-choice verifier before it counts. */
        if (textPersisted && greenhouseQuestionId && fillShape.tag === 'input') {
          await page.waitForTimeout(650);
          textPersisted = await verifyFilled(target, fillValue || '');
          if (textPersisted) {
            // Same element-blurring primitive choiceLanded uses below, rather than a second
            // hand-written 'element.blur()' - directControl is always 'target' here, so this
            // is the exact call blurDrivenChoiceControl already makes for a known control.
            await blurDrivenChoiceControl(target, target);
            await page.waitForTimeout(150);
            textPersisted = await verifyFilled(target, fillValue || '');
          }
        }
        if (textPersisted) {
          if (action.label) filledFields.push(action.label);
          if (actionDiagnostic) actionDiagnostic.outcome = 'text_committed';
        } else if (greenhouseQuestionId && fillShape.tag === 'input') {
          const rescueContainer = greenhouseLabelledQuestionCount > 0
            ? greenhouseLabelledQuestion
            : locator;
          if (actionDiagnostic) {
            actionDiagnostic.route = 'text_then_choice';
            actionDiagnostic.choiceAttempted = true;
          }
          const choiceFilled = await fillCustomChoice(rescueContainer, action.value || '', target);
          const landed = choiceFilled
            ? await choiceLanded(rescueContainer, action.value || '', target)
            : false;
          if (actionDiagnostic) {
            actionDiagnostic.choiceFilled = choiceFilled;
            actionDiagnostic.choiceLanded = landed;
            actionDiagnostic.choiceControlOpened = lastChoiceControlOpened;
            actionDiagnostic.choiceUnreadable = lastChoiceUnreadable;
            actionDiagnostic.choiceRefused = Boolean(lastChoiceRefusal);
            actionDiagnostic.outcome = landed ? 'choice_committed' : 'choice_uncommitted';
          }
          if (action.label && landed) filledFields.push(action.label);
          else if (action.label) {
            skipped.push(action.label + ': '
              + (lastChoiceUnreadable
                ? unreadableChoiceReason
                : (lastChoiceRefusal || 'value did not persist after fill')));
          }
        }
        /* WHAT WAS WRITTEN AND WHAT THE FIELD HOLDS, because the bare sentence cannot be acted on.
         *
         * "value did not persist after fill" says a write was lost and nothing else, and on
         * 2026-08-18 that one line was the last blocker on six of this user's Greenhouse packets -
         * DV Trading, Five Rings, Akuna, Tower Research, Jump Trading and IMC - all naming the same
         * control, "phone", and none of them saying why.
         *
         * Two plausible causes were then ruled out by hand against the live DV Trading form, which
         * is the work this line exists to make unnecessary. Its #phone is intl-tel-input
         * (iti__tel-input inside iti--allow-dropdown), and it ACCEPTS the international form:
         * "+971500000000" reads back "+971 50 000 0000". So the value is not rejected, and the
         * reformatting cannot break verifyFilled either, because normalized() keeps only [a-z0-9]
         * and both sides reduce to the same digits. Something in the live sequence loses it instead,
         * and neither the value nor the check can say which.
         *
         * Both sides truncated, and only ever on the failure path: this is the applicant's own data
         * going back to the applicant's own dashboard, and a run that SUCCEEDS still records nothing
         * but the label. */
        else if (action.label && !textPersisted) {
          if (actionDiagnostic) actionDiagnostic.outcome = 'text_uncommitted';
          const held = await target.evaluate((element) => (
            'value' in element ? String(element.value || '') : (element.textContent || '')
          )).catch(() => '');
          const wrote = String(fillValue || '');
          // Concatenation, not a template literal: this source is itself carried inside one, so a
          // backtick or a dollar-brace here terminates the runner rather than formatting a string.
          skipped.push(action.label
            + ': value did not persist after fill'
            + ' (wrote "' + wrote.slice(0, 40) + '", field holds "' + held.slice(0, 40) + '")');
        }
        // Last, and only after the value is committed and verified: a date field commits its value
        // and leaves its calendar standing over the next question.
        await dismissOverlayAfterFill(target, action.label);
      }
      if (action.type === 'fillByLabelText') {
        /* THE ELEMENT THAT NAMES THE QUESTION, ahead of the first prose that mentions it.
         *
         * See D-02 above. getByText(text).first() takes the first element in DOM order whose text
         * merely CONTAINS the question, and on the live Skydio Ashby form that is the EEO preamble
         * paragraph, three questions above the control. Everything downstream is resolved from this
         * anchor, so the wrong anchor silently redirects the whole action at another question's
         * options.
         *
         * A whole-string match is tried first: an element whose entire text IS the question is the
         * question's label, and prose that happens to contain the word is not. Case-insensitive
         * because the stored question text is not the board's capitalisation ("gender" in packet
         * 13bccb2d against Ashby's "Gender"), and a trailing asterisk or colon is allowed because
         * that is how a required field is marked. The old containment search is still the fallback,
         * so a board whose label carries extra words is no worse off than before.
         */
        /* THE REQUIRED MARKER IS NOT PART OF THE QUESTION'S NAME. Lever welds a \u2733 to the
         * heading with no space ("...United States?\u2733") while the stored question carries it
         * with one ("...united states? \u2733"), so the whole-string match failed, the containment
         * fallback failed on the same byte, and every reviewed radio on the live DGA form was
         * silently skipped with her answers sitting in the packet (measured 2026-08-20). The
         * marker is stripped from the WANTED side and allowed on the page side, exactly as the
         * trailing asterisk already was. */
        const wantedLabel = clean(action.text).replace(/[\s\u2733*]+$/, '');
        const wholeLabel = wantedLabel
          ? new RegExp('^\\s*' + wantedLabel.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\s*[*:\u2733]?\\s*$', 'i')
          : null;
        const exactLabel = wholeLabel ? page.getByText(wholeLabel).first() : null;
        const label = exactLabel && (await exactLabel.count()) > 0
          ? exactLabel
          : page.getByText(wantedLabel || action.text, { exact: false }).first();
        if (await label.count() === 0) {
          const message = 'fillByLabelText: label not found';
          if (action.optional) {
            skipped.push((action.label || action.type) + ': ' + message);
            continue;
          }
          throw new Error(message);
        }
        const container = label.locator(
          'xpath=ancestor::*[(self::div or self::fieldset) and (.//textarea or .//input[not(@type="file") and not(@type="hidden")] or .//select or .//*[@role="combobox"] or .//*[@aria-haspopup="listbox"])][1]'
        );
        const questionBlock = await questionOptionBlock(label, container);
        const field = questionBlock.locator('textarea, input:not([type=file]):not([type=hidden]), select').first();
        if (await field.count() === 0) {
          /* THE FOURTH CALL SITE, AND IT WAS THE ONE WITHOUT A VERIFIER.
           *
           * The three other fillCustomChoice calls in this loop read the control back before
           * reporting it; this one reported the label the moment the chooser said it had clicked
           * something. A chooser that clicked is not a chooser that was right: the widened tier
           * clicks a row that CONTAINS the answer, and verifyChoiceInContainer is the only thing in
           * this file that can disagree with it.
           *
           * The gap was invisible because of what reaches here. This branch is entered only when the
           * question's block holds no input, no textarea and no select at all, so every fixture with
           * a mirror checkbox, a search box or a hidden input goes down one of the verified branches
           * instead. A combobox that is not an input - '<div role="combobox">' on Ashby, '<button
           * aria-haspopup="listbox">' on Workday - is the shape that lands here, and it is the shape
           * that had no verification. Measured on one page, one stored answer of "I am authorized to
           * work in the United States" against a menu offering only "...only with a student visa":
           * the radio, pill and checkbox renderings refused it as a near miss, the React Select
           * clicked and was then refused by its verifier, and this branch clicked the same row and
           * reported the field filled.
           */
          if (await fillCustomChoice(questionBlock, action.value || '')) {
            const landed = await choiceLanded(questionBlock, action.value || '');
            if (action.label && landed) filledFields.push(action.label);
            else if (action.label) {
              skipped.push(action.label + ': '
                + (lastChoiceUnreadable ? unreadableChoiceReason : 'choice value did not persist after fillByLabelText'));
            }
            continue;
          }
          // A question whose only controls are option buttons has no field to find, by construction.
          // Asked here as well as in the checkbox arm below because a board that omits the mirror
          // input entirely never reaches that arm.
          if (await pickOptionPill(questionBlock, action.value || '')) {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          // A picker that DECLINED found the control perfectly well. Reporting "field not found"
          // there would tell the applicant the opposite of what happened and hide the one sentence
          // that lets her finish it.
          if (lastChoiceRefusal) {
            skipped.push((action.label || action.type) + ': ' + lastChoiceRefusal);
            continue;
          }
          /* AND NEITHER DID A PICKER THAT OPENED THE CONTROL AND FOUND THE ANSWER MISSING, which is
           * the same complaint one clause up and was still being answered with "field not found".
           * The field was found. It was opened, its list was read, and her answer is not on it, and
           * that is a sentence she can act on in one click. The other two combobox branches in this
           * loop have said so since D-01; this branch is the copy that was left behind.
           *
           * It matters more since the exact tier stopped being allowed to look across the page: a
           * portalling control that does not offer her answer used to click somebody else's row and
           * is now correctly handed back, so this is the sentence that reports it. */
          if (lastChoiceControlOpened && action.label) {
            const unmatched = await readChoiceState(questionBlock);
            skipped.push(unmatched.kind === 'chosen'
              ? action.label + ': left the answer already on the form, "' + clean(unmatched.value) + '"'
              : action.label + ': ' + unmatchedReason(action.value || ''));
            continue;
          }
          const message = 'fillByLabelText: field not found';
          if (action.optional) {
            skipped.push((action.label || action.type) + ': ' + message);
            continue;
          }
          throw new Error(message);
        }
        // Dispatch on the CONTROL, not on the question. Everything used to fall through to fill(),
        // which throws on a checkbox or radio ("Input of type checkbox cannot be filled") and, before
        // the try/catch above, took the entire run with it. Callers cannot predict the control type
        // either: on a real Greenhouse form "How did you hear about this job?" reads like free text
        // and is a checkbox group.
        const shape = await field.evaluate((element) => ({
          tag: element.tagName.toLowerCase(),
          type: (element.getAttribute('type') || '').toLowerCase(),
          placeholder: element.getAttribute('placeholder') || '',
          role: element.getAttribute('role') || '',
          ariaHaspopup: element.getAttribute('aria-haspopup') || '',
          ariaAutocomplete: element.getAttribute('aria-autocomplete') || ''
        }));
        /* A SEARCH BOX IS NOT THE CONTROL, however it is dressed. The field locator above resolves
         * the FIRST typeable input in the block, and on a react-select that is the widget's own
         * search input. Typing into it filters a menu and commits nothing, the typed text survives
         * long enough for verifyFilled to read it straight back out of the same box, and the
         * widget then drops it on blur - so the one protected attempt the backend's trimmer leaves
         * each question reported a fill the form never kept. Measured live on the Optiver
         * Greenhouse form 2026-08-19 the input announced itself (role=combobox), which the arm
         * below already dispatches on; older react-select renderings announce nothing on the input
         * at all (see the shape-read note above verifyFilled's rescue chain below), and for those
         * the widget's own class shell around the input is the durable signal. WIDGET-INTERNAL
         * classes only, on purpose: the shell names themselves ('select-shell', 'select__container')
         * also appear in LAYOUT wrappers - the measured 'select-shell-grid' of 19c - and a plain
         * text input under such a wrapper must keep its plain fill rather than be handed to a
         * chooser that has nothing to open. Detection only: everything this routes INTO is the
         * same verified choice arm the ARIA shapes take. */
        const fieldInChoiceShell = shape.tag === 'input' && await field.evaluate((element) => Boolean(
          element.closest('[class*="select__control"], [class*="select__value-container"], [class*="select__input"], [class*="select2-search"]')
        )).catch(() => false);
        // Read off the control, ahead of every other arm. A date picker is not a select, not a
        // combobox and not free text, and the old test for one - an answer already shaped
        // YYYY-MM-DD next to a placeholder mentioning a date - could only ever fire on a run that
        // had been handed a date to start with. See dateControlPrecisionOf.
        const labelDatePrecision = shape.tag === 'select' ? '' : await dateControlPrecisionOf(field);
        if (labelDatePrecision) {
          const result = await fillDateControl(field, action.value || '', labelDatePrecision);
          recordDateFill(result, action.label, action.value || '');
          await dismissOverlayAfterFill(field, action.label);
          continue;
        }
        if (shape.tag === 'select') {
          const customSelected = await fillCustomChoice(questionBlock, action.value || '');
          const selected = customSelected || await selectNativeOption(field, action.value || '');
          // SAID OUT LOUD, because a silent 'continue' is a dropped answer. This branch left an
          // unmatched select with nothing in filledFields and nothing in skipped, so the run
          // reported neither a filled field nor a reason, and the only trace was the employer's own
          // validator later calling it empty. The tightened exact rule above makes this arm fire
          // more often, not less, which is exactly why it has to speak.
          if (!selected) {
            if (action.label) skipped.push(action.label + ': ' + unmatchedReason(action.value || ''));
            continue;
          }
        } else if (shape.role === 'combobox' || shape.ariaHaspopup === 'true' || shape.ariaAutocomplete === 'list' || fieldInChoiceShell) {
          /* 'field' is NOT handed to either call as directControl, on purpose. It is only the first
           * typeable node the shape dispatch above found, and fillCustomChoice's own CHOICE_CONTROLS
           * discovery can and does pick a different element as the real opener - measured on the
           * choice-parity Select2 fixture, where 'field' resolves to the widget's decoy typeahead
           * input but the control actually driven is '.select2-choice'. Passing 'field' here would
           * not narrow blurDrivenChoiceControl's target, it would redirect fillCustomChoice itself
           * onto the wrong element. blurDrivenChoiceControl's own document.activeElement fallback is
           * what covers this call site instead, without needing to guess which element is real. */
          if (await fillCustomChoice(questionBlock, action.value || '')) {
            const landed = await choiceLanded(questionBlock, action.value || '');
            if (action.label && landed) filledFields.push(action.label);
            else if (action.label) {
              skipped.push(action.label + ': '
                + (lastChoiceUnreadable ? unreadableChoiceReason : 'choice value did not persist after fillByLabelText'));
            }
            continue;
          }
          /* NAME THE ANSWER THAT WAS NOT ON THE LIST, the way the fill branch above already does.
           *
           * The verdict is unchanged and deliberately so: no option matched, and a choice we could
           * not make belongs to the applicant. What changes is that she is told which answer went
           * looking. Measured 2026-08-09 on the live DV Trading form behind two of these reports:
           * "Graduation Date" is a React Select offering ranges - "January 2028 - July 2028",
           * "August 2028 - December 2028" - and the stored answer is the month "May 2028", which
           * genuinely is not on that list. "choice option not found" told her none of that, so a
           * report she could have cleared in one click read as a fault in Litos.
           */
          if (action.label) {
            const unmatched = await readChoiceState(questionBlock);
            skipped.push(unmatched.kind === 'chosen'
              ? action.label + ': left the answer already on the form, "' + clean(unmatched.value) + '"'
              : action.label + ': ' + unmatchedReason(action.value || ''));
          }
          continue;
        } else if (shape.type === 'checkbox' || shape.type === 'radio') {
          /* Scoped to THIS question's own option block, never the whole page and - since D-02 -
           * never a container that turned out to hold somebody else's options either. That scoping
           * is what makes matching an answer as short as "Yes" safe: an unscoped label match could
           * tick a consent or legal acknowledgement elsewhere on the form, which the applicant
           * cannot undo, and a container-wide match set Gender from the Race answer on every Ashby
           * EEO block Litos has ever filled.
           *
           * Every arm below ends the action. Falling through to the text verification at the bottom
           * is what reported four correctly ticked Skydio radios as lost, because that verification
           * reads the first input in the block and not the option that was clicked.
           */
          const wanted = String(action.value || '').trim();
          const scope = questionBlock;
          const groups = await radioGroupNames(scope);
          if (groups.length > 1) {
            // Refused rather than guessed. Two groups means two questions, and the only thing worse
            // than leaving this one for the applicant is answering the other one for her.
            if (action.label) {
              skipped.push(action.label + ': this block holds ' + groups.length
                + ' separate option groups, so an answer here could have landed on another question, left for you to choose');
            }
            continue;
          }
          const outcome = await pickRadioOption(scope, wanted);
          if (outcome === 'checked') {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          if (outcome === 'near-miss') {
            // Ends the action rather than falling through to the pill and lone-checkbox arms below.
            // Those arms exist for a block this one could not READ; a block it read and declined is
            // a block where a second, looser attempt would tick exactly the option the refusal was
            // protecting her from.
            if (action.label) skipped.push(action.label + ': ' + lastChoiceRefusal);
            continue;
          }
          if (outcome === 'not-checked') {
            // The option exists, it was clicked, and the page did not keep it. Said plainly, because
            // the applicant can finish it in one click and nothing else on the run can tell her.
            if (action.label) skipped.push(action.label + ': the option was clicked and did not stay selected');
            continue;
          }
          // Before the single-checkbox heuristic below, because on Ashby that heuristic is precisely
          // the wrong move: the one checkbox in the block is the display:none mirror of a pill pair,
          // so checking it neither drives React nor distinguishes Yes from No. See pickOptionPill.
          if (await pickOptionPill(scope, wanted)) {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          const lone = scope.locator('input[type=checkbox], input[type=radio]');
          const total = await lone.count();
          if (total === 1 && /^yes$/i.test(wanted)) {
            await lone.first().check().catch(() => undefined);
            // A single "I agree" checkbox - a terms-and-conditions acknowledgement is the measured
            // case - is exactly the shape pickRadioOption's own settleVerified call now covers, and
            // this arm had none of it: one check() and one immediate read, no retry at all.
            if (await settleVerified(() => lone.first().evaluate((element) => element.checked === true).catch(() => false))) {
              if (action.label) filledFields.push(action.label);
              continue;
            }
          }
          // No exact option match means the answer does not belong to this control. Leaving it
          // unticked is correct: it surfaces as a required-field blocker for the applicant, which is
          // far cheaper than guessing a checkbox on their behalf.
          if (action.label) skipped.push(action.label + ': ' + unmatchedReason(wanted));
          continue;
        } else {
          // No date arm here any more. input[type=date] and every picker this runner can recognise
          // are answered by fillDateControl above and never reach the shape dispatch, so an arm here
          // could only ever run on a control that is not a date control.
          await field.fill(action.value || '');
          await field.evaluate((element) => {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => undefined);
        }
        /* A TEXT FILL THAT DOES NOT STICK IS EVIDENCE THE CONTROL IS NOT TEXT.
         *
         * Measured on production packet 13bccb2d (Skydio, Ashby, 2026-08-09): "gender" and "veteran
         * status" were both resolved from the stored profile, both dispatched down this branch, and
         * both came back "value did not persist after fillByLabelText". A real text input keeps what
         * you type into it. One that does not is a widget's own search box, or a mirror input behind
         * a set of option buttons, and this branch was reached only because the shape read gave no
         * role, no aria-haspopup and no aria-autocomplete to dispatch on - which comment (3) at the
         * top of the backend's profileFieldResolution already records as routine on this path.
         *
         * So the failed verification is the signal, and the two choice fills get their turn before
         * the field is written off. Ordered most scoped first: pickOptionPill only ever clicks a
         * button inside THIS question's container, fillCustomChoice is the react-select path that
         * the same defect class was already fixed in. Nothing here runs on a fill that worked.
         */
        // See settleVerified: this is also where the shape.tag === 'select' branch above lands once
        // selectNativeOption has clicked an option, so a controlled select whose rendered value
        // repaints a tick after its DOM value commits gets the same bounded re-read a react-select
        // does, rather than the one immediate check this used to make.
        let persisted = await settleVerified(() => verifyFilled(field, action.value || ''));
        if (!persisted) {
          if (await pickOptionPill(questionBlock, action.value || '')) persisted = true;
          else if (await fillCustomChoice(questionBlock, action.value || '')) {
            // Same row hint as the two branches above, for the same reason: the fill that just
            // succeeded is the one whose row this is, and a widget on this path abbreviates its
            // chosen value exactly as readily as one on the others. 'field' is deliberately not
            // handed to either call here either - see the combobox arm above for why.
            persisted = await choiceLanded(questionBlock, action.value || '');
            if (!persisted && lastChoiceUnreadable) lastChoiceRefusal = unreadableChoiceReason;
          }
        }
        if (action.label && persisted) filledFields.push(action.label);
        // A refusal from either of the two choice fills above outranks the generic sentence: it says
        // what was actually wrong, and this arm is reached precisely when the plain text fill was the
        // wrong dispatch for the control.
        else if (action.label) skipped.push(action.label + ': ' + (lastChoiceRefusal || 'value did not persist after fillByLabelText'));
      }
      if (action.type === 'upload') {
        await locator.setInputFiles({
          name: action.file.name,
          mimeType: action.file.mimeType,
          buffer: Buffer.from(action.file.base64, 'base64')
        });
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'waitForSelector') await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
      if (action.type === 'press') {
        // A PRESS LANDS ON THE ELEMENT IT NAMES. It used to be page.keyboard.press(), which types
        // into whatever happens to hold focus, and normalizeManagedActions dropped the selector on
        // the floor so the runner could not have aimed it even if it wanted to. Two consequences,
        // both measured:
        //   - an OPTIONAL press whose target is not on the page fired anyway, because the optional
        //     pre-check is guarded on the locator, and the locator was always null for a press. A keystroke
        //     queued for a control that does not exist was still delivered to the form.
        //   - the caller queues { press Enter, selector '#country' } to commit the phone-country
        //     React Select. On the live Redwood Materials Greenhouse form that Enter reached the
        //     form itself and ran the employer's validator with the phone, the resume and all four
        //     screener questions still empty. Six "is required" messages rendered, none of them
        //     cleared when those fields were filled a moment later, and the preview screenshot the
        //     applicant is asked to approve showed a correctly filled form covered in red.
        if (!locator) {
          await page.keyboard.press(action.value);
        } else if (/^enter$/i.test(String(action.value || '')) && await choiceControlIsClosed(locator)) {
          // Enter on a choice control means "take the highlighted option". With the menu shut there
          // is no highlighted option, so the keystroke cannot do the job it was queued for, and the
          // only thing left for it to do is trigger the form's implicit submission. Withheld, and
          // said out loud.
          skipped.push((action.label || 'press')
            + ': Enter withheld, ' + action.selector + ' is a choice control with no menu open, so the keystroke could only have submitted the form');
        } else {
          await locator.press(action.value);
        }
      }
      if (action.type === 'select') {
        await locator.selectOption(action.value);
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'extract') {
        /* 'requireVisible' answers a different question from the plain read above, and the caller
         * has to say which one it wants because the two disagree on real employer pages.
         *
         * The plain read is locator.first().getAttribute(): it says what the FIRST matching node
         * carries, whether or not that node has a box, and says nothing about the nodes behind it.
         * That is the right shape for reading a value off a control the caller already located. It
         * is the wrong shape for asking whether a person is being shown something, which is what the
         * backend's captcha evidence reads are for, and it is why those reads called a 1380x0
         * hCaptcha container on three live Lever postings a rendered challenge.
         *
         * Under 'requireVisible' the read goes through captchaSnapshot, which owns this runner's one
         * definition of visible, and returns one entry per VISIBLE match in DOM order. Nothing
         * visible is reported the same way an unmatched optional action is: a line in 'skipped' and
         * no extracted entry, so "we looked and saw nothing on screen" and "we never looked" stay
         * distinguishable by the presence of the line rather than by the absence of a value.
         *
         * The locator is rebuilt WITHOUT .first(): the whole point is the nodes behind the first. */
        const assertExtractedValue = (value) => {
          if (action.requireNonEmpty && !String(value ?? '').trim()) {
            throw new Error((action.label || 'extract') + ': extracted value is empty');
          }
          if (action.expectedValueIncludes != null
            && !String(value ?? '').includes(action.expectedValueIncludes)) {
            throw new Error((action.label || 'extract') + ': extracted value does not include '
              + action.expectedValueIncludes);
          }
          if (action.expectedValueDigits != null
            && String(value ?? '').replace(/\D/g, '') !== action.expectedValueDigits) {
            throw new Error((action.label || 'extract') + ': extracted value does not match expected digits');
          }
        };
        const readExtractValues = async () => {
          if (action.requireVisible) {
            return await page.locator(action.selector).evaluateAll(captchaSnapshot, {
              mode: 'visibleValues',
              attribute: action.attribute || null
            });
          }
          const value = await locator.evaluate((element, attribute) => {
            if (attribute === 'value' && 'value' in element) return String(element.value ?? '');
            return attribute ? element.getAttribute(attribute) : (element.innerText || element.textContent || '');
          }, action.attribute || null);
          return [value];
        };
        const sampleCount = action.stabilityWindowMs ? 3 : 1;
        const sampleIntervalMs = sampleCount > 1
          ? Math.ceil(action.stabilityWindowMs / (sampleCount - 1))
          : 0;
        let values = [];
        for (let sample = 0; sample < sampleCount; sample += 1) {
          if (sample > 0) await page.waitForTimeout(sampleIntervalMs);
          if (action.requireUnique) {
            const currentCount = await page.locator(action.selector).count();
            if (currentCount !== 1) {
              throw new Error((action.label || action.type) + ': expected exactly one match for '
                + action.selector + ', found ' + String(currentCount));
            }
          }
          values = await readExtractValues();
          if (values.length === 0 && (action.requireNonEmpty || action.expectedValueIncludes
            || action.expectedValueDigits != null)) {
            throw new Error((action.label || 'extract') + ': extracted value is empty');
          }
          for (const value of values) assertExtractedValue(value);
        }
        if (values.length === 0) {
          skipped.push((action.label || 'extract') + ': nothing visible matched ' + action.selector);
        } else {
          for (const value of values) {
            extracted.push({
              selector: action.selector,
              label: action.label,
              value,
              ...(action.expectedValueDigits != null
                ? { expectedValueDigits: action.expectedValueDigits }
                : {})
            });
          }
        }
      }
     } catch (actionError) {
      // 'optional' previously meant only "skip if the element is missing", and it was checked via
      // 'locator', which is null for fillByLabelText. So a fillByLabelText could never be optional,
      // and any throw from ANY action aborted the whole run. A single unfillable checkbox on a
      // Greenhouse form therefore discarded the name, email, phone and resume already entered, and
      // returned the caller a raw Playwright stack trace instead of a filled form.
      // An optional action that fails is now recorded and stepped over; a required one still stops
      // the run, because the caller marked it as something the run cannot proceed without.
      if (!action.optional) throw actionError;
      skipped.push((action.label || action.type) + ': ' + String(actionError?.message || actionError).split('\n')[0].slice(0, 200));
     }
    }
    // The gate's findings lead, because "we did not send this" is the first thing the caller needs
    // to know and the reason has to travel with it.
    const blockers = [...submitGateBlockers];
    // The literal is a contract with the backend, which matches on it to decide whether an attention
    // state is a human-verification stall. See readUnresolvedCaptcha for what now has to be true
    // before it is said.
    if (await readUnresolvedCaptcha()) {
      blockers.push('CAPTCHA requires your attention');
    }
    /* THE SAME READING OF THE FORM THE PRE-SUBMIT GATE MAKES, made on every run.
     *
     * D-01. There used to be two separate answers in this file to the question "which required
     * fields are still empty": readSubmitReadiness above, built for the moment before the final
     * click, and a weaker pair of scans here whose output is what the CALLER stores and shows. The
     * weaker pair looked only at the 'required' ATTRIBUTE (plus aria-required on file upload groups),
     * and a PREPARE run queues no submit action at all, so the better reading never ran on the call
     * that decides whether a packet is offered to a person as ready to send.
     *
     * Measured on production packet 245c827a (Deepgram, Ashby, 2026-08-09): three required fields
     * empty on the filled form - Current Location, and both work-eligibility questions - and this
     * scan returned ZERO blockers, because Ashby marks none of the three with the attribute. The
     * caller read "no blockers" as "safe", wrote ready_for_final_approval, and put a green "Send it"
     * button in front of a person.
     *
     * One reading, used in both places, is the fix: whatever would withhold the click is also what
     * the run reports. The two can no longer disagree, and a required field this gate can see is now
     * visible at prepare time instead of only at the last moment.
     *
     * 'stale' and 'unmatched' are deliberately NOT folded in here. Both concern validation MESSAGES
     * rather than empty controls, they are the half of the gate with the false-positive history, and
     * a stale message over a filled field must never turn a complete application into a blocked one.
     */
    const readiness = requiredFieldConfirmation?.version === 2
      ? { blocking: [], stale: [], unmatched: [] }
      : await readSubmitReadiness();
    blockers.push(...readiness.blocking);
    // Read on EVERY run, at zero action cost, because the caller has no other way to find out. A
    // fill run that has somehow submitted looks exactly like a fill run that has not, right up
    // until the applicant is asked to approve sending an application that is already half sent.
    const humanVerification = await readSecurityCodeChallenge();
    /* THE OUTCOME OF THE CLICK, read from the page rather than inferred by the caller from a body
     * scrape. Zero actions: it is a page.evaluate inside the run, exactly like the two reads above.
     *
     * Only on a run that actually pressed the button. On a fill run there is nothing to confirm, and
     * a confirmation-shaped sentence already on an unsubmitted page (an employer's "Thank you for
     * your interest") must not be able to manufacture one. */
    const submitOutcome = finalSubmitPressed
      ? { pressed: true, ...(await readSubmitOutcome()), ...(submitNetwork ? { network: submitNetwork } : {}) }
      : { pressed: false, state: 'not_attempted', source: null, evidence: null, message: null, formStillPresent: null };
    // How many submissions the guard stopped. Zero on a run that was allowed to submit, because the
    // guard is not installed there. Non-zero on a fill run is a DEFECT REPORT: something in the
    // action list tried to send a real application without authorization, and this is the only
    // place that can ever say so.
    const blockedSubmits = input.allowSubmit === true
      ? 0
      : await page.evaluate(() => window.__litosBlockedSubmits || 0).catch(() => 0);
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({ text: (link.innerText || link.textContent || '').trim().slice(0, 500), href: link.href })));
    if (currentInput.screenshot) await page.screenshot({ path: 'stratus-screenshot-' + phase + '.png', fullPage: Boolean(currentInput.fullPage) });
    // 'skipped' is reported, never swallowed: an optional action that failed is something the
    // caller should be able to see and act on, and a silent skip is how a half-filled form starts
    // looking like a fully-filled one.
    /* A CONTINUATION IS OFFERED ONLY WHEN THERE IS SOMETHING TO CONTINUE.
     *
     * This used to be 'input.requestContinuation' alone, and the caller cannot know in advance
     * whether a form will ask for an emailed code, so it asks for a continuation on EVERY managed
     * submit. The consequence was that a form with no challenge - which is nearly all of them, and
     * every Ashby form Litos has ever driven - finished phase 0 and then sat here idling for the
     * full continuation TTL waiting for a second phase that was never coming, while the caller sat
     * on the other side waiting too. Nothing about that run involved a security code; it was still
     * reported as "Managed browser continuation timed out".
     *
     * The runner is the only party that can answer this, because the answer is a property of the
     * page in front of it. 'continuationOffered' travels in the result so the caller does not have
     * to re-derive it from scraped text, which is what continuationEligible was reduced to doing.
     */
    const pressedUnknown = phase === 0
      && submitOutcome.pressed === true
      && submitOutcome.state === 'unknown';
    const receiptObservationOnly = pressedUnknown
      && !humanVerification
      && input.continuationCheckpoint !== true;
    const continuationOffered = input.requestContinuation === true
      && (Boolean(humanVerification) || input.continuationCheckpoint === true || pressedUnknown);
    /* WHAT THIS RESULT'S SHAPE ACTUALLY MEANS, said out loud rather than inferred from its contents.
     *
     * 'extract-require-visible-v1' is the one the caller cannot work out for itself. A runner that
     * has never heard of requireVisible drops the unknown field in normalizeManagedActions and
     * returns the ordinary first-match read under the same label, so the RESULT of an honoured
     * requireVisible and the result of an ignored one are the same shape carrying different
     * meanings. Advertising it is what lets a caller tell "this evidence was filtered by a real
     * layout read, one entry per visible node" from "this runner is older than that", which matters
     * because the two answers differ on live pages and the caller deploys on its own schedule. */
    const usesExtractAssertions = currentInput.actions.some((action) => action.requireUnique === true
      || (action.type === 'extract' && (action.requireNonEmpty === true
        || action.expectedValueIncludes != null
        || action.expectedValueDigits != null
        || action.stabilityWindowMs != null)));
    const runnerCapabilities = [
      ...(currentInput.actions.some((action) => action.type === 'discover') ? ['discovery-control-role-v1'] : []),
      ...(currentInput.actions.some((action) => action.type === 'extract' && action.requireVisible === true)
        ? ['extract-require-visible-v1']
        : []),
      ...(currentInput.actions.some((action) => action.type === 'requireCapability'
        && action.value === extractAssertionsCapability)
        || usesExtractAssertions
        ? [extractAssertionsCapability]
        : [])
    ];
    /* THE WINDOW OPENS HERE, on the page that raised the challenge, not back when the sandbox was
     * forked.
     *
     * The old deadline was fixed before phase 0 ran, so the fill paid for it: a 120 second window
     * against a 75 second Greenhouse fill left 45 seconds to read a mailbox and come back, and the
     * 30 second floor underneath it was covering for a budget that had already been spent. Rebasing
     * it is what makes a bounded wait for an emailed code a real option rather than a race, and it
     * is the difference between the challenged page receiving the code and a SECOND submit having
     * to be sent to make a code field exist at all.
     *
     * WHAT IS NOT RELAXED. The window is still the caller's own clamped TTL and nothing longer, the
     * marker is still one-shot, still bound to the token and project hashes, and the claim script
     * still refuses a marker whose own expiresAt has passed. The marker is rewritten by RENAME so a
     * claim can never read a half-written one, and it is rewritten BEFORE the ready file exists, so
     * for the whole time a claim is possible the deadline it is checked against is this one. */
    const continuationExpiresAt = continuationOffered
      ? new Date(Date.now() + (receiptObservationOnly
        ? 15
        : Math.max(Number(input.continuationTtlSeconds) || 0, 15)) * 1000).toISOString()
      : null;
    if (continuationOffered) {
      try {
        const marker = JSON.parse(fs.readFileSync('stratus-continuation.json', 'utf8'));
        fs.writeFileSync('stratus-continuation-next.json', JSON.stringify({ ...marker, expiresAt: continuationExpiresAt }));
        fs.renameSync('stratus-continuation-next.json', 'stratus-continuation.json');
      } catch {
        /* No marker means no continuation was ever authorized, and the idle below simply ends. The
         * run's own result is written either way: a page we cannot offer to continue is still a
         * page we have to report. */
      }
      fs.writeFileSync('stratus-continuation-ready.json', JSON.stringify({ expiresAt: continuationExpiresAt, host: input.allowedHost }));
    }
    fs.writeFileSync('stratus-result-' + phase + '.json', JSON.stringify({ title, url, text, links, extracted, discovered, ...(runnerCapabilities.length > 0 ? { capabilities: runnerCapabilities } : {}), filledFields: [...new Set(filledFields)], blockers: [...new Set(blockers)], skipped: [...new Set(skipped)], ...(actionDiagnostics.length > 0 ? { actionDiagnostics } : {}), humanVerification, securityCodeAttempt, submitOutcome, requiredFieldConfirmation, blockedSubmits, continuationOffered, ...(continuationExpiresAt ? { continuationExpiresAt } : {}), elapsedMs: Date.now() - startedAt }));
    if (phase > 0 || !continuationOffered) break;
    const expiresAt = Date.parse(continuationExpiresAt);
    while (!fs.existsSync('stratus-continuation-input.json') && Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!fs.existsSync('stratus-continuation-input.json')) break;
    currentInput = JSON.parse(fs.readFileSync('stratus-continuation-input.json', 'utf8'));
    fs.unlinkSync('stratus-continuation-input.json');
    phase += 1;
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  const detail = String(error?.stack || error?.message || error);
  /* WRITTEN TO A FILE, not only to stderr, because on a continuation run this process is DETACHED
   * and nobody is holding its stderr. Before this, a runner that died on its first action and a
   * runner still patiently filling a slow form looked identical from outside - an absent result
   * file - so both were reported after the full timeout as "the run timed out", and a crash whose
   * message was sitting right there went unread. The caller watches for this file alongside the
   * result and reports whichever arrives. */
  try {
    fs.writeFileSync('stratus-error.json', JSON.stringify({ message: detail.split('\n')[0].slice(0, 500), detail: detail.slice(0, 4000) }));
  } catch { /* the result of the run matters more than the record of why there is none */ }
  console.error(detail);
  process.exit(1);
});
`;

function inputError(message, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { status: 400, code });
}

function validateSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) {
    throw inputError('Each selector must be a non-empty string no longer than 500 characters', 'INVALID_SELECTOR');
  }
  return selector.trim();
}

export function normalizeManagedActions(actions = []) {
  if (!Array.isArray(actions)) throw inputError('actions must be an array');
  if (actions.length > MAX_ACTIONS) throw inputError(`A run may contain at most ${MAX_ACTIONS} actions`, 'TOO_MANY_ACTIONS');
  if (actions.filter((action) => action?.type === 'confirmAndSubmit').length > 1) {
    throw inputError('A remote run may contain at most one atomic submit action', 'MULTIPLE_ATOMIC_SUBMITS');
  }
  return actions.map((action, index) => {
    if (!action || typeof action !== 'object' || !ALLOWED_ACTIONS.has(action.type)) {
      throw inputError(`Action ${index + 1} has an unsupported type`, 'INVALID_ACTION');
    }
    const normalized = { type: action.type };
    if (!['press', 'fillByLabelText', 'discover', 'requireCapability'].includes(action.type)) normalized.selector = validateSelector(action.selector);
    // A press keeps the selector it was given. It stays OPTIONAL - a caller may legitimately mean
    // "send this key wherever focus already is" and omit it - but when one is supplied, dropping it
    // here is what turned an aimed keystroke into a page-wide one, and made the optional pre-check
    // (which is guarded on the locator) unreachable for every press ever queued.
    else if (action.type === 'press' && action.selector != null) normalized.selector = validateSelector(action.selector);
    if (action.optional != null) normalized.optional = Boolean(action.optional);
    if (action.type === 'requireCapability') {
      if (action.value !== EXTRACT_ASSERTIONS_CAPABILITY) {
        throw inputError('The required runner capability is unsupported', 'UNSUPPORTED_RUNNER_CAPABILITY');
      }
      normalized.value = action.value;
    }
    if (action.requireUnique != null) {
      if (typeof action.requireUnique !== 'boolean'
        || !['click', 'fill', 'upload', 'select', 'extract', 'press'].includes(action.type)
        || !normalized.selector) {
        throw inputError('requireUnique needs a selector-backed action and a boolean value', 'INVALID_ACTION_ASSERTION');
      }
      normalized.requireUnique = action.requireUnique;
    }
    if (action.label != null) {
      if (typeof action.label !== 'string' || action.label.length > 200) throw inputError('Action labels must be strings no longer than 200 characters', 'INVALID_ACTION_LABEL');
      normalized.label = action.label;
    }
    if (['fill', 'press', 'select'].includes(action.type)) {
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) {
        throw inputError(`Action ${index + 1} requires a string value no longer than ${MAX_VALUE_LENGTH} characters`, 'INVALID_ACTION_VALUE');
      }
      normalized.value = action.value;
    }
    if (action.type === 'fillByLabelText') {
      if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 500) throw inputError('Question text must be a non-empty string no longer than 500 characters', 'INVALID_ACTION_TEXT');
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) throw inputError('Question answers must be strings no longer than 10000 characters', 'INVALID_ACTION_VALUE');
      normalized.text = action.text.trim();
      normalized.value = action.value;
    }
    if (action.type === 'upload') {
      const file = action.file;
      if (!file || typeof file !== 'object') throw inputError('Upload actions require a file', 'INVALID_UPLOAD');
      if (
        typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 ||
        /[\/\\\0-\x1f\x7f]/.test(file.name) || file.name.trim() === '.' || file.name.trim() === '..'
      ) throw inputError('Upload file names must be safe non-empty basenames no longer than 255 characters', 'INVALID_UPLOAD');
      if (typeof file.mimeType !== 'string' || !file.mimeType.trim() || file.mimeType.length > 200) throw inputError('Upload MIME types must be non-empty strings no longer than 200 characters', 'INVALID_UPLOAD');
      if (
        typeof file.base64 !== 'string' || !file.base64 || file.base64.length > MAX_FILE_BASE64_LENGTH ||
        file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
      ) throw inputError('Upload file data must be valid non-empty base64 no longer than 6000000 characters', 'INVALID_UPLOAD');
      normalized.file = { name: file.name.trim(), mimeType: file.mimeType.trim(), base64: file.base64 };
    }
    if (action.type === 'waitForSelector') normalized.timeout = Math.min(Math.max(Number(action.timeout) || 10_000, 100), 20_000);
    // The emailed code that finishes a Greenhouse submit, carried on the submit click itself. Kept
    // to the shape of a code and nothing else: it is typed into a live employer's form, so a value
    // that is not plausibly a code is a caller bug and must not reach the page. Greenhouse issues 8
    // alphanumeric characters; the bound is wider than that and still narrow enough that no
    // sentence, selector or script fragment can pass through it.
    if (action.securityCode != null) {
      if (action.type !== 'confirmAndSubmit') throw inputError('Only an atomic submit may carry a security code', 'INVALID_SECURITY_CODE');
      if (typeof action.securityCode !== 'string' || !/^[A-Za-z0-9]{4,12}$/.test(action.securityCode)) {
        throw inputError('A security code must be 4 to 12 letters or digits', 'INVALID_SECURITY_CODE');
      }
      normalized.securityCode = action.securityCode;
    }
    // A FIELD rather than a new action type, and the choice is a rollout constraint rather than a
    // preference. An unknown action TYPE is rejected outright by the check at the top of this
    // function, so a caller that shipped one before this runner did would have every run 400 and
    // every submission stop. An unknown FIELD is dropped here and the run proceeds on the older
    // reading, which is the pre-existing behaviour rather than an outage. The result advertises
    // 'extract-require-visible-v1' so the caller can tell the two apart instead of guessing.
    if (action.type === 'extract' && action.requireVisible != null) {
      normalized.requireVisible = Boolean(action.requireVisible);
    }
    if (action.requireNonEmpty != null) {
      if (action.type !== 'extract' || typeof action.requireNonEmpty !== 'boolean') {
        throw inputError('requireNonEmpty is only valid as a boolean on extract actions', 'INVALID_ACTION_ASSERTION');
      }
      normalized.requireNonEmpty = action.requireNonEmpty;
    }
    if (action.expectedValueIncludes != null) {
      if (action.type !== 'extract' || typeof action.expectedValueIncludes !== 'string'
        || !action.expectedValueIncludes || action.expectedValueIncludes.length > 500) {
        throw inputError('expectedValueIncludes needs non-empty extract text no longer than 500 characters', 'INVALID_ACTION_ASSERTION');
      }
      normalized.expectedValueIncludes = action.expectedValueIncludes;
    }
    if (action.expectedValueDigits != null) {
      if (action.type !== 'extract' || typeof action.expectedValueDigits !== 'string'
        || !/^\d{1,100}$/.test(action.expectedValueDigits)) {
        throw inputError('expectedValueDigits needs 1 to 100 digits on an extract action', 'INVALID_ACTION_ASSERTION');
      }
      normalized.expectedValueDigits = action.expectedValueDigits;
    }
    if (action.stabilityWindowMs != null) {
      if (action.type !== 'extract' || !Number.isInteger(action.stabilityWindowMs)
        || action.stabilityWindowMs < 300 || action.stabilityWindowMs > 2_000
        || (action.requireNonEmpty !== true && action.expectedValueIncludes == null
          && action.expectedValueDigits == null)) {
        throw inputError('stabilityWindowMs needs an asserted extract and must be 300 to 2000 milliseconds', 'INVALID_ACTION_ASSERTION');
      }
      normalized.stabilityWindowMs = action.stabilityWindowMs;
    }
    if (action.type === 'extract' && action.attribute != null) {
      if (typeof action.attribute !== 'string' || action.attribute.length > 100) {
        throw inputError('Extract attributes must be strings no longer than 100 characters', 'INVALID_ATTRIBUTE');
      }
      normalized.attribute = action.attribute;
    }
    if (action.type === 'confirmAndSubmit') {
      const maxRetries = Number(action.maxRetries);
      if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
        throw inputError('confirmAndSubmit maxRetries must be 0 or 1', 'INVALID_CONFIRM_AND_SUBMIT_RETRIES');
      }
      if (action.contractVersion !== 2) throw inputError('confirmAndSubmit contractVersion must be 2', 'INVALID_CONFIRM_AND_SUBMIT_VERSION');
      if (!['application', 'verification'].includes(action.submitKind)) throw inputError('confirmAndSubmit submitKind is invalid', 'INVALID_SUBMIT_KIND');
      if (action.securityCode && action.submitKind !== 'verification') throw inputError('A security code requires a verification atomic submit', 'INVALID_SUBMIT_KIND');
      if (action.selector !== ATOMIC_SUBMIT_SELECTOR) throw inputError('confirmAndSubmit selector must be the version 2 submit candidate set', 'INVALID_CONFIRM_AND_SUBMIT_SELECTOR');
      if (
        !action.chooserPolicy || typeof action.chooserPolicy !== 'object'
        || Object.keys(action.chooserPolicy).sort().join(',') !== 'exclusionPattern,finalPattern,grammarHash,name,version'
        || action.chooserPolicy.name !== ATOMIC_SUBMIT_POLICY.name
        || action.chooserPolicy.version !== ATOMIC_SUBMIT_POLICY.version
        || action.chooserPolicy.finalPattern !== ATOMIC_SUBMIT_POLICY.finalPattern
        || action.chooserPolicy.exclusionPattern !== ATOMIC_SUBMIT_POLICY.exclusionPattern
        || action.chooserPolicy.grammarHash !== ATOMIC_SUBMIT_POLICY.grammarHash
      ) throw inputError('confirmAndSubmit chooser policy is invalid', 'INVALID_CONFIRM_AND_SUBMIT_POLICY');
      if (typeof action.label !== 'string' || !action.label.trim()) throw inputError('confirmAndSubmit requires a non-empty label', 'INVALID_CONFIRM_AND_SUBMIT_LABEL');
      if (action.optional !== false) throw inputError('confirmAndSubmit must be non-optional', 'INVALID_CONFIRM_AND_SUBMIT_OPTIONAL');
      normalized.maxRetries = maxRetries;
      normalized.contractVersion = 2;
      normalized.submitKind = action.submitKind;
      normalized.chooserPolicy = { ...ATOMIC_SUBMIT_POLICY };
      if (action.timeout != null) normalized.timeout = Math.min(Math.max(Number(action.timeout) || 10_000, 100), 20_000);
    }
    return normalized;
  });
}

export async function normalizeManagedRun(input = {}, { urlValidator = assertPublicUrl } = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  if (input.continuationToken != null) throw inputError('A continuation request must not include a URL run payload', 'INVALID_CONTINUATION');
  const url = await urlValidator(input.url);
  const viewport = input.viewport || {};
  const width = Math.min(Math.max(Number(viewport.width) || 1440, 320), 1920);
  const height = Math.min(Math.max(Number(viewport.height) || 900, 240), 1080);
  const requestContinuation = Boolean(input.requestContinuation);
  const continuationTtlSeconds = Math.min(
    Math.max(Number(input.continuationTtlSeconds) || MANAGED_CONTINUATION_CONTRACT.defaultTtlSeconds, MANAGED_CONTINUATION_CONTRACT.minTtlSeconds),
    MANAGED_CONTINUATION_CONTRACT.maxTtlSeconds
  );
  return {
    url: url.toString(),
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    // DEFAULT DENY, and the default is the entire safety property. Every existing caller becomes a
    // run that cannot submit, which is what they all already believed they were, and only a caller
    // that says the word gets the ability to send a real application to a real employer. Written as
    // `=== true` rather than Boolean() so a truthy accident ('no', 0 vs '0', an object) cannot open
    // it: the one value that opens the gate is the literal true.
    allowSubmit: input.allowSubmit === true,
    fullPage: Boolean(input.fullPage),
    waitUntil: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(input.waitUntil) ? input.waitUntil : 'networkidle2',
    viewport: { width, height },
    requestContinuation,
    continuationCheckpoint: Boolean(input.continuationCheckpoint),
    continuationTtlSeconds,
    allowedHost: url.hostname.toLowerCase()
  };
}

export function normalizeManagedContinuation(input = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  if (typeof input.continuationToken !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(input.continuationToken)) {
    throw inputError('A valid continuationToken is required', 'INVALID_CONTINUATION');
  }
  if (input.url != null) throw inputError('A continuation must not include url', 'CONTINUATION_URL_FORBIDDEN');
  if (input.requestContinuation || input.continuationCheckpoint || input.continuationTtlSeconds != null) {
    throw inputError('A continuation cannot request another continuation', 'CONTINUATION_LIMIT_REACHED');
  }
  return {
    continuationToken: input.continuationToken,
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    fullPage: Boolean(input.fullPage)
  };
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function continuationSandboxName(projectBinding, token) {
  return `stratus-c-${digest(`${projectBinding}:${token}`).slice(0, 40)}`;
}

/* THE RUNNER DECIDES, and this is now only the fallback for a runner that predates it.
 *
 * `continuationOffered` is written by the run itself, which is the only party that has ever seen
 * the page. The text sweep below is kept for one reason: a caller may be pointed at an older
 * runtime image mid-deploy, and silently never offering a continuation there would break the
 * emailed-code path rather than degrade it. Note what the sweep matches - "check your email",
 * "confirmation code" - and where that text lives: an employer's own post-submit confirmation
 * ("we've sent a confirmation to your email") reads as a security-code challenge to it. That
 * false positive is exactly why the runner's own answer wins.
 */
function continuationEligible(result, checkpoint) {
  if (typeof result?.continuationOffered === 'boolean') return result.continuationOffered;
  if (checkpoint) return true;
  if (result?.humanVerification?.kind === 'security_code') return true;
  const haystack = `${result?.title || ''}\n${result?.url || ''}\n${result?.text || ''}`;
  return /(?:verification|security|confirmation)\s+code|enter\s+(?:the\s+)?code|check\s+your\s+email/i.test(haystack);
}

/* THE RUN'S OWN BUDGET, and it must not shrink because a continuation was requested.
 *
 * A managed run with no continuation is `sandbox.runCommand` against a fork whose timeout is
 * 90_000, so 90 seconds is what a submit has always been allowed. Requesting a continuation
 * switched it to a detached run polled for 60_000, which quietly took a third of the budget away
 * from every managed submit - and the caller asks for a continuation on every one of them, because
 * it cannot know in advance whether a form will demand an emailed code.
 *
 * Production packet 13bccb2d (Skydio, Ashby, 2026-08-09): approved at 12:24:42.430, failure written
 * at 12:25:49.894. 67.4 seconds end to end, of which one 60-second wait, on a form with no
 * challenge and nothing to continue.
 */
/* 150 seconds, raised from 90 on a measurement: the live Mercari workable run (Class of 2028,
 * 2026-08-20) died three times with 'Sandbox stream was closed and is not accepting commands' -
 * the sandbox's own LIFETIME is set from this value, and a long form's fill + submit + the
 * 30-second post-submit receipt watch overran 90s, so the box was evicted mid-run and the report
 * said "temporary secure-browser error". Worse, a box evicted DURING the receipt watch is exactly
 * a press with no confirmation read - the workable unverified-submission class. Not higher: the
 * CALLER chains up to three runs (discovery, option probe, fill) inside its own 300-second
 * function budget, so one run's ceiling has to leave room for the others. */
const MANAGED_RUN_TIMEOUT_MS = 150_000;
const CONTINUATION_TIMEOUT_MS = 60_000;

/**
 * Wait for whichever of `paths` appears first, and return its name.
 *
 * Plural because the runner has two things it can say - a result or, since it started running
 * detached, a crash - and watching only for the good one turns every crash into a timeout report
 * after the full budget. `failure` carries the message and code for the timeout, because "the run
 * took too long" and "the continuation expired" are different facts and were being reported with
 * the same sentence.
 */
async function waitForSandboxFile(sandbox, paths, timeoutMs, failure) {
  const wanted = Array.isArray(paths) ? paths : [paths];
  const script = "const fs=require('node:fs');const end=Date.now()+Number(process.argv[1]);const ps=process.argv.slice(2);(async()=>{for(;;){const hit=ps.find((p)=>fs.existsSync(p));if(hit){process.stdout.write(hit);process.exit(0)}if(Date.now()>=end)process.exit(3);await new Promise(r=>setTimeout(r,100))}})()";
  const result = await sandbox.runCommand('node', ['-e', script, String(timeoutMs), ...wanted], { timeoutMs: timeoutMs + 5_000 });
  if (result.exitCode !== 0) throw Object.assign(new Error(failure.message), { status: failure.status, code: failure.code });
  const found = typeof result.stdout === 'function' ? String(await result.stdout()).trim() : String(result.stdout || '').trim();
  return wanted.includes(found) ? found : wanted[0];
}

/** Turn a crash the detached runner recorded into the error it would have thrown in-line. */
async function throwSandboxRunnerError(sandbox) {
  const buffer = await sandbox.readFileToBuffer({ path: 'stratus-error.json' }).catch(() => null);
  let message = 'Sandbox browser run failed';
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (parsed?.message) message = String(parsed.message).slice(0, 500);
  } catch { /* a crash we cannot read is still a crash, and the generic message says so */ }
  throw Object.assign(new Error(message), { status: 502, code: 'SANDBOX_RUN_FAILED' });
}

export const CLAIM_CONTINUATION_SCRIPT = "const fs=require('node:fs');const crypto=require('node:crypto');const [tokenHash,projectHash]=process.argv.slice(1);try{const marker=JSON.parse(fs.readFileSync('stratus-continuation.json','utf8'));if(!fs.existsSync('stratus-continuation-ready.json'))process.exit(4);if(marker.tokenHash!==tokenHash||marker.projectHash!==projectHash)process.exit(5);if(marker.used||Date.now()>Date.parse(marker.expiresAt))process.exit(6);fs.renameSync('stratus-continuation.json','stratus-continuation-used.json');process.exit(0)}catch{process.exit(7)}";

async function ensureSandboxTemplate() {
  const template = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: 'node24',
    timeout: 45 * 60 * 1000,
    resources: { vcpus: 2 },
    persistent: true,
    snapshotExpiration: 0,
    keepLastSnapshots: { count: 1, expiration: 0 },
    onCreate: async (sandbox) => {
      const dependencies = await sandbox.runCommand({ cmd: 'dnf', args: ['install', '-y', ...SANDBOX_DEPENDENCIES], sudo: true });
      if (dependencies.exitCode !== 0) throw new Error(`Sandbox browser dependency installation failed: ${await dependencies.stderr()}`);
      const npmInit = await sandbox.runCommand('npm', ['init', '-y']);
      if (npmInit.exitCode !== 0) throw new Error(`Sandbox npm initialization failed: ${await npmInit.stderr()}`);
      const playwright = await sandbox.runCommand('npm', ['install', 'playwright@1.54.1']);
      if (playwright.exitCode !== 0) throw new Error(`Sandbox Playwright installation failed: ${await playwright.stderr()}`);
      const chromium = await sandbox.runCommand('npx', ['playwright', 'install', 'chromium']);
      if (chromium.exitCode !== 0) throw new Error(`Sandbox Chromium installation failed: ${await chromium.stderr()}`);
    }
  });
  if (!template.currentSnapshotId) await template.snapshot({ expiration: 0 });
  return template;
}

export async function executeSandboxRun(input, { urlValidator = assertPublicUrl, sandboxApi = Sandbox, projectBinding = 'stratus-managed' } = {}) {
  if (input?.continuationToken != null) {
    const continuation = normalizeManagedContinuation(input);
    const sandboxName = continuationSandboxName(projectBinding, continuation.continuationToken);
    let sandbox;
    try {
      sandbox = await sandboxApi.get({ name: sandboxName, resume: true });
      const claim = await sandbox.runCommand('node', [
        '-e', CLAIM_CONTINUATION_SCRIPT, digest(continuation.continuationToken), digest(projectBinding)
      ]);
      if (claim.exitCode !== 0) {
        throw Object.assign(new Error('Continuation is expired, already used, or does not belong to this project'), { status: 409, code: 'CONTINUATION_REJECTED' });
      }
      await sandbox.writeFiles([{ path: 'stratus-continuation-input.json', content: Buffer.from(JSON.stringify(continuation)) }]);
      const produced = await waitForSandboxFile(sandbox, ['stratus-result-1.json', 'stratus-error.json'], CONTINUATION_TIMEOUT_MS, {
        message: 'Managed browser continuation timed out', status: 410, code: 'CONTINUATION_EXPIRED'
      });
      if (produced === 'stratus-error.json') await throwSandboxRunnerError(sandbox);
      const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result-1.json' });
      if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a continuation result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
      const result = JSON.parse(resultBuffer.toString('utf8'));
      if (continuation.screenshot) {
        const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot-1.png' });
        result.screenshot = screenshot?.toString('base64') || null;
      }
      return result;
    } catch (error) {
      if (error?.code) throw error;
      throw Object.assign(new Error('Continuation is expired, already used, or does not belong to this project'), { status: 409, code: 'CONTINUATION_REJECTED' });
    } finally {
      if (sandbox) await sandbox.stop().catch(() => {});
    }
  }

  const context = await normalizeManagedRun(input, { urlValidator });
  let sandbox;
  let keepAlive = false;
  try {
    const template = sandboxApi === Sandbox
      ? await ensureSandboxTemplate()
      : await sandboxApi.get({ name: SANDBOX_NAME, resume: false });
    const continuationToken = context.requestContinuation ? crypto.randomBytes(32).toString('base64url') : null;
    /* THE MARKER'S OPENING DEADLINE, and it is a floor rather than the answer.
     *
     * The run rebases it to the moment the challenge appears and rewrites the marker before any
     * claim can be made, so this value is only ever in force while phase 0 is still running - a
     * window in which no ready file exists and no claim can succeed anyway. It is written because a
     * marker with no expiry at all would be a marker the claim script could not refuse. */
    const continuationExpiresAt = context.requestContinuation
      ? new Date(Date.now() + context.continuationTtlSeconds * 1000).toISOString()
      : null;
    if (continuationExpiresAt) context.continuationExpiresAt = continuationExpiresAt;
    sandbox = await sandboxApi.fork({
      sourceSandbox: template.name,
      ...(continuationToken ? { name: continuationSandboxName(projectBinding, continuationToken) } : {}),
      /* The sandbox has to outlive whatever the caller is allowed to wait for, or the wait times
         out against a box that is already gone and the run is reported as slow rather than as
         evicted. Three things can be waited on now, in sequence, and the box has to cover all
         three: phase 0, then the idle window that only STARTS when phase 0 raises a challenge, then
         one continuation. The old sum omitted the middle term because the window used to overlap
         phase 0 rather than follow it, so a rebased window would have outlived its own sandbox. */
      timeout: context.requestContinuation
        ? MANAGED_RUN_TIMEOUT_MS + context.continuationTtlSeconds * 1000 + CONTINUATION_TIMEOUT_MS + 30_000
        : MANAGED_RUN_TIMEOUT_MS,
      resources: { vcpus: 2 },
      persistent: false,
      networkPolicy: 'allow-all'
    });
    const files = [
      { path: 'stratus-runner.cjs', content: Buffer.from(SANDBOX_RUNNER) },
      { path: 'stratus-input.json', content: Buffer.from(JSON.stringify(context)) }
    ];
    if (continuationToken) files.push({
      path: 'stratus-continuation.json',
      content: Buffer.from(JSON.stringify({
        tokenHash: digest(continuationToken),
        projectHash: digest(projectBinding),
        host: context.allowedHost,
        expiresAt: continuationExpiresAt,
        used: false
      }))
    });
    await sandbox.writeFiles(files);
    if (context.requestContinuation) {
      await sandbox.runCommand({ cmd: 'node', args: ['stratus-runner.cjs'], detached: true });
      /* THE SAME BUDGET THE RUN WOULD HAVE HAD WITHOUT A CONTINUATION, and a timeout here is named
       * for what it is. `Managed browser continuation timed out` on a form with no challenge, no
       * continuation and no phase 1 was a sentence about a feature that had not been used, and it
       * is what the Skydio packet reported to its applicant. */
      const produced = await waitForSandboxFile(sandbox, ['stratus-result-0.json', 'stratus-error.json'], MANAGED_RUN_TIMEOUT_MS, {
        message: 'Managed browser run timed out before it produced a result', status: 504, code: 'RUN_TIMED_OUT'
      });
      if (produced === 'stratus-error.json') await throwSandboxRunnerError(sandbox);
    } else {
      const command = await sandbox.runCommand('node', ['stratus-runner.cjs']);
      if (command.exitCode !== 0) {
        throw Object.assign(new Error((await command.stderr()).trim() || 'Sandbox browser run failed'), { status: 502, code: 'SANDBOX_RUN_FAILED' });
      }
    }
    const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result-0.json' });
    if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
    const result = JSON.parse(resultBuffer.toString('utf8'));
    if (context.screenshot) {
      const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot-0.png' });
      result.screenshot = screenshot?.toString('base64') || null;
    }
    if (continuationToken && continuationEligible(result, context.continuationCheckpoint)) {
      keepAlive = true;
      result.continuationToken = continuationToken;
      /* THE RUN'S OWN DEADLINE WINS, for the same reason continuationOffered does: the run is the
       * only party that knows when the challenge appeared, and the window is a window on the
       * challenge. Reporting the fork-time value here would hand the caller a deadline that has
       * usually already passed by the time it reads it, and every caller of this API checks the
       * deadline before spending a continuation. The fallback covers a runtime image that predates
       * the rebase, which reports no deadline of its own and is still on the old clock. */
      result.continuationExpiresAt = typeof result.continuationExpiresAt === 'string'
        ? result.continuationExpiresAt
        : continuationExpiresAt;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error(`Vercel Sandbox browser request failed: ${error.message}`), { status: 502, code: 'SANDBOX_UNAVAILABLE' });
  } finally {
    if (sandbox && !keepAlive) await sandbox.stop().catch(() => {});
  }
}

export async function executeManagedRun(input, { urlValidator = assertPublicUrl, sandboxExecutor = executeSandboxRun, projectBinding = 'stratus-managed' } = {}) {
  return sandboxExecutor(input, { urlValidator, projectBinding });
}
