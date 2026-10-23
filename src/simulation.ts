import { MISSIONS,MISSION_TARGETS,gradeTrial,isMissionId,trialStars } from './missions.ts';
import type { MissionId } from './missions.ts';
export type FaultMode = 'lost-ack' | 'healthy' | 'partition';
export const MODEL_REVISION=3;
export interface SimulationConfig {
  deduplicate: boolean;
  fault: FaultMode;
  retryAfter: number;
  retryPolicy:'retry'|'observe';
  duration: number;
  stepSeconds: number;
  pvInitialKw: number;
  pvDropKw: number;
  initialEnergyKwh: number;
  windKw: number;
  demandKw: number;
  servedDemandKw: number;
  criticalDemandKw: number;
  servedCriticalKw: number;
  initialBaseKw: number | null;
  maxBatteryKw: number;
  capacityKwh: number;
  formingAvailable: boolean;
  commandDeltaKw: number;
  scenario:MissionId;
  commandTtl:number|null;
  localMode:'droop'|'restore';
  telemetryEvery:number;
  priority:boolean;
  reconnect:'resume'|'reconcile';
  planCost:number;
}
export const INPUT_LIMITS = Object.freeze({sourceKw:200, demandKw:300, batteryKw:200, capacityKwh:300, commandKw:100});

/** 教学模型参数，不是设备规格或供电质量标准。 */
export const PHYSICS = Object.freeze({
  nominalHz: 50, demandKw: 90, lossKw: 2,
  capacityKwh: 80, maxPowerKw: 65,
  chargeEfficiency: 0.95, dischargeEfficiency: 0.95,
  responseSeconds: 0.6, rampKwPerSecond: 35,
  droopKwPerHz: 65, effectiveM: 28, dampingKwPerHz: 4,
  secondaryKwPerHzSecond:8,
  cloudAt: 3, actionAt: 4, latencySeconds: 0.3,
  telemetryPeriod: 8, maxAttempts: 2, commandDeltaKw: 20,
  settledBandHz:MISSION_TARGETS.settledDeviationHz,confirmationWindow:MISSION_TARGETS.confirmationSeconds,
});
export const DEFAULT_CONFIG: Readonly<SimulationConfig> = Object.freeze({
  deduplicate: false, fault: 'lost-ack', retryAfter: 2,retryPolicy:'retry',
  duration: 24, stepSeconds: 0.02,
  pvInitialKw: 70, pvDropKw: 20, initialEnergyKwh: 40,
  windKw:0, demandKw:90, servedDemandKw:90, criticalDemandKw:90, servedCriticalKw:90,
  initialBaseKw:null, maxBatteryKw:65, capacityKwh:80, formingAvailable:true, commandDeltaKw:20,
  scenario:'lab',commandTtl:null,localMode:'droop',telemetryEvery:8,priority:false,reconnect:'resume',planCost:0,
});
export interface Command {
  id: string; sequence: number; deltaKw: number; createdAt: number;
}
export interface PhysicalState {
  frequencyHz: number | null;
  pvKw: number; windKw: number; batteryKw: number; baseKw: number;localKw:number;
  energyKwh: number; energized: boolean; servedKw: number; criticalServedKw:number;
}
export interface DeviceMeasurement {
  batteryKw: number; baseKw: number; energyKwh: number;
  frequencyHz: number | null;
  lastCommandId: string | null; lastAppliedAt: number | null;
  sampledAt: number; receivedAt: number;
}
export interface CommandKnowledge {
  id: string; status: 'unconfirmed' | 'confirmed' | 'exhausted' | 'rejected';
  attempts: number; createdAt: number;
  executedAt: number | null; confirmedAt: number | null;
  reportedBaseKw: number | null; source: 'ack' | 'telemetry' | null;
}
export interface KnownState {
  device: DeviceMeasurement;
  pv: { value: number; sampledAt: number; receivedAt: number };
  command: CommandKnowledge | null;
}
export type EventKind = 'briefing' | 'cloud' | 'sent' | 'delivered' | 'applied'
  | 'ack-lost' | 'ack-received' | 'retry' | 'duplicate' | 'rejected'
  | 'telemetry' | 'link-lost' | 'exhausted' | 'power-lost'|'weather'|'link-restored'|'reconcile'|'reconciled'|'local'|'waiting';
