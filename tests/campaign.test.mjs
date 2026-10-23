import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN,MISSIONS } from '../src/missions.ts';
import { newCampaign,createMissionDesign,validateMissionDesign,fieldRange,missionConfig,expansionCost,unlocked,nextMission,
 startAttempt,finishAttempt,decodeCampaign,trainingStage,experiment } from '../src/campaign.ts';
import { updateNumber,connectPorts } from '../src/network.ts';
import { Simulation } from '../src/simulation.ts';
function passingEcho(){const design=createMissionDesign('echo');design.protocol.deduplicate=true;
 const sim=new Simulation(missionConfig('echo',design));sim.advanceTo(sim.config.duration,true);return {design,sim,report:sim.report()};}
test('教程用真实接线和配平推进，不能只点下一步跳过操作',()=>{
 let design=createMissionDesign('training');assert.equal(trainingStage(design),'wire');
 design=connectPorts(design,{nodeId:'BUS1',portId:'b10'},{nodeId:'C1',portId:'grid'});
 assert.equal(trainingStage(design),'balance');design=updateNumber(design,'B1','baseKw',22);
 assert.equal(trainingStage(design),'test');const sim=new Simulation(missionConfig('training',design));sim.advanceTo(14,true);
 assert.equal(sim.report().success,true);
});
test('六关顺序解锁，回顾已完成关卡不会损失进度',()=>{
 const state=newCampaign();assert.equal(unlocked(state,'training'),true);assert.equal(unlocked(state,'echo'),false);
 for(const id of CAMPAIGN.slice(1))assert.equal(unlocked(state,id),false);
 state.tutorial='skipped';assert.equal(unlocked(state,'echo'),true);
 const {report}=passingEcho();startAttempt(state,'echo');finishAttempt(state,'echo',report);
 assert.equal(unlocked(state,'solar'),true);assert.equal(unlocked(state,'island'),false);
 assert.equal(nextMission('training'),'echo');assert.equal(nextMission('night'),null);
 assert.throws(()=>finishAttempt(state,'solar',report),/不属于/);
});
test('关卡配置固定扰动、负荷和初始能源，不能调小条件绕过考验',()=>{
 for(const id of [...CAMPAIGN,'training','lab'])assert.doesNotThrow(()=>validateMissionDesign(id,createMissionDesign(id)));
 const solar=createMissionDesign('solar');solar.nodes.find(n=>n.kind==='solar').dropKw=0;
 assert.throws(()=>missionConfig('solar',solar),/固定条件/);
 const night=createMissionDesign('night');night.nodes.find(n=>n.kind==='battery').initialKwh=2;
 assert.throws(()=>missionConfig('night',night),/固定条件/);
 const load=createMissionDesign('echo');load.nodes.find(n=>n.kind==='critical').demandKw=1;
 assert.throws(()=>missionConfig('echo',load),/固定条件/);
 const lab=createMissionDesign('lab');assert.ok(fieldRange('lab',lab.nodes[0],'powerKw'));
});
test('扩容预算按设备配置计数，移出设备也不会消掉费用',()=>{
 let design=createMissionDesign('night');design=updateNumber(design,'W1','powerKw',40);design=updateNumber(design,'B1','maxKw',75);
 assert.equal(expansionCost(design),30);design.nodes.find(n=>n.kind==='wind').present=false;
 design.edges=design.edges.filter(e=>e.from.nodeId!=='W1'&&e.to.nodeId!=='W1');assert.equal(expansionCost(design),30);
});
test('进度保存恢复匹配关卡与最近结果，错误记录明确拒绝',()=>{
 const state=newCampaign();state.tutorial='skipped';state.selected='echo';const {design,report}=passingEcho();
 state.designs.echo=design;startAttempt(state,'echo');finishAttempt(state,'echo',report);
 assert.deepEqual(decodeCampaign(JSON.stringify(state)),state);
 const invalid=structuredClone(state);invalid.progress.echo.wins=9;assert.throws(()=>decodeCampaign(JSON.stringify(invalid)),/成绩/);
 const locked=newCampaign();locked.selected='night';assert.throws(()=>decodeCampaign(JSON.stringify(locked)),/未解锁/);
});
test('导出使用同一次配置和事件，修改配置后不能导出旧结果冒充新试验',()=>{
 const {design,sim,report}=passingEcho(),data=JSON.parse(experiment(design,report,sim.events));
 assert.deepEqual(data.report,report);assert.deepEqual(data.events,sim.events);
 const replay=new Simulation(data.report.config);replay.advanceTo(replay.config.duration,true);
 assert.deepEqual(replay.report(),report);assert.deepEqual(replay.events,data.events);
 design.protocol.retryAfter=4;assert.throws(()=>experiment(design,report,sim.events),/已改变/);
});
