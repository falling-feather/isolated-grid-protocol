import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import {
  createDesign, analyzeDesign, validateDesign, updateNumber, connectPorts,
  editDesign, getPorts, DesignHistory,
} from '../src/network.ts';

function run(design) {
  const analysis = analyzeDesign(design);
  const sim = new Simulation(analysis.config);
  sim.advanceTo(4); sim.dispatchAdjustment(); sim.advanceTo(24);
  return sim;
}
test('默认组网的风光与需求接入同一个模拟，去重后可完成任务', () => {
  const design = createDesign();
  design.protocol.deduplicate = true;
  const {config} = analyzeDesign(design);
  assert.equal(config.pvInitialKw, 50);
  assert.equal(config.windKw, 20);
  assert.equal(config.demandKw, 90);
  assert.equal(config.servedDemandKw, 90);
  assert.equal(config.initialBaseKw, 22);
  assert.ok(run(design).report().success);
});
test('断开储能到母线的电路不会伪造有效频率或供电', () => {
  const design = editDesign(createDesign(), d => { d.edges.find(e=>e.id==='e3').closed=false; });
  const sim = run(design);
  assert.equal(sim.snapshot().physical.frequencyHz, null);
  assert.equal(sim.report().metrics.serviceRatio, 0);
  assert.ok(sim.events.some(e=>e.kind==='delivered'));
});
test('断开、移出或降低负荷都不能让任务需求消失', () => {
  for (const change of [
    d => { d.edges.find(e=>e.id==='e4').closed=false; },
    d => { d.nodes.find(n=>n.kind==='critical').present=false; d.edges=d.edges.filter(e=>e.id!=='e4'); },
    d => { d.nodes.find(n=>n.kind==='critical').demandKw=1; },
  ]) {
    const design=editDesign(createDesign(),change);
    assert.equal(analyzeDesign(design).config.demandKw,90);
    assert.equal(run(design).report().success,false);
    assert.ok(run(design).report().metrics.criticalServiceRatio<1);
  }
});
test('通信分区不改变已经闭合的电路，本地响应仍运行', () => {
  const design=createDesign(); design.protocol.fault='partition';
  const sim=run(design);
  assert.equal(sim.snapshot().physical.energized,true);
  assert.equal(sim.report().metrics.serviceRatio,1);
  assert.equal(sim.snapshot().appliedCount,0);
});
test('调整功率、容量和调节步长进入实际模拟', () => {
  let design=updateNumber(createDesign(),'PV1','powerKw',80);
  design=updateNumber(design,'B1','maxKw',30);
  design=updateNumber(design,'B1','commandKw',5);
  const sim=run(design);
  assert.equal(sim.config.pvInitialKw,80);
  assert.equal(sim.config.maxBatteryKw,30);
  assert.equal(sim.config.commandDeltaKw,5);
  assert.ok(sim.trace.every(p=>Math.abs(p.batteryKw)<=30));
  design=updateNumber(design,'B1','capacityKwh',20);
  assert.equal(design.nodes.find(n=>n.id==='B1').initialKwh,20);
});
test('重接端子是一个原子变更，不会产生一端多条线', () => {
  const before=createDesign();
  const next=connectPorts(before,{nodeId:'PV1',portId:'grid'},{nodeId:'BUS1',portId:'b1'});
  assert.equal(before.edges.find(e=>e.id==='e1').to.portId,'b0');
  assert.equal(next.edges.length,5);
  assert.equal(next.edges.filter(e=>e.from.nodeId==='PV1'||e.to.nodeId==='PV1').length,1);
  assert.ok(next.edges.some(e=>e.to.portId==='b1'));
  assert.throws(()=>connectPorts(before,{nodeId:'PV1',portId:'grid'},{nodeId:'BUS1',portId:'b10'}),/占用/);
});
test('图上位置和绕行不改变物理条件，开关状态会改变供电', () => {
  const before=createDesign();
  const moved=editDesign(before,d=>{d.nodes[0].x+=20;d.edges[0].via={x:400,y:160};});
  assert.equal(analyzeDesign(before).signature,analyzeDesign(moved).signature);
  const opened=editDesign(before,d=>{d.edges[3].closed=false;});
  assert.notEqual(analyzeDesign(before).signature,analyzeDesign(opened).signature);
});
test('连接基于端子和开关，不基于交叉线段的位置', () => {
  const design=editDesign(createDesign(),d=>{
    d.edges=d.edges.filter(e=>e.id!=='e4');
    d.edges[0].via={x:1200,y:240};
  });
  assert.equal(analyzeDesign(design).config.servedCriticalKw,0);
});
test('无效参数、重复端子或错误持久化内容明确拒绝', () => {
  assert.throws(()=>updateNumber(createDesign(),'PV1','powerKw',-1),/范围/);
  assert.throws(()=>validateDesign({schema:1,nodes:[]}),/装置/);
  const design=createDesign();
  design.edges.push({...design.edges[0],id:'extra'});
  assert.throws(()=>validateDesign(design),/占用/);
  assert.equal(getPorts(createDesign().nodes.find(n=>n.kind==='bus')).length,11);
});
test('撤销与重做恢复线路、位置和参数，而非另算一套状态', () => {
  const h=new DesignHistory(createDesign());
  h.commit(updateNumber(h.current,'PV1','powerKw',80));
  assert.equal(analyzeDesign(h.current).config.pvInitialKw,80);
  h.undo(); assert.equal(analyzeDesign(h.current).config.pvInitialKw,50);
  h.redo(); assert.equal(analyzeDesign(h.current).config.pvInitialKw,80);
  h.undo(); h.commit(updateNumber(h.current,'W1','powerKw',25));
  assert.equal(h.canRedo,false);
});
