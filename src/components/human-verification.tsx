"use client";

import Script from "next/script";
import {useEffect,useRef,useState} from "react";

export function HumanVerification({ action }: { action: string }) {
  const [siteKey,setSiteKey]=useState<string|null>(null);
  const [ready,setReady]=useState(false);
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{let active=true;fetch("/api/v1/auth/human-verification",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(result=>{if(active&&typeof result?.data?.siteKey==="string")setSiteKey(result.data.siteKey);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{
    const api=(window as Window&{turnstile?:{render:(element:HTMLElement,options:{sitekey:string;action:string})=>string;remove:(id:string)=>void;reset?:(id:string)=>void}}).turnstile;
    if(!ready||!siteKey||!container.current||!api)return;
    const id=api.render(container.current,{sitekey:siteKey,action});
    const form=container.current.closest("form");const reset=()=>api.reset?.(id);
    form?.addEventListener("deshdak:verification-reset",reset);
    return()=>{form?.removeEventListener("deshdak:verification-reset",reset);api.remove(id);};
  },[ready,siteKey,action]);
  if (!siteKey) return <p className="verification-notice">Human verification is enabled automatically in production.</p>;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setReady(true)} /><div ref={container} data-human-verification={action} /></>;
}
