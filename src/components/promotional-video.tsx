"use client";
import {useState} from "react";
import {promotionalVideoEmbed} from "@/modules/advertisements/appearance";

export function PromotionalVideo({url,title}:{url:string;title:string}) {
  const [playing,setPlaying]=useState(false);
  const embed=promotionalVideoEmbed(url);
  if(!embed)return null;
  return <section className="discovery-section" aria-label="Promotional video"><h2>{title}</h2>{playing?<iframe src={embed} title={title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{display:"block",width:"100%",aspectRatio:"16 / 9",border:0,borderRadius:16}}/>:<div style={{padding:32,borderRadius:16,background:"#0b1647",color:"white"}}><p>Play this video using YouTube. Loading the player connects to an external video service.</p><button className="button secondary" type="button" onClick={()=>setPlaying(true)}>Load video</button></div>}</section>;
}
