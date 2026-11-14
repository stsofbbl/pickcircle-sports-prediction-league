const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function functionSource(name, next) {
  return source.slice(source.indexOf(name), source.indexOf(next, source.indexOf(name)));
}

test('hosted invitation links omit connection credentials and describe joining', async () => {
  let copied = '';
  let message = '';
  const context = {
    URL,
    window: { location: { href: 'https://yoso.example/?dev=1#settings' }, YosoSupabase: {
      allowsConnectionOverrides: () => false,
      config: () => ({ url: 'https://official.supabase.co', anonKey: 'public-test-key', inviteCode: 'friends' }),
    } },
    state: { connection: { leagueId: 'friends' } },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    setConnectionMessage: text => { message = text; },
  };
  vm.runInNewContext(functionSource('async function copySupabaseSetupUrl()', 'function setAuthMessage'), context);
  await context.copySupabaseSetupUrl();
  const url = new URL(copied);
  assert.equal(url.searchParams.get('inviteCode'), 'friends');
  assert.equal(url.searchParams.has('supabaseUrl'), false);
  assert.equal(url.searchParams.has('supabaseAnonKey'), false);
  assert.equal(url.searchParams.has('dev'), false);
  assert.match(message, /招待URL/);
});

test('hosted developer settings display trusted connection and disable editing', () => {
  const names = [...source.slice(source.indexOf('function renderConnectionSettings()'), source.indexOf('function setConnectionMessage')).matchAll(/els\.(\w+)/g)].map(m => m[1]);
  const els = Object.fromEntries(names.map(name => [name, { closest: () => ({}) }]));
  const context = {
    URLSearchParams, els,
    state: { connection: { mode: 'supabase', supabaseUrl: 'https://stale.example', supabaseAnonKey: 'stale', leagueId: 'friends' } },
    normalizeConnectionSettings: value => value,
    window: { location: { search: '?dev=1' }, YosoSupabase: {
      allowsConnectionOverrides: () => false, hasConfig: () => true,
      config: () => ({ url: 'https://official.supabase.co', anonKey: 'public-test-key' }),
    } },
    UI_TEXT: { connection: { onlineReady: 'ready' } },
  };
  vm.runInNewContext(functionSource('function renderConnectionSettings()', 'function setConnectionMessage'), context);
  context.renderConnectionSettings();
  assert.equal(els.dataConnectionScriptUrl.disabled, true);
  assert.equal(els.dataConnectionSpreadsheetId.disabled, true);
  assert.equal(els.dataConnectionScriptUrl.value, 'https://official.supabase.co');
  assert.equal(els.dataConnectionSpreadsheetId.value, 'public-test-key');
  assert.equal(els.dataConnectionCopyStateButton.textContent, '招待URLをコピー');
});
