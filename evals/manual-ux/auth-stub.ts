import {useState} from 'react';
const session={user:{id:'qa-local',isAnonymous:false}};
export const useSession=()=>{const [pending,setPending]=useState(new URLSearchParams(location.search).has('pending'));(window as any).resolveSession=()=>setPending(false);return {data:session,isPending:pending};};
export const authClient={signIn:{anonymous:async()=>({})}};
