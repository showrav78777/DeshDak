import assert from "node:assert/strict";
import sharp from "sharp";
import {processWebsiteImage} from "../src/modules/advertisements/media-processing.ts";
import {readFile} from "node:fs/promises";
import {stripTypeScriptTypes} from "node:module";
import {appearanceSchema,defaultAppearance,promotionalVideoEmbed,bannerIsPublished} from "../src/modules/advertisements/appearance.ts";

// The Next compiler resolves this marker; plain Node has no server-only package.
// Evaluate the unchanged scanner implementation without that compiler marker.
const scannerSource=(await readFile(new URL('../src/modules/advertisements/media-scanner.ts',import.meta.url),'utf8')).replace('import "server-only";','');
const {scanWebsiteMedia,websiteMediaUploadsEnabled}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(scannerSource)).toString('base64')}`);

const original={mode:process.env.NODE_ENV,url:process.env.WEBSITE_MEDIA_SCAN_URL,token:process.env.WEBSITE_MEDIA_SCAN_TOKEN,fetch:globalThis.fetch};
const bytes=await sharp({create:{width:200,height:100,channels:4,background:'#ffbd45'}}).png().toBuffer();
const file=new File([bytes],'../../untrusted.png',{type:'image/png'});
try {
  const result=await processWebsiteImage(file,{x:25,y:10,width:50,height:80});
  assert.equal(result.width,100);assert.equal(result.height,80);
  const metadata=await sharp(result.bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);
  for(const crop of [{x:-1,y:0,width:20,height:20},{x:90,y:0,width:20,height:20},{x:0,y:0,width:0,height:20},{x:0,y:0,width:NaN,height:20}])await assert.rejects(()=>processWebsiteImage(file,crop));
  await assert.rejects(()=>processWebsiteImage(new File(['<svg/>'],'fake.png',{type:'image/png'})));
  await assert.rejects(()=>processWebsiteImage(new File([bytes],'fake.jpg',{type:'image/jpeg'})));
  await assert.rejects(()=>processWebsiteImage(new File([new Uint8Array(8*1024*1024+1)],'large.png',{type:'image/png'})));
  for(const logo of ['javascript:alert(1)','http://example.test/image','https://user:secret@example.test/image','/brand/../private'])assert(!appearanceSchema.safeParse({...defaultAppearance,logo}).success);
  assert.equal(promotionalVideoEmbed('https://youtube.com.evil.test/watch?v=abcdefghijk'),null);
  const now=new Date('2026-11-02T12:00:00Z'), slide=defaultAppearance.slides[0];
  assert(bannerIsPublished(slide,now));
  assert(!bannerIsPublished({...slide,startsAt:'2026-11-03T12:00:00Z'},now));
  assert(!bannerIsPublished({...slide,endsAt:now.toISOString()},now));
  assert(bannerIsPublished({...slide,startsAt:now.toISOString(),endsAt:'2026-11-03T12:00:00Z'},now));
  assert(!appearanceSchema.safeParse({...defaultAppearance,slides:[{...slide,startsAt:'2026-11-03T12:00:00Z',endsAt:now.toISOString()}]}).success);
  process.env.NODE_ENV='production';delete process.env.WEBSITE_MEDIA_SCAN_URL;delete process.env.WEBSITE_MEDIA_SCAN_TOKEN;
  assert.equal(websiteMediaUploadsEnabled(),false);await assert.rejects(()=>scanWebsiteMedia(file));
  process.env.WEBSITE_MEDIA_SCAN_URL='https://scanner.example.test/scan';process.env.WEBSITE_MEDIA_SCAN_TOKEN='synthetic-test-token';
  assert.equal(websiteMediaUploadsEnabled(),true);
  for(const response of [()=>new Response('{"status":"infected"}'),()=>new Response('{"status":"pending"}'),()=>new Response('invalid'),()=>new Response('{}',{status:503}),()=>{throw new Error('Synthetic outage');}]) {
    globalThis.fetch=async()=>response();await assert.rejects(()=>scanWebsiteMedia(file));
  }
  globalThis.fetch=async(url,options)=>{
    assert.equal(url.href,'https://scanner.example.test/scan');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal);
    assert.equal(options.headers.Authorization,'Bearer synthetic-test-token');assert.equal(Buffer.from(options.body).length,file.size);
    return new Response('{"status":"clean"}');
  };
  await scanWebsiteMedia(file);
  process.env.WEBSITE_MEDIA_SCAN_URL='http://scanner.example.test/scan';await assert.rejects(()=>scanWebsiteMedia(file));
  console.log('Website media safety passed: file limits/signatures, crop validation, metadata removal, URL validation and fail-closed production scanner behavior. Scanner responses were synthetic.');
}finally{
  globalThis.fetch=original.fetch;
  for(const [key,value]of [['NODE_ENV',original.mode],['WEBSITE_MEDIA_SCAN_URL',original.url],['WEBSITE_MEDIA_SCAN_TOKEN',original.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
