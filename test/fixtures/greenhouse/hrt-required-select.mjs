/* THE LIVE HUDSON RIVER TRADING APPLICATION FORM, TRANSCRIBED.
 *
 * Structure, class names and attribute set are taken from that form's own server-rendered HTML
 * (job-boards.greenhouse.io/embed/job_app?for=wehrtyou, read 2026-09-03). The header of
 * ../greenhouse-required-backing-commit-dom.test.js states what was measured on it and why the
 * widget below behaves the way it does. Kept in its own module so a test and a bare probe can
 * serve the identical page.
 */
const GPA_LABEL = 'What is your overall college/university GPA?';
const SCALE_LABEL = 'Please select the corresponding GPA scale:';
const VETERAN_LABEL = 'Are you a veteran?';
const DISABILITY_LABEL = 'Do you have a disability?';
const RACE_LABEL = 'What is your race/ethnicity?';
const GENDER_LABEL = 'What is your gender?';
// Genuinely optional on the live form, and it carries no RequiredInput there either.
const DEADLINE_LABEL = 'Do you have any upcoming offer deadlines?';

const GPA_OPTIONS = ['3.26 - 3.50', '3.51 - 3.75', '3.76 - 4.0'];
const SCALE_OPTIONS = ['0.0 - 4.0', '0.0 - 5.0', 'UK Grading Scale'];
const YES_NO = ['Yes', 'No', 'I prefer not to answer'];
const RACE_OPTIONS = ['South Asian', 'East Asian', 'White', 'Black or African American'];
const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary'];
const DEADLINE_OPTIONS = ['Less than 2 weeks', '2 to 4 weeks', 'More than 4 weeks'];
/* The R-004 shape, on a required multi: a control that answers any event by adding a second value.
 * An employer receiving two race declarations, one she never gave, is the cost of getting this
 * wrong, so it is pinned on a control of exactly that kind. */
const LANGUAGE_LABEL = 'What is your preferred coding language?';
const LANGUAGE_OPTIONS = ['Python', 'Java', 'C++', 'Rust'];

/* Transcribed from the live HRT form, one question. 'multi' reproduces the
 * 'select__value-container--is-multi' the demographic gender and race controls carry.
 * 'losesCommit' marks a control whose option-row click does not select, which leaves the widget in
 * the measured 'typed, not selected' state described on the commit function below. 'staleBacking'
 * marks one that DOES select and whose form never looks at the field again, which is the state any
 * repair would be aimed at; see syncRequiredInput. */
const question = ({ id, label, options, multi = false, losesCommit = false, staleBacking = false, mutatesOnInput = false, required = true }) => `
  <div class="field-wrapper"><div class="select"><div class="select__container select__container--outside-label">
    <label id="${id}-label" for="${id}" class="label select__label select__label--outside-label">${label}${required ? '<span aria-hidden="true">*</span>' : ''}</label>
    <div class="select-shell remix-css-b62m3t-container" data-question="${id}" data-options="${options.join('|')}"${multi ? ' data-multi="1"' : ''}${losesCommit ? ' data-loses-commit="1"' : ''}${staleBacking ? ' data-stale-backing="1"' : ''}${mutatesOnInput ? ' data-mutates-on-input="1"' : ''}${required ? ' data-required="1"' : ''}>
      <span id="react-select-${id}-live-region" class="remix-css-7pg0cj-a11yText"></span>
      <span aria-live="polite" aria-atomic="false" aria-relevant="additions text" role="log" class="remix-css-7pg0cj-a11yText"></span>
      <div><div class="select__control--outside-label select__control remix-css-13cymwt-control">
        <div class="select__value-container${multi ? ' select__value-container--is-multi' : ''} remix-css-hlgwow">
          <div class="select__placeholder remix-css-1jqq78o-placeholder" id="react-select-${id}-placeholder">Select...</div>
          <div class="select__input-container remix-css-19bb58m" data-value=""><input class="select__input" autocapitalize="none" autocomplete="off" autocorrect="off" id="${id}" spellcheck="false" tabindex="0" type="text" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true" aria-errormessage="${id}-error" aria-invalid="false" aria-labelledby="${id}-label"${required ? ' aria-required="true"' : ''} role="combobox" aria-activedescendant="" aria-describedby="react-select-${id}-placeholder" value=""/></div>
        </div>
        <div class="select__indicators--outside-label select__indicators remix-css-1wy0on6"><button type="button" class="icon-button icon-button--sm" aria-label="Toggle flyout" tabindex="-1">&#9662;</button></div>
      </div></div>
      ${required ? `<input required="" tabindex="-1" aria-hidden="true" class="remix-css-1a0ro4n-requiredInput" value=""/>` : ''}
    </div>
    <div id="${id}-error" class="error-message"></div>
  </div></div></div>`;

