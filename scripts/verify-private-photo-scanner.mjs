import assert from "node:assert/strict";
import { randomBytes,createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const code=(await readFile(new URL("../src/modules/private-storage/photo-scanner.ts",import.meta.url),"utf8")).replace('import "server-only";',"");
const {createPrivatePhotoScanner}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`);
const config={url:"https://private-scanner.example.test/scan",token:randomBytes(32).toString("hex")};const bytes=Buffer.from("SYNTHETIC_PRIVATE_IMAGE"),sha=createHash("sha256").update(bytes).digest("hex");
for(const patch of [{url:"http://private.test/scan"},{url:"https://user:pass@private.test/scan"},{url:"https://private.test/scan?token=x"},{url:"https://private.test/scan#x"},{token:"short"},{token:config.token+"\0"},{token:config.token+"\u007f"}])assert.throws(()=>createPrivatePhotoScanner({...config,...patch}));
const scan=createPrivatePhotoScanner(config,async(url,options)=>{assert.equal(String(url),config.url);assert.equal(options.redirect,"error");assert.equal(options.cache,"no-store");assert.equal(options.headers.Authorization,`Bearer ${config.token}`);assert.equal(options.headers["X-Deshdak-Scan-Sha256"],sha);assert(Buffer.from(options.body).equals(bytes));return Response.json({status:"clean",sha256:sha});});
const proof=await scan(bytes);assert.equal(proof.sha256,sha);assert(proof.verifiedAt instanceof Date);
for(const [body,status] of [[{status:"clean"},200],[{status:"infected",sha256:sha},200],[{status:"pending",sha256:sha},200],[{status:"clean",sha256:"0".repeat(64)},200],[{status:"clean",sha256:sha,provider:"PRIVATE_INTERNAL"},200],[{status:"clean",sha256:sha},503]]){
 await assert.rejects(()=>createPrivatePhotoScanner(config,async()=>Response.json(body,{status}))(bytes),error=>error.message==="PRIVATE_PHOTO_SCAN_FAILED");
}
for(const response of [()=>new Response("not-json",{headers:{"Content-Type":"application/json"}}),()=>new Response("x".repeat(3000),{headers:{"Content-Type":"application/json"}}),()=>new Response(JSON.stringify({status:"clean",sha256:sha}),{headers:{"Content-Type":"text/plain"}}),()=>{throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");}])await assert.rejects(()=>createPrivatePhotoScanner(config,async()=>response())(bytes),error=>error.message==="PRIVATE_PHOTO_SCAN_FAILED");
let cancelled=false;await assert.rejects(()=>createPrivatePhotoScanner(config,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(3000));},cancel(){cancelled=true;}}),{headers:{"Content-Type":"application/json"}}))(bytes));assert(cancelled);
console.log("Private scanner client passed: mandatory HTTPS/token, exact digest-bound clean acknowledgement, no development bypass, bounded responses, cancellation and redacted failures. Scanner responses were simulated.");
