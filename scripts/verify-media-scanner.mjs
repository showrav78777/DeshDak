import assert from "node:assert/strict";
import { createServer as tcpServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { createScannerServer, scannerConfiguration } from "../services/media-scanner/server.mjs";
import { clamdCommand, requireFreshDefinitions } from "../services/media-scanner/clamd.mjs";

const token=randomBytes(32).toString("hex"); let mode="clean"; let scanned=0; const inputs=[];
const fresh=()=>`ClamAV 1.4.3/12345/${new Date().toUTCString()}`;
const engine=tcpServer(socket=>{
  let buffered=Buffer.alloc(0); let command=null; let file=Buffer.alloc(0);
  socket.on("error",()=>{});
  socket.on("data",bytes=>{
    buffered=Buffer.concat([buffered,bytes]);
    if(command===null){const end=buffered.indexOf(0);if(end===-1)return;command=buffered.subarray(0,end).toString();buffered=buffered.subarray(end+1);
      if(command==="zVERSION"){
        if(mode==="version-offline"){socket.destroy();return;}
        const value=mode==="stale"?`ClamAV 1.4.3/12345/${new Date(Date.now()-72*60*60_000).toUTCString()}`:fresh();socket.end(value+"\0");return;
      }
      assert.equal(command,"zINSTREAM");
    }
    while(buffered.length>=4){const length=buffered.readUInt32BE();if(buffered.length<length+4)return;const part=buffered.subarray(4,4+length);buffered=buffered.subarray(4+length);
      if(!length){scanned++;inputs.push(file);if(mode==="hang")return;if(mode==="oversized-reply"){socket.end("x".repeat(5000));return;}
        const reply={clean:"stream: OK",infected:"stream: Synthetic.Test FOUND",error:"INSTREAM size limit exceeded. ERROR",malformed:"OK"}[mode]??"stream: OK";
        socket.end(reply+"\0");return;
      }file=Buffer.concat([file,part]);
    }
  });
});
await new Promise(resolve=>engine.listen(0,"127.0.0.1",resolve));
const config={token,host:"127.0.0.1",port:engine.address().port};
const scanner=createScannerServer(config);await new Promise(resolve=>scanner.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${scanner.address().port}`;
const auth={Authorization:`Bearer ${token}`};
const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),randomBytes(130_000)]);
const upload=(headers={},body=bytes)=>fetch(`${origin}/scan`,{method:"POST",headers:{...auth,"Content-Type":"application/octet-stream",...headers},body,duplex:"half"});
try{
  assert.throws(()=>scannerConfiguration({SCANNER_TOKEN:"short"}));assert.throws(()=>scannerConfiguration({SCANNER_TOKEN:token,CLAMD_HOST:"http://evil"}));
  requireFreshDefinitions(fresh());assert.throws(()=>requireFreshDefinitions("ClamAV 1.4.3"));assert.throws(()=>requireFreshDefinitions(`ClamAV 1.4.3/12345/${new Date(Date.now()+60*60_000).toUTCString()}`));
  assert.equal((await fetch(`${origin}/health/live`)).status,200);
  assert.equal((await fetch(`${origin}/health/ready`)).status,401);
  assert.equal((await fetch(`${origin}/health/ready`,{headers:auth})).status,200);
  assert.equal((await upload({Authorization:"Bearer wrong"})).status,401);
  assert.equal((await upload({"Content-Type":"image/png"})).status,415);
  assert.equal((await upload({"Content-Encoding":"gzip"})).status,415);
  assert.equal((await upload({},new Uint8Array())).status,422);
  const clean=await upload();assert.equal(clean.status,200);assert.match(clean.headers.get("cache-control"),/no-store/);assert.deepEqual(await clean.json(),{status:"clean"});assert(inputs.at(-1).equals(bytes),"INSTREAM framing changed uploaded bytes.");
  const archive=await upload({},Buffer.from("PK\x03\x04unsupported archive"));assert.equal(archive.status,415);assert.deepEqual(await archive.json(),{status:"unsupported_media"});
  const digest=createHash("sha256").update(bytes).digest("hex");
  const bound=await upload({"X-Deshdak-Scan-Sha256":digest});assert.equal(bound.status,200);assert.deepEqual(await bound.json(),{status:"clean",sha256:digest});
  assert.equal((await upload({"X-Deshdak-Scan-Sha256":"0".repeat(64)})).status,400);
  for(const [state,status] of [["infected",422],["error",503],["malformed",503],["oversized-reply",503],["stale",503],["version-offline",503]]){mode=state;const response=await upload();assert.equal(response.status,status,state);assert(!JSON.stringify(await response.json()).includes("Synthetic.Test"));}
  mode="clean";const before=scanned;const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));controller.close();}});assert.equal((await upload({},oversized)).status,413);assert.equal(scanned,before,"Oversized body reached engine scan.");
  mode="hang";const abort=new AbortController();const pending=clamdCommand({...config,signal:abort.signal},"INSTREAM",bytes);setTimeout(()=>abort.abort(),30);await assert.rejects(pending);
  // Saturate the two scan slots, then verify readiness/uploads fail closed.
  const a=upload();const b=upload();await new Promise(resolve=>setTimeout(resolve,80));assert.equal((await upload()).status,503);await Promise.all([a,b]).then(responses=>responses.forEach(response=>assert.equal(response.status,503)));
  mode="clean";assert.equal((await upload()).status,200,"Timed-out requests did not release concurrency slots.");
  console.log("Media scanner checks passed: HTTP authentication, exact INSTREAM framing, clean/infected/error outcomes, stale definitions, bounded bodies/replies, timeout/abort, concurrency recovery and secret-free responses. Daemon responses were simulated.");
}finally{scanner.closeAllConnections();await new Promise(resolve=>scanner.close(resolve));await new Promise(resolve=>engine.close(resolve));}
