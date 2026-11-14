const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// Supply a local copy of the deployed Supabase UMD SDK; this test never fetches it.
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-supabase-connection-sdk.cjs /path/to/supabase.js');
const sdk = fs.readFileSync(process.argv[2], 'utf8');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/supabase-client.js'), 'utf8');
(async () => {
 for (const scenario of ['url', 'stored', 'save']) {
  const requests = [];
  const storage = new Map();
  const ctx = { console, WebSocket, URL, URLSearchParams, Headers, Request, Response, TextEncoder, TextDecoder, AbortController, crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval };
  ctx.fetch = async (url, options = {}) => {
    url = new URL(url);
    assert.equal(url.origin, 'https://official-validation.supabase.co');
    requests.push(url.pathname);
    if (url.pathname === '/auth/v1/token') {
      const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const token = encode({ alg: 'HS256' }) + '.' + encode({ sub: 'test-user', exp: Math.floor(Date.now()/1000)+3600 }) + '.fake';
      return new Response(JSON.stringify({ access_token: token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'test-user', aud: 'authenticated', email: 'test@example.invalid' } }), {status:200,headers:{'Content-Type':'application/json'}});
    }
    return new Response('{}', {status:200,headers:{'Content-Type':'application/json'}});
  };
  ctx.window = ctx;
  ctx.location = new URL('https://yoso-validation.example/?inviteCode=friends' + (scenario === 'url' ? '&supabaseUrl=https://untrusted.example&anonKey=hostile' : ''));
  ctx.localStorage = { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) };
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.document = { querySelector: () => null, visibilityState: 'hidden', addEventListener: () => {}, removeEventListener: () => {} };
  ctx.YOSO_SUPABASE_CONFIG = {url:'https://official-validation.supabase.co',anonKey:'public-test-key'};
  if (scenario === 'stored') storage.set('yoso-supabase-config-v1',JSON.stringify({url:'https://untrusted.example',anonKey:'hostile'}));
  vm.createContext(ctx);
  vm.runInContext(sdk, ctx);
  vm.runInContext(source, ctx);
  if (scenario === 'save') ctx.YosoSupabase.saveConfig({url:'https://untrusted.example',anonKey:'hostile'});
  const client = await ctx.YosoSupabase.client();
  const login = await client.auth.signInWithPassword({email:'test@example.invalid',password:'fake-test-password'});
  assert.equal(login.error,null);
  assert.equal(login.data.user.id,'test-user');
  assert.ok((await client.auth.getSession()).data.session);
  assert.equal((await client.auth.signOut()).error,null);
  assert.equal((await client.auth.getSession()).data.session,null);
  await client.auth.stopAutoRefresh();
  assert.deepEqual(requests,['/auth/v1/token','/auth/v1/logout']);
  console.log(JSON.stringify({scenario,pass:true,requests,externalRequests:0,sdk:'provided UMD SDK',environment:'Node VM, mocked HTTP responses'}));
 }
})().catch(error=>{console.error(error);process.exit(1)});
