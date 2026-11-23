const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function extract(start, end) {
  const first = app.indexOf(start);
  const last = app.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error('App function not found: ' + start);
  return app.slice(first, last);
}
const functions = [
  extract('function resultFlowPanel() {', '\nfunction resultFlowMessage()'),
  extract('async function runKoshienSharedApprovalAction(kind) {', '\nasync function reloadKoshienSharedApproval()'),
  extract('async function confirmSave() {', '\nels.resetButton?.addEventListener'),
].join('\n');
let shared = { revision: 1, submission_status: 'submitted', submission_id: 'submission-1', approved_count: 0 };
function view(user) {
  return {
    eventId: 'event-A', event_id: 'event-A', event_status: 'resultWait',
    loadedFromDb: true, ...shared, required_count: 2,
    current_user_eligible: true, current_user_voted: user === 'member' && shared.approved_count > 0,
  };
}
function page(user, phase) {
  const setup = [
    'const user = ' + JSON.stringify(user) + ';',
    'const phase = ' + JSON.stringify(phase) + ';',
    'let state = {event:{id:"event-A",templateId:"koshien",status:"resultWait"}};',
    'let koshienSharedApprovalView = {eventId:"event-A",loadedFromDb:false};',
    'let koshienSharedApprovalNotice = {eventId:"",message:"",kind:""};',
    'let koshienSharedApprovalBusy = false;',
    'const els = {saveButton:document.getElementById("save")};',
    'const UI_TEXT = {save:{syncing:"syncing",local:"local",partial:"partial",saved:"saved",confirm:"confirm",confirmed:"confirmed"}};',
    'window.YosoDataService = {shouldAutoSaveKoshien:()=>true,koshien:{',
    'submitSharedApprovalResults:async(eventId,revision)=>api("/api/submit",{revision}),',
    'approveSharedApprovalResults:async(eventId,submissionId,revision)=>api("/api/approve",{submissionId,revision})}};',
    'window.confirm = ()=>true;',
    'function baseTemplateId(id){return id;}',
    'function isOnlineKoshienResultFlow(){return true;}',
    'function isCurrentUserAdmin(){return user==="admin";}',
    'function currentAuthUser(){return {id:user};}',
    'function isResultFinalized(){return false;}',
    'function koshienHasScorableResults(){return true;}',
    'function escapeHtml(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;");}',
    'function persist(){}',
    'function render(){document.getElementById("panel").innerHTML=resultFlowPanel();}',
    'async function api(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw Error(x.error);return x;}',
    'async function refreshKoshienSharedApprovalState(){koshienSharedApprovalView=await(await fetch("/api/state?user="+user)).json();return koshienSharedApprovalView;}',
    'async function saveKoshienOnlineNow(){return api("/api/save",{});}',
    'async function loadKoshienOnlineState(){await refreshKoshienSharedApprovalState();return {ok:true};}',
    functions,
    'function check(ok,msg){if(!ok)throw Error(msg);}',
    '(async()=>{',
    'if(phase==="member-old"){koshienSharedApprovalView={eventId:"event-A",loadedFromDb:true,event_status:"resultWait",submission_status:"submitted",revision:1,submission_id:"submission-1",current_user_eligible:true,current_user_voted:false};',
    'await runKoshienSharedApprovalAction("approve");',
    'check(koshienSharedApprovalNotice.kind==="error","Old vote must be rejected");',
    'check(!resultFlowPanel().includes("data-result-approve"),"Stale vote button remains");}',
    'else {await refreshKoshienSharedApprovalState();render();',
    'if(phase==="admin-save"){check(resultFlowPanel().includes("data-result-approve"),"Initial approval missing");await confirmSave();check(resultFlowPanel().includes("data-result-submit"),"Resubmit missing");check(!resultFlowPanel().includes("data-result-approve"),"Old approval remains");}',
    'if(phase==="admin-submit"){check(resultFlowPanel().includes("data-result-submit"),"Submit missing");await runKoshienSharedApprovalAction("submit");check(resultFlowPanel().includes("data-result-approve"),"New approval missing");}',
    'if(phase==="member-approve"){check(resultFlowPanel().includes("data-result-approve"),"Member approval missing");await runKoshienSharedApprovalAction("approve");check(koshienSharedApprovalNotice.kind==="success","New approval failed");check(!resultFlowPanel().includes("data-result-approve"),"Duplicate approval enabled");}',
    '}document.documentElement.dataset.result="pass";',
    '})().catch(e=>{document.getElementById("error").textContent=String(e.stack||e);document.documentElement.dataset.result="fail";});',
  ].join('\n');
  return '<!doctype html><html><body><button id="save">保存</button><div id="panel"></div><pre id="error"></pre><script>' + setup.replaceAll('</script>', '<\\/script>') + '</script></body></html>';
}
const server = http.createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  res.setHeader('Content-Type', url.pathname.startsWith('/api/') ? 'application/json' : 'text/html; charset=utf-8');
  if(url.pathname==='/api/state') return res.end(JSON.stringify(view(url.searchParams.get('user'))));
  if(url.pathname==='/') return res.end(page(url.searchParams.get('user'),url.searchParams.get('phase')));
  let body='';for await(const chunk of req)body+=chunk;
  const payload=JSON.parse(body||'{}');
  if(url.pathname==='/api/save'){shared={revision:shared.revision+1,submission_status:'none',submission_id:null,approved_count:0};return res.end(JSON.stringify({ok:true}));}
  if(url.pathname==='/api/submit'){if(payload.revision!==shared.revision||shared.submission_status!=='none'){res.statusCode=409;return res.end(JSON.stringify({error:'stale revision'}));}shared={...shared,submission_status:'submitted',submission_id:'submission-2'};return res.end(JSON.stringify(view('admin')));}
  if(url.pathname==='/api/approve'){if(payload.revision!==shared.revision||payload.submissionId!==shared.submission_id||shared.submission_status!=='submitted'){res.statusCode=409;return res.end(JSON.stringify({error:'stale vote rejected'}));}shared.approved_count++;return res.end(JSON.stringify(view('member')));}
  res.statusCode=404;res.end('{}');
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const [user,phase] of [['admin','admin-save'],['member','member-old'],['admin','admin-submit'],['member','member-approve']]){
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yoso-approval-chrome-'));
      try{
        const url='http://127.0.0.1:'+server.address().port+'/?user='+user+'&phase='+phase;
        const {stdout}=await run(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-proxy-server','--user-data-dir='+profile,'--dump-dom','--virtual-time-budget=10000',url],{timeout:30000,maxBuffer:1024*1024});
        if(!stdout.includes('data-result="pass"'))throw Error(phase+' failed: '+stdout.slice(-5000));
        console.log('PASS isolated Chrome: '+phase);
      }finally{fs.rmSync(profile,{recursive:true,force:true});}
    }
    if(shared.approved_count!==1)throw Error('New approval vote missing');
  }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