export interface SimEvent {
  id: string; time: number; kind: EventKind; title: string; detail: string;
  commandId: string | null; relatedId: string | null; reason: string | null;
  evidence?:CommandEvidence;
}
export interface CommandEvidence {
  createdAt:number;sequence:number;deltaKw:number;
  outcome:'sent'|'arrived'|'applied'|'cached'|'rejected'|'expired'|'confirmed'|'lost';
  beforeBaseKw?:number;afterBaseKw?:number;executedAt?:number|null;
}
export interface Snapshot {
  time: number; physical: PhysicalState; known: KnownState; appliedCount: number;
  network:{connected:boolean;queued:number;sent:number;delivered:number;expired:number;reconciled:boolean};
}
export interface PlotPoint {
  time: number; frequencyHz: number | null; knownFrequencyHz: number | null;
  knownSampledAt: number; batteryKw: number; baseKw: number;
  energyKwh: number; servedKw: number; windKw:number; criticalServedKw:number;
}
export interface Goal { id?:string;label: string; passed: boolean; value: string; }
export interface TrialMetrics {
  peakDeviationHz: number; settledDeviationHz: number | null;
  energyUsedKwh: number; unservedKwh: number; serviceRatio: number; criticalServiceRatio:number;
  appliedCount: number; attempts: number; confirmationSeconds: number | null;
  finalEnergyKwh:number;initialMismatchKw:number;expiredCommands:number;localSeconds:number;
  messagesSent:number;peakQueue:number;maxDataAge:number;reconcileSeconds:number|null;
  uncertainSeconds:number;commandPackets:number;
}
export interface TrialReport {
  schema: 1;modelRevision:number; config: SimulationConfig; commandAt: number | null;
  success: boolean;stars:number; goals: Goal[]; metrics: TrialMetrics; trace: PlotPoint[];
}
interface Result {
  accepted: boolean; baseKw: number; executedAt: number | null; reason: string | null;
}
type PacketBody =
  | { type: 'command'; command: Command }
  | { type: 'ack'; command: Command; result: Result }
  | { type: 'telemetry'; measurement: DeviceMeasurement;reconcile?:boolean }
  | { type: 'pv'; value: number; sampledAt: number }
  | { type:'sensor';value:number;sampledAt:number }
  | { type:'query' };
type Packet = { order: number; due: number; origin: string;latency:number } & PacketBody;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const roundTime = (n: number) => Math.round(n * 1e9) / 1e9;
const fingerprint = (c: Command) => JSON.stringify([c.sequence, c.deltaKw, c.createdAt]);
export function requiredBase(config:Pick<SimulationConfig,'servedDemandKw'|'pvInitialKw'|'windKw'>):number {
  return config.servedDemandKw+PHYSICS.lossKw-config.pvInitialKw-config.windKw;
}

export function validateSimulationConfig(config:Readonly<SimulationConfig>):void {
    if (!Number.isFinite(config.stepSeconds) || config.stepSeconds <= 0 || config.stepSeconds > 0.05) throw Error('模拟步长必须在 (0, 0.05] 秒');
    if (!Number.isFinite(config.duration) || config.duration < 10 || config.duration > 120
      || Math.abs(config.duration / config.stepSeconds - Math.round(config.duration / config.stepSeconds)) > 1e-6) throw Error('时长必须为步长的整数倍，且在 10—120 秒');
    if (!Number.isFinite(config.capacityKwh) || config.capacityKwh<=0 || config.capacityKwh>INPUT_LIMITS.capacityKwh
      || !Number.isFinite(config.initialEnergyKwh) || config.initialEnergyKwh < 0 || config.initialEnergyKwh > config.capacityKwh) throw Error('初始电量或容量越界');
    if (!Number.isFinite(config.pvInitialKw) || config.pvInitialKw < 0 || config.pvInitialKw > INPUT_LIMITS.sourceKw
      || !Number.isFinite(config.pvDropKw) || config.pvDropKw < 0 || config.pvDropKw > config.pvInitialKw) throw Error('光伏输入不合法');
    if (!Number.isFinite(config.windKw) || config.windKw<0 || config.windKw>INPUT_LIMITS.sourceKw) throw Error('风电输入不合法');
    if (![config.demandKw,config.servedDemandKw,config.criticalDemandKw,config.servedCriticalKw].every(n=>Number.isFinite(n)&&n>=0&&n<=INPUT_LIMITS.demandKw*2)
      || config.servedDemandKw>config.demandKw || config.criticalDemandKw>config.demandKw
      || config.servedCriticalKw>Math.min(config.servedDemandKw,config.criticalDemandKw)) throw Error('负荷需求与接入量不合法');
    if (!Number.isFinite(config.maxBatteryKw) || config.maxBatteryKw<=0 || config.maxBatteryKw>INPUT_LIMITS.batteryKw
      || (config.initialBaseKw!==null && (!Number.isFinite(config.initialBaseKw)||Math.abs(config.initialBaseKw)>config.maxBatteryKw))) throw Error('储能功率范围不合法');
    if (!Number.isFinite(config.commandDeltaKw) || config.commandDeltaKw<0 || config.commandDeltaKw>INPUT_LIMITS.commandKw
      || typeof config.formingAvailable!=='boolean') throw Error('成网或调节配置不合法');
    if (!Number.isFinite(config.retryAfter) || config.retryAfter < 0.6 || config.retryAfter > 6) throw Error('重试间隔必须为 0.6—6 秒');
    if (!['lost-ack', 'healthy', 'partition'].includes(config.fault) || typeof config.deduplicate !== 'boolean') throw Error('协议配置不合法');
    if(!isMissionId(config.scenario)||!(config.commandTtl===null||(Number.isFinite(config.commandTtl)&&config.commandTtl>=.5&&config.commandTtl<=30))
      ||!['droop','restore'].includes(config.localMode)||![.5,1,2,3,4,8].includes(config.telemetryEvery)||!['retry','observe'].includes(config.retryPolicy)
      ||typeof config.priority!=='boolean'||!['resume','reconcile'].includes(config.reconnect)
      ||!Number.isFinite(config.planCost)||config.planCost<0||config.planCost>500)throw Error('任务或扩展协议配置不合法');
}

