"use client";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";

type Media = {id:string;title:string;width:number;height:number;sizeBytes:number};
export type MediaDestination="logo"|"banner"|`desktop:${number}`|`mobile:${number}`;
export function WebsiteMediaLibrary({onUse,bannerCount}:{onUse:(url:string,kind:MediaDestination)=>void;bannerCount:number}) {
  const [media,setMedia] = useState<Media[]>([]);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [enabled,setEnabled] = useState(false);
  const [search,setSearch] = useState("");
  const [destination,setDestination] = useState<MediaDestination>("logo");
  const [source,setSource] = useState("");
  const [cropping,setCropping] = useState(false);
  const [crop,setCrop] = useState({x:0,y:0,width:100,height:100});
  useEffect(()=>()=>{if(source)URL.revokeObjectURL(source);},[source]);
  async function load() {
    const response = await fetch("/api/v1/admin/website-media",{cache:"no-store"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Library is unavailable. Check that the media migration has been applied.");
    setMedia(result.data.media);setEnabled(result.data.uploadsEnabled);
  }
  useEffect(()=>{let active=true;fetch("/api/v1/admin/website-media",{cache:"no-store"}).then(response=>{if(!response.ok)throw new Error("Unavailable");return response.json();}).then(result=>{if(active){setMedia(result.data.media);setEnabled(result.data.uploadsEnabled);}}).catch(()=>{if(active)setMessage("Library unavailable. Apply the website media migration and reload.");});return()=>{active=false;};},[]);
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;setBusy(true);setMessage("");
    try {
      const data=new FormData(form);
      if(cropping)data.set("crop",JSON.stringify(crop));
      const response=await fetch("/api/v1/admin/website-media",{method:"POST",body:data});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error?.message ?? "Upload failed.");
      form.reset();setSource("");setCropping(false);setCrop({x:0,y:0,width:100,height:100});await load();setMessage("Image uploaded. Choose Use as logo or Add as banner below.");
    }catch(error){setMessage(error instanceof Error?error.message:"Upload could not be confirmed. Reload the library before retrying.");}
    finally{setBusy(false);}
  }
  async function remove(id:string) {
    if(!window.confirm("Delete this image permanently? Images used by website appearance cannot be deleted."))return;
    setBusy(true);
    try{const response=await fetch(`/api/v1/admin/website-media/${id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??"Deletion failed.");await load();setMessage("Unused image deleted.");}
    catch(error){setMessage(error instanceof Error?error.message:"Deletion could not be confirmed.");}finally{setBusy(false);}
  }
  return <section aria-label="Website media library" style={{margin:"24px 0"}}><h3>Image library</h3><p>PNG, JPEG or WebP, up to 8 MB. Images are optimized and metadata is removed. Uploads stay private until used in published appearance.</p>
    <form onSubmit={upload}><fieldset disabled={busy||!enabled}><label>Image title<input name="title" required minLength={2} maxLength={120}/></label><label>Image file<input name="file" type="file" required accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];setSource(file?URL.createObjectURL(file):"");setCropping(false);setCrop({x:0,y:0,width:100,height:100});}}/></label>
    {source?<section aria-label="Image crop preview"><label><input type="checkbox" checked={cropping} onChange={event=>setCropping(event.target.checked)}/> Crop before upload</label><p>The highlighted area is kept. Values are percentages of the original image. The server validates the final crop.</p>
      <div style={{position:"relative",maxWidth:500,margin:"12px 0"}}>{/* eslint-disable-next-line @next/next/no-img-element -- local blob preview retains the source aspect ratio */}
      <img src={source} alt="Selected image crop preview" style={{display:"block",width:"100%",height:"auto",opacity:cropping?.45:1}}/>{cropping?<div aria-hidden="true" style={{position:"absolute",left:`${crop.x}%`,top:`${crop.y}%`,width:`${crop.width}%`,height:`${crop.height}%`,border:"3px solid #167b9c",boxSizing:"border-box",background:"#ffffff22"}}/>:null}</div>
      {cropping?<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>{(["x","y","width","height"] as const).map(field=><label key={field}>{({x:"Crop left (%)",y:"Crop top (%)",width:"Crop width (%)",height:"Crop height (%)"})[field]}<input type="number" min={field==="x"||field==="y"?0:1} max={100} required value={crop[field]} onChange={event=>setCrop({...crop,[field]:Number(event.target.value)})}/></label>)}</div>:null}
      {cropping&&(crop.x+crop.width>100||crop.y+crop.height>100)?<p role="alert">Crop extends outside the image. Reduce the width or height.</p>:null}
    </section>:null}<button type="submit" disabled={cropping&&(crop.x+crop.width>100||crop.y+crop.height>100)}>{busy?"Working…":"Upload image"}</button></fieldset></form>
    {!enabled?<p>Uploads are unavailable until storage tables and production security scanning are configured.</p>:null}
    <label>Search images<input value={search} onChange={event=>setSearch(event.target.value)}/></label><button type="button" disabled={busy} onClick={()=>void load().catch(()=>setMessage("Library could not be refreshed."))}>Refresh library</button>
    <label htmlFor="website-media-destination">Apply selected image to</label><select id="website-media-destination" value={destination} onChange={event=>setDestination(event.target.value as MediaDestination)}><option value="logo">Website logo</option><option value="banner">New homepage banner</option>{Array.from({length:bannerCount},(_,index)=><optgroup key={index} label={`Banner ${index+1}`}><option value={`desktop:${index}`}>Banner {index+1} — desktop image</option><option value={`mobile:${index}`}>Banner {index+1} — mobile image</option></optgroup>)}</select><p>Choose a destination, then select Use selected location on an image. Preview and publish the appearance changes when ready.</p>
    <p role="status">{message}</p><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))",gap:16}}>{media.filter(item=>item.title.toLowerCase().includes(search.toLowerCase())).map(item=><article key={item.id} style={{border:"1px solid #dce5ee",padding:12,borderRadius:12}}>
      <Image unoptimized src={`/api/v1/website-media/${item.id}`} alt={item.title} width={240} height={140} style={{width:"100%",height:"auto",aspectRatio:"12 / 7",objectFit:"contain"}}/><h4>{item.title}</h4><p>{item.width} × {item.height} · {Math.ceil(item.sizeBytes/1024)} KB</p><div style={{display:"flex",flexWrap:"wrap",gap:8}}><button disabled={busy} type="button" onClick={()=>onUse(`/api/v1/website-media/${item.id}`,"logo")}>Use as logo</button><button disabled={busy} type="button" onClick={()=>onUse(`/api/v1/website-media/${item.id}`,"banner")}>Add as banner</button><button disabled={busy} type="button" onClick={()=>void remove(item.id)}>Delete unused image</button></div>
      <button disabled={busy} type="button" onClick={()=>onUse(`/api/v1/website-media/${item.id}`,destination)}>Use selected location</button>
    </article>)}</div>
  </section>;
}
