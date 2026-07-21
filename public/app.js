const API_KEY = 'sk_stratus_dev_change_me';
const headers = { 'X-Stratus-API-Key': API_KEY, 'Content-Type': 'application/json' };
const state = { sessionId: null, eventSocket: null, frameTimer: null, latestFunction: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Request failed with ${response.status}`);
  return body;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('visible'), 2400);
}

const titles = { overview: 'Browser operations', playground: 'Browser playground', sessions: 'Session archive', contexts: 'Persistent identities', agents: 'Reusable browser agents', functions: 'Agent functions', gateway: 'Model gateway', developers: 'Developer control plane', access: 'Organization access' };
function showView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === name));
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = titles[name];
  $('#sectionName').textContent = name.toUpperCase();
  history.replaceState(null, '', `#${name}`);
  if (name === 'sessions') loadSessions();
  if (name === 'contexts') loadContexts();
  if (name === 'agents') loadAgents();
  if (name === 'functions') loadFunctions();
  if (name === 'developers') loadHealth();
  if (name === 'access') loadAccess();
}
$$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-open-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.openView)));

async function loadUsage() {
  try {
    const usage = await api('/v1/usage');
    $('#runningCount').textContent = usage.concurrent;
    $('#hoursUsed').textContent = usage.browserHoursUsed.toFixed(3);
    $('#hoursRemaining').textContent = usage.browserHoursRemaining.toFixed(2);
    $('#hoursMeter').style.width = `${Math.min(100, usage.browserHoursUsed / usage.browserHoursAllowance * 100)}%`;
    const sessions = await api('/v1/sessions?status=RUNNING');
    renderRiver(sessions);
  } catch (error) { toast(error.message); }
}

function renderRiver(sessions) {
  const river = $('#sessionRiver');
  if (!sessions.length) {
    river.innerHTML = '<div class="empty-inline"><span class="pulse-icon"></span><div><strong>No browsers are running</strong><p>Launch one to watch the event stream come alive.</p></div></div>';
    return;
  }
  river.innerHTML = sessions.slice(0, 5).map((session) => `<div class="session-card"><i></i><div><strong>${escapeHtml(session.id)}</strong><p>${escapeHtml(session.region)} · ${escapeHtml(session.userMetadata?.purpose || 'browser automation')}</p></div><time>${duration(session.startedAt)}</time></div>`).join('');
}

async function launchSession({ navigate = false } = {}) {
  const session = await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ region: 'us-west-2', keepAlive: true, userMetadata: { purpose: navigate ? 'playground verification' : 'dashboard launch' }, browserSettings: { viewport: { width: 1440, height: 900 } } }) });
  state.sessionId = session.id;
  toast(`Browser ${session.id.slice(0, 13)} launched`);
  await loadUsage();
  if (navigate) await navigatePlayground();
  return session;
}

async function navigatePlayground() {
  if (!state.sessionId) return;
  const url = $('#targetUrl').value;
  logCommand(`navigate ${url.slice(0, 70)}`);
  const result = await api(`/v1/sessions/${state.sessionId}/commands`, { method: 'POST', body: JSON.stringify({ action: 'navigate', url }) });
  $('#browserAddress').textContent = result.url;
  $('#playStatus').textContent = 'live';
  $('#playStatus').classList.remove('muted');
  $('#clickProof').disabled = false;
  $('#stopPlay').disabled = false;
  $('#viewportEmpty').style.display = 'none';
  $('#liveFrame').classList.add('visible');
  connectEvents(state.sessionId);
  clearInterval(state.frameTimer);
  const refresh = () => { $('#liveFrame').src = `/v1/sessions/${state.sessionId}/live-frame?apiKey=${encodeURIComponent(API_KEY)}&t=${Date.now()}`; };
  refresh(); state.frameTimer = setInterval(refresh, 850);
}

function connectEvents(sessionId) {
  if (state.eventSocket) state.eventSocket.close();
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.eventSocket = new WebSocket(`${protocol}://${location.host}/v1/sessions/${sessionId}/live?apiKey=${encodeURIComponent(API_KEY)}`);
  state.eventSocket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.event) appendEvent(message.event);
  };
}

function appendEvent(event) {
  const stream = $('#eventStream');
  stream.querySelector('.empty-copy')?.remove();
  const row = document.createElement('div');
  row.className = 'event-row';
  row.innerHTML = `<time>${new Date(event.timestamp).toLocaleTimeString()}</time><b>${escapeHtml(event.type)}</b><span>${escapeHtml(JSON.stringify(event.data).slice(0, 230))}</span>`;
  stream.prepend(row);
}

