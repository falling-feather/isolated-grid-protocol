import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeDesign,decodeReport} from '../src/storage.ts';
import {createDesign,updateNumber} from '../src/network.ts';
import {Simulation,DEFAULT_CONFIG} from '../src/simulation.ts';
test('布局、参数、线路与协议可完整保存恢复',()=>{
 let d=updateNumber(createDesign(),'PV1','powerKw',80);d.edges[0].closed=false;d.protocol.deduplicate=true;
 assert.deepEqual(decodeDesign(JSON.stringify(d)),d);
 assert.throws(()=>decodeDesign('{bad'),/JSON/);
});
test('旧原型对照记录补齐新增字段，仍保留原场景条件',()=>{
 const sim=new Simulation({...DEFAULT_CONFIG,deduplicate:true});sim.advanceTo(4);sim.dispatchAdjustment();sim.advanceTo(24);
 const old=sim.report();delete old.config.windKw;delete old.config.initialBaseKw;delete old.config.criticalDemandKw;
 delete old.metrics.criticalServiceRatio;
 for(const p of old.trace){delete p.windKw;delete p.criticalServedKw;}
 const loaded=decodeReport(JSON.stringify(old));
 assert.equal(loaded.config.windKw,0);assert.equal(loaded.config.initialBaseKw,null);
 assert.equal(loaded.metrics.criticalServiceRatio,old.metrics.serviceRatio);
 assert.equal(loaded.trace.length,old.trace.length);
});
test('无效对照不作为可用结果继续绘制',()=>{
 assert.equal(decodeReport(null),null);
 assert.throws(()=>decodeReport(JSON.stringify({schema:1,trace:[{time:NaN}]})));
});
