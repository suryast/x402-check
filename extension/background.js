'use strict';
importScripts('protocol.js');
const P=X402Protocol;
let queue=Promise.resolve();
chrome.action.setIcon({path:{16:'icons/icon16.png',32:'icons/icon32.png',48:'icons/icon48.png',128:'icons/icon128.png'}});
chrome.action.setBadgeText({text:'OFF'});
chrome.action.setBadgeBackgroundColor({color:'#ef4444'});
async function badge(tabId,info){await chrome.action.setIcon({tabId,path:Object.fromEntries([16,32,48,128].map(n=>[n,`icons/icon${n}${info?'-active':''}.png`]))});await chrome.action.setBadgeText({tabId,text:info?'x402':'OFF'});await chrome.action.setBadgeBackgroundColor({tabId,color:info?'#22c55e':'#ef4444'});await chrome.action.setTitle({tabId,title:info?`x402 v${info.version} requirements observed (not verified payment)`:'No valid x402 requirements observed'});}
async function status(tabId){return (await chrome.storage.session.get('tab:'+tabId))['tab:'+tabId]||null;}
// Publish observed requirements only after the native toolbar update completes.
// Otherwise session readers can see valid requirements while the badge is still OFF.
async function record(tabId,info){if(!info)await chrome.storage.session.set({['tab:'+tabId]:null});await badge(tabId,info);if(!info)return;await chrome.storage.session.set({['tab:'+tabId]:info});
 const data=await chrome.storage.local.get('discoveries');const list=(data.discoveries||[]).filter(d=>d.url!==info.url);list.unshift({...info,discoveredAt:info.detectedAt});await chrome.storage.local.set({discoveries:list.slice(0,500)});
 const seen=(await chrome.storage.local.get('notifiedUrls')).notifiedUrls||[];
 if(!seen.includes(info.url)){await chrome.storage.local.set({notifiedUrls:[...seen,info.url].slice(-1000)});chrome.notifications.create({type:'basic',iconUrl:'icons/icon48.png',title:'x402 requirements observed',message:`${info.url} — v${info.version}, ${info.amount} atomic units on ${info.network}. Not payment or identity verification.`}).catch(()=>{});}}
// Serialize navigation and header events: no fetch/replay on browsing.
chrome.webRequest.onBeforeRequest.addListener(d=>{if(d.tabId>=0&&d.type==='main_frame')queue=queue.then(()=>record(d.tabId,null)).catch(()=>{});},{urls:['http://*/*','https://*/*']});
chrome.webRequest.onHeadersReceived.addListener(d=>{if(d.tabId>=0&&d.type==='main_frame')queue=queue.then(()=>record(d.tabId,P.detect(d.statusCode,d.responseHeaders||[],d.url))).catch(()=>{});},{urls:['http://*/*','https://*/*']},['responseHeaders']);
chrome.tabs.onRemoved.addListener(id=>chrome.storage.session.remove('tab:'+id));
chrome.runtime.onInstalled.addListener(()=>{chrome.storage.local.remove(['discoveries','notifiedUrls']);});
async function probe(url){const u=new URL(url);if(!P.safeUrl(url)||u.username||u.password)return null;const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(response.status!==402)return null;
 const headers=[...response.headers].map(([name,value])=>({name,value}));const found=P.detect(402,headers,url);if(found)return found;
 // Explicit user probe can inspect legacy JSON body; never replay automatically.
 if(Number(response.headers.get('content-length'))>65536)return null;
 const reader=response.body.getReader();let size=0,chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return null;}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}const payload=JSON.parse(new TextDecoder().decode(bytes));return payload.x402Version===1?P.fromPayload(payload,url):null;}
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(s.id!==chrome.runtime.id)return false;(async()=>{
 await queue;
 if(m.type==='GET_TAB_STATUS')return {x402Info:await status(m.tabId)};
 if(m.type==='GET_DISCOVERIES')return {discoveries:(await chrome.storage.local.get('discoveries')).discoveries||[]};
 if(m.type==='PROBE_URL'){const tab=await chrome.tabs.get(m.tabId);if(tab.url!==m.url)return {result:null};const result=await probe(tab.url);queue=queue.then(()=>record(tab.id,result));await queue;return {result};}
 if(m.type==='OPEN_A2ALIST'){await chrome.tabs.create({url:'https://a2alist.ai'});return {ok:true};}
 return {};})().then(reply).catch(()=>reply({result:null}));return true;});
