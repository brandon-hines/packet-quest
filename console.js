'use strict';
/* =====================================================================
   CONSOLE LAB — a teaching Cisco IOS command-line simulator
   Learn → Practice → Challenge. Nothing is assumed: every command is
   introduced and explained before it is expected.
   ===================================================================== */
(function(){
const MODE_NAME   = {user:'User EXEC', priv:'Privileged EXEC', config:'Global Config', line:'Line Config', if:'Interface Config'};
const MODE_SUFFIX = {user:'>', priv:'#', config:'(config)#', line:'(config-line)#', if:'(config-if)#'};
const TIERNAME    = {learn:'📘 Learn', practice:'🛠 Practice', challenge:'🏆 Challenge'};
const TIERS = ['learn','practice','challenge'];
const PRIORITY = new Set(['enable','configure','terminal','interface','show','exit','running-config','startup-config','shutdown','address','brief','line','console','password','login','hostname','description','copy','ping','end','disable']);

/* ---------------------------------------------------------------- helpers */
const isIP  = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(x=>+x<=255);
const ipN   = s => { const p=s.split('.').map(Number); return ((p[0]<<24)|(p[1]<<16)|(p[2]<<8)|p[3])>>>0; };
const isMask= s => { if(!isIP(s)) return false; const n=ipN(s); if(n===0) return false; const inv=(0xFFFFFFFF-n); return ((inv+1)&inv)===0; };
const h7 = s => { let x='08'; for(let i=0;i<s.length;i++) x+=((s.charCodeAt(i)^[0x64,0x73,0x66,0x64,0x3b,0x6b,0x66,0x6f][i%8])&255).toString(16).padStart(2,'0').toUpperCase(); return x; };
const h9 = s => { let h=2166136261; for(const c of s) h=Math.imul(h^c.charCodeAt(0),16777619)>>>0; return '$9$'+h.toString(36)+'.'+((h*7)>>>0).toString(36)+'Xk3mQe8'; };
const tokenize = raw => { const out=[]; const re=/\S+/g; let m; while((m=re.exec(raw))) out.push({t:m[0],s:m.index}); return out; };
function parseIf(str){
  const m=str.replace(/\s+/g,'').match(/^([a-z]+)(\d+(?:\/\d+)*)$/i); if(!m) return null;
  const t=m[1].toLowerCase(), n=m[2];
  const hit=[['gigabitethernet','GigabitEthernet'],['fastethernet','FastEthernet'],['serial','Serial'],['vlan','Vlan'],['loopback','Loopback']].filter(([k])=>k.startsWith(t));
  return hit.length===1 ? hit[0][1]+n : null;
}
const ARGNAME = {'<WORD>':'WORD','<IP>':'A.B.C.D','<MASK>':'A.B.C.D (mask)','<NUM>':'<number>','<V6>':'X:X:X:X::X/<0-128>','<LINE>':'LINE'};
function validArg(p,t){
  switch(p){
    case '<IP>': return isIP(t);
    case '<MASK>': return isMask(t);
    case '<NUM>': return /^\d+$/.test(t);
    case '<V6>': return /^[0-9a-f:]+\/\d{1,3}$/i.test(t) && t.includes(':');
    default: return true;
  }
}

/* ---------------------------------------------------------------- simulated device */
const newIf = shut => ({ip:null,mask:null,v6:[],ll:null,shut,desc:null});
function newDevice(lab){
  const router = lab.device==='router';
  const d={type:lab.device, hostname:router?'Router':'Switch', mode:'user', line:null, iface:null,
    enableSecret:null, enablePassword:null, servicePE:false, banner:null, gateway:null, domain:null, noLookup:false, v6routing:false,
    users:{}, rsa:0, blockFor:null, minLen:null, vtyRange:null, startup:null, rev:0, savedRev:-1, pending:null, last:null, lastPing:false,
    lines:{con:{password:null,login:false,local:false}, vty:{password:null,login:false,local:false,transport:'all'}},
    ifs:{}, arp:new Set(), hosts:lab.hosts||[], cabled:lab.cabled||[]};
  const names = router ? ['GigabitEthernet0/0/0','GigabitEthernet0/0/1','Serial0/1/0'] : ['FastEthernet0/1','FastEthernet0/2','GigabitEthernet0/1','Vlan1'];
  names.forEach(n=>d.ifs[n]=newIf(router||n==='Vlan1'));
  if(lab.preset) lab.preset(d);
  return d;
}
const chg = d => { d.rev++; };
function linkUp(d,n){ if(/^(Vlan|Loopback)/.test(n)) return true; return d.cabled.includes(n); }
function ifStatus(d,n){ const I=d.ifs[n]; if(I.shut) return ['administratively down','down']; return linkUp(d,n)?['up','up']:['down','down']; }
function ipBrief(d){
  return 'Interface              IP-Address      OK? Method Status                Protocol\n'+
    Object.keys(d.ifs).map(n=>{ const I=d.ifs[n], st=ifStatus(d,n); return n.padEnd(23)+(I.ip||'unassigned').padEnd(16)+'YES '+(I.ip?'manual':'unset ').padEnd(7)+st[0].padEnd(22)+st[1]; }).join('\n');
}
function buildRun(d){
  const L=[], pw=v=>d.servicePE?'7 '+h7(v):v;
  L.push(`Current configuration : ${900+d.rev*37} bytes`,'!','version 15.2',(d.servicePE?'':'no ')+'service password-encryption','!',`hostname ${d.hostname}`,'!');
  if(d.blockFor) L.push(`login block-for ${d.blockFor[0]} attempts ${d.blockFor[1]} within ${d.blockFor[2]}`,'!');
  if(d.enableSecret) L.push(`enable secret 9 ${h9(d.enableSecret)}`);
  if(d.enablePassword) L.push(`enable password ${pw(d.enablePassword)}`);
  if(d.enableSecret||d.enablePassword) L.push('!');
  if(d.noLookup) L.push('no ip domain-lookup');
  if(d.domain) L.push(`ip domain-name ${d.domain}`);
  if(d.v6routing) L.push('ipv6 unicast-routing');
  Object.entries(d.users).forEach(([u,x])=>L.push(x.secret?`username ${u} secret 9 ${h9(x.secret)}`:`username ${u} password ${pw(x.password)}`));
  if(d.minLen) L.push(`security passwords min-length ${d.minLen}`);
  L.push('!');
  Object.entries(d.ifs).forEach(([n,I])=>{ L.push(`interface ${n}`); if(I.desc) L.push(` description ${I.desc}`); L.push(I.ip?` ip address ${I.ip} ${I.mask}`:' no ip address');
    if(I.ll) L.push(` ipv6 address ${I.ll} link-local`); I.v6.forEach(v=>L.push(` ipv6 address ${v}`)); if(I.shut) L.push(' shutdown'); L.push('!'); });
  if(d.gateway) L.push(`ip default-gateway ${d.gateway}`,'!');
  if(d.banner) L.push(`banner motd ^C${d.banner}^C`,'!');
  const line=(hdr,X)=>{ L.push(hdr); if(X.timeout) L.push(` exec-timeout ${X.timeout}`); if(X.password) L.push(` password ${pw(X.password)}`); if(X.sync) L.push(' logging synchronous');
    if(X.login) L.push(' login'); if(X.local) L.push(' login local'); if(X.transport&&X.transport!=='all') L.push(` transport input ${X.transport}`); };
  line('line con 0',d.lines.con); line(`line vty ${d.vtyRange||(d.type==='switch'?'0 15':'0 4')}`,d.lines.vty);
  L.push('!','end');
  return L.join('\n');
}
function saveCfg(d){ d.startup=buildRun(d); d.savedRev=d.rev; }
function version(d){
  return `Cisco IOS Software, ${d.type==='router'?'ISR4300 Software (X86_64_LINUX_IOSD-UNIVERSALK9-M)':'C2960 Software (C2960-LANBASEK9-M)'}, Version 15.2\n`+
    `${d.hostname} uptime is 12 minutes\nSystem image file is "flash:${d.type==='router'?'isr4300-universalk9.bin':'c2960-lanbasek9-mz.152-2.SE4.bin'}"\n`+
    `${d.type==='router'?'cisco ISR4321/K9':'cisco WS-C2960-24TT-L'} processor with ${d.type==='router'?'1795999K':'65536K'} bytes of memory.\nConfiguration register is 0x2102`;
}
function ping(d,ip,p){
  p('Type escape sequence to abort.'); p(`Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`);
  const t=ipN(ip); let reach=false, own=false, viaGw=false;
  for(const [n,I] of Object.entries(d.ifs)){
    if(!I.ip||ifStatus(d,n)[1]!=='up') continue;
    const m=ipN(I.mask), net=(ipN(I.ip)&m)>>>0;
    if(ipN(I.ip)===t) own=true;
    if(((t&m)>>>0)===net && d.hosts.includes(ip)) reach=true;
    if(d.gateway && ((ipN(d.gateway)&m)>>>0)===net && d.hosts.includes(d.gateway) && d.hosts.includes(ip)) viaGw=true;
  }
  let res='.....';
  if(own||reach||viaGw){ const first=!own && !d.arp.has(ip); d.arp.add(ip); res=first?'.!!!!':'!!!!!'; }
  p(res); const s=(res.match(/!/g)||[]).length;
  p(`Success rate is ${s*20} percent (${s}/5)`+(s?', round-trip min/avg/max = 1/1/2 ms':''));
  d.lastPing = s>0;
}
function rsaPre(d,p){
  if(/^(Router|Switch)$/.test(d.hostname)){ p(`% Please define a hostname other than ${d.hostname}.`); return false; }
  if(!d.domain){ p('% Please define a domain-name first.'); return false; }
  return true;
}
function genRsa(d,v,p){
  const n=parseInt(v,10);
  if(!(n>=360&&n<=4096)){ p('% Invalid modulus size. Enter a number from 360 to 4096.'); return; }
  d.rsa=n; chg(d);
  p(`% The key modulus size is ${n} bits`); p(`% Generating ${n} bit RSA keys, keys will be non-exportable...`); p('[OK] (elapsed time was 1 seconds)');
  if(n<768) p('% Warning: SSH version 2 needs a key of at least 768 bits (1024 or 2048 recommended).');
  else p('%SSH-5-ENABLED: SSH 1.99 has been enabled');
}

/* ---------------------------------------------------------------- command table */
const C = (m,w,id,desc,run) => ({m:m.split(' '), w:w.split(' '), id, desc, run:run||(()=>{})});
const CMDS = [
  /* EXEC */
  C('user priv','enable','enable','Turn on privileged commands',(d,a,p)=>{
    if(d.mode!=='user') return;
    const pw=d.enableSecret||d.enablePassword;
    if(pw) d.pending={prompt:'Password: ',secret:true,on:(d,v,p)=>{ if(v===pw) d.mode='priv'; else p('% Access denied'); }};
    else d.mode='priv';
  }),
  C('priv','disable','disable','Turn off privileged commands (back to User EXEC)',d=>{ d.mode='user'; }),
  C('priv','configure terminal','conf-t','Enter configuration mode',(d,a,p)=>{ d.mode='config'; p('Enter configuration commands, one per line.  End with CNTL/Z.'); }),
  C('user priv','exit','exit-exec','Log out of the device',(d,a,p)=>{ d.mode='user'; p(''); p(`${d.hostname} con0 is now available`); p('Press RETURN to get started.'); }),
  C('priv','show running-config','show-run','Current operating configuration (RAM)',(d,a,p)=>{ p('Building configuration...'); p(''); p(buildRun(d)); }),
  C('priv','show startup-config','show-start','Saved configuration (NVRAM)',(d,a,p)=>p(d.startup||'startup-config is not present')),
  C('user priv','show ip interface brief','show-ipib','Brief summary of every interface: IP and up/down status',(d,a,p)=>p(ipBrief(d))),
  C('user priv','show version','show-ver','Hardware, software and uptime',(d,a,p)=>p(version(d))),
  C('priv','show ip ssh','show-ssh','Is SSH enabled?',(d,a,p)=>p(d.rsa>=768?'SSH Enabled - version 2.0\nAuthentication methods:publickey,keyboard-interactive,password\nAuthentication timeout: 120 secs; Authentication retries: 3':'%SSH has not been enabled')),
  C('priv','copy running-config startup-config','copy-run','Save the running config to NVRAM',d=>{
    d.pending={prompt:'Destination filename [startup-config]? ',on:(d,v,p)=>{ if(v&&v!=='startup-config'){ p(`%Error opening flash:${v} (Permission denied)`); return; } p('Building configuration...'); p('[OK]'); saveCfg(d); }};
  }),
  C('priv','write memory','write','Older shortcut that also saves the config',(d,a,p)=>{ p('Building configuration...'); p('[OK]'); saveCfg(d); }),
  C('priv','write','write','Older shortcut that also saves the config',(d,a,p)=>{ p('Building configuration...'); p('[OK]'); saveCfg(d); }),
  C('user priv','ping <IP>','ping','Test reachability with ICMP echo requests',(d,a,p)=>ping(d,a[0],p)),
  /* global config */
  C('config','hostname <WORD>','hostname','Set the device name',(d,a,p)=>{ if(!/^[A-Za-z][A-Za-z0-9-]*$/.test(a[0])||a[0].length>63) return p('% Hostname must start with a letter and contain only letters, digits and hyphens.'); d.hostname=a[0]; chg(d); }),
  C('config','enable secret <WORD>','en-secret','Password for Privileged EXEC (strongly encrypted)',(d,a,p)=>{ if(d.minLen&&a[0].length<d.minLen) return p(`% Password too short - must be at least ${d.minLen} characters.`); d.enableSecret=a[0]; chg(d); }),
  C('config','enable password <WORD>','en-pass','Password for Privileged EXEC (NOT encrypted - avoid)',(d,a)=>{ d.enablePassword=a[0]; chg(d); }),
  C('config','service password-encryption','spe','Encrypt all plaintext passwords',d=>{ d.servicePE=true; chg(d); }),
  C('config','no service password-encryption','no-spe','Stop encrypting new passwords',d=>{ d.servicePE=false; chg(d); }),
  C('config','banner motd <LINE>','banner','Message of the day shown at login',(d,a,p)=>{
    const s=a[0], c=s[0];
    if(s.length<3||s[s.length-1]!==c) return p('% Start and end the banner with the same delimiter, e.g.  banner motd #Authorized access only#');
    d.banner=s.slice(1,-1); chg(d);
  }),
  C('config','line console <NUM>','line-con','Configure the console port line',(d,a,p)=>{ if(a[0]!=='0') return p('% There is only one console line: line console 0'); d.mode='line'; d.line='con'; }),
  C('config','line vty <NUM> <NUM>','line-vty','Configure the virtual (remote access) lines',(d,a,p)=>{
    if(+a[0]>+a[1]||+a[1]>15) return p('% Invalid VTY range. Lines are numbered 0-15, e.g.  line vty 0 15');
    d.mode='line'; d.line='vty'; d.vtyRange=a.join(' ');
  }),
  C('config','interface <LINE>','int','Select an interface to configure',(d,a,p)=>{
    const n=parseIf(a[0]);
    if(!n) return p('% Invalid interface name. Examples: g0/0/0, f0/1, vlan 1');
    if(!d.ifs[n]){ if(/^(Vlan|Loopback)\d+$/.test(n)){ d.ifs[n]=newIf(/^Vlan/.test(n)); chg(d); } else return p(`% This ${d.type} has no ${n}. Use "do show ip interface brief" to list its interfaces.`); }
    d.mode='if'; d.iface=n;
  }),
  C('config','ip default-gateway <IP>','dgw','Default gateway for a switch',(d,a)=>{ d.gateway=a[0]; chg(d); }),
  C('config','ip domain-name <WORD>','domain','Set the domain name (needed for SSH keys)',(d,a)=>{ d.domain=a[0]; chg(d); }),
  C('config','ip domain name <WORD>','domain','Set the domain name (newer syntax)',(d,a)=>{ d.domain=a[0]; chg(d); }),
  C('config','no ip domain-lookup','no-lookup','Stop treating typos as hostnames to look up',d=>{ d.noLookup=true; chg(d); }),
  C('config','username <WORD> secret <WORD>','user','Create a local user account (encrypted secret)',(d,a)=>{ d.users[a[0]]={secret:a[1]}; chg(d); }),
  C('config','username <WORD> password <WORD>','user','Create a local user account (weak password)',(d,a)=>{ d.users[a[0]]={password:a[1]}; chg(d); }),
  C('config','crypto key generate rsa','rsa','Generate RSA keys (required for SSH)',(d,a,p)=>{
    if(!rsaPre(d,p)) return;
    p(`The name for the keys will be: ${d.hostname}.${d.domain}`);
    p('Choose the size of the key modulus in the range of 360 to 4096 for your');
    p('  General Purpose Keys. Choosing a key modulus greater than 512 may take');
    p('  a few minutes.'); p('');
    d.pending={prompt:'How many bits in the modulus [512]: ',on:(d,v,p)=>genRsa(d,v||'512',p)};
  }),
  C('config','crypto key generate rsa general-keys modulus <NUM>','rsa','Generate RSA keys with a set size',(d,a,p)=>{ if(!rsaPre(d,p)) return; p(`The name for the keys will be: ${d.hostname}.${d.domain}`); genRsa(d,a[0],p); }),
  C('config','login block-for <NUM> attempts <NUM> within <NUM>','block','Block logins after repeated failures',(d,a)=>{ d.blockFor=a.map(Number); chg(d); }),
  C('config','security passwords min-length <NUM>','minlen','Require a minimum password length',(d,a,p)=>{ if(+a[0]<1||+a[0]>16) return p('% Valid range is 1-16'); d.minLen=+a[0]; chg(d); }),
  C('config','ipv6 unicast-routing','v6route','Let a router forward IPv6 packets',d=>{ d.v6routing=true; chg(d); }),
  C('config line if','do <LINE>','do','Run an EXEC command (like show) without leaving config mode'),
  C('config line if','exit','exit','Go back one level',d=>{ d.mode = d.mode==='config'?'priv':'config'; d.line=null; d.iface=null; }),
  C('config line if','end','end','Jump straight back to Privileged EXEC',d=>{ d.mode='priv'; d.line=null; d.iface=null; }),
  /* line config */
  C('line','password <WORD>','line-pass','Set the password for this line',(d,a,p)=>{ if(d.minLen&&a[0].length<d.minLen) return p(`% Password too short - must be at least ${d.minLen} characters.`); d.lines[d.line].password=a[0]; chg(d); }),
  C('line','login','login','Ask for the line password when someone connects',d=>{ const L=d.lines[d.line]; L.login=true; L.local=false; chg(d); }),
  C('line','login local','login-local','Log in with a username from the local database',d=>{ const L=d.lines[d.line]; L.local=true; L.login=false; chg(d); }),
  C('line','no login','no-login','Stop asking for a password (insecure)',d=>{ const L=d.lines[d.line]; L.login=false; L.local=false; chg(d); }),
  C('line','transport input <WORD>','transport','Which remote protocols may use the VTY lines',(d,a,p)=>{
    const v=a[0].toLowerCase(), ok=['ssh','telnet','all','none'].find(x=>x.startsWith(v));
    if(!ok) return p('% Use one of: ssh, telnet, all, none');
    if(d.line!=='vty') return p('% transport input applies to VTY lines (line vty ...)');
    d.lines.vty.transport=ok; chg(d);
  }),
  C('line','exec-timeout <NUM> <NUM>','exec-timeout','Log out idle sessions after <minutes> <seconds>',(d,a)=>{ d.lines[d.line].timeout=a.join(' '); chg(d); }),
  C('line','logging synchronous','logsync','Stop log messages interrupting your typing',d=>{ d.lines[d.line].sync=true; chg(d); }),
  /* interface config */
  C('if','ip address <IP> <MASK>','ip-addr','Set the IPv4 address and subnet mask',(d,a,p)=>{
    if(d.type==='switch'&&/^(FastEthernet|GigabitEthernet)/.test(d.iface)) return p('% Switch ports are Layer 2 and cannot take an IP address here. Use interface vlan 1 (the SVI).');
    const n=ipN(a[0]), m=ipN(a[1]), net=(n&m)>>>0, bc=(net|(~m>>>0))>>>0;
    if(m!==0xFFFFFFFF && (n===net||n===bc)) return p(`% Bad mask 0x${m.toString(16).toUpperCase()} for address ${a[0]} (that is the ${n===net?'network':'broadcast'} address, not a host address)`);
    const I=d.ifs[d.iface]; I.ip=a[0]; I.mask=a[1]; chg(d);
  }),
  C('if','no ip address','no-ip','Remove the IPv4 address',d=>{ const I=d.ifs[d.iface]; I.ip=null; I.mask=null; chg(d); }),
  C('if','ipv6 address <V6>','ipv6-addr','Set an IPv6 address with its /prefix',(d,a)=>{ const I=d.ifs[d.iface], v=a[0].toLowerCase(); if(!I.v6.includes(v)) I.v6.push(v); chg(d); }),
  C('if','ipv6 address <WORD> link-local','ipv6-ll','Set a link-local IPv6 address',(d,a,p)=>{ if(!/^fe80:/i.test(a[0])) return p('% Link-local addresses must begin with FE80'); d.ifs[d.iface].ll=a[0].toLowerCase(); chg(d); }),
  C('if','no shutdown','no-shut','Turn the interface on',(d,a,p)=>{
    const I=d.ifs[d.iface]; if(!I.shut) return; I.shut=false; chg(d);
    const up=linkUp(d,d.iface);
    p(`%LINK-${up?5:3}-CHANGED: Interface ${d.iface}, changed state to ${up?'up':'down'}`);
    if(up) p(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${d.iface}, changed state to up`);
  }),
  C('if','shutdown','shut','Turn the interface off',(d,a,p)=>{ d.ifs[d.iface].shut=true; chg(d); p(`%LINK-5-CHANGED: Interface ${d.iface}, changed state to administratively down`); }),
  C('if','description <LINE>','desc','Note what this interface connects to',(d,a)=>{ d.ifs[d.iface].desc=a[0]; chg(d); })
];
const FIRSTDESC = {enable:'Turn on privileged commands',disable:'Turn off privileged commands',configure:'Enter configuration mode',exit:'Exit / go back one level',
  show:'Show running system information',copy:'Copy from one file to another',write:'Write running configuration to memory',ping:'Send echo messages',
  hostname:'Set system\'s network name',banner:'Define a login banner',line:'Configure a terminal line',interface:'Select an interface to configure',
  ip:'Global IP configuration subcommands',ipv6:'IPv6 configuration subcommands',no:'Negate a command or set its defaults',service:'Modify use of network based services',
  username:'Establish User Name Authentication',crypto:'Encryption module',login:'Enable secure login checking',security:'Infra Security CLI',do:'To run exec commands in config mode',
  end:'Exit to Privileged EXEC',password:'Set a password',transport:'Define transport protocols for line','exec-timeout':'Set the EXEC timeout',logging:'Modify message logging facilities',
  description:'Interface specific description',shutdown:'Shutdown the selected interface'};

/* ---------------------------------------------------------------- parser */
const allowed = (e,mode) => e.m.includes(mode) || ((mode==='line'||mode==='if') && e.m.includes('config'));
function tryMatch(pat,toks,raw){
  const args=[]; let score=0;
  for(let i=0;i<pat.length;i++){
    const p=pat[i];
    if(i>=toks.length) return {st:'inc',i,score};
    const t=toks[i].t;
    if(p==='<LINE>'){ args.push(raw.slice(toks[i].s).trim()); return {st:'full',args,score}; }
    if(p[0]==='<'){ if(!validArg(p,t)) return {st:'bad',i,score}; args.push(t); score+=1; continue; }
    const tl=t.toLowerCase();
    if(!p.startsWith(tl)) return {st:'bad',i,score};
    score += tl===p ? 3 : (PRIORITY.has(p)?1:0);
  }
  if(toks.length>pat.length) return {st:'bad',i:pat.length,score};
  return {st:'full',args,score};
}
function resolve(d,raw,modeOverride){
  const mode=modeOverride||d.mode, toks=tokenize(raw);
  const res=CMDS.filter(e=>allowed(e,mode)).map(e=>({e,r:tryMatch(e.w,toks,raw)}));
  const direct=x=>x.e.m.includes(mode)?0:1;
  const full=res.filter(x=>x.r.st==='full').sort((a,b)=>(b.r.score-a.r.score)||(direct(a)-direct(b)));
  if(full.length){
    if(full.length>1 && full[0].r.score===full[1].r.score && direct(full[0])===direct(full[1])) return {err:'amb'};
    return {e:full[0].e, args:full[0].r.args, sub:!full[0].e.m.includes(mode)};
  }
  if(res.some(x=>x.r.st==='inc'&&x.r.i>0)) return {err:'inc'};
  let far=0; res.forEach(x=>{ if(x.r.st==='bad') far=Math.max(far,x.r.i); });
  return {err:'bad', pos: far<toks.length ? toks[far].s : raw.length};
}
function helpFor(d,raw){
  const toks=tokenize(raw), endsSpace=raw.length===0||/\s$/.test(raw);
  const done=endsSpace?toks:toks.slice(0,-1), partial=endsSpace?'':toks[toks.length-1].t.toLowerCase();
  const items=new Map(); let cr=false;
  CMDS.filter(e=>allowed(e,d.mode)).forEach(e=>{
    for(let i=0;i<done.length;i++){
      const p=e.w[i]; if(p===undefined) return;
      if(p==='<LINE>'){ if(endsSpace) cr=true; return; }
      if(p[0]==='<'){ if(!validArg(p,done[i].t)) return; continue; }
      if(!p.startsWith(done[i].t.toLowerCase())) return;
    }
    const next=e.w[done.length];
    if(next===undefined){ if(endsSpace) cr=true; return; }
    if(next[0]==='<'){ if(!partial) items.set(ARGNAME[next],e.desc); return; }
    if(next.startsWith(partial) && !items.has(next)) items.set(next, done.length===0 ? (FIRSTDESC[next]||e.desc) : e.desc);
  });
  return {items:[...items].sort((a,b)=>a[0].localeCompare(b[0])), cr};
}
function complete(d,raw){
  if(!raw||/\s$/.test(raw)) return null;
  const kws=helpFor(d,raw).items.map(x=>x[0]).filter(k=>k===k.toLowerCase()&&!k.startsWith('<'));
  if(!kws.length) return null;
  const toks=tokenize(raw), last=toks[toks.length-1];
  let pre=kws[0]; kws.forEach(k=>{ while(!k.startsWith(pre)) pre=pre.slice(0,-1); });
  if(kws.length===1) return raw.slice(0,last.s)+kws[0]+' ';
  return pre.length>last.t.length ? raw.slice(0,last.s)+pre : null;
}
function howTo(from,to){
  if(to==='priv'){ return from==='user'?'Type <b>enable</b> first.':'Type <b>end</b> to get there — or put <b>do</b> in front of the command to run it from here.'; }
  if(to==='user') return 'Type <b>disable</b> (from Privileged EXEC).';
  if(to==='config') return from==='user'?'Type <b>enable</b>, then <b>configure terminal</b>.':from==='priv'?'Type <b>configure terminal</b> first.':'Type <b>exit</b>.';
  if(to==='line') return 'From Global Config, enter <b>line console 0</b> or <b>line vty 0 15</b> first.';
  if(to==='if') return 'From Global Config, enter <b>interface</b> + a name (e.g. <b>interface g0/0/0</b>) first.';
  return '';
}

/* ---------------------------------------------------------------- labs (lessons) */
const ok = (d,ev,id) => ev===id;
const LABS = [
 {id:'nav', m:2, device:'switch', title:'IOS Modes & Navigation', blurb:'Your first steps on a Cisco CLI: help, the four main modes, and moving between them.',
  scenario:'You are plugged into a brand-new switch with a console cable. Explore the command line and learn to move between its modes.',
  recap:'You used ? for help, enable / disable, configure terminal, line console 0, exit, end, and two show commands. These moves are the foundation of every Cisco lab.',
  steps:[
   {goal:'Ask the switch for help by typing ?', cmd:'?', hint:'A single character: the question mark.',
    why:'Look at the prompt: <code>Switch&gt;</code>. The <b>&gt;</b> means <b>User EXEC</b> mode, a view-only mode with only a few commands. In <i>every</i> mode, typing <b>?</b> lists the commands available right now, so you never have to guess. You can even type part of a word then <code>?</code> (like <code>sh?</code>).',
    check:(d,ev)=>ev==='help'},
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'One word meaning "turn on privileged commands".',
    why:'<b>enable</b> moves you up to <b>Privileged EXEC</b> mode, shown by a <b>#</b> at the end of the prompt. From here you can see everything, save the config, and enter configuration mode.<br>Tip: IOS accepts any unique abbreviation, so <code>en</code> works too.',
    check:d=>d.mode==='priv'},
   {goal:'Display the running configuration', cmd:'show running-config', hint:'show &lt;which config?&gt; — the one currently running. Short form: sh run',
    why:'<b>show running-config</b> prints the <b>active</b> configuration, which lives in <b>RAM</b>. Changes take effect the moment you type them, but RAM is wiped on reboot. To keep changes they must be saved to <b>NVRAM</b> as the <i>startup-config</i> (you will learn how later).',
    check:(d,ev)=>ok(d,ev,'show-run')},
   {goal:'Check the interfaces with a quick summary', cmd:'show ip interface brief', hint:'show ip interface &lt;short version&gt; — short form: sh ip int br',
    why:'<b>show ip interface brief</b> lists every interface with its IP address, <b>Status</b> (Layer 1) and <b>Protocol</b> (Layer 2). It is the #1 troubleshooting command. "administratively down" means someone turned it off with <code>shutdown</code>.',
    check:(d,ev)=>ok(d,ev,'show-ipib')},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'configure &lt;where from?&gt; — you are typing at a terminal. Short form: conf t',
    why:'<b>configure terminal</b> enters <b>Global Configuration</b> mode: <code>Switch(config)#</code>. Commands here change the whole device (name, passwords, banners…). It only works from Privileged EXEC — that is why you needed <code>enable</code> first.',
    check:d=>d.mode==='config'},
   {goal:'Enter Line Configuration mode for the console port', cmd:'line console 0', hint:'line &lt;type&gt; &lt;number&gt; — the console port is number 0.',
    why:'Some settings belong to one <b>line</b> (a way of logging in). <b>line console 0</b> selects the physical console port and enters <b>Line Configuration</b> mode: <code>Switch(config-line)#</code>. There is only one console line, and it is numbered 0.',
    check:d=>d.mode==='line'&&d.line==='con'},
   {goal:'Go back up ONE level, to Global Config', cmd:'exit', hint:'The usual word for leaving.',
    why:'<b>exit</b> moves you back one level at a time: Line Config → Global Config → Privileged EXEC.',
    check:d=>d.mode==='config'},
   {goal:'Jump straight back to Privileged EXEC', cmd:'end', hint:'Three letters. (Ctrl+Z does the same thing.)',
    why:'<b>end</b> (or <b>Ctrl+Z</b>) jumps from <i>any</i> configuration mode straight back to Privileged EXEC, no matter how deep you are.',
    check:d=>d.mode==='priv'},
   {goal:'Drop back down to User EXEC mode', cmd:'disable', hint:'The opposite of enable.',
    why:'<b>disable</b> takes you from Privileged EXEC back to User EXEC (<code>&gt;</code>). Now you know the whole ladder: <code>&gt;</code> → <code>#</code> → <code>(config)#</code> → <code>(config-line)#</code>.',
    check:d=>d.mode==='user'}
  ]},
 {id:'secure', m:2, device:'switch', title:'Name & Secure a Switch', blurb:'Hostname, enable secret, console & VTY passwords, password encryption, a banner, and saving.',
  scenario:'Prepare a new switch before it goes on the network. Name: <b>S1</b> · enable secret: <b>class</b> · console & VTY password: <b>cisco</b> · banner: <b>Authorized access only!</b> · save when done.',
  recap:'hostname · enable secret · line console 0 + password + login · line vty 0 15 + password + login · service password-encryption · banner motd · copy running-config startup-config. This is the basic device configuration from Module 2.',
  steps:[
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'Same first move as always.', why:'Every configuration job starts the same way: get to Privileged EXEC (<code>#</code>) with <b>enable</b>.', check:d=>d.mode!=='user'},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'conf t', why:'Device-wide settings are made in Global Config — <b>configure terminal</b>.', check:d=>['config','line','if'].includes(d.mode)},
   {goal:'Name the switch S1', cmd:'hostname S1', hint:'hostname &lt;name&gt;',
    why:'<b>hostname</b> names the device so you can tell it apart from every other switch. Naming rules: start with a letter, no spaces, end with a letter or digit, under 64 characters. Watch your prompt change!',
    check:d=>d.hostname.toLowerCase()==='s1'},
   {goal:'Protect Privileged EXEC with the secret "class"', cmd:'enable secret class', hint:'enable secret &lt;password&gt;',
    why:'Right now anyone who types <code>enable</code> gets full control. <b>enable secret</b> sets a password for Privileged EXEC and stores it with <b>strong encryption</b> (type 9). Avoid <code>enable password</code>: it is stored in plain text.',
    check:d=>!!d.enableSecret},
   {goal:'Select the console line', cmd:'line console 0', hint:'line &lt;type&gt; &lt;number&gt;', why:'The console port is the first way someone could walk up and get in. Select it with <b>line console 0</b>.', check:d=>d.mode==='line'&&d.line==='con'},
   {goal:'Set the console password to "cisco"', cmd:'password cisco', hint:'password &lt;password&gt; (in Line Config)', why:'<b>password</b> sets the password for the line you selected.', check:d=>!!d.lines.con.password},
   {goal:'Make the console actually ask for it', cmd:'login', hint:'One word that turns on password checking at login.',
    why:'Important trap: a line password does <b>nothing</b> until you add <b>login</b>, which tells the line to actually ask for it.', check:d=>d.lines.con.login||d.lines.con.local},
   {goal:'Select all 16 VTY (remote access) lines', cmd:'line vty 0 15', hint:'line vty &lt;first&gt; &lt;last&gt;',
    why:'<b>VTY</b> (virtual terminal) lines handle remote logins over Telnet or SSH. A Cisco switch has 16 of them, numbered 0 to 15, so configure them all at once. You can type this straight from Line Config.',
    check:d=>d.mode==='line'&&d.line==='vty'},
   {goal:'Set the VTY password to "cisco"', cmd:'password cisco', hint:'Same command you used on the console line.', why:'Same idea as the console: set a password on the remote-access lines…', check:d=>!!d.lines.vty.password},
   {goal:'Make the VTY lines ask for it', cmd:'login', hint:'Same as the console line.', why:'…and turn on checking with <b>login</b>.', check:d=>d.lines.vty.login||d.lines.vty.local},
   {goal:'Encrypt every plaintext password', cmd:'service password-encryption', hint:'service password-&lt;what?&gt;',
    why:'If you ran <code>show run</code> now you would see <code>password cisco</code> in plain text. <b>service password-encryption</b> scrambles every plaintext password (weak type 7 encryption) so someone glancing at the config cannot read them. It is a Global Config command, so IOS drops you back to <code>(config)#</code>.',
    check:d=>d.servicePE},
   {goal:'Add the banner "Authorized access only!"', cmd:'banner motd #Authorized access only!#', hint:'banner motd &lt;delimiter&gt;message&lt;delimiter&gt;',
    why:'<b>banner motd</b> (message of the day) warns everyone who connects. The first character after <code>motd</code> is a <b>delimiter</b>: the banner ends at the next copy of it. Pick one, like <b>#</b>, that is not in your message.',
    check:d=>!!d.banner},
   {goal:'Return to Privileged EXEC', cmd:'end', hint:'Three letters (or Ctrl+Z).', why:'Configuration done. <b>end</b> jumps back to Privileged EXEC so you can verify and save.', check:d=>d.mode==='priv'},
   {goal:'Verify your configuration', cmd:'show running-config', hint:'sh run',
    why:'Always verify. Look for <code>hostname S1</code>, <code>enable secret 9 …</code>, the <code>password 7 …</code> lines (now encrypted), <code>login</code> under each line, and your banner.',
    check:(d,ev)=>ok(d,ev,'show-run')},
   {goal:'Save the configuration to NVRAM', cmd:'copy running-config startup-config', hint:'copy &lt;source&gt; &lt;destination&gt; — then press Enter to accept the filename.',
    why:'Everything so far lives only in RAM. <b>copy running-config startup-config</b> saves it to NVRAM so it survives a reboot. IOS asks for a destination filename. Just press <b>Enter</b> to accept the default shown in [brackets].',
    check:d=>d.startup&&d.savedRev===d.rev}
  ]},
 {id:'svi', m:2, device:'switch', title:'Switch Management Address (SVI)', blurb:'Give a switch an IP address on VLAN 1, a default gateway, then verify with show and ping.',
  preset:d=>{ d.hostname='S1'; }, hosts:['192.168.1.1','192.168.1.10'], cabled:['FastEthernet0/1'],
  scenario:'Admins need to reach S1 over the network. Put the management address on the <b>VLAN 1 SVI</b>: <b>192.168.1.2 /24</b> (mask 255.255.255.0) with default gateway <b>192.168.1.1</b>. Then test it.',
  recap:'interface vlan 1 · ip address + mask · no shutdown · ip default-gateway · show ip interface brief · ping. Switches get ONE management IP on an SVI, not on their ports.',
  steps:[
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'en', why:'Start where every config starts.', check:d=>d.mode!=='user'},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'conf t', why:'Interfaces are selected from Global Config.', check:d=>['config','line','if'].includes(d.mode)},
   {goal:'Select the VLAN 1 switch virtual interface', cmd:'interface vlan 1', hint:'interface &lt;type&gt; &lt;number&gt;',
    why:'A switch\'s ports work at Layer 2, so they do not get IP addresses. Instead you give the switch a <b>switch virtual interface (SVI)</b>: a virtual interface with no physical port. VLAN 1 is the default SVI. The prompt becomes <code>(config-if)#</code>.',
    check:d=>d.mode==='if'&&d.iface==='Vlan1'},
   {goal:'Assign 192.168.1.2 with mask 255.255.255.0', cmd:'ip address 192.168.1.2 255.255.255.0', hint:'ip address &lt;address&gt; &lt;subnet mask&gt;',
    why:'<b>ip address</b> takes the IPv4 address, then the subnet mask in <b>dotted decimal</b>. IOS does not accept <code>/24</code> here; /24 = 255.255.255.0.',
    check:d=>d.ifs.Vlan1.ip==='192.168.1.2'&&d.ifs.Vlan1.mask==='255.255.255.0'},
   {goal:'Turn the interface on', cmd:'no shutdown', hint:'"no" + the command that turns an interface off.',
    why:'SVIs start <b>administratively down</b>. <b>no shutdown</b> enables the interface. In IOS, putting <b>no</b> in front of a command reverses it.',
    check:d=>!d.ifs.Vlan1.shut},
   {goal:'Go back to Global Config', cmd:'exit', hint:'One level up.', why:'The default gateway is a device-wide (global) setting, so step back out of the interface.', check:d=>d.mode==='config'},
   {goal:'Set the default gateway to 192.168.1.1', cmd:'ip default-gateway 192.168.1.1', hint:'ip default-gateway &lt;router address&gt;',
    why:'A switch is not a router. To reply to an admin on a <i>different</i> network, it needs a <b>default gateway</b>: the router on its subnet, exactly like a PC does.',
    check:d=>d.gateway==='192.168.1.1'},
   {goal:'Return to Privileged EXEC', cmd:'end', hint:'end', why:'Time to verify.', check:d=>d.mode==='priv'},
   {goal:'Check the interface status', cmd:'show ip interface brief', hint:'sh ip int br',
    why:'Find <b>Vlan1</b>: it should show 192.168.1.2 with Status <b>up</b> and Protocol <b>up</b>.', check:(d,ev)=>ok(d,ev,'show-ipib')},
   {goal:'Ping the default gateway 192.168.1.1', cmd:'ping 192.168.1.1', hint:'ping &lt;address&gt;',
    why:'<b>ping</b> sends 5 ICMP echo requests. <b>!</b> = reply, <b>.</b> = timed out. The first one often times out because the switch has to <b>ARP</b> for the gateway\'s MAC address first.',
    check:d=>d.lastPing},
   {goal:'Save the configuration', cmd:'copy running-config startup-config', hint:'copy run start, then Enter', why:'Save to NVRAM so the address survives a reboot.', check:d=>d.startup&&d.savedRev===d.rev}
  ]},
 {id:'router', m:10, device:'router', title:'Router Interfaces', blurb:'Name and secure a router, then address and enable its LAN (IPv4 + IPv6) and WAN interfaces.',
  hosts:['192.168.10.10'], cabled:['GigabitEthernet0/0/0','GigabitEthernet0/0/1'],
  scenario:'Configure <b>R1</b> (enable secret <b>class</b>).<br>G0/0/0 (LAN): description <b>Link to LAN</b>, <b>192.168.10.1 /24</b>, IPv6 <b>2001:db8:acad:10::1/64</b>.<br>G0/0/1 (WAN to ISP): <b>209.165.200.225 /30</b> (mask 255.255.255.252).',
  recap:'interface g0/0/x · description · ip address · ipv6 address · no shutdown (router interfaces start OFF!) · show ip interface brief · copy run start. The LAN interface address becomes the default gateway for the PCs.',
  steps:[
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'en', why:'Routers use exactly the same IOS modes as switches. Notice the prompt says <code>Router&gt;</code>.', check:d=>d.mode!=='user'},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'conf t', why:'Global Config.', check:d=>['config','line','if'].includes(d.mode)},
   {goal:'Name the router R1', cmd:'hostname R1', hint:'hostname &lt;name&gt;', why:'Same command as on a switch.', check:d=>d.hostname.toLowerCase()==='r1'},
   {goal:'Set the enable secret to "class"', cmd:'enable secret class', hint:'enable secret &lt;password&gt;', why:'Protect Privileged EXEC with a strongly encrypted secret.', check:d=>!!d.enableSecret},
   {goal:'Select the LAN interface GigabitEthernet0/0/0', cmd:'interface g0/0/0', hint:'interface &lt;type+slot/subslot/port&gt; — g is short for GigabitEthernet',
    why:'Select an interface with <b>interface</b> + its type and number. <code>g0/0/0</code> is short for <b>GigabitEthernet0/0/0</b> (slot/subslot/port). Unlike switch ports, router ports are Layer 3 and take IP addresses directly.',
    check:d=>d.mode==='if'&&d.iface==='GigabitEthernet0/0/0'},
   {goal:'Describe it as "Link to LAN"', cmd:'description Link to LAN', hint:'description &lt;text&gt;',
    why:'A <b>description</b> documents what the link connects to. It appears in show commands and saves time when troubleshooting later.', check:d=>!!d.ifs['GigabitEthernet0/0/0'].desc},
   {goal:'Give it 192.168.10.1 /24', cmd:'ip address 192.168.10.1 255.255.255.0', hint:'ip address &lt;address&gt; &lt;mask&gt; (/24 = 255.255.255.0)',
    why:'This address will be the <b>default gateway</b> for every PC on the 192.168.10.0/24 LAN.', check:d=>d.ifs['GigabitEthernet0/0/0'].ip==='192.168.10.1'},
   {goal:'Add the IPv6 address 2001:db8:acad:10::1/64', cmd:'ipv6 address 2001:db8:acad:10::1/64', hint:'ipv6 address &lt;address&gt;/&lt;prefix length&gt;',
    why:'IPv6 is entered with the <b>prefix length after a slash</b>, not a mask. (A real router also needs <code>ipv6 unicast-routing</code> in Global Config to forward IPv6 between networks.)',
    check:d=>d.ifs['GigabitEthernet0/0/0'].v6.includes('2001:db8:acad:10::1/64')},
   {goal:'Turn the interface on', cmd:'no shutdown', hint:'no + shutdown',
    why:'<b>Router interfaces are shut down by default.</b> Forgetting <b>no shutdown</b> is the most common router mistake. Watch for the <code>%LINK-5-CHANGED … up</code> message.', check:d=>!d.ifs['GigabitEthernet0/0/0'].shut},
   {goal:'Select the WAN interface GigabitEthernet0/0/1', cmd:'interface g0/0/1', hint:'interface …',
    why:'You can jump straight to another interface without typing exit first.', check:d=>d.mode==='if'&&d.iface==='GigabitEthernet0/0/1'},
   {goal:'Give it 209.165.200.225 /30', cmd:'ip address 209.165.200.225 255.255.255.252', hint:'/30 = 255.255.255.252',
    why:'A <b>/30</b> (255.255.255.252) has exactly <b>2 usable addresses</b>: one for you and one for the ISP. That makes it perfect for a point-to-point link.', check:d=>d.ifs['GigabitEthernet0/0/1'].ip==='209.165.200.225'},
   {goal:'Turn this interface on too', cmd:'no shutdown', hint:'no shut', why:'Every router interface needs its own <b>no shutdown</b>.', check:d=>!d.ifs['GigabitEthernet0/0/1'].shut},
   {goal:'Return to Privileged EXEC', cmd:'end', hint:'end', why:'Back to verify.', check:d=>d.mode==='priv'},
   {goal:'Verify both interfaces are up/up', cmd:'show ip interface brief', hint:'sh ip int br', why:'Both G0/0/0 and G0/0/1 should show their IPs and <b>up up</b>. Serial0/1/0 stays administratively down because you never enabled it.', check:(d,ev)=>ok(d,ev,'show-ipib')},
   {goal:'Save the configuration', cmd:'copy running-config startup-config', hint:'copy run start, then Enter', why:'Save it to NVRAM.', check:d=>d.startup&&d.savedRev===d.rev}
  ]},
 {id:'ssh', m:16, device:'router', title:'Secure Remote Access with SSH', blurb:'Domain name, local user, RSA keys, SSH-only VTY lines with login local, and brute-force protection.',
  scenario:'Allow admins to manage the router remotely <b>only over SSH</b> (encrypted). Hostname <b>R1</b> · domain <b>netacad.local</b> · user <b>admin</b> with secret <b>Str0ngPass</b> · RSA key <b>1024</b> bits · VTY 0-4 · block logins for <b>120</b> s after <b>3</b> failures within <b>60</b> s.',
  recap:'hostname + ip domain-name → crypto key generate rsa → username … secret … → line vty: transport input ssh + login local → login block-for. These are the SSH steps from Module 16 (and a classic exam question!).',
  steps:[
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'en', why:'Start in Privileged EXEC.', check:d=>d.mode!=='user'},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'conf t', why:'All the SSH settings are configured from here.', check:d=>['config','line','if'].includes(d.mode)},
   {goal:'Name the router R1', cmd:'hostname R1', hint:'hostname &lt;name&gt;',
    why:'SSH needs an <b>RSA key pair</b>, and the key\'s name is built from <b>hostname.domain</b>. IOS refuses to make keys while the hostname is still the default "Router".', check:d=>d.hostname.toLowerCase()==='r1'},
   {goal:'Set the domain name netacad.local', cmd:'ip domain-name netacad.local', hint:'ip domain-name &lt;domain&gt;',
    why:'The second half of the key name. The keys will be called <code>R1.netacad.local</code>.', check:d=>!!d.domain},
   {goal:'Create the local user admin with secret Str0ngPass', cmd:'username admin secret Str0ngPass', hint:'username &lt;name&gt; secret &lt;password&gt;',
    why:'With SSH, each admin logs in with a <b>username and password</b>, checked against this <b>local user database</b>. Use <code>secret</code> (strong encryption) rather than <code>password</code>.', check:d=>Object.keys(d.users).length>0},
   {goal:'Generate a 1024-bit RSA key pair', cmd:'crypto key generate rsa', hint:'crypto key generate &lt;key type&gt; — then answer the modulus question with 1024',
    why:'This creates the RSA keys SSH uses for encryption. IOS will ask <i>"How many bits in the modulus [512]"</i>: type <b>1024</b> and press Enter. Keys under 768 bits cannot run SSH version 2. When it works, IOS reports that SSH is enabled.',
    check:d=>d.rsa>=1024},
   {goal:'Select VTY lines 0 to 4', cmd:'line vty 0 4', hint:'line vty &lt;first&gt; &lt;last&gt;', why:'Remote logins arrive on the VTY lines.', check:d=>d.mode==='line'&&d.line==='vty'},
   {goal:'Allow ONLY SSH on these lines', cmd:'transport input ssh', hint:'transport input &lt;protocol&gt;',
    why:'<b>transport input ssh</b> blocks Telnet, which sends everything (including passwords) in <b>plain text</b>.', check:d=>d.lines.vty.transport==='ssh'},
   {goal:'Use the local user database to log in', cmd:'login local', hint:'login &lt;where are the accounts?&gt;',
    why:'<b>login local</b> makes the lines ask for a username and password from the local database, instead of one shared line password.', check:d=>d.lines.vty.local},
   {goal:'Go back to Global Config', cmd:'exit', hint:'exit', why:'The next command is global.', check:d=>d.mode==='config'},
   {goal:'Block logins for 120 s after 3 failures within 60 s', cmd:'login block-for 120 attempts 3 within 60', hint:'login block-for &lt;seconds&gt; attempts &lt;tries&gt; within &lt;seconds&gt;',
    why:'This slows down <b>brute-force</b> password guessing: after 3 failed logins within 60 seconds, all logins are blocked for 120 seconds.', check:d=>!!d.blockFor},
   {goal:'Return to Privileged EXEC', cmd:'end', hint:'end', why:'Time to verify.', check:d=>d.mode==='priv'},
   {goal:'Verify SSH is enabled', cmd:'show ip ssh', hint:'show ip &lt;protocol&gt;', why:'You should see <b>SSH Enabled - version 2.0</b>.', check:(d,ev)=>ok(d,ev,'show-ssh')},
   {goal:'Save the configuration', cmd:'copy running-config startup-config', hint:'copy run start, then Enter', why:'Save it to NVRAM.', check:d=>d.startup&&d.savedRev===d.rev}
  ]},
 {id:'fix', m:17, device:'router', title:'Troubleshoot: LAN Can\'t Reach R1', blurb:'Use show commands to find a fault, fix it, and prove the fix with ping.',
  preset:d=>{ d.hostname='R1'; Object.assign(d.ifs['GigabitEthernet0/0/0'],{ip:'192.168.10.1',mask:'255.255.255.0',desc:'Link to LAN',shut:true}); },
  hosts:['192.168.10.10'], cabled:['GigabitEthernet0/0/0'],
  scenario:'Users on the <b>192.168.10.0/24</b> LAN cannot reach their gateway, R1 (192.168.10.1). Investigate, fix the fault, and prove it works by pinging the PC at <b>192.168.10.10</b>.',
  recap:'Look (show ip interface brief) → spot "administratively down" → fix (interface + no shutdown) → test (ping) → save. That is the troubleshooting method from Module 17: gather information, fix, verify, document.',
  steps:[
   {goal:'Enter Privileged EXEC mode', cmd:'enable', hint:'en', why:'Troubleshooting starts by getting enough access to look around.', check:d=>d.mode!=='user'},
   {goal:'Gather information: check every interface', cmd:'show ip interface brief', hint:'sh ip int br',
    why:'Start with the big picture. Find <b>GigabitEthernet0/0/0</b>. Its IP address is correct, but read the <b>Status</b> column. <b>administratively down</b> means the interface was turned off with <code>shutdown</code> (or never turned on).', check:(d,ev)=>ok(d,ev,'show-ipib')},
   {goal:'Enter Global Configuration mode', cmd:'configure terminal', hint:'conf t', why:'To fix it you need to change the configuration.', check:d=>['config','line','if'].includes(d.mode)},
   {goal:'Select the broken interface G0/0/0', cmd:'interface g0/0/0', hint:'interface …', why:'Select the interface you found in the output.', check:d=>d.mode==='if'&&d.iface==='GigabitEthernet0/0/0'},
   {goal:'Fix it: enable the interface', cmd:'no shutdown', hint:'Reverse the shutdown.', why:'<b>no shutdown</b> brings it back up. Watch for the up/up messages.', check:d=>!d.ifs['GigabitEthernet0/0/0'].shut},
   {goal:'Return to Privileged EXEC', cmd:'end', hint:'end', why:'Now test your fix.', check:d=>d.mode==='priv'},
   {goal:'Verify: ping the PC at 192.168.10.10', cmd:'ping 192.168.10.10', hint:'ping &lt;address&gt;',
    why:'Proof beats assumptions. Expect <code>.!!!!</code>: the first echo times out while R1 uses <b>ARP</b> to learn the PC\'s MAC address, then the rest succeed.', check:d=>d.lastPing},
   {goal:'Document & save the fix', cmd:'copy running-config startup-config', hint:'copy run start, then Enter', why:'Save it so the fix survives a reboot. (In real life, also write down what you found and changed.)', check:d=>d.startup&&d.savedRev===d.rev}
  ]}
];
const LAB_MODS = [...new Set(LABS.map(l=>l.m))];

/* ---------------------------------------------------------------- command reference */
const REF = [
 ['Getting around',[['?','List the commands available in the current mode (or after a partial command)'],['Tab','Finish a partly typed word'],['↑ / ↓','Re-use earlier commands'],['enable','User EXEC (>) → Privileged EXEC (#)'],['disable','Privileged EXEC → User EXEC'],['configure terminal','Privileged EXEC → Global Config (config)#'],['exit','Back one level'],['end / Ctrl+Z','Any config mode → Privileged EXEC'],['do <command>','Run a show/EXEC command from inside config mode']]],
 ['Show & test (Privileged EXEC)',[['show running-config','Active config in RAM'],['show startup-config','Saved config in NVRAM'],['show ip interface brief','Every interface: IP, status, protocol'],['show version','Hardware, IOS version, uptime'],['show ip ssh','Is SSH enabled?'],['ping <ip>','! = reply, . = timeout, U = unreachable'],['copy running-config startup-config','Save RAM → NVRAM (press Enter at the prompt)']]],
 ['Global Config  (config)#',[['hostname <name>','Name the device'],['enable secret <pw>','Encrypted Privileged EXEC password'],['service password-encryption','Encrypt plaintext passwords (type 7)'],['banner motd #text#','Login warning message'],['line console 0','Configure the console port'],['line vty 0 15','Configure the remote-access lines (0 4 on many routers)'],['interface <name>','Configure an interface (g0/0/0, f0/1, vlan 1)'],['ip default-gateway <ip>','Gateway for a switch'],['ip domain-name <name>','Domain (needed for SSH keys)'],['username <u> secret <pw>','Local user account'],['crypto key generate rsa','RSA keys for SSH (use 1024+ bits)'],['login block-for <s> attempts <n> within <s>','Slow brute-force logins'],['security passwords min-length <n>','Minimum password length']]],
 ['Line Config  (config-line)#',[['password <pw>','Set the line password'],['login','Ask for the line password'],['login local','Ask for a username/password from the local database'],['transport input ssh','Allow only SSH (no Telnet)'],['exec-timeout <m> <s>','Log out idle sessions'],['logging synchronous','Keep log messages from breaking your typing']]],
 ['Interface Config  (config-if)#',[['ip address <ip> <mask>','IPv4 address (mask in dotted decimal)'],['ipv6 address <addr>/<len>','IPv6 address with prefix length'],['no shutdown','Turn the interface on (router ports start OFF)'],['shutdown','Turn it off'],['description <text>','Document the link']]]
];
function openRef(back){
  const el=openPanel(`<h2>📖 IOS Command Reference</h2><p class="small">Prompt endings tell you the mode: <code>&gt;</code> User EXEC · <code>#</code> Privileged EXEC · <code>(config)#</code> Global · <code>(config-line)#</code> Line · <code>(config-if)#</code> Interface. IOS accepts unique abbreviations: <code>conf t</code>, <code>sh run</code>, <code>int g0/0/0</code>, <code>no shut</code>.</p>`+
    REF.map(([h,rows])=>`<h3 class="refh">${h}</h3><table class="reft">${rows.map(([c,x])=>`<tr><td><code>${esc(c)}</code></td><td>${esc(x)}</td></tr>`).join('')}</table>`).join('')+
    `<div class="row"><button class="pri" id="rback">Back</button></div>`,{full:true});
  el.querySelector('#rback').onclick=()=>{ if(back) back(); else closePanel(); };
}

/* ---------------------------------------------------------------- lab picker */
function openLabs(focusMod){
  S.labs=S.labs||{};
  const sorted=LABS.slice().sort((a,b)=>(b.m===focusMod)-(a.m===focusMod));
  const rows=sorted.map(L=>{
    const st=S.labs[L.id]||{};
    const btns=TIERS.map((t,i)=>{ const unlocked=i===0||st[TIERS[i-1]]; return `<button data-l="${L.id}" data-t="${t}" ${unlocked?'':'disabled'} ${st[t]?'class="donebtn"':''}>${st[t]?'✔ ':unlocked?'':'🔒 '}${TIERNAME[t]}</button>`; }).join('');
    return `<div class="labrow ${focusMod===L.m?'hl':''}"><div><b>${esc(L.title)}</b> <span class="tag">Module ${L.m}</span>${focusMod===L.m?' <span class="tag" style="background:#3a56d4">this realm</span>':''}<div class="small">${esc(L.blurb)}</div></div><div class="row" style="margin-top:6px">${btns}</div></div>`;
  }).join('');
  const el=openPanel(`<h2>💻 Console Lab</h2>
    <p class="small">Learn the Cisco IOS command line one step at a time, with no prior knowledge needed. Each lab has three tiers:<br>
    <b>📘 Learn</b>: every command is shown and explained before you type it. &nbsp;<b>🛠 Practice</b>: you get the goal and an explanation, with hints if you need them. &nbsp;<b>🏆 Challenge</b>: just the goal and the prompt. Finish a tier to unlock the next. Start with <b>IOS Modes &amp; Navigation</b>.</p>
    ${rows}
    <div class="row"><button id="lref">📖 Command reference</button><button class="pri" id="lclose">Close</button></div>`,{full:true});
  el.querySelectorAll('button[data-l]').forEach(b=>b.onclick=()=>{ sfx.click(); startLab(LABS.find(x=>x.id===b.dataset.l),b.dataset.t,focusMod); });
  el.querySelector('#lref').onclick=()=>openRef(()=>openLabs(focusMod));
  el.querySelector('#lclose').onclick=closePanel;
}

/* ---------------------------------------------------------------- lab runner */
function startLab(lab,tier,focusMod){
  const d=newDevice(lab);
  const steps=lab.steps; let step=0, errors=0, assisted=0, hint=0, done=false;
  const hist=[]; let hi=0;
  const el=openPanel(`
   <div class="lab">
    <div class="labtop"><h2 style="margin:0">💻 ${esc(lab.title)} <span class="tag">${TIERNAME[tier]}</span></h2><span style="flex:1"></span><button id="lref">📖 Commands</button><button id="lquit">Leave lab</button></div>
    <div class="modemap" id="mm"></div>
    <div class="labgrid">
      <div class="labsteps"><div class="small">MISSION</div><p class="scen">${lab.scenario}</p><ol id="steps"></ol></div>
      <div class="lesson" id="lesson"></div>
    </div>
    <div class="term" id="term"><div id="tout"></div><div class="inrow"><span id="tprompt"></span><input id="tin" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div></div>
    <div class="tkeys"><button data-k="help">?</button><button data-k="tab">Tab</button><button data-k="up">↑</button><button data-k="down">↓</button><button data-k="ctrlz">Ctrl+Z</button><button data-k="enter" class="pri">Enter ⏎</button></div>
    <div class="small deskkeys">Keys: <kbd>?</kbd> help · <kbd>Tab</kbd> complete a word · <kbd>↑</kbd><kbd>↓</kbd> history · <kbd>Ctrl+Z</kbd> = end · abbreviations like <code>conf t</code> work</div>
   </div>`,{full:true,closable:false,cls:'labpanel'});
  const out=el.querySelector('#tout'), term=el.querySelector('#term'), inp=el.querySelector('#tin'), prm=el.querySelector('#tprompt'),
        lesson=el.querySelector('#lesson'), stepsEl=el.querySelector('#steps'), mm=el.querySelector('#mm');
  const promptStr=()=>d.pending?d.pending.prompt:d.hostname+MODE_SUFFIX[d.mode];
  function line(txt,cls){ const div=document.createElement('div'); if(cls) div.className=cls; if(cls==='tutor') div.innerHTML=txt; else div.textContent=txt; out.appendChild(div); term.scrollTop=term.scrollHeight; }
  const print=t=>String(t).split('\n').forEach(x=>line(x));
  const tutor=html=>{ if(tier!=='challenge') line('💡 '+html,'tutor'); };
  function renderMode(){
    const m=d.mode, cell=(k,label)=>`<span class="${m===k?'on':''}">${label}</span>`;
    mm.innerHTML=cell('user','User EXEC <code>&gt;</code>')+' › '+cell('priv','Privileged EXEC <code>#</code>')+' › '+cell('config','Global Config <code>(config)#</code>')+' › '+cell('line','Line <code>(config-line)#</code>')+' / '+cell('if','Interface <code>(config-if)#</code>');
    prm.textContent=promptStr(); inp.type=d.pending&&d.pending.secret?'password':'text';
  }
  function renderSteps(){
    stepsEl.innerHTML=steps.map((s,i)=>`<li class="${i<step?'sdone':i===step?'scur':''}">${i<step?'✔ ':i===step?'▶ ':''}${s.goal}</li>`).join('');
    const cur=stepsEl.querySelector('.scur'); if(cur) cur.scrollIntoView({block:'nearest'});
  }
  function renderLesson(){
    if(done) return;
    const s=steps[step], n=`Step ${step+1} of ${steps.length}`;
    if(tier==='learn'){
      lesson.innerHTML=`<div class="small">${n}</div><div class="lgoal">${s.goal}</div><div class="lwhy">${s.why}</div><div class="lcmd">Type this, then press Enter:<br><code>${s.cmd}</code></div>`;
    } else if(tier==='practice'){
      lesson.innerHTML=`<div class="small">${n}</div><div class="lgoal">${s.goal}</div><div class="lwhy">${s.why.replace(/<code>[^<]*<\/code>/g,m=>m)}</div>
        ${hint>=1?`<div class="lhint">Syntax: ${s.hint}</div>`:''}${hint>=2?`<div class="lcmd">Answer: <code>${s.cmd}</code></div>`:''}
        <div class="row">${hint<1?'<button id="h1">💡 Syntax hint</button>':''}${hint<2?'<button id="h2">👀 Show the command</button>':''}</div>`;
      const b1=lesson.querySelector('#h1'), b2=lesson.querySelector('#h2');
      if(b1) b1.onclick=()=>{ hint=1; renderLesson(); inp.focus(); };
      if(b2) b2.onclick=()=>{ hint=2; assisted++; renderLesson(); inp.focus(); };
    } else {
      lesson.innerHTML=`<div class="small">${n}</div><div class="lgoal">${s.goal}</div><p class="small">Challenge mode: no hints. Mistakes so far: <b>${errors}</b>. You can still type <b>?</b> for IOS help, just like on real gear.</p>`;
    }
  }
  function check(ev){
    let first=true;
    while(step<steps.length && steps[step].check(d, first?ev:null)){ step++; first=false; hint=0; sfx.good(); }
    renderSteps();
    if(step>=steps.length) finish(); else if(!first) renderLesson();
  }
  function exec(raw){
    const t=raw.trim(); d.last=null; d.lastPing=false;
    if(!t) return null;
    hist.push(t); hi=hist.length;
    let r=resolve(d,t);
    if(r.err){
      errors++;
      if(r.err==='inc'){ line('% Incomplete command.','err'); tutor('That command needs more words. Type it followed by a space and <b>?</b> to see what comes next.'); }
      else if(r.err==='amb'){ line(`% Ambiguous command:  "${t}"`,'err'); tutor('That abbreviation matches more than one command. Type a few more letters (try <b>'+esc(t)+'?</b> to see the options).'); }
      else {
        line(' '.repeat(promptStr().length+r.pos)+'^','err'); line("% Invalid input detected at '^' marker.",'err');
        for(const m of ['user','priv','config','line','if']){ if(m===d.mode) continue; const r2=resolve(d,t,m); if(!r2.err&&r2.e.m.includes(m)){ tutor(`<b>${esc(t)}</b> is a <b>${MODE_NAME[m]}</b> command (prompt ends in <code>${esc(MODE_SUFFIX[m])}</code>), but you are in <b>${MODE_NAME[d.mode]}</b>. ${howTo(d.mode,m)}`); return null; } }
        tutor('IOS does not recognise that here. The <b>^</b> marks where it stopped understanding. Type <b>?</b> to list what this mode accepts, or press <b>Tab</b> to finish a word.');
      }
      if(tier==='challenge') renderLesson();
      return null;
    }
    if(r.sub){ d.mode='config'; d.line=null; d.iface=null; }
    if(r.e.id==='do'){
      const inner=resolve(d,r.args[0],'priv');
      if(inner.err||!inner.e.m.includes('priv')){ errors++; line("% Invalid input detected at '^' marker.",'err'); tutor('<b>do</b> runs an EXEC command such as <b>do show ip interface brief</b>.'); return null; }
      const m=d.mode, ln=d.line, ifc=d.iface; inner.e.run(d,inner.args,print); d.mode=m; d.line=ln; d.iface=ifc; return inner.e.id;
    }
    r.e.run(d,r.args,print);
    return r.e.id;
  }
  function submit(){
    if(done) return;
    const v=inp.value; inp.value='';
    if(d.pending){ const pd=d.pending; d.pending=null; line(pd.prompt+(pd.secret?'':v),'echo'); pd.on(d,v.trim(),print); renderMode(); check(null); return; }
    line(promptStr()+v,'echo');
    const ev=exec(v);
    renderMode(); check(ev);
  }
  function showHelp(){
    const v=inp.value; line(promptStr()+v+'?','echo');
    const h=helpFor(d,v);
    if(!h.items.length&&!h.cr) line('% Unrecognized command','err');
    else { const narrow=term.clientWidth<520; h.items.forEach(([k,ds])=>line(narrow?('  '+k+(ds?'\n      '+ds:'')):('  '+k.padEnd(24)+' '+(ds||'')))); if(h.cr) line('  <cr>'); }
    check(v.trim()===''?'help':'help-partial');
  }
  const KEY = {
    enter(){ submit(); },
    tab(){ if(d.pending) return; const t=complete(d,inp.value); if(t) inp.value=t; else sfx.click(); },
    help(){ if(!d.pending) showHelp(); },
    up(){ if(hi>0){ hi--; inp.value=hist[hi]; } },
    down(){ if(hi<hist.length-1){ hi++; inp.value=hist[hi]; } else { hi=hist.length; inp.value=''; } },
    ctrlz(){ if(['config','line','if'].includes(d.mode)){ line(promptStr()+'^Z','echo'); d.mode='priv'; d.line=null; d.iface=null; renderMode(); check('end'); } }
  };
  inp.addEventListener('keydown',e=>{
    const k = e.key==='Enter'?'enter' : e.key==='Tab'?'tab' : e.key==='?'?'help' : e.key==='ArrowUp'?'up' : e.key==='ArrowDown'?'down' : (e.ctrlKey&&(e.key==='z'||e.key==='Z'))?'ctrlz' : null;
    if(!k || (k==='help'&&d.pending)) return;
    e.preventDefault(); KEY[k]();
  });
  // phone keyboards often skip keydown for '?': catch it from the typed text instead
  inp.addEventListener('input',()=>{ if(!d.pending && inp.value.endsWith('?')){ inp.value=inp.value.slice(0,-1); showHelp(); } });
  el.querySelectorAll('.tkeys button').forEach(b=>{
    b.addEventListener('pointerdown',e=>e.preventDefault());   // keep the on-screen keyboard open
    b.addEventListener('click',()=>{ if(done) return; KEY[b.dataset.k](); inp.focus(); });
  });
  term.addEventListener('click',()=>inp.focus());
  el.querySelector('#lquit').onclick=()=>openLabs(focusMod);
  el.querySelector('#lref').onclick=()=>{
    // show the reference in a pop-over without losing the lab
    const pop=document.createElement('div'); pop.className='refpop';
    pop.innerHTML=REF.map(([h,rows])=>`<h3 class="refh">${h}</h3><table class="reft">${rows.map(([c,x])=>`<tr><td><code>${esc(c)}</code></td><td>${esc(x)}</td></tr>`).join('')}</table>`).join('')+'<div class="row"><button class="pri">Close reference</button></div>';
    pop.querySelector('button').onclick=()=>{ pop.remove(); inp.focus(); };
    el.appendChild(pop);
  };
  function finish(){
    done=true; inp.disabled=true;
    S.labs=S.labs||{}; const st=S.labs[lab.id]=S.labs[lab.id]||{}; const first=!st[tier]; st[tier]=true;
    let [xp,gold]={learn:[20,5],practice:[40,15],challenge:[80,40]}[tier];
    if(!first){ xp=Math.round(xp/4); gold=Math.round(gold/4); }
    const flawless=tier==='challenge'&&errors===0; if(flawless) gold+=20;
    if(first&&tier==='challenge') S.items.shield++;
    S.gold+=gold; const up=addXP(xp); save(); updateHUD(); sfx.win();
    const next=TIERS[TIERS.indexOf(tier)+1];
    lesson.innerHTML=`<div class="lgoal">✅ Lab complete!</div>
      <p>${tier==='challenge'?`Mistakes: <b>${errors}</b>${flawless?' (flawless, +20🪙)':''} · `:''}Commands typed: <b>${hist.length}</b>${assisted?` · answers revealed: <b>${assisted}</b>`:''}</p>
      <p>+${xp} XP, +${gold}🪙${first&&tier==='challenge'?', +1 🛡':''}${up?' <b style="color:var(--acc)">LEVEL UP!</b>':''}</p>
      <div class="lwhy"><b>What you learned:</b> ${lab.recap}</div>
      <div class="row">${next?`<button class="pri" id="lnext">Next: ${TIERNAME[next]} ▶</button>`:''}<button id="lagain">Retry this tier</button><button id="lback">Back to labs</button></div>`;
    const nb=lesson.querySelector('#lnext'); if(nb) nb.onclick=()=>startLab(lab,next,focusMod);
    lesson.querySelector('#lagain').onclick=()=>startLab(lab,tier,focusMod);
    lesson.querySelector('#lback').onclick=()=>openLabs(focusMod);
    renderSteps();
  }
  line(`${d.hostname} con0 is now available`); line('');
  if(tier!=='challenge') tutor('Click in the black terminal and start typing. Press <b>Enter</b> to run a command. Type <b>?</b> any time to see what you can type.');
  renderMode(); renderSteps(); renderLesson(); setTimeout(()=>inp.focus(),50);
}

window.openLabs = openLabs;
window.LAB_MODS = LAB_MODS;
window.CONSOLE_LAB_TEST = {LABS,newDevice,resolve,helpFor,complete,CMDS};
})();
