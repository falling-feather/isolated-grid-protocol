import type { SimulationConfig, Snapshot, PlotPoint, SimEvent, TrialReport } from './simulation.ts';
export type Phase = 'briefing' | 'running' | 'awaiting' | 'paused' | 'review';
export type WorkerRequest =
  | { type: 'reset' | 'replay'; runId: number; config: SimulationConfig }
  | { type: 'start' | 'pause' | 'send' | 'step' | 'live'; runId: number }
  | { type: 'speed'; runId: number; value: number }
  | { type: 'seek'; runId: number; value: number };
export interface View {
  type: 'view'; runId: number; phase: Phase;
  snapshot: Snapshot; actualTime: number; selectedTime: number | null;
  trace: PlotPoint[]; events: SimEvent[]; report: TrialReport | null;
}
export type WorkerResponse = View | { type: 'error'; runId: number; message: string };
