import {readCompanyDefinitions} from '@/lib/company/definitions';
import {NextResponse} from 'next/server';
import {consoleContext} from '@/lib/console/context';
import {variableDefinitions,variableWriterPreview} from '@/lib/company-variable-contract';
import {storeCompanyVariable,variableMetadata} from '@/lib/company/variables';
const disabled=()=>NextResponse.json({enabled:false,items:[],policyPending:true},{headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 if(process.env.COMPANY_VARIABLES_PREVIEW_ENABLED!=='true'||process.env.COMPANY_VARIABLES_POLICY_APPROVED!=='true')return disabled();
 try{const ctx=await consoleContext(request);if(!ctx)return NextResponse.json({error:'No autorizado.'},{status:401});if(!variableWriterPreview(ctx.grant.role))return NextResponse.json({error:'Sin acceso a variables.'},{status:403});const defs=await readCompanyDefinitions(ctx.grant.organizationId);const metadata=await variableMetadata(ctx.grant.organizationId);return NextResponse.json({enabled:true,items:defs.map(d=>({...d,configured:metadata.some(m=>m.key===d.key),updatedAt:metadata.find(m=>m.key===d.key)?.updatedAt??null}))},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'No pudimos cargar las variables.'},{status:503})}
}
export async function POST(request:Request){
 if(process.env.COMPANY_VARIABLES_PREVIEW_ENABLED!=='true'||process.env.COMPANY_VARIABLES_POLICY_APPROVED!=='true')return NextResponse.json({error:'La gestión de variables todavía no está habilitada.'},{status:503});
 try{if(!process.env.CONSOLE_ORIGIN||request.headers.get('origin')!==process.env.CONSOLE_ORIGIN)return NextResponse.json({error:'Origen no permitido.'},{status:403});const ctx=await consoleContext(request);if(!ctx||!variableWriterPreview(ctx.grant.role))return NextResponse.json({error:'Sin acceso a variables.'},{status:403});const text=await request.text();if(text.length>12000)return NextResponse.json({error:'Valor demasiado largo.'},{status:413});const body=JSON.parse(text);const def=(await readCompanyDefinitions(ctx.grant.organizationId)).find(d=>d.key===body.key);if(!def||typeof body.value!=='string'||!body.value.trim()||body.value.length>8192)return NextResponse.json({error:'Variable o valor no válido.'},{status:400});await storeCompanyVariable({organizationId:ctx.grant.organizationId,key:def.key,secret:def.secret,value:body.value,actorId:ctx.user.id});return NextResponse.json({saved:true,key:def.key},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'No pudimos guardar la variable.'},{status:503})}
}