const fixture = `<!doctype html><meta charset="utf-8"><title>Job Application at Hudson River Trading</title>
<style>
  .select__control { border: 1px solid #ccc; min-height: 38px; display: flex; padding: 2px 8px; }
  .select__value-container { display: flex; flex-wrap: wrap; align-items: center; flex: 1; }
  .select__input { border: 0; outline: 0; flex: 1 1 auto; min-width: 2px; font: inherit; }
  .select__menu { position: absolute; background: #fff; border: 1px solid #ccc; z-index: 5; }
  .select__option { padding: 8px 12px; cursor: default; }
  .select__multi-value { display: inline-flex; background: #eee; margin: 2px; }
  .error-message { color: #b00; min-height: 1em; }
  .field-wrapper { margin-bottom: 18px; }
</style>
<body>
<div id="react-portal-mount-point"></div>
<main class="main">
<form id="application-form" action="/candidates" method="post" novalidate>
${question({ id: 'question_67889507', label: GPA_LABEL, options: GPA_OPTIONS, losesCommit: true })}
${question({ id: 'question_67889508', label: SCALE_LABEL, options: SCALE_OPTIONS, losesCommit: true })}
${question({ id: 'question_67889515', label: DEADLINE_LABEL, options: DEADLINE_OPTIONS, losesCommit: true, required: false })}
${question({ id: 'question_67889530', label: LANGUAGE_LABEL, options: LANGUAGE_OPTIONS, multi: true, staleBacking: true, mutatesOnInput: true })}
<hr/>
<div id="demographic-section" class="demographic--container">
<h3 class="section-header">Voluntary Self-Identification</h3>
${question({ id: '245', label: GENDER_LABEL, options: GENDER_OPTIONS, multi: true })}
${question({ id: '248', label: VETERAN_LABEL, options: YES_NO, losesCommit: true })}
${question({ id: '249', label: DISABILITY_LABEL, options: YES_NO })}
${question({ id: '250', label: RACE_LABEL, options: RACE_OPTIONS, multi: true, losesCommit: true })}
</div>
<button id="submit" type="submit">Submit application</button>
</form>
</main>
<div id="submitted"></div>
<script>
/* A react-select v5 work-alike, reduced to the behaviour this test needs and faithful to it:
 *   - the menu is portalled to #react-portal-mount-point, as Greenhouse's menuPortalTarget does;
 *   - the placeholder is rendered only when the widget holds no value AND the search box is empty
 *     (react-select's renderPlaceholderOrValue), which is why an uncommitted control shows neither
 *     a chosen value nor a placeholder;
 *   - a value is committed only by an option row's 'click';
 *   - the search input's blur closes the menu;
 *   - the RequiredInput exists exactly while the widget holds no value, so the form's own
 *     constraint validation is the honest statement of whether the answer arrived;
 *   - a multi select keeps its menu open after a commit (closeMenuOnSelect is false for isMulti).
 */
(function () {
  var shells = [].slice.call(document.querySelectorAll('.select-shell'));
  shells.forEach(function (shell) {
    var id = shell.getAttribute('data-question');
    var options = shell.getAttribute('data-options').split('|');
    var multi = shell.getAttribute('data-multi') === '1';
    var losesCommit = shell.getAttribute('data-loses-commit') === '1';
    var staleBacking = shell.getAttribute('data-stale-backing') === '1';
    var mutatesOnInput = shell.getAttribute('data-mutates-on-input') === '1';
    var required = shell.getAttribute('data-required') === '1';
    var control = shell.querySelector('.select__control');
    var valueContainer = shell.querySelector('.select__value-container');
    var inputContainer = shell.querySelector('.select__input-container');
    var input = shell.querySelector('input.select__input');
    var errorNode = document.getElementById(id + '-error');
    var state = { values: [], menu: null };

    function requiredInput() { return shell.querySelector('input.remix-css-1a0ro4n-requiredInput'); }
    function syncRequiredInput() {
      var existing = requiredInput();
      if (!required) return;
      /* THE ONE STATE A REPAIR WOULD BE AIMED AT. The widget holds the value and renders it, so
       * readChoiceState says 'chosen'; the form has not looked at the field again, so its own
       * required backing is still there and formStillRequiresChoice says the field is empty. Those
       * two together were exactly the removed nudge's precondition, and any future repair aims at
       * this state by definition, because it is the only one where the run has something to fix. */
      if (staleBacking) return;
      if (state.values.length > 0) { if (existing) existing.remove(); return; }
      if (existing) return;
      var sentinel = document.createElement('input');
      sentinel.required = true;
      sentinel.tabIndex = -1;
      sentinel.setAttribute('aria-hidden', 'true');
      sentinel.className = 'remix-css-1a0ro4n-requiredInput';
      sentinel.value = '';
      shell.appendChild(sentinel);
    }
    function render() {
      [].slice.call(valueContainer.querySelectorAll('.select__placeholder, .select__single-value, .select__multi-value'))
        .forEach(function (node) { node.remove(); });
      if (state.values.length > 0) {
        state.values.forEach(function (value) {
          var node = document.createElement('div');
          if (multi) {
            node.className = 'select__multi-value remix-css-1p3m7a8-multiValue';
            var text = document.createElement('div');
            text.className = 'select__multi-value__label remix-css-wsp0cs-MultiValueGeneric';
            text.textContent = value;
            var remove = document.createElement('div');
            remove.className = 'select__multi-value__remove remix-css-12a83d4-MultiValueRemove';
            remove.setAttribute('role', 'button');
            remove.setAttribute('aria-label', 'Remove ' + value);
            remove.textContent = 'x';
            node.appendChild(text);
            node.appendChild(remove);
          } else {
            node.className = 'select__single-value remix-css-1dimb5e-singleValue';
            node.textContent = value;
          }
          valueContainer.insertBefore(node, inputContainer);
        });
      } else if (!input.value) {
        var placeholder = document.createElement('div');
        placeholder.className = 'select__placeholder remix-css-1jqq78o-placeholder';
        placeholder.id = 'react-select-' + id + '-placeholder';
        placeholder.textContent = 'Select...';
        valueContainer.insertBefore(placeholder, inputContainer);
      }
      inputContainer.setAttribute('data-value', input.value);
      shell.setAttribute('data-values', state.values.join('|'));
      syncRequiredInput();
    }
    function closeMenu() {
      if (!state.menu) return;
      state.menu.remove();
      state.menu = null;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      input.setAttribute('aria-activedescendant', '');
    }
    /* THE FOUR STATES THIS WIDGET CAN BE IN, read off the live Hudson River Trading form on
     * 2026-09-04 by driving one required control ('Are you a veteran?') through each of them:
     *
     *   state                  valueNode  placeholder  searchBox  RequiredInput
     *   pristine               false      true         ""         true
     *   typed, not selected    false      false        "No"       TRUE
     *   selected               true       false        ""         false
     *   typed over a commit    false      false        "Yes"      false
     *
     * Row two is the one that matters and it is the one this fixture reproduces. The runner types
     * the answer to filter the list and then clicks the matching row; if that click does not
     * select, the widget is left showing the typed text with no chosen value and no placeholder,
     * so readChoiceState reads 'unknown' and the committed-search-input rule then accepts the
     * search box's own text because it equals the row this call clicked. That is the runner reading
     * back its own keystrokes, and the RequiredInput sitting there is the form saying so.
     *
     * 'losesCommit' is that click failing to select. The fixture does not claim a mechanism for
     * why it fails, because none was measured; it reproduces the state, which is what the contract
     * under test is about.
     */
    function commit(value) {
      if (losesCommit) {
        /* Clicked, menu dismissed, nothing selected. The typed query is all that is left on the
         * control, and with the menu closed that query is exactly what
         * readCommittedSearchInputValue offers the verifier as evidence of a commit. */
        input.value = value;
        closeMenu();
        render();
        return;
      }
      if (multi) { if (state.values.indexOf(value) === -1) state.values.push(value); }
      else state.values = [value];
      input.value = '';
      if (errorNode) errorNode.textContent = '';
      input.setAttribute('aria-invalid', 'false');
      render();
      if (!multi) closeMenu();
      else if (state.menu) renderRows();
    }
    function renderRows() {
      if (!state.menu) return;
      var list = state.menu.querySelector('.select__menu-list');
      list.textContent = '';
      var query = input.value.trim().toLowerCase();
      options.filter(function (option) {
        return !query || option.toLowerCase().indexOf(query) !== -1;
      }).forEach(function (option, index) {
        var row = document.createElement('div');
        row.className = 'select__option remix-css-1n6sfyn-MenuList';
        row.setAttribute('role', 'option');
        row.setAttribute('tabindex', '-1');
        row.id = 'react-select-' + id + '-option-' + index;
        row.textContent = option;
        row.addEventListener('click', function () { commit(option); });
        list.appendChild(row);
      });
    }
    function openMenu() {
      if (state.menu) { renderRows(); return; }
      var portal = document.createElement('div');
      portal.className = 'select__menu-portal';
      // react-select names its own popup while it is open, and only while it is open:
      // '...(menuIsOpen && { "aria-controls": this.getElementId("listbox") })' in its own source.
      portal.innerHTML = '<div class="select__menu remix-css-1nmdiq5-menu"><div class="select__menu-list remix-css-qr46ko" role="listbox" id="react-select-' + id + '-listbox"></div></div>';
      state.menu = portal;
      document.getElementById('react-portal-mount-point').appendChild(portal);
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', 'react-select-' + id + '-listbox');
      renderRows();
    }

    control.addEventListener('mousedown', function (event) {
      // react-select's onControlMouseDown: focus the search box and open the menu.
      event.preventDefault();
      input.focus();
      openMenu();
    });
    input.addEventListener('input', function () { openMenu(); render(); mutate(); });
    input.addEventListener('change', function () { mutate(); });
    /* A CONTROL THAT ANSWERS AN EVENT BY CHANGING WHAT IT HOLDS.
     *
     * Not a hypothetical. react-select's own selectOption REMOVES an already-selected option when
     * isMulti is set, employer typeaheads commit on blur, and a form that re-evaluates on an input
     * can snap or extend its own value. What they have in common is that ANY write this runner
     * makes to a control after it has verified the answer can change the answer, and on a multi the
     * change is invisible to the verifier by construction: readChoiceState reads chosenNodes[0]
     * only, so a chip appended at index 1 leaves state.value identical.
     *
     * This control appends a second option on any input or change event it receives while it is
     * holding a value. If anything in the runner ever touches a verified control again, the test
     * that reads this shell's data-values will say so, and it will say so in the one shape the
     * verifier cannot see for itself. */
    function mutate() {
      if (!mutatesOnInput || state.values.length === 0) return;
      var next = options.filter(function (option) { return state.values.indexOf(option) === -1; })[0];
      if (!next) return;
      state.values.push(next);
      render();
    }
    /* react-select's own Menu calls preventDefault on mousedown so the search box never blurs while
     * a row is being pressed, which is what lets the row's click land. Kept, so the fill path here
     * behaves like the real widget and the only thing under test is what reaches the FORM. */
    document.getElementById('react-portal-mount-point').addEventListener('mousedown', function (event) {
      if (state.menu && state.menu.contains(event.target)) event.preventDefault();
    });
    input.addEventListener('blur', function () { closeMenu(); render(); });
    render();
  });

  document.getElementById('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var missing = 0;
    [].slice.call(document.querySelectorAll('.select-shell')).forEach(function (shell) {
      var id = shell.getAttribute('data-question');
      var sentinel = shell.querySelector('input.remix-css-1a0ro4n-requiredInput');
      var input = shell.querySelector('input.select__input');
      var errorNode = document.getElementById(id + '-error');
      if (sentinel && sentinel.validity.valueMissing) {
        missing += 1;
        errorNode.textContent = 'This field is required.';
        input.setAttribute('aria-invalid', 'true');
      } else {
        errorNode.textContent = '';
        input.setAttribute('aria-invalid', 'false');
      }
    });
    if (missing === 0) document.getElementById('submitted').textContent = 'submitted';
  });
})();
</script>
</body>`;

export {
  fixture,
  GPA_LABEL, SCALE_LABEL, VETERAN_LABEL, DISABILITY_LABEL, RACE_LABEL, GENDER_LABEL, DEADLINE_LABEL, LANGUAGE_LABEL,
  GPA_OPTIONS, SCALE_OPTIONS, YES_NO, RACE_OPTIONS, GENDER_OPTIONS, DEADLINE_OPTIONS, LANGUAGE_OPTIONS
};
