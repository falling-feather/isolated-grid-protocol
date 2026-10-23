import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { createMissionDesign,missionConfig } from '../src/campaign.ts';
function trial(id,protocol){const d=createMissionDesign(id);Object.assign(d.protocol,protocol);const s=new Simulation(missionConfig(id,d));s.advanceTo(s.config.duration,true);return s;}
test('快速重试与等待遥测均可通过，但确认等待与报文代价不同',()=>{
 const fast=trial('echo',{deduplicate:true,retryPolicy:'retry',retryAfter:2});
 const patient=trial('echo',{deduplicate:false,retryPolicy:'observe',retryAfter:2});
 const a=fast.report(),b=patient.report();
 assert.equal(a.success,true);assert.equal(b.success,true);assert.equal(a.stars,3);assert.equal(b.stars,3);
 assert.equal(a.metrics.appliedCount,1);assert.equal(b.metrics.appliedCount,1);
 assert.ok(a.metrics.confirmationSeconds<b.metrics.confirmationSeconds);
 assert.ok(a.metrics.messagesSent>b.metrics.messagesSent);
 assert.equal(a.metrics.commandPackets,2);assert.equal(b.metrics.commandPackets,1);
 assert.ok(Math.abs(a.metrics.uncertainSeconds-2.6)<1e-7);
 assert.ok(Math.abs(b.metrics.uncertainSeconds-4.3)<1e-7);
 assert.deepEqual(fast.trace.map(p=>[p.time,p.frequencyHz,p.batteryKw,p.energyKwh]),patient.trace.map(p=>[p.time,p.frequencyHz,p.batteryKw,p.energyKwh]));
 assert.equal(patient.snapshot().known.command.source,'telemetry');
});
test('三秒和两秒报告策略都有可行解，低流量不等于更新鲜的记录',()=>{
 const fresh=trial('traffic',{deduplicate:true,telemetryEvery:2,priority:true});
 const economical=trial('traffic',{deduplicate:true,telemetryEvery:3,priority:false});
 assert.equal(fresh.report().success,true);assert.equal(economical.report().success,true);
 assert.ok(fresh.report().metrics.messagesSent>economical.report().metrics.messagesSent);
 assert.ok(fresh.report().metrics.maxDataAge<economical.report().metrics.maxDataAge);
});
