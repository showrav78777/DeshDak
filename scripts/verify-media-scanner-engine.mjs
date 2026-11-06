import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
const base = new URL(process.env.SCANNER_TEST_BASE_URL ?? "http://invalid");
if (!["localhost","127.0.0.1","[::1]"].includes(base.hostname) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Scanner engine acceptance requires a local disposable scanner URL.");
const token=process.env.SCANNER_TOKEN;
if (!token || token.length<32) throw new Error("Inject the disposable scanner token through the environment.");
const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/octet-stream"};
const ready=await fetch(new URL("/health/ready",base),{headers,signal:AbortSignal.timeout(12_000)});
assert.equal(ready.status,200,"Engine definitions must be available and fresh before acceptance; do not bypass this gate.");
const clean=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
const cleanResponse=await fetch(new URL("/scan",base),{method:"POST",headers,body:clean,signal:AbortSignal.timeout(12_000)});
assert.equal(cleanResponse.status,200);assert.deepEqual(await cleanResponse.json(),{status:"clean"});
// Standard harmless antivirus test string, assembled only in memory. No test
// file is written, and no customer upload or actual malicious sample is used.
const antivirusTest=["X5O!P%@AP[4",String.fromCharCode(92),"PZX54(P^)7CC)7}","$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
const rejected=await fetch(new URL("/scan",base),{method:"POST",headers,body:antivirusTest,signal:AbortSignal.timeout(12_000)});
assert.equal(rejected.status,422);assert.deepEqual(await rejected.json(),{status:"infected"});
// A bounded synthetic ZIP with a 9 MiB benign member must hit the engine's
// 8 MiB internal file limit. The gateway must reject the unsupported archive
// even if an older engine silently returns clean for a truncated ZIP member.
const member=Buffer.alloc(9*1024*1024,65),compressed=deflateRawSync(member),name=Buffer.from("large.txt");
let crc=0xffffffff;for(const byte of member){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(member.length,22);local.writeUInt16LE(name.length,26);
const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(member.length,24);central.writeUInt16LE(name.length,28);
const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
const limited=await fetch(new URL("/scan",base),{method:"POST",headers,body:Buffer.concat([local,name,compressed,central,name,end]),signal:AbortSignal.timeout(12_000)});
assert([415,422].includes(limited.status),"Gateway accepted an unsupported or partially scanned archive.");
assert.deepEqual(await limited.json(),limited.status===415?{status:"unsupported_media"}:{status:"infected"});
console.log("Real-engine scanner acceptance passed: fresh definitions, harmless image accepted, standard antivirus test string and unsupported/oversized-member archive rejected. This is not production deployment or independent malware-detection certification.");