function logCommand(message) {
  const row = document.createElement('p');
  row.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${escapeHtml(message)}`;
  $('#commandLog').prepend(row);
}

async function stopSession() {
  if (!state.sessionId) return;
  clearInterval(state.frameTimer);
  $('#liveFrame').classList.remove('visible');
  $('#liveFrame').removeAttribute('src');
  await api(`/v1/sessions/${state.sessionId}`, { method: 'POST', body: JSON.stringify({ status: 'REQUEST_RELEASE' }) });
  logCommand('session released');
  state.eventSocket?.close();
  state.sessionId = null;
  $('#playStatus').textContent = 'offline'; $('#playStatus').classList.add('muted');
  $('#clickProof').disabled = true; $('#stopPlay').disabled = true;
  $('#viewportEmpty').style.display = ''; $('#browserAddress').textContent = 'No active page';
  await loadUsage(); toast('Browser stopped and usage recorded');
}

async function loadSessions() {
  const sessions = await api('/v1/sessions');
  $('#sessionsTable').innerHTML = sessions.length ? sessions.map((session) => `<tr><td><span class="status-pill ${session.status.toLowerCase()}">${session.status}</span></td><td><code>${escapeHtml(session.id)}</code></td><td>${escapeHtml(session.region)}</td><td>${session.startedAt ? new Date(session.startedAt).toLocaleString() : 'pending'}</td><td>${duration(session.startedAt, session.endedAt)}</td><td>${escapeHtml(JSON.stringify(session.userMetadata))}</td><td><button class="table-action" data-inspect="${session.id}">Inspect</button></td></tr>`).join('') : '<tr><td colspan="7">No sessions yet. Launch a browser to create the first record.</td></tr>';
  $$('[data-inspect]').forEach((button) => button.addEventListener('click', () => inspectSession(button.dataset.inspect)));
}

async function inspectSession(id) {
  const [session, events] = await Promise.all([api(`/v1/sessions/${id}`), api(`/v1/sessions/${id}/recording`)]);
  $('#inspector').classList.remove('hidden'); $('#inspectorTitle').textContent = id; $('#inspectorJson').textContent = JSON.stringify(session, null, 2);
  $('#inspectorEvents').innerHTML = events.length ? events.map((event) => `<div class="event-row"><time>${new Date(event.timestamp).toLocaleTimeString()}</time><b>${escapeHtml(event.type)}</b><span>${escapeHtml(JSON.stringify(event.data).slice(0,180))}</span></div>`).join('') : '<p class="empty-copy">No events recorded.</p>';
}

async function loadContexts() {
  const contexts = await api('/v1/contexts');
  $('#contextList').innerHTML = contexts.length ? contexts.map((context) => `<div class="data-card"><div><strong>${escapeHtml(context.name)}</strong><p>${escapeHtml(context.id)} · updated ${new Date(context.updatedAt).toLocaleString()}</p></div><b>PERSISTENT</b></div>`).join('') : '<p class="empty-copy">No identities yet. Create one to preserve login state.</p>';
}
async function loadFunctions() {
  const list = await api('/v1/functions');
  state.latestFunction = list[0]?.id || null; $('#invokeLatest').disabled = !state.latestFunction;
  $('#functionList').innerHTML = list.length ? list.map((fn) => `<div class="data-card"><div><strong>${escapeHtml(fn.name)}</strong><p>${escapeHtml(fn.id)} · timeout ${fn.timeoutMs} ms</p></div><b>${fn.enabled ? 'READY' : 'PAUSED'}</b></div>`).join('') : '<p class="empty-copy">No functions deployed. Deploy the example to create one.</p>';
}
async function loadAgents() {
  const list = await api('/v1/agents');
  $('#agentList').innerHTML = list.length ? list.map((agent) => `<div class="data-card"><div><strong>${escapeHtml(agent.name)}</strong><p>${escapeHtml(agent.id)} · ${escapeHtml(agent.instructions)}</p></div><button class="table-action" data-run-agent="${agent.id}">Run proof</button></div>`).join('') : '<p class="empty-copy">No reusable agents yet.</p>';
  $$('[data-run-agent]').forEach((button) => button.addEventListener('click', async () => {
    const run = await api(`/v1/agents/${button.dataset.runAgent}/runs`, { method: 'POST', body: JSON.stringify({ task: 'Verify the reusable agent lifecycle', simulated: true, mockResult: { verified: true } }) });
    $('#agentOutput').textContent = JSON.stringify(run, null, 2);
    toast('Agent run completed');
  }));
}
async function loadAccess() {
  const [team, settings] = await Promise.all([api('/v1/team'), api('/v1/project-settings')]);
  $('#memberList').innerHTML = team.members.map((member) => `<div class="data-card"><div><strong>${escapeHtml(member.name)}</strong><p>${escapeHtml(member.email)} · ${escapeHtml(member.projectIds.join(', '))}</p></div><b>${member.role}</b></div>`).join('');
  $('#retentionSummary').innerHTML = `<div><span>30</span><strong>Retention window</strong><b>${settings.retentionDays} days</b></div><div><span>0</span><strong>Zero data retention</strong><b>${settings.zeroDataRetention ? 'enabled' : 'disabled'}</b></div><div><span>R</span><strong>Session recording</strong><b>${settings.recordSessions ? 'enabled' : 'disabled'}</b></div>`;
}
async function loadHealth() {
  const health = await fetch('/health').then((r) => r.json());
  const labels = [['API', health.status], ['Database', 'ready'], ['Chromium', health.browserExecutable ? 'ready' : 'missing'], ['Worker', health.browserExecutable ? 'ready' : 'blocked']];
  $('#healthGrid').innerHTML = labels.map(([name, status]) => `<span>${name}<strong>${status}</strong></span>`).join('');
}

$('#newSession').addEventListener('click', async () => { try { await launchSession(); } catch (error) { toast(error.message); } });
$('#launchPlay').addEventListener('click', async () => { try { if (!state.sessionId) await launchSession({ navigate: true }); else await navigatePlayground(); } catch (error) { toast(error.message); logCommand(error.message); } });
$('#clickProof').addEventListener('click', async () => { try { await api(`/v1/sessions/${state.sessionId}/commands`, { method: 'POST', body: JSON.stringify({ action: 'click', selector: '#proof' }) }); logCommand('clicked #proof'); } catch (error) { toast(error.message); } });
$('#stopPlay').addEventListener('click', () => stopSession().catch((error) => toast(error.message)));
$('#refreshSessions').addEventListener('click', () => loadSessions().catch((error) => toast(error.message)));
$('#closeInspector').addEventListener('click', () => $('#inspector').classList.add('hidden'));
$('#createContext').addEventListener('click', async () => { try { await api('/v1/contexts', { method: 'POST', body: JSON.stringify({ name: `Identity ${new Date().toLocaleTimeString()}` }) }); await loadContexts(); toast('Persistent identity created'); } catch (error) { toast(error.message); } });
$('#createFunction').addEventListener('click', async () => { try { await api('/v1/functions', { method: 'POST', body: JSON.stringify({ name: 'hello-browser-agent', code: "console.log('Function started'); return { ok: true, received: input, runtime: 'stratus-node' };" }) }); await loadFunctions(); toast('Function deployed'); } catch (error) { toast(error.message); } });
$('#createAgent').addEventListener('click', async () => { try { await api('/v1/agents', { method: 'POST', body: JSON.stringify({ name: 'Evidence collector', instructions: 'Open a page and return a concise structured summary.' }) }); await loadAgents(); toast('Reusable agent created'); } catch (error) { toast(error.message); } });
$('#addViewer').addEventListener('click', async () => { try { await api('/v1/team/members', { method: 'POST', body: JSON.stringify({ email: `viewer-${Date.now()}@example.com`, role: 'VIEWER', projectIds: ['proj_stratus_demo'] }) }); await loadAccess(); toast('Viewer added with selected-project access'); } catch (error) { toast(error.message); } });
$('#enableZdr').addEventListener('click', async () => { try { await api('/v1/project-settings', { method: 'PUT', body: JSON.stringify({ zeroDataRetention: true, recordSessions: false, recordLogs: false }) }); await loadAccess(); toast('Zero data retention enabled'); } catch (error) { toast(error.message); } });
$('#invokeLatest').addEventListener('click', async () => { try { const run = await api(`/v1/functions/${state.latestFunction}/invoke`, { method: 'POST', body: JSON.stringify({ source: 'dashboard', at: new Date().toISOString() }) }); $('#functionOutput').textContent = JSON.stringify(run, null, 2); toast('Function completed'); } catch (error) { toast(error.message); } });
$('#sendModel').addEventListener('click', async () => { try { const completion = await api('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'stratus-local', messages: [{ role: 'user', content: $('#modelPrompt').value }] }) }); $('#modelOutput').textContent = completion.choices[0].message.content; } catch (error) { toast(error.message); } });
$('#copyKey').addEventListener('click', async () => { await navigator.clipboard.writeText(API_KEY); toast('Development API key copied'); });
$('#copyQuickstart').addEventListener('click', async () => { await navigator.clipboard.writeText(`curl -X POST http://localhost:4100/v1/sessions -H 'X-Stratus-API-Key: ${API_KEY}' -H 'Content-Type: application/json' -d '{"region":"us-west-2"}'`); toast('Quickstart copied'); });
$('#settingsButton').addEventListener('click', () => toast('Project limit: 100 concurrent browsers, 500 browser hours'));

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function duration(start, end) { if (!start) return '0s'; const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000)); if (seconds < 60) return `${seconds}s`; return `${Math.floor(seconds/60)}m ${seconds%60}s`; }

const initial = location.hash.slice(1); if (titles[initial]) showView(initial);
loadUsage(); setInterval(loadUsage, 5000);
