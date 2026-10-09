import { NextResponse } from "next/server";
import { handleMailEvent, signatureValid } from "@/lib/mail-flow";
export const maxDuration = 300;
export async function POST(r: Request) {
 if(Number(r.headers.get("content-length")||0)>1024*1024)return new NextResponse(null,{status:413});
 const raw=await r.text();if(raw.length>1024*1024)return new NextResponse(null,{status:413});
 if(!signatureValid(r.headers,raw))return NextResponse.json({error:"Invalid signature."},{status:401});
 try{return NextResponse.json(await handleMailEvent(JSON.parse(raw)));}catch{return NextResponse.json({error:"Event processing incomplete. Retry required."},{status:503});}
}
