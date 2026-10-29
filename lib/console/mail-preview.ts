// Pure previews. No transport credentials, HTTP client, or send operation.
export type NoticeKind='failure'|'connection'|'approval';
export function noticePreview(kind:NoticeKind,workflowName:string){
 const name=workflowName.slice(0,160).replace(/[\r\n]/g,' ');
 const copy={failure:{subject:'Una corrida necesita revisión',body:`Una corrida de ${name} falló. Revisá el historial de tu consola para ver su estado. No vuelvas a iniciarla sin comprobar si dejó acciones parciales.`},connection:{subject:'Una conexión necesita atención',body:`Una conexión usada por ${name} necesita atención. Ingresá a tu consola desde tu dirección habitual y revisá Conexiones. No compartas contraseñas ni tokens por correo.`},approval:{subject:'Tenés una aprobación pendiente',body:`${name} tiene una aprobación pendiente. Revisá la solicitud en tu consola antes de aprobar. Este aviso no ejecuta el workflow.`}};
 return {...copy[kind],delivery:'preview-only' as const};
}
export function dryRunTransport(){
 const previews:{recipient:string;subject:string;body:string}[]=[];
 return {mode:'dry-run' as const,previews,async deliver(message:{recipient:string;subject:string;body:string}){previews.push({...message});return {sent:false,previewed:true};}};
}
