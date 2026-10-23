import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { createMissionDesign,missionConfig } from '../src/campaign.ts';
import { commandEvidence,knowledgeGap,compareStrategies,recentEventAt } from '../src/evidence.ts';
function trial(id,patch={}){const d=createMissionDesign(id);Object.assign(d.protocol,patch);const s=new Simulation(missionConfig(id,d));s.advanceTo(s.config.duration,true);return s;}
test('重复改变设备的具体投递保留原创建时间和前后基准',()=>{
 const s=trial('echo');const messages=commandEvidence(s.events);
 assert.equal(messages.length,2);assert.equal(messages[1].label,'M02');assert.equal(messages[1].commandId,'C17');
 assert.equal(messages[1].createdAt,4);assert.equal(messages[1].sent.time,6);assert.equal(messages[1].arrival.time,6.3);
 assert.equal(messages[1].action.evidence.beforeBaseKw,42);assert.equal(messages[1].action.evidence.afterBaseKw,62);
 assert.equal(messages[1].action.evidence.outcome,'applied');
});
test('去重响应引用原执行，不冒充一次新设备动作',()=>{
 const m=commandEvidence(trial('echo',{deduplicate:true}).events)[1];
 assert.equal(m.action.evidence.outcome,'cached');assert.equal(m.action.evidence.executedAt,4.3);
 assert.equal(m.action.evidence.beforeBaseKw,m.action.evidence.afterBaseKw);
 assert.equal(m.receipts.at(-1).time,6.6);
});
test('等待遥测的确认也能追溯到先前实际执行的那份消息',()=>{
 const s=trial('echo',{retryPolicy:'observe',deduplicate:false});const m=commandEvidence(s.events)[0];
 assert.ok(m.receipts.some(e=>e.kind==='ack-lost'));
 assert.equal(m.receipts.at(-1).reason,'telemetry-confirmed');assert.equal(m.receipts.at(-1).time,8.3);
 assert.equal(m.action.time,4.3);
});
test('双状态面板不把原执行回执当作新遥测',()=>{
 const s=trial('echo',{deduplicate:true});const gap=knowledgeGap(s.snapshotAt(6.8));
 assert.equal(gap.actualBaseKw,42);assert.equal(gap.sampledBaseKw,22);assert.equal(gap.sampledAt,0);
 assert.equal(gap.resultBaseKw,42);assert.equal(gap.executedAt,4.3);assert.equal(gap.status,'confirmed');
 assert.equal(gap.differenceKw,20);assert.equal(gap.hasBaseGap,true);
});
test('基准数值一致与执行确认是两件事，失联不能显示为已确认',()=>{
 const s=trial('island',{localMode:'restore'}),gap=knowledgeGap(s.snapshotAt(15));
 assert.equal(gap.differenceKw,0);assert.equal(gap.hasBaseGap,false);
 assert.ok(['unconfirmed','exhausted'].includes(gap.status));
});
test('策略比较限定相同初态，代价来自运行结果',()=>{
 const a=trial('echo',{deduplicate:true,retryPolicy:'retry'}).report();
 const b=trial('echo',{deduplicate:false,retryPolicy:'observe'}).report();
 const c=compareStrategies(a,b);assert.ok(c);assert.equal(c.messagesDelta,-2);assert.ok(c.confirmationDelta>1.6);
 const other=structuredClone(b);other.config.windKw+=5;assert.equal(compareStrategies(a,other),null);
});
test('链路中断保留在原投递链中，延后送达不会变成新命令',()=>{
 const messages=commandEvidence(trial('return').events);
 assert.equal(messages[0].interruptions[0].time,4.6);
 const delayed=messages[1];assert.equal(delayed.interruptions[0].time,6.3);
 assert.equal(delayed.createdAt,4);assert.equal(delayed.arrival.time,13.3);
 assert.equal(delayed.action.evidence.outcome,'cached');
 assert.equal(messages[2].commandId,'C18');assert.equal(messages[2].action.evidence.outcome,'applied');
});
test('回看提示只能来自光标之前的事件，不能把将来的回执显示为已收到',()=>{
 const s=trial('echo',{deduplicate:true});
 assert.equal(recentEventAt(s.events,0),undefined);
 assert.equal(recentEventAt(s.events,4.3).kind,'applied');
 assert.equal(recentEventAt(s.events,6.8).kind,'ack-received');
});
