import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Simulation, DEFAULT_CONFIG, PHYSICS } from '../src/simulation.ts';

function trial(overrides = {}, send = true) {
  const sim = new Simulation({ ...DEFAULT_CONFIG, ...overrides });
  sim.advanceTo(4);
  if (send) sim.dispatchAdjustment();
  sim.advanceTo(sim.config.duration);
  return sim;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('恒定供需下保持平衡，储能按实际功率与效率积分', () => {
  const sim = trial({ pvDropKw: 0, fault: 'healthy' }, false);
  const state = sim.snapshot();
  assert.ok(Math.abs(state.physical.frequencyHz - 50) < 1e-10);
  const expected = DEFAULT_CONFIG.initialEnergyKwh - 22 * 24 / 3600 / PHYSICS.dischargeEfficiency;
  assert.ok(Math.abs(state.physical.energyKwh - expected) < 1e-9);
});

test('设备已执行、回执丢失时，中央仍只知道旧电池状态', () => {
  const sim = new Simulation(DEFAULT_CONFIG);
  sim.advanceTo(4);
  sim.dispatchAdjustment();
  sim.advanceTo(4.8);
  const state = sim.snapshot();
  assert.equal(state.physical.baseKw, 42);
  assert.equal(state.known.device.baseKw, 22);
  assert.equal(state.known.command.status, 'unconfirmed');
  assert.equal(state.appliedCount, 1);
  assert.ok(sim.events.some(e => e.kind === 'ack-lost'));
});

test('无去重重试执行两次；去重重试一次并重新返回结果', () => {
  const bad = trial({ deduplicate: false });
  const good = trial({ deduplicate: true });
  assert.equal(bad.snapshot().appliedCount, 2);
  assert.equal(good.snapshot().appliedCount, 1);
  assert.equal(bad.snapshot().physical.baseKw, 62);
  assert.equal(good.snapshot().physical.baseKw, 42);
  assert.equal(good.snapshot().known.command.status, 'confirmed');
  assert.ok(good.events.some(e => e.kind === 'duplicate'));
  assert.ok(good.report().success);
  assert.equal(bad.report().success, false);
  assert.ok(bad.report().metrics.settledDeviationHz > 0.2);
  assert.ok(good.report().metrics.settledDeviationHz < 0.08);
});

test('去重返回原执行时刻，不冒充新执行', () => {
  const sim = trial({ deduplicate: true });
  const applied = sim.events.find(e => e.kind === 'applied');
  assert.equal(sim.snapshot().known.command.executedAt, applied.time);
  assert.ok(sim.snapshot().known.command.confirmedAt > applied.time);
});

test('无故障时，两种规则产生相同物理结果', () => {
  const a = trial({ fault: 'healthy', deduplicate: false });
  const b = trial({ fault: 'healthy', deduplicate: true });
  assert.equal(a.snapshot().appliedCount, 1);
  assert.equal(digest(a.trace), digest(b.trace));
});

test('同编号不同载荷拒绝，不能借去重覆盖新内容', () => {
  const sim = new Simulation({ ...DEFAULT_CONFIG, fault: 'healthy', deduplicate: true });
  sim.advanceTo(4);
  const command = sim.dispatchAdjustment();
  sim.advanceTo(4.8);
  sim.transmit({ ...command, deltaKw: 7 });
  sim.advanceTo(5.6);
  assert.equal(sim.snapshot().physical.baseKw, 42);
  assert.ok(sim.events.some(e => e.kind === 'rejected' && e.reason === 'identity-conflict'));
});

test('旧序号不能覆盖已经接受的新命令', () => {
  const sim = new Simulation({ ...DEFAULT_CONFIG, fault: 'healthy', deduplicate: true });
  sim.advanceTo(4);
  const command = sim.dispatchAdjustment();
  sim.advanceTo(4.8);
  sim.transmit({ ...command, id: 'C18', sequence: 2, deltaKw: 1 });
  sim.advanceTo(5.4);
  sim.transmit({ ...command, id: 'C16', sequence: 1 });
  sim.advanceTo(6);
  assert.equal(sim.snapshot().physical.baseKw, 43);
  assert.ok(sim.events.some(e => e.kind === 'rejected' && e.reason === 'stale-sequence'));
});

test('同刻回执先于超时处理，不多发一次重试', () => {
  const sim = trial({ fault: 'healthy', retryAfter: 0.6 });
  assert.equal(sim.snapshot().known.command.attempts, 1);
});

test('晚到的有效回执可以更新更早遥测确认的处理结果', () => {
  const sim = new Simulation({ ...DEFAULT_CONFIG, deduplicate: false, retryAfter: 4 });
  sim.advanceTo(4); sim.dispatchAdjustment(); sim.advanceTo(9);
  const state = sim.snapshot();
  assert.equal(state.known.device.baseKw, 42);
  assert.equal(state.known.command.reportedBaseKw, 62);
  assert.equal(state.known.command.executedAt, 8.3);
  assert.equal(state.known.command.confirmedAt, 8.6);
});

test('通信分区仍有本地响应和供电，中央得不到新测量', () => {
  const sim = trial({ fault: 'partition', deduplicate: true });
  const state = sim.snapshot();
  assert.equal(state.physical.energized, true);
  assert.equal(state.known.device.sampledAt, 0);
  assert.equal(state.known.command.status, 'exhausted');
  assert.equal(state.appliedCount, 0);
  assert.ok(state.physical.batteryKw > 22);
  assert.ok(sim.report().metrics.serviceRatio > 0.999);
  assert.equal(sim.report().success, false);
});

test('储能耗尽后不越界，无成网源时停供且频率无效', () => {
  const empty = new Simulation({ ...DEFAULT_CONFIG, initialEnergyKwh: 0 }).snapshot();
  assert.equal(empty.known.pv.value, 0);
  assert.equal(empty.known.device.frequencyHz, null);
  const sim = trial({ initialEnergyKwh: 0.0001, fault: 'partition' }, false);
  const state = sim.snapshot();
  assert.equal(state.physical.energyKwh, 0);
  assert.equal(state.physical.energized, false);
  assert.equal(state.physical.frequencyHz, null);
  assert.equal(state.physical.servedKw, 0);
  assert.ok(sim.report().metrics.unservedKwh > 0);
});

test('充电含效率且不越过容量边界', () => {
  const sim = trial({ pvInitialKw: 110, pvDropKw: 0, initialEnergyKwh: 79.999 }, false);
  assert.ok(sim.snapshot().physical.energyKwh <= PHYSICS.capacityKwh);
  assert.ok(sim.snapshot().physical.energyKwh >= 79.999);
  const charge = new Simulation({ ...DEFAULT_CONFIG, pvInitialKw: 102, pvDropKw: 0 });
  charge.advanceTo(1);
  const expected = DEFAULT_CONFIG.initialEnergyKwh + 10 * PHYSICS.chargeEfficiency / 3600;
  assert.ok(Math.abs(charge.snapshot().physical.energyKwh - expected) < 1e-9);
});

test('正常供电保持功率与斜坡约束，保护退出时立即归零', () => {
  const sim = trial({ pvDropKw: 60 });
  for (const point of sim.trace) {
    assert.ok(Math.abs(point.batteryKw) <= PHYSICS.maxPowerKw + 1e-9);
    assert.ok(point.energyKwh >= 0 && point.energyKwh <= PHYSICS.capacityKwh);
  }
  for (let i = 1; i < sim.trace.length; i++) {
    const a = sim.trace[i - 1], b = sim.trace[i];
    if (b.servedKw > 0 && a.servedKw > 0) {
      assert.ok(Math.abs(b.batteryKw - a.batteryKw) <= PHYSICS.rampKwPerSecond * (b.time - a.time) + 1e-8);
    } else {
      assert.equal(b.batteryKw, 0);
    }
  }
});

test('固定配置和动作的事件、快照可重复', () => {
  const a = trial({ deduplicate: true });
  const b = trial({ deduplicate: true });
  assert.equal(digest(a.events), digest(b.events));
  assert.equal(digest(a.trace), digest(b.trace));
});

test('步长减半满足预先约定的峰值和电量容差', () => {
  for (const deduplicate of [false, true]) {
    const a = trial({ deduplicate, stepSeconds: 0.02 }).report();
    const b = trial({ deduplicate, stepSeconds: 0.01 }).report();
    assert.ok(Math.abs(a.metrics.peakDeviationHz - b.metrics.peakDeviationHz) < 0.02);
    assert.ok(Math.abs(a.metrics.energyUsedKwh - b.metrics.energyUsedKwh) < 0.001);
  }
});

test('未进行调节不能通过；输入不合法时明确拒绝', () => {
  assert.equal(trial({}, false).report().success, false);
  assert.throws(() => new Simulation({ ...DEFAULT_CONFIG, stepSeconds: 0 }), /步长/);
  assert.throws(() => new Simulation({ ...DEFAULT_CONFIG, initialEnergyKwh: -1 }), /电量/);
});
