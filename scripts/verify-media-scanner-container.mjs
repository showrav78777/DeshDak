import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp,writeFile,rm,access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,dirname } from "node:path";
let docker="docker";
if(process.platform==="darwin"){const bundled="/Applications/Docker.app/Contents/Resources/bin/docker";try{await access(bundled);docker=bundled;}catch{}}
const id=randomBytes(8).toString("hex"),prefix=`deshdak-scanner-test-${id}`,engine=`${prefix}-engine`,app=`${prefix}-app`,network=`${prefix}-network`,image=`${prefix}:scanner`,engineImage=`${prefix}:engine`;
const directory=await mkdtemp(join(tmpdir(),"deshdak-scanner-test-"));const containers=[];let createdNetwork=false,built=false,engineBuilt=false;
const env={...process.env,PATH:`${dirname(docker)}:${process.env.PATH??""}`};
function run(args,{allowFailure=false,timeout=60_000}={}){const result=spawnSync(docker,args,{encoding:"utf8",env,timeout,maxBuffer:16*1024*1024});if(!allowFailure&&(result.error||result.status!==0))throw new Error(`Scanner container command failed (${args[0]}): ${result.error?.code??result.status}\n${(result.stdout+result.stderr).slice(-2000)}`);return{status:result.status,output:(result.stdout??"")+(result.stderr??"")};}
try{
 const daemon=process.env.DOCKER_HOST||JSON.parse(run(["context","inspect","--format","{{json .Endpoints.docker.Host}}"]).output);
 if(!/^(unix|npipe):/.test(daemon))throw new Error("Scanner acceptance requires a local Docker socket.");
 const token=randomBytes(32).toString("hex"),envFile=join(directory,"scanner.env");
 await writeFile(envFile,`SCANNER_TOKEN=${token}\nCLAMD_HOST=engine.internal\n`,{mode:0o600,flag:"wx"});
 console.log("Building the isolated scanner image and starting official ClamAV (linux/amd64; emulated on ARM hosts).");
 run(["build","-f","services/media-scanner/Dockerfile","-t",image,"."],{timeout:300_000});built=true;
 run(["build","--platform","linux/amd64","-f","services/media-scanner/Engine.Dockerfile","-t",engineImage,"."],{timeout:300_000});engineBuilt=true;
 run(["network","create","--label","deshdak.scanner-acceptance=true",network]);createdNetwork=true;
 containers.push(engine);run(["run","--detach","--platform","linux/amd64","--name",engine,"--label","deshdak.scanner-acceptance=true","--network",network,"--network-alias","engine.internal","--env-file","services/media-scanner/clamd.env","--memory","4g","--cpus","2","--pids-limit","128","--security-opt","no-new-privileges:true",engineImage],{timeout:300_000});
 containers.push(app);run(["run","--detach","--name",app,"--label","deshdak.scanner-acceptance=true","--network",network,"--env-file",envFile,"--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true","--memory","256m","--pids-limit","64","--publish","127.0.0.1::8080",image]);
 const address=run(["port",app,"8080/tcp"]).output.trim();assert.match(address,/^127\.0\.0\.1:\d+$/);const origin=`http://${address}`;
 console.log("Waiting for the engine and fresh definitions; stale or missing definitions cannot pass acceptance.");
 let ready=false;const deadline=Date.now()+240_000;
 while(Date.now()<deadline){try{ready=(await fetch(`${origin}/health/ready`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12_000)})).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,1500));}
 assert(ready,"Scanner did not become ready with fresh definitions. Keep uploads disabled and inspect restricted engine/update logs.");
 const verified=spawnSync(process.execPath,["scripts/verify-media-scanner-engine.mjs"],{env:{...process.env,SCANNER_TEST_BASE_URL:origin,SCANNER_TOKEN:token},encoding:"utf8",timeout:45_000});
 assert.equal(verified.status,0,`Real scanner acceptance failed: ${(verified.stdout+verified.stderr).slice(-1000)}`);console.log(verified.stdout.trim());
 assert.equal(run(["exec",app,"node","-p","process.getuid()" ]).output.trim(),"1000");
 console.log("Scanner container acceptance passed with actual ClamAV. Production TLS/ingress, signature-update operations, image scanning/signing and deployment certification remain required.");
}catch(error){if(containers.includes(engine))console.error(run(["logs","--tail","15",engine],{allowFailure:true}).output);throw error;}
finally{
 let failed=false;
 for(const name of containers.reverse()){run(["rm","-f","-v",name],{allowFailure:true});if(run(["inspect",name],{allowFailure:true}).status===0)failed=true;}
 if(createdNetwork&&run(["network","rm",network],{allowFailure:true}).status!==0)failed=true;
 for(const tag of [...(built?[image]:[]),...(engineBuilt?[engineImage]:[])]){run(["image","rm",tag],{allowFailure:true});if(run(["image","inspect",tag],{allowFailure:true}).status===0)failed=true;}
 await rm(directory,{recursive:true,force:true});if(failed)throw new Error("Owned scanner acceptance resources require cleanup.");
 console.log("Removed owned scanner containers, network, image tag and temporary token file. Shared images/build caches remain.");
}
