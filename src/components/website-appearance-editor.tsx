"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { WebsiteMediaLibrary } from "./website-media-library";
import { PromotionalVideo } from "./promotional-video";
import { appearanceSchema, homepageSectionLabels, defaultHomepageSections, bannerIsPublished, type Appearance } from "@/modules/advertisements/appearance";

function localDate(value?:string) {if(!value)return "";const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}

export function WebsiteAppearanceEditor({ initial, published, version, draftVersion, draftsReady }: { initial: Appearance; published:Appearance; version: number; draftVersion:number;draftsReady:boolean }) {
  const [content, updateContent] = useState(initial);
  const currentContent=useRef(initial);
  const [draftRevision,setDraftRevision]=useState(draftVersion);
  const [dirty,setDirty]=useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const dragIndex=useRef<number|null>(null);
  function setContent(next: Appearance) {
    currentContent.current=next;updateContent(next); setPreview(null); setConfirmed(false);setDirty(true);
  }
  async function saveDraft(discard=false) {
    if(discard&&!window.confirm("Discard the saved draft and return to the published appearance?"))return;
    const parsed=appearanceSchema.safeParse(content);
    if(!discard&&!parsed.success){setMessage(parsed.error.issues[0].message);return;}
    const snapshot=content;setBusy(true);
    try{
      const response=await fetch("/api/v1/admin/website-appearance/draft",{method:discard?"DELETE":"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:draftRevision,...(!discard?{content}: {})})});
      const result=await response.json();
      if(!response.ok){setMessage(result.error?.message??"Draft could not be saved.");return;}
      setDraftRevision(result.data.version);
      if(discard){setContent(published);setDirty(false);setMessage("Saved draft discarded. Published appearance restored in the editor.");}
      else {const newer=currentContent.current!==snapshot;setDirty(newer);setMessage(newer?"Draft saved. Your newer edits still need saving.":"Draft saved securely. The live website has not changed.");}
    }catch{setMessage("Draft change could not be confirmed. Reload before retrying.");}
    finally{setBusy(false);}
  }
  function moveBanner(from:number,to:number) {
    if(busy||from===to||from<0||to<0||from>=content.slides.length||to>=content.slides.length)return;
    const slides=[...content.slides];const [slide]=slides.splice(from,1);slides.splice(to,0,slide);setContent({...content,slides});setMessage(`Banner moved to position ${to+1}. Preview and publish to apply the new order.`);
  }
  const router = useRouter();
  async function publish() {
    if (!confirmed) { setMessage("Review the preview and confirm before publishing."); return; }
    const parsed = appearanceSchema.safeParse(content);
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/website-appearance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, version, draftVersion:draftRevision }) });
      const result = await response.json();
      setMessage(response.ok ? "Website appearance published. Reload the storefront to see it." : result.error?.message ?? "Publishing failed.");
      if (response.ok) { setDraftRevision(0);setDirty(currentContent.current!==content);setConfirmed(false); router.refresh(); }
    } catch { setMessage("Publishing could not be confirmed. Reload before retrying."); }
    finally { setBusy(false); }
  }
  return <section className="advertisement-form"><h2>Logo and homepage banners</h2><p>Enter approved image addresses. Banners appear in the order below and rotate every five seconds. Changes go live after publishing.</p>
    <p role="status">{dirty?"Unsaved appearance changes":draftRevision?"Editing saved draft — not yet published":"Editing published appearance"}</p>
    {!draftsReady?<p role="alert">Apply the website draft migration before saving or publishing appearance.</p>:null}
    <div><button type="button" disabled={busy||!draftsReady} onClick={()=>void saveDraft()}>Save draft</button><button type="button" disabled={busy||!draftRevision||!draftsReady} onClick={()=>void saveDraft(true)}>Discard saved draft</button></div>
    <WebsiteMediaLibrary bannerCount={content.slides.length} onUse={(url,kind)=>{
      if(kind==="logo")setContent({...content,logo:url});
      else if(kind==="banner"){
        if(content.slides.length<10)setContent({...content,slides:[...content.slides,{src:url,alt:"DeshDak promotional banner",title:"",copy:"",enabled:true}]});
        else setMessage("Maximum ten banners. Remove a banner before adding another.");
      }else{
        const [device,rawIndex]=kind.split(":");const index=Number(rawIndex);
        if(!Number.isInteger(index)||!content.slides[index]){setMessage("That banner was removed. Choose another location.");return;}
        setContent({...content,slides:content.slides.map((slide,position)=>position===index?{...slide,[device==="mobile"?"mobileSrc":"src"]:url}:slide)});
      }
    }}/>
    <fieldset disabled={busy} onChange={() => { setPreview(null); setConfirmed(false); }}><label>Website logo<input value={content.logo} onChange={(event) => setContent({ ...content, logo: event.target.value })} /></label>
    {content.slides.map((slide, index) => <fieldset key={index} style={{ margin: "20px 0", padding: 16 }} onDragOverCapture={event=>{if(dragIndex.current!==null&&!busy)event.preventDefault();}} onDropCapture={event=>{if(dragIndex.current===null)return;event.preventDefault();const from=dragIndex.current;dragIndex.current=null;moveBanner(from,index);}}><legend>Banner {index + 1}</legend>
      <button type="button" draggable={!busy} aria-label={`Drag banner ${index+1} to reorder`} onDragStart={event=>{dragIndex.current=index;event.dataTransfer.setData("application/x-deshdak-banner",String(index));event.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{dragIndex.current=null;}}>↕ Drag to reorder</button><p>Or use Move up / Move down below.</p>
      <details><summary>Edit image, text and schedule</summary>
      {(["src", "mobileSrc", "alt", "title", "copy"] as const).map((field) => <label key={field} style={{ display: "grid", gap: 6, marginBottom: 12 }}>{({ src: "Desktop image", mobileSrc: "Mobile image (optional)", alt: "Image description", title: "Overlay heading (optional)", copy: "Overlay message (optional)" })[field]}<input value={slide[field] ?? ""} onChange={(event) => setContent({ ...content, slides: content.slides.map((item, position) => position === index ? { ...item, [field]: event.target.value || (field === "mobileSrc" ? undefined : "") } : item) })} /></label>)}
      <label><input type="checkbox" checked={slide.enabled} onChange={(event) => setContent({ ...content, slides: content.slides.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item) })} /> Visible</label>
      <p>Schedule uses your device’s local time. Leave dates blank for ongoing display. Official default artwork appears when no campaign is currently eligible.</p>
      {(["startsAt","endsAt"] as const).map(field=><label key={field}>{field==="startsAt"?"Publish banner at":"Expire banner at"}<input type="datetime-local" value={localDate(slide[field])} onChange={event=>{const date=event.target.value?new Date(event.target.value):null;if(date&&Number.isNaN(date.getTime()))return;setContent({...content,slides:content.slides.map((item,position)=>position===index?{...item,[field]:date?.toISOString()}:item)});}}/></label>)}
      </details><div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}><button type="button" disabled={index === 0} onClick={() => moveBanner(index,index-1)}>Move up</button><button type="button" disabled={index === content.slides.length-1} onClick={()=>moveBanner(index,index+1)}>Move down</button><button type="button" onClick={() => setContent({ ...content, slides: content.slides.filter((_, position) => position !== index) })}>Remove banner</button></div>
    </fieldset>)}
    <button type="button" disabled={content.slides.length >= 10} onClick={() => setContent({ ...content, slides: [...content.slides, { src: "", alt: "", title: "", copy: "", enabled: false }] })}>Add banner</button>
    <section aria-label="Promotional video settings"><h3>Promotional video</h3><p>Use a video you own or have permission to publish. The player loads only after the visitor chooses to play it.</p>
      {content.video?<><label>Video title<input value={content.video.title} maxLength={160} onChange={event=>setContent({...content,video:{...content.video!,title:event.target.value}})}/></label><label>YouTube video link<input type="url" value={content.video.url} onChange={event=>setContent({...content,video:{...content.video!,url:event.target.value}})}/></label><label><input type="checkbox" checked={content.video.enabled} onChange={event=>setContent({...content,video:{...content.video!,enabled:event.target.checked}})}/> Show promotional video</label><button type="button" onClick={()=>setContent({...content,video:null})}>Remove video</button></>:<button type="button" onClick={()=>setContent({...content,video:{url:"",title:"",enabled:false},sections:content.sections.some(section=>section.id==="promotionVideo")?content.sections:[...content.sections,{id:"promotionVideo",enabled:true}]})}>Add promotional video</button>}
    </section>
    <button type="button" onClick={() => { const parsed = appearanceSchema.safeParse(content); if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; } setPreview(parsed.data); setMessage(""); setConfirmed(false); }}>Preview changes</button>
    <section aria-label="Homepage section management"><h3>Homepage sections</h3><p>Show or hide supported sections and move them into the order customers should see. The main banner and category navigation stay at the top.</p>
      {content.sections.map((section,index)=><div key={section.id} style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:12,margin:"12px 0"}}><label><input type="checkbox" checked={section.enabled} onChange={event=>setContent({...content,sections:content.sections.map((item,position)=>position===index?{...item,enabled:event.target.checked}:item)})}/>{homepageSectionLabels[section.id]}</label><button type="button" disabled={index===0} onClick={()=>{const sections=[...content.sections];[sections[index-1],sections[index]]=[sections[index],sections[index-1]];setContent({...content,sections});}}>Move up</button><button type="button" disabled={index===content.sections.length-1} onClick={()=>{const sections=[...content.sections];[sections[index+1],sections[index]]=[sections[index],sections[index+1]];setContent({...content,sections});}}>Move down</button></div>)}
      <button type="button" onClick={()=>setContent({...content,sections:defaultHomepageSections})}>Reset section order</button>
    </section>
    </fieldset>
    {preview ? <section aria-label="Website appearance preview" style={{ marginTop: 24 }}><h3>Preview before publishing</h3><p>Only enabled banners are shown below. Images must load correctly before you publish.</p>
      <h4>Published section order</h4><ol>{preview.sections.filter(section=>section.enabled).map(section=><li key={section.id}>{homepageSectionLabels[section.id]}</li>)}</ol>
      {preview.video?.enabled?<PromotionalVideo url={preview.video.url} title={preview.video.title}/>:null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button type="button" aria-pressed={!mobilePreview} onClick={() => setMobilePreview(false)}>Desktop preview</button><button type="button" aria-pressed={mobilePreview} onClick={() => setMobilePreview(true)}>Mobile preview</button></div>
      <div style={{ width: mobilePreview ? 375 : "100%", maxWidth: "100%", margin: "16px auto", border: "1px solid #dce5ee", borderRadius: 16, overflow: "hidden", background: "white" }}>
        <div style={{ display: "flex", alignItems: "center", padding: 16, gap: 10 }}><Image unoptimized src={preview.logo} alt="Proposed DeshDak logo" width={40} height={40} /><strong>DeshDak</strong></div>
        {preview.slides.filter((slide) => slide.enabled).map((slide, index) => <article key={index} style={{ position: "relative", background: "#0b1647", marginBottom: 12 }}>
          {!bannerIsPublished(slide)?<p style={{padding:12,color:"white"}}>Scheduled or expired — this banner is not currently displayed.</p>:null}
          <Image unoptimized src={mobilePreview ? slide.mobileSrc ?? slide.src : slide.src} alt={slide.alt} width={1200} height={400} style={{ width: "100%", height: "auto", display: "block" }} />
          {slide.title ? <div style={{ padding: 16, color: "white" }}><h4>{slide.title}</h4><p>{slide.copy}</p></div> : null}
        </article>)}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the artwork and approve these changes for the live website.</label>
      <button className="button primary" disabled={busy || !confirmed || !draftsReady} type="button" onClick={() => void publish()}>{busy ? "Publishing…" : "Publish appearance"}</button>
    </section> : null}<p role="status">{message}</p>
  </section>;
}
