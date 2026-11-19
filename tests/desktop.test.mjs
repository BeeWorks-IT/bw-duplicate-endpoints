import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// npm test bundles the production plugin against the SDK shim before node:test runs.
const { default: plugin, testHost: host, testQueryClient: queryClient, __registerI18n } =
  await import('../node_modules/.bw-duplicate-endpoints-desktop-test.mjs');

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const rootNode = document.getElementById('root');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const settle = async fn => { await act(async () => { await fn?.(); await tick(); }); };
const text = () => rootNode.textContent;
const button = label => [...rootNode.querySelectorAll('button')].find(el => el.textContent === label);
const buttons = label => [...rootNode.querySelectorAll('button')].filter(el => el.textContent === label);
const dialogButton = label => [...rootNode.querySelectorAll('[role="dialog"] button')].find(el => el.textContent === label);
const click = async label => { assert.ok(button(label), `button ${label}`); await settle(() => button(label).click()); };
const clickNth = async (label, index) => {
  const all = buttons(label); assert.ok(all[index], `button ${label} #${index}`);
  await settle(() => all[index].click());
};
const clickDialog = async label => { assert.ok(dialogButton(label), `dialog button ${label}`); await settle(() => dialogButton(label).click()); };
const byRole = (role, label) => rootNode.querySelector(`[role="${role}"][aria-label="${label}"]`);
const clickRole = async (role, label) => {
  const el = byRole(role, label); assert.ok(el, `${role} ${label}`);
  await settle(() => el.click());
};
const setSelect = async (index, value) => {
  const select = rootNode.querySelectorAll('select')[index];
  assert.ok(select, `select #${index}`);
  await settle(() => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};
const setInput = async (el, value) => {
  await settle(() => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};

// --- fixtures ---------------------------------------------------------------
const endpointA = { id: 'refuseless-test', name: 'Refuseless Test', base_url: 'https://api.refuseless.example/v1',
  model: 'flash-free', models: ['flash-free', 'pro'], has_api_key: true, api_key_preview: '${SRC_API_KEY}',
  is_current: true, source: 'custom_providers', api_mode: '', discover_models: true, context_length: null };
const endpointB = { id: 'local-lab', name: 'Local Lab', base_url: 'http://127.0.0.1:8283/v1',
  model: 'qwen3', models: ['qwen3'], has_api_key: false, api_key_preview: null,
  is_current: false, source: 'providers', api_mode: '', discover_models: false, context_length: 32768 };
const profileRow = (name, endpoints) => ({ name, home: `/tmp/${name}`, is_default: name === 'default',
  endpoints, current: null, error: null });
const overview = { plugin: 'bw-duplicate-endpoints', version: '1.0.0', profiles: [
  profileRow('default', []), profileRow('alpha', [endpointA, endpointB]), profileRow('beta', []),
] };
const richProfile = (name, endpoints, extra = {}) => ({
  name, display_name: '', description: '', description_auto: false, home: `/tmp/${name}`,
  is_default: name === 'default', gateway_running: true, model: 'flash-free', provider: 'refuseless-test',
  has_env: true, skill_count: 3, alias_name: null, endpoints, endpoint_count: endpoints.length,
  key_count: endpoints.filter(e => e.has_api_key).length, current: null, plugin_enabled: false, error: null, ...extra,
});
const profilesRich = { plugin: 'bw-duplicate-endpoints', version: '1.0.0', profiles: [
  richProfile('default', []), richProfile('alpha', [endpointA, endpointB], { description: 'RH profile' }),
  richProfile('beta', []),
] };
const duplicateResponse = { ok: true, source_profile: 'alpha', results: [
  { target: 'beta', endpoint_id: 'refuseless-test', name: 'Refuseless Test', ok: true, action: 'created',
    key: 'copied', verified: true, activated: false, error: null },
], summary: { endpoints: 1, targets: 1, succeeded: 1, failed: 0 } };

function makeRest(calls, { fail = false } = {}) {
  return async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body });
    if (fail) throw new Error('404 plugin backend not found');
    if (path === '/overview') return overview;
    if (path === '/profiles') return profilesRich;
    if (path === '/health') return { ok: true, plugin: 'bw-duplicate-endpoints', version: '1.0.0' };
    if (path === '/duplicate') return duplicateResponse;
    if (path === '/create') return { ok: true, results: [
      { profile: 'beta', ok: true, endpoint_id: 'my-api', action: 'created', key: 'copied', verified: true, activated: false, error: null },
    ], summary: { profiles: 1, succeeded: 1, failed: 0 } };
    if (path === '/probe') return { endpoint_id: 'refuseless-test', ok: true, reachable: true, message: '', models: ['flash-free'] };
    if (path === '/profiles/meta') return { profile: options.body.profile, display_name: options.body.display_name, description: options.body.description };
    if (path === '/profiles/plugin') return { profile: options.body.profile, plugin_enabled: options.body.enabled, restart_may_be_required: true };
    if (path === '/profiles/activate') return { ok: true, provider: options.body.endpoint_id, model: 'flash-free' };
    throw new Error(`Unexpected endpoint ${path}`);
  };
}

