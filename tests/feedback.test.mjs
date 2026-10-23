import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation,DEFAULT_CONFIG } from '../src/simulation.ts';
import { MISSIONS,MISSION_TARGETS } from '../src/missions.ts';
import { trialFeedback } from '../src/feedback.ts';
function report(id,extra={}){const s=new Simulation({...DEFAULT_CONFIG,pvInitialKw:50,windKw:20,initialBaseKw:22,criticalDemandKw:60,servedCriticalKw:60,
 scenario:id,duration:MISSIONS[id].duration,...MISSIONS[id].protocol,...extra});s.advanceTo(s.config.duration,true);return s.report();}
test('新编号的重复意图要定位重连策略，不能把已开启的 C17 去重当作原因',()=>{
 const r=report('return'),feedback=trialFeedback('return',r,'once');
 assert.equal(feedback.protocol,'reconnect');assert.match(feedback.detail,/C18|新编号/);
});
test('不同机制的失败能定位当前可操作的规则',()=>{
 assert.equal(trialFeedback('echo',report('echo')).protocol,'deduplicate');
 assert.equal(trialFeedback('solar',report('solar')).protocol,'commandTtl');
 assert.equal(trialFeedback('island',report('island')).protocol,'localMode');
 assert.equal(trialFeedback('traffic',report('traffic')).protocol,'telemetryEvery');
});
test('零次执行不能误诊为重复执行，断开负荷与储能耗尽也分开解释',()=>{
 const absent=trialFeedback('lab',report('lab',{fault:'partition'}));
 assert.equal(absent.protocol,'fault');assert.doesNotMatch(absent.title,/重复/);
 const load=trialFeedback('lab',report('lab',{servedCriticalKw:0,servedDemandKw:30}));assert.equal(load.kind,'critical');
 const empty=trialFeedback('night',report('night',{capacityKwh:2,initialEnergyKwh:.01}));
 assert.match(empty.title,/电量|耗尽/);assert.equal(empty.kind,'wind');
});
test('电量尚存但供需失配导致保护退出，不能误报为电量耗尽',()=>{
 const r=report('night',{capacityKwh:2,initialEnergyKwh:1.2});
 assert.ok(r.metrics.finalEnergyKwh>0);assert.ok(r.metrics.serviceRatio<.95);
 const feedback=trialFeedback('night',r);assert.match(feedback.title,/保护/);assert.equal(feedback.field,'maxKw');
});
test('等待遥测超出确认窗口时定位等待策略，不能要求修改不会生效的重试间隔',()=>{
 const r=report('lab',{deduplicate:true,retryPolicy:'observe',telemetryEvery:8});
 assert.equal(r.success,false);assert.ok(r.metrics.confirmationSeconds>MISSION_TARGETS.confirmationSeconds);
 const feedback=trialFeedback('lab',r,'confirmation');
 assert.equal(feedback.protocol,'retryPolicy');assert.match(feedback.detail,/遥测/);
});
test('等待方案通关的复盘解释真实的等待，不假称重试返回了旧结果',()=>{
 const r=report('echo',{deduplicate:false,retryPolicy:'observe'});
 assert.equal(r.success,true);
 const feedback=trialFeedback('echo',r);
 assert.match(feedback.detail,/遥测/);assert.match(feedback.detail,/4.3/);
});
