import { Simulation, DEFAULT_CONFIG } from './simulation.ts';
import type { Phase, View, WorkerRequest, WorkerResponse } from './protocol.ts';
interface SimulationPort {
  postMessage(value: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}
const port = globalThis as unknown as SimulationPort;
let sim = new Simulation({ ...DEFAULT_CONFIG });
let runId = 0;
let phase: Phase = 'briefing';
let selectedTime: number | null = null;
let speed = 2;
let accumulator = 0;
let autoSend = false;

function emit(): void {
  const message: View = {
    type: 'view', runId, phase,
    snapshot: selectedTime === null ? sim.snapshot() : sim.snapshotAt(selectedTime),
    actualTime: sim.time, selectedTime,
    trace: sim.trace, events: sim.events,
    report: phase === 'review' ? sim.report() : null,
  };
  port.postMessage(message);
}
function advance(target: number): void {
  while (sim.time + 1e-8 < target && phase === 'running') {
    sim.advanceTo(sim.time + sim.config.stepSeconds,autoSend);
    if (!autoSend&&sim.actionTime!==null&&sim.time>=sim.actionTime&&!sim.snapshot().known.command) {
      phase = 'awaiting'; break;
    }
    if (sim.time >= sim.config.duration) { phase = 'review'; break; }
  }
}
port.addEventListener('message', ({ data }) => {
  try {
    if (data.type === 'reset' || data.type === 'replay') {
      const replacement = new Simulation(data.config);
      sim = replacement; runId = data.runId;
      selectedTime = null; accumulator = 0;
      autoSend = data.type === 'replay';
      phase = autoSend ? 'running' : 'briefing';
    } else {
      if (data.runId !== runId) return;
      if (data.type === 'start' && (phase === 'briefing' || phase === 'paused')) {
        selectedTime = null; phase = 'running'; accumulator = 0;
      } else if (data.type === 'pause' && phase === 'running') phase = 'paused';
      else if (data.type === 'send' && phase === 'awaiting') {
        sim.dispatchAdjustment(); selectedTime = null; phase = 'running'; accumulator = 0;
      } else if (data.type === 'step' && phase === 'paused') {
        selectedTime = null; phase = 'running';
        advance(Math.min(sim.time + 0.5, sim.config.duration));
        if ((phase as Phase) === 'running') phase = 'paused';
      } else if (data.type === 'speed') {
        if (![1, 2, 4].includes(data.value)) throw Error('不支持的运行速度');
        speed = data.value;
      } else if (data.type === 'seek' && phase !== 'running') {
        if (!Number.isFinite(data.value)) throw Error('回放时刻不合法');
        selectedTime = Math.max(0, Math.min(sim.time, data.value));
      } else if (data.type === 'live') selectedTime = null;
    }
    emit();
  } catch (error) {
    if (phase === 'running') phase = 'paused';
    port.postMessage({ type: 'error', runId: data.runId, message: error instanceof Error ? error.message : String(error) });
  }
});
setInterval(() => {
  if (phase !== 'running') return;
  try {
    accumulator += speed / 20;
    const steps = Math.floor((accumulator + 1e-8) / sim.config.stepSeconds);
    accumulator -= steps * sim.config.stepSeconds;
    advance(Math.min(sim.time + steps * sim.config.stepSeconds, sim.config.duration));
    emit();
  } catch (error) {
    phase = 'paused';
    port.postMessage({ type: 'error', runId, message: error instanceof Error ? error.message : String(error) });
  }
}, 50);
emit();