export class Simulation {
  readonly config: Readonly<SimulationConfig>;
  private tick = 0;
  private physical: PhysicalState;
  private known: KnownState;
  private log: SimEvent[] = [];
  private history: Snapshot[] = [];
  private queue: Packet[] = [];
  private outbox:Packet[]=[];
  private packetOrder = 0;
  private ledger = new Map<string, { fingerprint: string; result: Result }>();
  private highestSequence = 0;
  private applied = 0;
  private activeCommand: Command | null = null;
  private nextDeadline = Infinity;
  private firstAckLost = false;
  private weatherIndex=0;
  private nextTelemetry:number;
  private nextTransmit=0;
  private initialCommandAt:number|null=null;
  private expiredCommands=0;
  private localSeconds=0;
  private localNoted=false;
  private messagesSent=0;
  private messagesDelivered=0;
  private peakQueue=0;
  private maxDataAge=0;
  private reconcileAt:number|null=null;
  private wasConnected=true;
  private uncertainSeconds=0;
  private commandPackets=0;
  private servedEnergy = 0;
  private demandEnergy = 0;
  private servedCriticalEnergy = 0;
  private criticalDemandEnergy = 0;
  private peakDeviation = 0;
  private protectionTime = 0;

  constructor(config: SimulationConfig = { ...DEFAULT_CONFIG }) {
    validateSimulationConfig(config);
    this.config = Object.freeze({ ...config });
    this.nextTelemetry=config.telemetryEvery;
    this.wasConnected=this.connected();
    const baseKw = clamp(config.initialBaseKw ?? requiredBase(config), -config.maxBatteryKw, config.maxBatteryKw);
    const energized = config.formingAvailable && config.initialEnergyKwh > 0;
    this.physical = {
      frequencyHz: energized ? 50 : null, pvKw: energized ? config.pvInitialKw : 0, windKw:energized?config.windKw:0,
      batteryKw: energized ? baseKw : 0, baseKw,localKw:0,
      energyKwh: config.initialEnergyKwh, energized,
      servedKw: energized ? config.servedDemandKw : 0, criticalServedKw:energized?config.servedCriticalKw:0,
    };
    // t=0 为开班前已经完成的点检，不通过未来真值初始化中央。
    this.known = {
      device: this.measureDevice(),
      pv: { value: this.physical.pvKw, sampledAt: 0, receivedAt: 0 },
      command: null,
    };
    this.record('briefing', '开班点检完成', '电池、光伏与负荷已确认。之后中央仅更新收到的消息。');
    this.saveFrame();
  }
  get time(): number { return roundTime(this.tick * this.config.stepSeconds); }
  get actionTime():number|null{return MISSIONS[this.config.scenario].actionAt;}
  get events(): SimEvent[] { return structuredClone(this.log); }
  get trace(): PlotPoint[] {
    return this.history.map(s => ({
      time: s.time, frequencyHz: s.physical.frequencyHz,
      knownFrequencyHz: s.known.device.frequencyHz, knownSampledAt: s.known.device.sampledAt,
      batteryKw: s.physical.batteryKw, baseKw: s.physical.baseKw,
      energyKwh: s.physical.energyKwh, servedKw: s.physical.servedKw,
      windKw:s.physical.windKw,criticalServedKw:s.physical.criticalServedKw,
    }));
  }
  snapshot(): Snapshot {
    return structuredClone({ time: this.time, physical: this.physical, known: this.known, appliedCount: this.applied,
      network:{connected:this.connected(),queued:this.queue.length+this.outbox.length,sent:this.messagesSent,delivered:this.messagesDelivered,expired:this.expiredCommands,reconciled:this.reconcileAt!==null} });
  }
  snapshotAt(time: number): Snapshot {
    const index = this.history.findLastIndex(s => s.time <= time + 1e-8);
    return structuredClone(this.history[Math.max(0, index)]!);
  }
  dispatchAdjustment(): Command {
    if (this.activeCommand) throw Error('本关只调节一次；重试请复用原命令');
    return this.beginCommand('C17',1);
  }
  private beginCommand(id:string,sequence:number):Command {
    const command: Command = { id, sequence, deltaKw: this.config.commandDeltaKw, createdAt: this.time };
    this.initialCommandAt??=this.time;
    this.activeCommand = command;
    this.known.command = {
      id: command.id, status: 'unconfirmed', attempts: 1, createdAt: this.time,
      executedAt: null, confirmedAt: null, reportedBaseKw: null, source: null,
    };
    this.transmit(command);
    this.nextDeadline = roundTime(this.time + this.config.retryAfter);
    this.saveFrame();
    return { ...command };
  }
  transmit(command: Command): void {
    if (!command.id || !Number.isInteger(command.sequence) || command.sequence < 1
      || !Number.isFinite(command.deltaKw) || Math.abs(command.deltaKw) > INPUT_LIMITS.commandKw
      || !Number.isFinite(command.createdAt) || command.createdAt > this.time) throw Error('命令内容不合法');
    this.commandPackets++;
    const origin = this.record('sent', command.id + ' 发出', '增加基准 ' + command.deltaKw + ' kW；发送不代表设备已执行。', command.id,null,null,this.commandFact(command,'sent'));
    this.enqueue({type:'command',command:{...command}},origin,MISSIONS[this.config.scenario].commandLatency);
  }
  advanceTo(target: number,scripted=false): void {
    if (!Number.isFinite(target) || target < this.time - 1e-8) throw Error('不能倒退模拟；请使用回放快照');
    const targetTick = Math.min(Math.round(this.config.duration / this.config.stepSeconds), Math.floor((target + 1e-8) / this.config.stepSeconds));
    while (this.tick < targetTick){
      this.step();
      if(scripted&&this.actionTime!==null&&this.time+1e-8>=this.actionTime&&this.initialCommandAt===null)this.dispatchAdjustment();
    }
  }
  report(): TrialReport {
    const tail = this.trace.filter(p => p.time >= this.config.duration - MISSION_TARGETS.settledWindowSeconds);
    const settledDeviationHz = tail.length && tail.every(p => p.frequencyHz !== null)
      ? Math.max(...tail.map(p => Math.abs(p.frequencyHz! - 50))) : null;
    const confirmed = this.known.command?.status === 'confirmed';
    const confirmationSeconds = confirmed && this.known.command?.confirmedAt !== null
      ? this.known.command!.confirmedAt! - this.known.command!.createdAt : null;
    const serviceRatio = this.demandEnergy > 0 ? this.servedEnergy / this.demandEnergy : 0;
    const criticalServiceRatio=this.criticalDemandEnergy>0?this.servedCriticalEnergy/this.criticalDemandEnergy:0;
    const metrics:TrialMetrics={
      peakDeviationHz:this.peakDeviation,settledDeviationHz,energyUsedKwh:this.config.initialEnergyKwh-this.physical.energyKwh,
      unservedKwh:Math.max(0,this.demandEnergy-this.servedEnergy),serviceRatio,criticalServiceRatio,
      appliedCount:this.applied,attempts:this.known.command?.attempts??0,confirmationSeconds,
      finalEnergyKwh:this.physical.energyKwh,initialMismatchKw:(this.config.initialBaseKw??requiredBase(this.config))-requiredBase(this.config),
      expiredCommands:this.expiredCommands,localSeconds:this.localSeconds,messagesSent:this.messagesSent,peakQueue:this.peakQueue,maxDataAge:this.maxDataAge,
      uncertainSeconds:this.uncertainSeconds,commandPackets:this.commandPackets,
      reconcileSeconds:this.reconcileAt===null?null:this.reconcileAt-MISSIONS[this.config.scenario].linkWindow![1],
    };
    const goals=gradeTrial(this.config,metrics),success=goals.every(g=>g.passed);
    return {
      schema:1,modelRevision:MODEL_REVISION,config:{...this.config},commandAt:this.initialCommandAt,success,stars:trialStars(success,metrics,this.config.scenario),goals,metrics,trace:this.trace,
    };
  }
  private commandFact(command:Command,outcome:CommandEvidence['outcome'],state?:Pick<CommandEvidence,'beforeBaseKw'|'afterBaseKw'|'executedAt'>):CommandEvidence {
    return {createdAt:command.createdAt,sequence:command.sequence,deltaKw:command.deltaKw,outcome,...state};
  }
  private record(kind: EventKind, title: string, detail: string, commandId: string | null = null, relatedId: string | null = null, reason: string | null = null,evidence?:CommandEvidence): string {
    const id = 'E' + (this.log.length + 1);
    this.log.push({ id, time: this.time, kind, title, detail, commandId, relatedId, reason,...(evidence?{evidence}:{} ) });
    return id;
  }
  private measureDevice(): DeviceMeasurement {
    const applied = [...this.log].reverse().find(e => e.kind === 'applied');
    return {
      batteryKw: this.physical.batteryKw, baseKw: this.physical.baseKw,
      energyKwh: this.physical.energyKwh, frequencyHz: this.physical.frequencyHz,
      lastCommandId: applied?.commandId ?? null, lastAppliedAt: applied?.time ?? null,
      sampledAt: this.time, receivedAt: this.time,
    };
  }
  private connected():boolean {
    const window=MISSIONS[this.config.scenario].linkWindow;
    return this.config.fault!=='partition'&&!(window&&this.time>=window[0]-1e-8&&this.time<window[1]-1e-8);
  }
  private enqueue(body:PacketBody,origin='',latency:number=PHYSICS.latencySeconds):void {
    const packet:Packet={...body,origin,latency,order:this.packetOrder++,due:roundTime(this.time+latency)};
    this.messagesSent++;
    if(MISSIONS[this.config.scenario].capacity>0)this.outbox.push(packet);else this.queue.push(packet);
    this.peakQueue=Math.max(this.peakQueue,this.queue.length+this.outbox.length);
  }
  private pumpChannel():void {
    const capacity=MISSIONS[this.config.scenario].capacity;
    if(!capacity||!this.outbox.length||this.time+1e-8<this.nextTransmit)return;
    const priority=(packet:Packet)=>['command','ack','query'].includes(packet.type)?0:packet.type==='telemetry'?1:2;
    this.outbox.sort((a,b)=>(this.config.priority?priority(a)-priority(b):0)||a.order-b.order);
    const packet=this.outbox.shift()!;
    const serviceAt=Math.max(this.nextTransmit,roundTime(packet.due-packet.latency));
    packet.due=roundTime(serviceAt+packet.latency);this.queue.push(packet);
    this.nextTransmit=roundTime(serviceAt+1/capacity);
  }
  private updateProgram():void {
    const mission=MISSIONS[this.config.scenario];
    while(mission.weather[this.weatherIndex]&&this.time+1e-8>=mission.weather[this.weatherIndex]!.at){
      const weather=mission.weather[this.weatherIndex++]!;
      this.physical.pvKw=this.physical.energized?Math.max(0,this.config.pvInitialKw*weather.pvFactor-(weather.drop?this.config.pvDropKw:0)):0;
      if(weather.windFactor!==undefined)this.physical.windKw=this.physical.energized?this.config.windKw*weather.windFactor:0;
      const origin=this.record(weather.drop?'cloud':'weather',weather.title,
        '当前光伏 '+this.physical.pvKw.toFixed(1)+' kW，风电 '+this.physical.windKw.toFixed(1)+' kW。电力线路仍然连接。');
      this.enqueue({type:'pv',value:this.physical.pvKw,sampledAt:this.time},origin);
    }
    const connected=this.connected();
    if(connected!==this.wasConnected){
      this.wasConnected=connected;
      this.record(connected?'link-restored':'link-lost',connected?'通信链路恢复':'通信链路中断',connected?'连通已恢复，中央仍需核对设备记录。':'电力通路没有断开；中央收不到新的设备记录。',null,null,'transport-change');
      if(connected&&this.initialCommandAt!==null){
        if(this.config.reconnect==='reconcile'){
          const origin=this.record('reconcile','发起状态核对','先请求新的设备记录，收到后再决定是否接管。');
          this.enqueue({type:'query'},origin);
        }else if(this.known.command?.status!=='confirmed'){
          this.record('reconcile','未核对，重新下发调节意图','中央尚未确认 C17，直接新建 C18；新编号不能被 C17 的去重记录拦截。');
          this.beginCommand('C18',2);
        }
      }
    }
  }
  private step(): void {
    const powerLost = this.integratePhysical();
    this.tick++;
    if (powerLost) this.record('power-lost', '成网源停止供电', powerLost);
    this.updateProgram();
    if (this.time + 1e-8 >= this.nextTelemetry) {
      this.enqueue({type:'telemetry',measurement:this.measureDevice()});
      if(MISSIONS[this.config.scenario].capacity>0){
        // 其余五台装置也占用同一条有限信道，不凭空增加传输容量。
        for(const value of [this.physical.pvKw,this.physical.windKw,this.physical.servedKw,this.physical.criticalServedKw,this.physical.servedKw-this.physical.criticalServedKw])this.enqueue({type:'sensor',value,sampledAt:this.time});
      }
      this.nextTelemetry += this.config.telemetryEvery;
    }
    this.pumpChannel();
    // 同刻先投递，再处理超时；不会因为遍历顺序凭空多发重试。
    this.queue.sort((a, b) => a.due - b.due || a.order - b.order);
    while (this.queue[0] && this.queue[0].due <= this.time + 1e-8) {
      const packet = this.queue.shift()!;
      this.deliver(packet);
      this.queue.sort((a, b) => a.due - b.due || a.order - b.order);
    }
    const pending = this.known.command;
    if (pending && pending.status === 'unconfirmed' && this.time + 1e-8 >= this.nextDeadline) {
      if(this.config.retryPolicy==='observe'){
        this.nextDeadline=Infinity;
        this.record('waiting','等待下一份遥测核对','不新增调节报文，等待设备记录到达。确认更慢，信道占用更少。',pending.id);
      }else if (pending.attempts < PHYSICS.maxAttempts) {
        pending.attempts++;
        this.record('retry', '超时，重发同一 '+pending.id, '中央还没有确认，沿用原编号与原内容重试。', pending.id);
        this.transmit(this.activeCommand!);
        this.nextDeadline = roundTime(this.time + this.config.retryAfter);
      } else {
        pending.status = 'exhausted';
        this.record('exhausted', '重试次数已用尽', '停止继续发送；结果仍需有效回执或后续遥测核对。', pending.id);
      }
    }
    if(this.time>=6)this.maxDataAge=Math.max(this.maxDataAge,this.time-this.known.device.sampledAt);
    const last = this.history.at(-1)!;
    if (this.time >= last.time + 0.1 - 1e-8 || this.time >= this.config.duration) this.saveFrame();
  }
  private integratePhysical(): string | null {
    const state = this.physical;
    const dt = this.config.stepSeconds;
    if(this.known.command&&['unconfirmed','exhausted'].includes(this.known.command.status))this.uncertainSeconds+=dt;
    this.demandEnergy += this.config.demandKw * dt / 3600;
    this.criticalDemandEnergy += this.config.criticalDemandKw*dt/3600;
    if (!state.energized) return null;
    const f = state.frequencyHz!;
    if(this.config.localMode==='restore'){
      state.localKw=clamp(state.localKw+(50-f)*PHYSICS.secondaryKwPerHzSecond*dt,-this.config.maxBatteryKw-state.baseKw,this.config.maxBatteryKw-state.baseKw);
      if(!this.connected())this.localSeconds+=dt;
      if(!this.localNoted&&Math.abs(f-50)>.01){this.localNoted=true;this.record('local','本地频率恢复开始响应','只读取设备本地频率，调整本地修正量，不替中央确认命令。');}
    }
    const target = clamp(state.baseKw+state.localKw+PHYSICS.droopKwPerHz*(50-f),-this.config.maxBatteryKw,this.config.maxBatteryKw);
    const change = clamp((target - state.batteryKw) * dt / PHYSICS.responseSeconds, -PHYSICS.rampKwPerSecond * dt, PHYSICS.rampKwPerSecond * dt);
    const maxDischarge = Math.min(this.config.maxBatteryKw, state.energyKwh * 3600 * PHYSICS.dischargeEfficiency / dt);
    const maxCharge = Math.min(this.config.maxBatteryKw, (this.config.capacityKwh - state.energyKwh) * 3600 / PHYSICS.chargeEfficiency / dt);
    state.batteryKw = clamp(state.batteryKw + change, -maxCharge, maxDischarge);
    state.energyKwh += state.batteryKw >= 0
      ? -state.batteryKw * dt / 3600 / PHYSICS.dischargeEfficiency
      : -state.batteryKw * dt / 3600 * PHYSICS.chargeEfficiency;
    state.energyKwh = clamp(state.energyKwh, 0, this.config.capacityKwh);
    if (state.energyKwh < 1e-10) state.energyKwh = 0;
    // 有效 M 只描述教学动态；频率敏感负荷/阻尼项与实际注入分开。
    const mismatch = state.pvKw + state.windKw + state.batteryKw - state.servedKw - PHYSICS.lossKw - PHYSICS.dampingKwPerHz * (f - 50);
    state.frequencyHz = f + mismatch * dt / PHYSICS.effectiveM;
    this.peakDeviation = Math.max(this.peakDeviation, Math.abs(state.frequencyHz - 50));
    this.servedEnergy += state.servedKw * dt / 3600;
    this.servedCriticalEnergy +=state.criticalServedKw*dt/3600;
    this.protectionTime = Math.abs(state.frequencyHz - 50) > 2 ? this.protectionTime + dt : 0;
    if (state.energyKwh === 0 || this.protectionTime >= 3) {
      state.energized = false;
      state.frequencyHz = null;
      state.batteryKw = 0; state.pvKw = 0;state.windKw=0;state.servedKw = 0;state.criticalServedKw=0;
      return state.energyKwh === 0 ? '储能耗尽；本原型不模拟无源黑启动。' : '持续超出保护范围，成网源退出。';
    }
    return null;
  }
  private deliver(packet: Packet): void {
    if (!this.connected()) {
      const window=MISSIONS[this.config.scenario].linkWindow;
      if(packet.type==='command'&&window){packet.due=roundTime(window[1]+packet.latency);this.queue.push(packet);}
      if (packet.type==='command'||packet.type==='ack'||packet.type==='telemetry') this.record('link-lost', '通信链路未送达', '消息失联，设备本地控制继续运行。', packet.type === 'command' || packet.type === 'ack' ? packet.command.id : null, packet.origin);
      return;
    }
    if(packet.type==='ack'&&this.config.fault==='lost-ack'&&!this.firstAckLost&&packet.result.accepted){
      this.firstAckLost=true;this.record('ack-lost','回执丢失','设备已经处理了命令，这份回执没有到达中央。',packet.command.id,packet.origin,null,this.commandFact(packet.command,'lost',{executedAt:packet.result.executedAt}));return;
    }
    this.messagesDelivered++;
    if (packet.type === 'command') { this.receiveCommand(packet); return; }
    if(packet.type==='sensor')return;
    if(packet.type==='query'){this.enqueue({type:'telemetry',measurement:this.measureDevice(),reconcile:true},packet.origin);return;}
    if (packet.type === 'pv') {
      if (packet.sampledAt >= this.known.pv.sampledAt) this.known.pv = { value: packet.value, sampledAt: packet.sampledAt, receivedAt: this.time };
      return;
    }
    if (packet.type === 'ack') {
      const pending = this.known.command;
      if (!pending || pending.id !== packet.command.id || fingerprint(packet.command) !== fingerprint(this.activeCommand!)) return;
      if (packet.result.accepted) {
        if (!this.confirmKnown(packet.command.id, packet.result, 'ack')) return;
      } else {
        if (pending.status === 'confirmed') return;
        pending.status = 'rejected';
        pending.executedAt = null; pending.confirmedAt = this.time;
        pending.reportedBaseKw = packet.result.baseKw; pending.source = 'ack';
      }
      this.record('ack-received', packet.result.accepted ? '中央收到执行回执' : '中央收到拒绝回执',packet.result.accepted?'回执指向 '+packet.result.executedAt!.toFixed(1)+' 秒时的处理结果；它不是当前遥测。':'设备返回了拒绝记录，基准没有因这条请求改变；原因见设备事件。', packet.command.id, packet.origin,null,this.commandFact(packet.command,packet.result.accepted?'confirmed':'rejected',{executedAt:packet.result.executedAt}));
      return;
    }
    const measurement = packet.measurement;
    if (measurement.sampledAt < this.known.device.sampledAt) return;
    this.known.device = { ...measurement, receivedAt: this.time };
    this.record('telemetry', '电池遥测到达', '采样于 ' + measurement.sampledAt.toFixed(1) + ' 秒，携带实际出力和电量。');
    if(packet.reconcile){
      this.reconcileAt=this.time;
      this.record('reconciled','新的设备记录已核对','采样于 '+measurement.sampledAt.toFixed(1)+' 秒；记录通过链路到达后，中央才更新所知。',measurement.lastCommandId,packet.origin);
    }
    const pending = this.known.command;
    if (pending && measurement.lastCommandId === pending.id && measurement.lastAppliedAt !== null) {
      if(this.confirmKnown(pending.id, { accepted: true, baseKw: measurement.baseKw, executedAt: measurement.lastAppliedAt, reason: null }, 'telemetry')){
        const action=this.log.findLast(e=>e.kind==='applied'&&e.commandId===pending.id&&e.time===measurement.lastAppliedAt);
        this.record('ack-received','遥测核对已确认执行','新的设备记录到达，中央确认先前的执行；没有新增设备动作。',pending.id,action?.id??null,'telemetry-confirmed',this.commandFact(this.activeCommand!,'confirmed',{executedAt:measurement.lastAppliedAt}));
      }
    }
  }
  private confirmKnown(id: string, result: Result, source: 'ack' | 'telemetry'): boolean {
    const pending = this.known.command;
    if (!pending || pending.id !== id || result.executedAt === null || result.executedAt < pending.createdAt) return false;
    // 已经确认也可能收到更新的执行证据；旧回执则不能覆盖更新结果。
    if (pending.status === 'confirmed' && result.executedAt <= (pending.executedAt ?? -Infinity)) return false;
    pending.status = 'confirmed'; pending.confirmedAt = this.time;
    pending.executedAt = result.executedAt;
    pending.reportedBaseKw = result.baseKw; pending.source = source;
    return true;
  }
  private receiveCommand(packet: Extract<Packet, { type: 'command' }>): void {
    const command = packet.command;
    const arrived = this.record('delivered', command.id + ' 到达设备', '设备将检查身份、内容与序号。', command.id, packet.origin,null,this.commandFact(command,'arrived'));
    const prior = this.ledger.get(command.id);
    let result: Result;
    if (prior && prior.fingerprint !== fingerprint(command)) {
      result = { accepted: false, baseKw: this.physical.baseKw, executedAt: null, reason: 'identity-conflict' };
    } else if (prior && this.config.deduplicate) {
      const eventId = this.record('duplicate', '识别重复 '+command.id+'，返回原结果',prior.result.accepted?'基准没有再次增加，原执行时刻保持不变。':'先前未执行，这次仍返回原拒绝记录。', command.id, arrived,null,this.commandFact(command,'cached',{beforeBaseKw:this.physical.baseKw,afterBaseKw:this.physical.baseKw,executedAt:prior.result.executedAt}));
      this.sendAck(command, prior.result, eventId);
      return;
    } else if (command.sequence < this.highestSequence) {
      result = { accepted: false, baseKw: this.physical.baseKw, executedAt: null, reason: 'stale-sequence' };
    } else if(this.config.commandTtl!==null&&this.time-command.createdAt>this.config.commandTtl+1e-8){
      result={accepted:false,baseKw:this.physical.baseKw,executedAt:null,reason:'expired-command'};
      this.expiredCommands++;
      if(!prior)this.ledger.set(command.id,{fingerprint:fingerprint(command),result:{...result}});
    } else if (!this.physical.energized) {
      result = { accepted: false, baseKw: this.physical.baseKw, executedAt: null, reason: 'device-offline' };
    } else {
      const beforeBaseKw=this.physical.baseKw;
      this.physical.baseKw = clamp(this.physical.baseKw + command.deltaKw, -this.config.maxBatteryKw, this.config.maxBatteryKw);
      this.highestSequence = Math.max(this.highestSequence, command.sequence);
      this.applied++;
      result = { accepted: true, baseKw: this.physical.baseKw, executedAt: this.time, reason: null };
      this.ledger.set(command.id, { fingerprint: fingerprint(command), result: { ...result } });
      const eventId = this.record('applied', '基准出力已增加至 ' + this.physical.baseKw + ' kW', '第 ' + this.applied + ' 次执行；实际出力仍由本地频率响应与设备约束决定。', command.id, arrived,null,this.commandFact(command,'applied',{beforeBaseKw,afterBaseKw:this.physical.baseKw,executedAt:this.time}));
      this.sendAck(command, result, eventId);
      return;
    }
    const rejected = this.record('rejected', '设备拒绝命令', result.reason === 'identity-conflict' ? '相同编号携带了不同内容。' : result.reason === 'stale-sequence' ? '旧序号不能覆盖更新的命令。' : result.reason==='expired-command'?'命令已超过有效期，未执行；不会撤销已发生的事实。':'储能未向当前母线供电，无法执行本次调节。', command.id, arrived, result.reason,this.commandFact(command,result.reason==='expired-command'?'expired':'rejected',{beforeBaseKw:this.physical.baseKw,afterBaseKw:this.physical.baseKw,executedAt:null}));
    this.sendAck(command, result, rejected);
  }
  private sendAck(command: Command, result: Result, origin: string): void {
    this.enqueue({type:'ack',command:{...command},result:{...result}},origin);
  }
  private saveFrame(): void {
    const frame = this.snapshot();
    if (this.history.at(-1)?.time === frame.time) this.history[this.history.length - 1] = frame;
    else this.history.push(frame);
  }
}
