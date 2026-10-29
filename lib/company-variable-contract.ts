import {validateVariableKey} from './company-variables';
export type VariableDefinition={key:string;label:string;secret:boolean};
// Preview contract only. Role policy remains pending; activation is separately gated.
export function variableWriterPreview(role:string){return role==='owner'||role==='admin'}
export function variableDefinitions(raw:string|undefined,organizationId:string):VariableDefinition[]{
 if(!raw)return[];let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw Error('Invalid variable definitions')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid variable definitions');
 const rows=Object.hasOwn(parsed,organizationId)?(parsed as Record<string,unknown>)[organizationId]:[];
 if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid variable definitions');
 const seen=new Set<string>();return rows.map(row=>{if(!row||typeof row!=='object'||!validateVariableKey(row.key)||typeof row.label!=='string'||!row.label.trim()||row.label.length>100||typeof row.secret!=='boolean'||seen.has(row.key))throw Error('Invalid variable definitions');seen.add(row.key);return{key:row.key,label:row.label,secret:row.secret}})
}
