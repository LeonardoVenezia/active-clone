// Value-based scrubbing, independent of field names. Never retains an Error cause.
export function scrubCompanyValues(value:unknown,secrets:readonly string[]):unknown{
 const needles=[...new Set(secrets.filter(Boolean).flatMap(s=>[s,encodeURIComponent(s),JSON.stringify(s).slice(1,-1),Buffer.from(s).toString('base64')]))].sort((a,b)=>b.length-a.length);
 const scrub=(v:unknown):unknown=>{if(typeof v==='string'){let text=v;for(const needle of needles)text=text.split(needle).join('[REDACTED]');return text}if(Array.isArray(v))return v.map(scrub);if(v instanceof Error)return{message:scrub(v.message),name:v.name};if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[String(scrub(k)),scrub(x)]));return v};return scrub(value)
}
