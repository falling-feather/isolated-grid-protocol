import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation,DEFAULT_CONFIG,validateSimulationConfig } from '../src/simulation.ts';
import { comparable,decodeReport } from '../src/storage.ts';
const config=(extra={})=>({...DEFAULT_CONFIG,pvInitialKw:50,windKw:20,initialBaseKw:22,criticalDemandKw:60,servedCriticalKw:60,...extra});
function trial(extra){const sim=new Simulation(config(extra));sim.advanceTo(sim.config.duration,true);return sim;}
test('运行和保存解码共用同一配置校验，非法扩展选项明确拒绝',()=>{
 for(const change of [{scenario:'unknown'},{commandTtl:0},{localMode:'magic'},{telemetryEvery:0},{priority:'yes'},{planCost:-1}]){
  assert.throws(()=>validateSimulationConfig(config(change)));
  const report=trial({deduplicate:true}).report();Object.assign(report.config,change);
  assert.throws(()=>decodeReport(JSON.stringify(report)));
 }
});
test('过期边界一致：等于有效期仍可执行，重试不刷新创建时刻',()=>{
 const exact=trial({scenario:'solar',fault:'healthy',deduplicate:true,commandTtl:7});
 const late=trial({scenario:'solar',fault:'healthy',deduplicate:true,commandTtl:6.99});
 assert.equal(exact.snapshot().appliedCount,1);assert.equal(exact.snapshot().known.command.executedAt,11);
 assert.equal(late.snapshot().appliedCount,0);assert.ok(late.report().metrics.expiredCommands>0);
});
test('重连核对在新的设备记录真正到达前，不能更新中央所知',()=>{
 const sim=new Simulation(config({scenario:'return',duration:28,fault:'healthy',deduplicate:true,reconnect:'reconcile'}));
 sim.advanceTo(13.4,true);
 assert.equal(sim.snapshot().physical.baseKw,42);assert.equal(sim.snapshot().known.device.sampledAt,0);
 assert.equal(sim.snapshot().network.reconciled,false);
 sim.advanceTo(13.6,true);assert.equal(sim.snapshot().known.device.sampledAt,13.3);assert.equal(sim.snapshot().network.reconciled,true);
});
test('优先级改变真实队列等待，不能消除已经产生的过量报文',()=>{
 const fifo=trial({scenario:'traffic',duration:28,fault:'healthy',deduplicate:true,telemetryEvery:.5,priority:false});
 const priority=trial({scenario:'traffic',duration:28,fault:'healthy',deduplicate:true,telemetryEvery:.5,priority:true});
 assert.equal(fifo.report().metrics.confirmationSeconds,null);
 assert.ok(priority.report().metrics.confirmationSeconds<2);
 assert.equal(priority.report().success,false);assert.ok(priority.report().metrics.messagesSent>95);
});
test('共享信道的固定步长不把每秒四份报文偷偷降成较低吞吐量',()=>{
 const sim=new Simulation(config({scenario:'traffic',duration:28,fault:'healthy',telemetryEvery:.5}));
 sim.advanceTo(1,true);const before=sim.snapshot().network.delivered;
 sim.advanceTo(11,true);assert.equal(sim.snapshot().network.delivered-before,40);
});
test('对照允许改变消息策略，天气、物理条件与故障不同则不混作同条件',()=>{
 const report=trial({scenario:'solar',fault:'healthy',deduplicate:true}).report();
 assert.equal(comparable(report,{...report.config,commandTtl:2}),true);
 assert.equal(comparable(report,{...report.config,localMode:'restore',retryAfter:4,priority:true,telemetryEvery:2}),true);
 assert.equal(comparable(report,{...report.config,fault:'lost-ack'}),false);
 assert.equal(comparable(report,{...report.config,windKw:40}),false);
 assert.equal(comparable(report,{...report.config,scenario:'echo'}),false);
});
test('目标与星级损坏不会作为正常对照继续使用',()=>{
 const report=trial({deduplicate:true}).report();report.stars=9;
 assert.throws(()=>decodeReport(JSON.stringify(report)));
 report.stars=3;report.goals[0].passed='yes';assert.throws(()=>decodeReport(JSON.stringify(report)));
});
test('旧模型记录保留原结果，但不与更新后的模型叠加为同条件曲线',()=>{
 const report=trial({deduplicate:true}).report();delete report.modelRevision;
 const legacy=decodeReport(JSON.stringify(report));
 assert.equal(legacy.modelRevision,1);assert.equal(legacy.success,report.success);
 assert.equal(comparable(legacy,report.config),false);
});
