import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation,DEFAULT_CONFIG } from '../src/simulation.ts';
import { MISSIONS } from '../src/missions.ts';
function run(id,overrides={}){
 const mission=MISSIONS[id];
 const sim=new Simulation({...DEFAULT_CONFIG,pvInitialKw:50,windKw:20,initialBaseKw:22,criticalDemandKw:60,servedCriticalKw:60,
  scenario:id,duration:mission.duration,...mission.protocol,...overrides});
 sim.advanceTo(sim.config.duration,true);return sim;
}
test('关卡脚本与 Worker 使用同一自动调节时刻，回声关可解',()=>{
 const bad=run('echo'),good=run('echo',{deduplicate:true});
 assert.equal(bad.snapshot().appliedCount,2);
 assert.equal(bad.report().success,false);
 assert.equal(good.snapshot().appliedCount,1);
 assert.equal(good.report().success,true);
});
test('迟到命令在阳光恢复后失效，不能靠去重代替有效期',()=>{
 const bad=run('solar'),good=run('solar',{commandTtl:2});
 assert.equal(bad.report().success,false);
 assert.ok(bad.snapshot().appliedCount>0);
 assert.equal(good.snapshot().appliedCount,0);
 assert.ok(good.report().metrics.expiredCommands>=1);
 assert.equal(good.report().success,true);
 assert.ok(good.events.some(e=>e.reason==='expired-command'));
});
test('已执行结果即使超过有效期，去重仍返回原结果',()=>{
 const sim=new Simulation({...DEFAULT_CONFIG,deduplicate:true,commandTtl:1,fault:'healthy'});
 sim.advanceTo(4);const command=sim.dispatchAdjustment();sim.advanceTo(8);sim.transmit(command);sim.advanceTo(9);
 assert.equal(sim.snapshot().appliedCount,1);
 assert.equal(sim.snapshot().known.command.executedAt,4.3);
 assert.ok(sim.events.some(e=>e.kind==='duplicate'));
});
test('失联下本地恢复只改变本地控制，中央仍没有新测量',()=>{
 const bad=run('island'),good=run('island',{localMode:'restore'});
 assert.equal(bad.report().success,false);
 assert.equal(good.report().success,true);
 assert.equal(good.snapshot().known.device.sampledAt,0);
 assert.equal(good.snapshot().appliedCount,0);
 assert.ok(good.report().metrics.localSeconds>5);
  assert.ok(Math.abs(good.report().metrics.localSeconds-27)<1e-7);
 assert.ok(Math.abs(good.snapshot().physical.frequencyHz-50)<.08);
});
test('信道真实排队，优先级和报告节奏要兼顾消息预算与信息年龄',()=>{
 const busy=run('traffic'),balanced=run('traffic',{telemetryEvery:2,priority:true}),stale=run('traffic',{telemetryEvery:8,priority:true});
 assert.equal(busy.report().success,false);
 assert.ok(busy.report().metrics.peakQueue>10);
 assert.ok(busy.report().metrics.messagesSent>95);
 assert.equal(balanced.report().success,true);
 assert.ok(balanced.report().metrics.confirmationSeconds<=4);
 assert.equal(stale.report().success,false);
 assert.ok(stale.report().metrics.maxDataAge>3.5);
});
test('重连的新编号会再执行调节，先核对则经消息确认已有事实',()=>{
 const bad=run('return'),good=run('return',{reconnect:'reconcile'});
 assert.equal(bad.snapshot().appliedCount,2);
 assert.equal(bad.report().success,false);
 assert.equal(good.snapshot().appliedCount,1);
 assert.ok(good.report().metrics.reconcileSeconds>0);
 assert.ok(good.report().metrics.reconcileSeconds<=2);
 assert.equal(good.report().success,true);
 assert.ok(good.events.some(e=>e.kind==='reconciled'));
});
test('夜班需要实际电力和能源余量，不能只勾协议通关',()=>{
 const protocol={deduplicate:true,localMode:'restore',reconnect:'reconcile',capacityKwh:2,initialEnergyKwh:1.2};
 const bad=run('night',protocol);
 const good=run('night',{...protocol,windKw:40,maxBatteryKw:75,initialBaseKw:2,planCost:30});
 assert.equal(bad.report().success,false);
 assert.equal(good.report().success,true);
 assert.ok(good.report().metrics.finalEnergyKwh>=.05);
 assert.ok(good.report().metrics.peakDeviationHz<=.9);
 const over=run('night',{...protocol,windKw:40,maxBatteryKw:80,initialBaseKw:2,planCost:35});
 assert.equal(over.report().success,false);
 assert.equal(over.report().goals.find(g=>g.id==='expansion').passed,false);
});
test('新关卡同配置可重放，布局不参与脚本和数值',()=>{
 const a=run('traffic',{telemetryEvery:2,priority:true}),b=run('traffic',{telemetryEvery:2,priority:true});
 assert.deepEqual(a.trace,b.trace);assert.deepEqual(a.events,b.events);assert.deepEqual(a.report(),b.report());
});
test('本地恢复与夜间组合场景的步长减半仍在原定容差内',()=>{
 const solution={deduplicate:true,localMode:'restore',reconnect:'reconcile',capacityKwh:2,initialEnergyKwh:1.2,
  windKw:40,maxBatteryKw:75,initialBaseKw:2,planCost:30};
 const a=run('night',solution).report(),b=run('night',{...solution,stepSeconds:.01}).report();
 assert.equal(a.success,true);assert.equal(b.success,true);
 assert.ok(Math.abs(a.metrics.peakDeviationHz-b.metrics.peakDeviationHz)<.02);
 assert.ok(Math.abs(a.metrics.energyUsedKwh-b.metrics.energyUsedKwh)<.001);
});
test('综合关存在不同的达标方案，三星目标也可实际达到',()=>{
 const protocol={deduplicate:true,localMode:'restore',reconnect:'reconcile',capacityKwh:2,initialEnergyKwh:1.2,windKw:40,planCost:30};
 const steady=run('night',{...protocol,initialBaseKw:2,maxBatteryKw:75}).report();
 const efficient=run('night',{...protocol,pvInitialKw:55,initialBaseKw:-3,maxBatteryKw:70}).report();
 assert.equal(steady.success,true);assert.equal(efficient.success,true);
 assert.equal(steady.stars,2);assert.equal(efficient.stars,3);
 assert.ok(efficient.metrics.finalEnergyKwh>steady.metrics.finalEnergyKwh);
});
