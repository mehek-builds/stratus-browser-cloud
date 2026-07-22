const elements = Object.fromEntries(['statusDot','statusText','concurrency','monthlyUnits','allowanceLabel','runSeconds','runForm','runButton','targetUrl','apiKey','actions','fullPage','message','browserAddress','emptyState','screenshot','pageTitle','elapsed','resultJson'].map((id) => [id, document.getElementById(id)]));

function setMessage(text, state = '') { elements.message.textContent = text; elements.message.dataset.state = state; }
function setBusy(busy) { elements.runButton.disabled = busy; elements.runButton.textContent = busy ? 'Browser running…' : 'Run managed browser'; }

async function loadConfiguration() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Control plane is unavailable');
    const config = await response.json();
    elements.concurrency.textContent = config.limits.concurrentBrowsers;
    elements.monthlyUnits.textContent = (config.limits.monthlyUnits ?? config.limits.monthlyCpuHours).toLocaleString();
    elements.allowanceLabel.textContent = config.limits.monthlyUnits ? 'units per month' : 'CPU hours per month';
    elements.runSeconds.textContent = `${config.limits.maxRunSeconds}s`;
    elements.statusDot.dataset.ready = String(config.configured);
    elements.statusText.textContent = config.configured ? 'Stratus browser cloud ready' : 'Browser runtime unavailable';
    elements.runButton.disabled = !config.configured;
    if (!config.configured) setMessage('The Stratus browser runtime is unavailable.', 'warning');
  } catch (error) {
    elements.statusText.textContent = 'Control plane unavailable'; elements.statusDot.dataset.ready = 'false'; elements.runButton.disabled = true; setMessage(error.message, 'error');
  }
}

elements.apiKey.value = localStorage.getItem('stratus-api-key') || '';
elements.apiKey.addEventListener('change', () => localStorage.setItem('stratus-api-key', elements.apiKey.value));
elements.runForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  let actions;
  try { actions = JSON.parse(elements.actions.value); } catch { setMessage('Actions must be valid JSON.', 'error'); return; }
  setBusy(true); setMessage('Allocating a managed browser and running the task…');
  try {
    const headers = { 'content-type': 'application/json' };
    if (elements.apiKey.value) headers['x-stratus-api-key'] = elements.apiKey.value;
    const response = await fetch('/api/run', { method: 'POST', headers, body: JSON.stringify({ url: elements.targetUrl.value, actions, screenshot: true, fullPage: elements.fullPage.checked }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Browser run failed');
    const run = payload.run;
    elements.browserAddress.textContent = run.url; elements.pageTitle.textContent = run.title || 'Untitled'; elements.elapsed.textContent = `${Number(run.elapsedMs || 0).toLocaleString()} ms`;
    elements.resultJson.textContent = JSON.stringify({ url: run.url, title: run.title, extracted: run.extracted, links: run.links, text: run.text }, null, 2);
    if (run.screenshot) { elements.screenshot.src = `data:image/png;base64,${run.screenshot}`; elements.screenshot.classList.add('visible'); elements.emptyState.classList.add('hidden'); }
    setMessage('Managed browser task completed.', 'success');
  } catch (error) { setMessage(error.message, 'error'); } finally { setBusy(false); }
});
loadConfiguration();
