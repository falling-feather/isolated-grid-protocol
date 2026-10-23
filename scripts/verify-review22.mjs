import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Simulation,MODEL_REVISION } from '../src/simulation.ts';
import { compareStrategies } from '../src/evidence.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output','review22');
const files=(await fs.readdir(output)).filter(name=>name.endsWith('-experiment.json')).sort();
const experiments=[];
for(const name of files){
  const data=JSON.parse(await fs.readFile(path.join(output,name),'utf8'));
  const simulation=new Simulation(data.report.config);simulation.advanceTo(simulation.config.duration,true);
  assert.deepEqual(simulation.report(),data.report,name+' report differs');
  assert.deepEqual(simulation.events,data.events,name+' events differ');
  experiments.push({file:name,scenario:data.scenario,revision:data.report.modelRevision,frames:data.report.trace.length,events:data.events.length,success:data.report.success,stars:data.report.stars,metrics:data.report.metrics});
}
const fast=JSON.parse(await fs.readFile(path.join(output,'echo-fast-experiment.json'),'utf8')).report;
const patient=JSON.parse(await fs.readFile(path.join(output,'echo-patient-experiment.json'),'utf8')).report;
assert.ok(compareStrategies(fast,patient));assert.equal(fast.success&&patient.success,true);
assert.deepEqual(fast.trace.map(p=>[p.time,p.frequencyHz,p.batteryKw,p.energyKwh]),patient.trace.map(p=>[p.time,p.frequencyHz,p.batteryKw,p.energyKwh]));
async function inventory(directory){const list=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())list.push(...await inventory(file));else if(!entry.name.endsWith('.map')){const bytes=await fs.readFile(file);list.push({file:path.relative(path.join(root,'dist'),file).split(path.sep).join('/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}return list;}
const distribution=(await inventory(path.join(root,'dist'))).sort((a,b)=>a.file.localeCompare(b.file));
const buildSha256=createHash('sha256').update(distribution.map(f=>f.file+'\0'+f.sha256+'\n').join('')).digest('hex');
const measurements=(await fs.readFile(path.join(output,'screen-evidence.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
for(const entry of measurements){assert.deepEqual(entry.page,entry.size,entry.label+' page exceeds viewport');assert.equal(entry.overflow.length,0,entry.label+' overflows');assert.equal(entry.outside.length,0,entry.label+' has outside controls');}
await fs.writeFile(path.join(output,'screen-evidence.json'),JSON.stringify({date:'2026-10-22',buildSha256,checks:measurements.length,measurements},null,2)+'\n','utf8');
const result={date:'2026-10-22',state:'待验收',runtime:{node:process.version},modelRevision:MODEL_REVISION,buildSha256,distribution,screenChecks:measurements.length,experiments,exportVerification:'从浏览器实际生成的导出链接读取文件内容，保存后逐字段重放。自动化浏览器的原生下载事件未成功返回，系统下载对话仍需人工复核。'};
await fs.writeFile(path.join(output,'build-evidence.json'),JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify({buildSha256,modelRevision:MODEL_REVISION,screenChecks:measurements.length,experiments:experiments.map(({file,frames,events,success,stars})=>({file,frames,events,success,stars}))}));
