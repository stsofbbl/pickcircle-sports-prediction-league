// Uses an existing Chrome executable and a local SDK copy; no package installation.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.join(__dirname, '..');
const chrome = process.env.CHROME_BIN;
if (!chrome || !process.argv[2]) throw new Error('Set CHROME_BIN and provide a local Supabase UMD SDK path');
const sdk = fs.readFileSync(process.argv[2], 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function extract(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error('App function not found: ' + start);
  return app.slice(first, last);
}
const render = extract('function renderConnectionSettings()', 'function setConnectionMessage');
const copy = extract('async function copySupabaseSetupUrl()', 'function setAuthMessage');
const fields = [...new Set([...render.matchAll(/els\.(\w+)/g)].map(match => match[1]))];
const setup = `
const errors = [];
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const scenario = new URLSearchParams(location.search).get('scenario');
const official = 'https://official-validation.supabase.co';
window.YOSO_SUPABASE_CONFIG = {url:official,anonKey:'public-test-key',sdkUrl:'/sdk.js'};
if (scenario === 'stored') localStorage.setItem('yoso-supabase-config-v1',JSON.stringify({url:'https://untrusted.example',anonKey:'hostile',sdkUrl:'https://untrusted.example/sdk.js',activeLeagueId:'test-club'}));
const calls = [];
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== official) throw new Error('Unexpected destination: '+url.origin);
  calls.push(url.pathname);
  if (url.pathname === '/auth/v1/token') {
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
    const token = encode({alg:'HS256'})+'.'+encode({sub:'test-user',exp:Math.floor(Date.now()/1000)+3600})+'.fake';
    return new Response(JSON.stringify({access_token:token,refresh_token:'fake-refresh',token_type:'bearer',expires_in:3600,user:{id:'test-user',aud:'authenticated',email:'test@example.invalid'}}),{headers:{'Content-Type':'application/json'}});
  }
  if (url.pathname !== '/auth/v1/logout') throw new Error('Unexpected auth path');
  return new Response('{}',{headers:{'Content-Type':'application/json'}});
};
`;
const checks = `
function check(condition, message) { if (!condition) throw new Error(message); }
const els = Object.fromEntries(${JSON.stringify(fields)}.map(id=>[id,document.getElementById(id)]));
const state = {connection:{mode:'supabase',supabaseUrl:'https://stale.example',supabaseAnonKey:'stale',leagueId:'friends'}};
const normalizeConnectionSettings = value => value;
const UI_TEXT = {connection:{onlineReady:'ready'}};
let copied = '';
Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
function setConnectionMessage(message) { document.getElementById('message').textContent = message; }
${render}
${copy}
(async()=>{
  if(scenario==='save') YosoSupabase.saveConfig({url:'https://untrusted.example',anonKey:'hostile',sdkUrl:'https://untrusted.example/sdk.js'});
  check(!YosoSupabase.allowsConnectionOverrides(),'Hosted origin must be locked');
  const client=await YosoSupabase.client();
  const login=await client.auth.signInWithPassword({email:'test@example.invalid',password:'fake-test-password'});
  check(!login.error && login.data.user.id==='test-user','Login failed');
  check(!!(await client.auth.getSession()).data.session,'Session missing');
  check(!(await client.auth.signOut()).error,'Logout failed');
  check((await client.auth.getSession()).data.session===null,'Session retained');
  await client.auth.stopAutoRefresh();
  check(JSON.stringify(calls)===JSON.stringify(['/auth/v1/token','/auth/v1/logout']),'Wrong request paths');
  check(YosoSupabase.config().inviteCode==='friends','Invitation lost');
  renderConnectionSettings();
  check(els.dataConnectionScriptUrl.disabled && els.dataConnectionSpreadsheetId.disabled,'Connection editable');
  check(els.dataConnectionScriptUrl.value===official,'Stale connection displayed');
  check(els.dataConnectionSpreadsheetId.value==='public-test-key','Wrong key displayed');
  els.dataConnectionCopyStateButton.addEventListener('click',copySupabaseSetupUrl);
  els.dataConnectionCopyStateButton.click();
  await Promise.resolve();
  const invitation=new URL(copied);
  check(invitation.searchParams.get('inviteCode')==='friends','Wrong invitation');
  check(!invitation.searchParams.has('supabaseUrl')&&!invitation.searchParams.has('supabaseAnonKey'),'Connection leaked into invitation');
  check(document.getElementById('message').textContent.includes('招待URL'),'Wrong copy message');
  check(errors.length===0,errors.join(';'));
  document.getElementById('result').textContent=JSON.stringify({scenario,calls,settings:'locked',invitation:'passed'});
  document.documentElement.dataset.result='pass';
})().catch(error=>{document.getElementById('result').textContent=String(error.stack||error);document.documentElement.dataset.result='fail';});
`;
const page = `<!doctype html><html><head><title>YOSO isolated browser verification</title></head><body>
${fields.map(id => `<label class="field"><${id.endsWith('Button') ? 'button' : 'input'} id="${id}"></${id.endsWith('Button') ? 'button' : 'input'}></label>`).join('')}
<p id="message"></p><pre id="result">pending</pre><script src="/setup.js"></script><script src="/client.js"></script><script src="/checks.js"></script></body></html>`;
const routes = {'/':page,'/sdk.js':sdk,'/setup.js':setup,'/checks.js':checks,'/client.js':fs.readFileSync(path.join(root,'js/supabase-client.js'),'utf8')};
const server = http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://test.invalid').pathname;
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('Content-Type',pathname==='/'?'text/html; charset=utf-8':'application/javascript; charset=utf-8');
  res.writeHead(routes[pathname]===undefined?404:200);
  res.end(routes[pathname]||'');
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(const scenario of ['url','stored','save']) {
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yoso-chrome-'));
      try {
        const url='http://yoso-test.invalid:'+server.address().port+'/?scenario='+scenario+'&dev=1&inviteCode=friends'+(scenario==='url'?'&supabaseUrl=https://untrusted.example&anonKey=hostile':'');
        const {stdout}=await run(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP yoso-test.invalid 127.0.0.1','--user-data-dir='+profile,'--dump-dom','--virtual-time-budget=10000',url],{timeout:30000,maxBuffer:1024*1024});
        if(!stdout.includes('data-result="pass"')) throw new Error('Browser scenario '+scenario+' failed: '+stdout.slice(-5000));
        console.log('PASS real Chrome / real SDK / mocked HTTP: '+scenario);
      } finally {fs.rmSync(profile,{recursive:true,force:true});}
    }
  } finally {server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
