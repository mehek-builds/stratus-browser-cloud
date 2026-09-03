/* A GREENHOUSE CONTROL WEARING AN ERROR THE FORM WILL NEVER TAKE BACK.
 *
 * Measured on the live Hudson River Trading form (job-boards.greenhouse.io/embed/job_app?for=wehrtyou,
 * 2026-09-04), reading the same page three times: pristine, after one validation pass on an empty
 * form, and after answering each control correctly by clicking its own option row.
 *
 *   control          shown           RequiredInput   aria-invalid   error text
 *   gender           "Woman"         GONE            "true"         "This field is required."
 *   veteran          "No"            GONE            "true"         "This field is required."
 *   race/ethnicity   "South Asian"   GONE            "true"         "This field is required."
 *   GPA              "3.76 - 4.0"    GONE            "true"         "This field is required."
 *
 * The answer is on the form and the browser will submit it. What never clears is aria-invalid and
 * the sentence under the control. Everything below is that page, reduced to one required control
 * and a submit, so a run can be driven all the way to the press.
 */
const OPTIONS = ['Woman', 'Man', 'Non-binary'];
const LABEL = 'What is your gender?';
const ID = '245';

const staleErrorFixture = `<!doctype html><meta charset="utf-8"><title>Job Application at Hudson River Trading</title>
<style>
  .select__control { border: 1px solid #ccc; min-height: 38px; display: flex; padding: 2px 8px; }
  .select__value-container { display: flex; flex-wrap: wrap; align-items: center; flex: 1; }
  .select__input { border: 0; outline: 0; flex: 1 1 auto; min-width: 2px; font: inherit; }
  .select__menu { position: absolute; background: #fff; border: 1px solid #ccc; z-index: 5; }
  .select__option { padding: 8px 12px; }
  .error-message { color: #b00; min-height: 1em; }
</style>
<body>
<div id="react-portal-mount-point"></div>
<form id="application-form" action="/candidates" method="post" novalidate>
  <div class="field-wrapper"><div class="select"><div class="select__container select__container--outside-label">
    <label id="${ID}-label" for="${ID}" class="label select__label select__label--outside-label">${LABEL}<span aria-hidden="true">*</span></label>
    <div class="select-shell remix-css-b62m3t-container" data-question="${ID}">
      <div><div class="select__control--outside-label select__control remix-css-13cymwt-control">
        <div class="select__value-container select__value-container--is-multi remix-css-hlgwow">
          <div class="select__placeholder remix-css-1jqq78o-placeholder" id="react-select-${ID}-placeholder">Select...</div>
          <div class="select__input-container remix-css-19bb58m" data-value=""><input class="select__input" autocomplete="off" id="${ID}" tabindex="0" type="text" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true" aria-errormessage="${ID}-error" aria-invalid="false" aria-labelledby="${ID}-label" aria-required="true" role="combobox" value=""/></div>
        </div>
      </div></div>
      <input required="" tabindex="-1" aria-hidden="true" class="remix-css-1a0ro4n-requiredInput" value=""/>
    </div>
    <div id="${ID}-error" class="error-message"></div>
  </div></div></div>
  <button id="submit" type="submit">Submit application</button>
</form>
<div id="submitted"></div>
<script>
(function () {
  var OPTIONS = ${JSON.stringify(OPTIONS)};
  var shell = document.querySelector('.select-shell');
  var control = shell.querySelector('.select__control');
  var valueContainer = shell.querySelector('.select__value-container');
  var inputContainer = shell.querySelector('.select__input-container');
  var input = shell.querySelector('input.select__input');
  var errorNode = document.getElementById('${ID}-error');
  var values = [];
  var menu = null;

  function syncRequiredInput() {
    var existing = shell.querySelector('input.remix-css-1a0ro4n-requiredInput');
    if (values.length > 0) { if (existing) existing.remove(); return; }
    if (existing) return;
    var sentinel = document.createElement('input');
    sentinel.required = true; sentinel.tabIndex = -1;
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.className = 'remix-css-1a0ro4n-requiredInput';
    sentinel.value = '';
    shell.appendChild(sentinel);
  }
  function render() {
    [].slice.call(valueContainer.querySelectorAll('.select__placeholder, .select__multi-value'))
      .forEach(function (node) { node.remove(); });
    if (values.length > 0) {
      values.forEach(function (value) {
        var chip = document.createElement('div');
        chip.className = 'select__multi-value remix-css-1p3m7a8-multiValue';
        var text = document.createElement('div');
        text.className = 'select__multi-value__label remix-css-wsp0cs-MultiValueGeneric';
        text.textContent = value;
        chip.appendChild(text);
        valueContainer.insertBefore(chip, inputContainer);
      });
    } else if (!input.value) {
      var placeholder = document.createElement('div');
      placeholder.className = 'select__placeholder remix-css-1jqq78o-placeholder';
      placeholder.id = 'react-select-${ID}-placeholder';
      placeholder.textContent = 'Select...';
      valueContainer.insertBefore(placeholder, inputContainer);
    }
    inputContainer.setAttribute('data-value', input.value);
    syncRequiredInput();
  }
  function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
  }
  function renderRows() {
    if (!menu) return;
    var list = menu.querySelector('.select__menu-list');
    list.textContent = '';
    var query = input.value.trim().toLowerCase();
    OPTIONS.filter(function (option) { return !query || option.toLowerCase().indexOf(query) !== -1; })
      .forEach(function (option, index) {
        var row = document.createElement('div');
        row.className = 'select__option';
        row.setAttribute('role', 'option');
        row.setAttribute('tabindex', '-1');
        row.id = 'react-select-${ID}-option-' + index;
        row.textContent = option;
        /* COMMITS PROPERLY. The value lands, the chip renders, the RequiredInput unmounts, so the
         * browser will submit this field. What does NOT happen is the page taking back what it said
         * about the field: Greenhouse leaves aria-invalid and the sentence exactly where they were.
         * That is the whole point of this fixture and it is measured behaviour, not a hypothesis. */
        row.addEventListener('click', function () {
          if (values.indexOf(option) === -1) values.push(option);
          input.value = '';
          render();
          closeMenu();
        });
        list.appendChild(row);
      });
  }
  function openMenu() {
    if (menu) { renderRows(); return; }
    var portal = document.createElement('div');
    portal.className = 'select__menu-portal';
    portal.innerHTML = '<div class="select__menu"><div class="select__menu-list" role="listbox" id="react-select-${ID}-listbox"></div></div>';
    menu = portal;
    document.getElementById('react-portal-mount-point').appendChild(portal);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'react-select-${ID}-listbox');
    renderRows();
  }
  control.addEventListener('mousedown', function (event) { event.preventDefault(); input.focus(); openMenu(); });
  input.addEventListener('input', function () { openMenu(); render(); });
  input.addEventListener('blur', function () { closeMenu(); render(); });
  document.getElementById('react-portal-mount-point').addEventListener('mousedown', function (event) {
    if (menu && menu.contains(event.target)) event.preventDefault();
  });
  render();

  // The stray validation pass this page has already had, before the run ever reached it. Rendered
  // once, on an empty field, and never revisited.
  errorNode.textContent = 'This field is required.';
  input.setAttribute('aria-invalid', 'true');

  document.getElementById('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var sentinel = shell.querySelector('input.remix-css-1a0ro4n-requiredInput');
    if (sentinel && sentinel.validity.valueMissing) return;
    document.getElementById('submitted').textContent = 'submitted';
  });
})();
</script>
</body>`;

export { staleErrorFixture, LABEL as STALE_LABEL, ID as STALE_ID };
