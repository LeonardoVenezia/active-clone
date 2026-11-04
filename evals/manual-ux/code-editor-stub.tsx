// Monaco loads a third-party CDN, excluded from this offline regression.
import React from 'react';
export function CodeEditor({value,onChange,...props}:any){return <textarea aria-label="Code editor fixture" value={value||''} onChange={e=>onChange?.(e.target.value)}/>;}