async function mount(subPage = 'duplicate', restOptions) {
  const calls = [];
  const storageBag = {};
  const pages = [];
  const contributions = [];
  const cleanups = [];
  const notifications = [];
  let bundles = null;
  host.navigate = () => {};
  host.notify = message => notifications.push(message);
  host.notifyError = (error, fallback) => notifications.push({ error: String(error?.message || error), fallback });
  queryClient.removeQueries();
  plugin.register({
    source: `plugin:${plugin.id}`,
    rest: makeRest(calls, restOptions),
    storage: { get: (k, d) => (k in storageBag ? storageBag[k] : d), set: (k, v) => { storageBag[k] = v; }, remove: k => { delete storageBag[k]; } },
    i18n: { register: next => { bundles = next; __registerI18n(next); } },
    registerSettingsPage: page => pages.push(page),
    register: row => contributions.push(row),
    onDispose: fn => cleanups.push(fn),
  });
  const page = pages[0];
  assert.ok(page, 'settings page registered');
  const sub = subPage === 'duplicate' ? { render: page.render } : page.children.find(c => c.id === subPage);
  assert.ok(sub, `sub-page ${subPage}`);
  const root = createRoot(rootNode);
  await settle(() => root.render(sub.render()));
  return { calls, notifications, storageBag, contributions, page, bundles,
    async close() { await settle(() => { cleanups.forEach(fn => fn()); root.unmount(); }); } };
}

