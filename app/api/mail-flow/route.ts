import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { activateFlow, connectSheets, flowStatus, pauseFlow, resumeFlow, retryMail, safeFlowError } from "@/lib/mail-flow";
export const maxDuration = 300;
async function owner(r: Request) { const s = await auth.api.getSession({headers:r.headers}); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
export async function GET(r: Request) {
 const id=await owner(r); if(!id)return NextResponse.json({error:"Sign in first."},{status:401});
 try{return NextResponse.json(await flowStatus(id));}catch(e){return NextResponse.json({error:safeFlowError(e)},{status:503});}
}
export async function POST(r: Request) {
 const origin=r.headers.get("origin"); if(origin!=="https://active-clone.vercel.app" || new URL(r.url).origin!==origin)return NextResponse.json({error:"Invalid origin."},{status:403});
 const id=await owner(r); if(!id)return NextResponse.json({error:"Sign in first."},{status:401});
 try{const b=await r.json();if(b.action==="connect")return NextResponse.json(await connectSheets(id,`${origin}/mail-flow?returned=sheets`));
 if(b.action==="retry" && typeof b.id==="string" && b.id.length<=2048)return NextResponse.json(await retryMail(id,b.id));
 if(b.action==="pause")return NextResponse.json(await pauseFlow(id));
 if(b.action==="resume")return NextResponse.json(await resumeFlow(id));
 if(b.action==="activate" && typeof b.id==="string" && /^ca_[A-Za-z0-9_-]+$/.test(b.id))return NextResponse.json(await activateFlow(id,b.id));
 return NextResponse.json({error:"Unsupported action."},{status:400});}catch(e){return NextResponse.json({error:safeFlowError(e)},{status:503});}
}
