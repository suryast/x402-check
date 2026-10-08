'use strict';
(function(root){
 const text=x=>typeof x==='string'&&x.length>0&&x.length<=4096;
 function safeUrl(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol))return null;return u.origin+u.pathname;}catch{return null;}}
 function fromPayload(p,url){
  if(!p||![1,2].includes(p.x402Version)||!Array.isArray(p.accepts)||!p.accepts.length||p.accepts.length>100)return null;
  const v=p.x402Version;
  if(v===2&&(!p.resource||!safeUrl(p.resource.url)))return null;
  if(!p.accepts.every(a=>a&&text(a.scheme)&&text(a.network)&&text(a.asset)&&text(a.payTo)&&typeof a[v===2?'amount':'maxAmountRequired']==='string'&&/^\d+$/.test(a[v===2?'amount':'maxAmountRequired'])&&Number.isSafeInteger(a.maxTimeoutSeconds)&&a.maxTimeoutSeconds>0&&(v!==2||/^[a-z0-9-]{3,8}:[a-zA-Z0-9_-]{1,32}$/.test(a.network))&&(v!==1||safeUrl(a.resource))))return null;
  const a=p.accepts[0];if(!safeUrl(url))return null;
  return {url:safeUrl(url),version:v,network:a.network,scheme:a.scheme,amount:a[v===2?'amount':'maxAmountRequired'],asset:a.asset,payTo:a.payTo,resource:safeUrl(v===2?p.resource.url:a.resource),detectedAt:new Date().toISOString(),discoveredVia:'observed-header'};
 }
 function decode(s){if(typeof s!=='string'||s.length>65536||!s.length)return null;try{const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return null;}}
 function detect(status,headers,url){if(status!==402)return null;const h=headers.find(h=>h.name.toLowerCase()==='payment-required')||headers.find(h=>h.name.toLowerCase()==='x-payment-required');if(!h)return null;const p=decode(h.value);if(h.name.toLowerCase()==='x-payment-required'&&p?.x402Version!==1)return null;return fromPayload(p,url);}
 const api={safeUrl,fromPayload,decode,detect};root.X402Protocol=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