const keyTree = (node, prefix = '') => Object.entries(node).flatMap(([k, v]) =>
  typeof v === 'object' && v !== null ? keyTree(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

// --- tests ------------------------------------------------------------------
test('contract: opt-in settings page with four sub-pages, palette commands, English locale', async () => {
  const mounted = await mount('duplicate');
  try {
    assert.equal(plugin.id, 'bw-duplicate-endpoints');
    assert.equal(plugin.defaultEnabled, false);
    assert.deepEqual(mounted.page.children.map(c => c.id), ['duplicate', 'new-endpoint', 'profiles', 'settings', 'help']);
    const palette = mounted.contributions.filter(c => c.area === 'palette');
    assert.equal(palette.length, 3);
    let navigated = [];
    host.navigate = path => navigated.push(path);
    palette.forEach(c => c.data.run());
    assert.deepEqual(navigated, [
      '/settings?tab=plugins&plugin=bw-duplicate-endpoints&ppage=duplicate',
      '/settings?tab=plugins&plugin=bw-duplicate-endpoints&ppage=profiles',
      '/settings?tab=plugins&plugin=bw-duplicate-endpoints&ppage=new-endpoint',
    ]);
    assert.ok(mounted.contributions.some(c => c.area === 'customEndpoint.form'),
      'core editor seam registered when the SDK exposes the area');
    assert.ok(mounted.bundles.en && !mounted.bundles.fr, 'English-only locale bundle');
    assert.ok(keyTree(mounted.bundles.en).length > 80, 'locale bundle is complete');
  } finally { await mounted.close(); }
});

test('duplicate workflow: validation gates, confirmation matrix, payload, verified results', async () => {
  const mounted = await mount('duplicate');
  try {
    assert.match(text(), /Duplicate Custom Endpoints/);
    assert.match(text(), /Choose a source profile/);
    assert.ok(button('Duplicate…').disabled, 'gated before any selection');
    await setSelect(0, 'alpha');
    assert.match(text(), /Refuseless Test/);
    assert.match(text(), /Local Lab/);
    assert.ok(button('Duplicate…').disabled, 'gated without endpoints/targets');
    await clickRole('checkbox', 'Refuseless Test');
    await clickRole('checkbox', 'beta');
    assert.ok(!button('Duplicate…').disabled, 'enabled once selection is complete');
    await click('Duplicate…');
    assert.ok(rootNode.querySelector('[role="dialog"]'), 'confirmation opens');
    assert.match(text(), /beta: create · copy key/);
    await click('Duplicate');
    const call = mounted.calls.find(c => c.path === '/duplicate');
    assert.ok(call, 'duplicate called');
    assert.deepEqual(call.body, {
      source_profile: 'alpha', endpoint_ids: ['refuseless-test'], target_profiles: ['beta'],
      copy_keys: true, validate_first: false, make_default: false, on_conflict: 'update',
    });
    assert.match(text(), /verified/);
    assert.equal(mounted.notifications.at(-1).kind, 'success');
  } finally { await mounted.close(); }
});

test('options: key toggle and skip conflict reach the payload; probe reports status', async () => {
  const mounted = await mount('duplicate');
  try {
    await setSelect(0, 'alpha');
    await clickRole('checkbox', 'Refuseless Test');
    await clickRole('checkbox', 'beta');
    await clickRole('switch', 'Copy API keys');
    await click('Skip it');
    await click('Test');
    assert.match(text(), /Connection OK/);
    const probe = mounted.calls.find(c => c.path === '/probe');
    assert.deepEqual(probe.body, { profile: 'alpha', endpoint_id: 'refuseless-test' });
    await click('Duplicate…');
    // beta does not hold the endpoint yet: even in skip mode the action is
    // "create"; with keys off the new endpoint arrives keyless.
    assert.match(text(), /beta: create · no key/);
    await click('Duplicate');
    const call = mounted.calls.find(c => c.path === '/duplicate');
    assert.equal(call.body.copy_keys, false);
    assert.equal(call.body.on_conflict, 'skip');
    assert.equal(mounted.storageBag.copyKeys, false);
    assert.equal(mounted.storageBag.onConflict, 'skip');
  } finally { await mounted.close(); }
});

test('profiles page: metadata edit, backend toggle, default-route activation', async () => {
  const mounted = await mount('profiles');
  try {
    assert.match(text(), /RH profile/);
    assert.match(text(), /gateway running/);
    // backend toggle on beta (cards: default, alpha, beta — beta has no route select)
    const switches = [...rootNode.querySelectorAll('[role="switch"][aria-label="Plugin backend enabled"]')];
    assert.equal(switches.length, 3);
    await settle(() => switches[2].click());
    const toggle = mounted.calls.find(c => c.path === '/profiles/plugin');
    assert.deepEqual(toggle.body, { profile: 'beta', enabled: true });
    // edit alpha metadata (cards order: default, alpha, beta)
    await clickNth('Edit', 1);
    const nameInput = rootNode.querySelector('input[aria-label="Display name"]');
    const descInput = rootNode.querySelector('textarea[aria-label="Description"]');
    assert.ok(nameInput && descInput);
    await setInput(nameInput, 'Atelier RH');
    await setInput(descInput, 'Profil gestion & social');
    await click('Save');
    const meta = mounted.calls.find(c => c.path === '/profiles/meta');
    assert.deepEqual(meta.body, { profile: 'alpha', display_name: 'Atelier RH', description: 'Profil gestion & social' });
    // activate a default route on alpha
    await setSelect(0, 'refuseless-test');
    await click('Activate');
    assert.ok(rootNode.querySelector('[role="dialog"]'));
    await clickDialog('Activate');
    const activate = mounted.calls.find(c => c.path === '/profiles/activate');
    assert.deepEqual(activate.body, { profile: 'alpha', endpoint_id: 'refuseless-test' });
  } finally { await mounted.close(); }
});

test('search, key filter and batch probe', async () => {
  const mounted = await mount('duplicate');
  try {
    await setSelect(0, 'alpha');
    const search = rootNode.querySelector('input[aria-label="Filter endpoints…"]');
    assert.ok(search, 'search field present');
    await setInput(search, 'local');
    assert.match(text(), /Local Lab/);
    assert.ok(!text().includes('Refuseless Test'), 'search narrows the list');
    await setInput(search, '');
    await clickRole('checkbox', 'With key only');
    assert.ok(!text().includes('Local Lab'), 'keyless endpoint filtered out');
    assert.match(text(), /Refuseless Test/);
    await clickRole('checkbox', 'With key only');
    await clickRole('checkbox', 'Refuseless Test');
    await click('Probe selection');
    const probes = mounted.calls.filter(c => c.path === '/probe');
    assert.equal(probes.length, 1);
    assert.deepEqual(probes[0].body, { profile: 'alpha', endpoint_id: 'refuseless-test' });
  } finally { await mounted.close(); }
});

test('settings page: backend health, new options and defaults reset', async () => {
  const mounted = await mount('settings');
  try {
    assert.match(text(), /Mounted · v1\.0\.0/);
    await clickRole('switch', 'Copy API keys');
    assert.equal(mounted.storageBag.copyKeys, false);
    await setSelect(0, 'alpha');
    assert.equal(mounted.storageBag.preferredSource, 'alpha');
    await click('30 s');
    assert.equal(mounted.storageBag.refreshInterval, '30');
    await clickRole('switch', 'Keep last results');
    assert.equal(mounted.storageBag.keepResults, true);
    await click('Reset defaults');
    assert.equal(mounted.storageBag.copyKeys, true);
    assert.equal(mounted.storageBag.onConflict, 'update');
    assert.equal(mounted.storageBag.preferredSource, '');
    assert.equal(mounted.storageBag.refreshInterval, '0');
    assert.equal(mounted.storageBag.keepResults, false);
  } finally { await mounted.close(); }
});

test('new endpoint form: validation gates, payload, verified results', async () => {
  const mounted = await mount('new-endpoint');
  try {
    assert.match(text(), /Create one custom endpoint on several profiles/);
    assert.ok(button('Create endpoint…').disabled, 'gated before the form is complete');
    await setInput(rootNode.querySelector('input[aria-label="Name"]'), 'My API');
    await setInput(rootNode.querySelector('input[aria-label="Base URL"]'), 'https://api.example.com/v1');
    await setInput(rootNode.querySelector('input[aria-label="Default model"]'), 'm1');
    assert.ok(button('Create endpoint…').disabled, 'still gated without a profile');
    await clickRole('checkbox', 'beta');
    assert.ok(!button('Create endpoint…').disabled);
    await click('Create endpoint…');
    assert.ok(rootNode.querySelector('[role="dialog"]'));
    await clickDialog('Create');
    const call = mounted.calls.find(c => c.path === '/create');
    assert.ok(call, 'create called');
    assert.deepEqual(call.body, {
      name: 'My API', base_url: 'https://api.example.com/v1', model: 'm1', profiles: ['beta'],
      endpoint_id: '', api_key: null, api_mode: '', context_length: null,
      discover_models: true, make_default: false,
    });
    assert.match(text(), /verified/);
  } finally { await mounted.close(); }
});

test('core editor seam contribution: also-create copies after save', async () => {
  const mounted = await mount('duplicate');
  const seam = mounted.contributions.find(c => c.area === 'customEndpoint.form');
  assert.ok(seam, 'seam contribution registered');
  await mounted.close();
  const root = createRoot(rootNode);
  const props = saved => ({ profile: 'alpha', draft: {}, saved, saving: false });
  await settle(() => root.render(seam.data.render(props(null))));
  assert.match(text(), /Also create on other profiles/);
  assert.ok(!byRole('checkbox', 'alpha'), 'source profile excluded');
  await clickRole('checkbox', 'beta');
  await settle(() => root.render(seam.data.render(props({
    id: 'refuseless-test', name: 'Refuseless Test', base_url: 'https://api.refuseless.example/v1',
    model: 'flash-free', has_api_key: true, savedAt: 123,
  }))));
  const call = mounted.calls.find(c => c.path === '/duplicate');
  assert.ok(call, 'duplication triggered by the core save');
  assert.deepEqual(call.body, {
    source_profile: 'alpha', endpoint_ids: ['refuseless-test'], target_profiles: ['beta'],
    copy_keys: true, validate_first: false, make_default: false, on_conflict: 'update',
  });
  assert.match(text(), /Copied to checked profiles/);
  await settle(() => root.unmount());
});

test('backend outage is explicit and retryable', async () => {
  const mounted = await mount('duplicate', { fail: true });
  try {
    assert.match(text(), /Plugin backend unavailable/);
    assert.match(text(), /hermes plugins enable bw-duplicate-endpoints/);
    assert.ok(button('Retry'));
  } finally { await mounted.close(); }
});
