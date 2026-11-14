const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/supabase-client.js'), 'utf8');
const official = { url: 'https://official.supabase.co', anonKey: 'public-test-key', sdkUrl: 'https://cdn.example/sdk.js', emailRedirectTo: 'https://yoso-murex.vercel.app/' };
const hostile = { url: 'https://untrusted.example', anonKey: 'untrusted-key', sdkUrl: 'https://untrusted.example/sdk.js', emailRedirectTo: 'https://untrusted.example/' };

function boot({ href = 'https://yoso-murex.vercel.app/', stored = {}, published = official } = {}) {
  const values = new Map([['yoso-supabase-config-v1', JSON.stringify(stored)]]);
  const calls = [];
  const window = { location: new URL(href), YOSO_SUPABASE_CONFIG: published, supabase: { createClient: (...args) => { calls.push(args); return { auth: {} }; } } };
  const document = { querySelector: () => null };
  vm.runInNewContext(source, { window, document, URLSearchParams, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  return { api: window.YosoSupabase, calls, values, window, document };
}

test('public URL parameters cannot redirect the authentication client', async () => {
  const { api, calls } = boot({ href: 'https://yoso-murex.vercel.app/?supabaseUrl=https://untrusted.example&anonKey=untrusted-key&inviteCode=friends' });
  await api.client();
  assert.equal(calls[0][0], official.url);
  assert.equal(calls[0][1], official.anonKey);
  assert.equal(api.config().inviteCode, 'friends');
});

test('legacy stored connection and redirects are ignored while club preferences survive', async () => {
  const { api, calls } = boot({ stored: { ...hostile, inviteCode: 'friends', activeLeagueId: 'club-id' } });
  await api.client();
  assert.equal(calls[0][0], official.url);
  assert.equal(api.config().sdkUrl, official.sdkUrl);
  assert.equal(api.config().emailRedirectTo, official.emailRedirectTo);
  assert.equal(api.config().inviteCode, 'friends');
  assert.equal(api.config().activeLeagueId, 'club-id');
});

test('saveConfig cannot persist an alternate public connection', async () => {
  const { api, calls, values } = boot();
  api.saveConfig({ ...hostile, activeLeagueId: 'another-club' });
  await api.client();
  const saved = JSON.parse(values.get(api.CONFIG_STORAGE_KEY));
  assert.equal(saved.url, official.url);
  assert.equal(saved.anonKey, official.anonKey);
  assert.equal(saved.sdkUrl, official.sdkUrl);
  assert.equal(saved.activeLeagueId, 'another-club');
  assert.equal(calls[0][0], official.url);
});

test('missing published configuration fails closed despite a stored connection', async () => {
  const { api, calls } = boot({ published: {}, stored: hostile });
  assert.equal(api.hasConfig(), false);
  assert.equal(await api.client(), null);
  assert.equal(calls.length, 0);
});

test('SDK loading uses the published source instead of legacy storage', async () => {
  const { api, window, document } = boot({ stored: hostile });
  delete window.supabase;
  const scripts = [];
  document.scripts = [];
  document.createElement = () => {
    const listeners = {};
    return { dataset: {}, addEventListener: (name, fn) => { listeners[name] = fn; }, listeners };
  };
  document.head = { append: script => {
    scripts.push(script.src);
    window.supabase = { createClient: () => ({ auth: {} }) };
    script.listeners.load();
  } };
  await api.client();
  assert.deepEqual(scripts, [official.sdkUrl]);
});

test('loopback development preserves explicit connection overrides', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const { api, calls } = boot({ href: `http://${host}:4173/?supabaseUrl=https://dev.supabase.co&supabaseAnonKey=dev-key` });
    await api.client();
    assert.equal(calls[0][0], 'https://dev.supabase.co');
    assert.equal(calls[0][1], 'dev-key');
  }
});

test('preview domains and loopback lookalikes cannot enable connection overrides', async () => {
  for (const host of ['preview.vercel.app', 'localhost.example', '127.0.0.1.example']) {
    const { api, calls } = boot({ href: `https://${host}/`, stored: hostile });
    await api.client();
    assert.equal(calls[0][0], official.url);
  }
});

test('connection-only links preserve the existing invitation', () => {
  const { api } = boot({ href: 'https://yoso-murex.vercel.app/?supabaseUrl=https://untrusted.example', stored: { inviteCode: 'existing-invite' } });
  assert.equal(api.config().inviteCode, 'existing-invite');
});

test('data service sends login only to the protected client and preserves auth errors', async () => {
  const { api, window } = boot({ stored: hostile });
  const requests = [];
  const rejected = new Error('Test credentials rejected');
  window.supabase.createClient = (url, key) => ({ auth: {
    signInWithPassword: async payload => {
      requests.push({ url, key, ...payload });
      return { data: {}, error: rejected };
    },
  } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/data-service.js'), 'utf8'), { window });
  await assert.rejects(window.YosoDataService.auth.signIn({ email: ' TEST@example.com ', password: 'fake-test-password' }), error => error === rejected);
  assert.deepEqual(requests, [{ url: official.url, key: official.anonKey, email: 'test@example.com', password: 'fake-test-password' }]);
  assert.equal(api.config().url, official.url);
});

test('session lookup and logout keep the existing protected client', async () => {
  const { api, window } = boot({ stored: hostile });
  const destinations = [];
  let logouts = 0;
  window.supabase.createClient = url => {
    destinations.push(url);
    return { auth: {
      getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }),
      signOut: async () => { logouts += 1; },
    } };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/data-service.js'), 'utf8'), { window });
  assert.equal((await api.sessionUser()).id, 'test-user');
  await window.YosoDataService.auth.signOut();
  assert.deepEqual(destinations, [official.url]);
  assert.equal(logouts, 1);
});
