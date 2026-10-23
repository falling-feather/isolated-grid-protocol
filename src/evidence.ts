import { MODEL_REVISION } from './simulation.ts';
import type { SimEvent,Snapshot,TrialReport,SimulationConfig } from './simulation.ts';
import { comparable } from './storage.ts';
export interface MessageEvidence {
  label:string;commandId:string;createdAt:number|null;sent:SimEvent;
  arrival:SimEvent|null;action:SimEvent|null;receipts:SimEvent[];interruptions:SimEvent[];
}
export function commandEvidence(events:readonly SimEvent[]):MessageEvidence[] {
  const byId=new Map(events.map(e=>[e.id,e]));
  const root=(event:SimEvent):string|null=>{
    const seen=new Set<string>();let current:SimEvent|undefined=event;
    while(current&&!seen.has(current.id)){
      if(current.kind==='sent')return current.id;
      seen.add(current.id);current=current.relatedId?byId.get(current.relatedId):undefined;
    }return null;
  };
  return events.filter(e=>e.kind==='sent'&&e.commandId).map((sent,index)=>{
    const chain=events.filter(e=>root(e)===sent.id);
    return {label:'M'+String(index+1).padStart(2,'0'),commandId:sent.commandId!,createdAt:sent.evidence?.createdAt??null,sent,
      arrival:chain.find(e=>e.kind==='delivered')??null,
      action:chain.find(e=>['applied','duplicate','rejected'].includes(e.kind))??null,
      receipts:chain.filter(e=>e.kind==='ack-lost'||e.kind==='ack-received'),
      interruptions:chain.filter(e=>e.kind==='link-lost'),
    };
  });
}
export function knowledgeGap(snapshot:Snapshot){
  const command=snapshot.known.command;
  const differenceKw=snapshot.physical.baseKw-snapshot.known.device.baseKw;
  return {actualBaseKw:snapshot.physical.baseKw,sampledBaseKw:snapshot.known.device.baseKw,
    differenceKw,hasBaseGap:Math.abs(differenceKw)>.01,
    sampledAt:snapshot.known.device.sampledAt,ageSeconds:snapshot.time-snapshot.known.device.sampledAt,
    resultBaseKw:command?.reportedBaseKw??null,executedAt:command?.executedAt??null,confirmedAt:command?.confirmedAt??null,status:command?.status??'not-sent'};
}
export function recentEventAt(events:readonly SimEvent[],time:number):SimEvent|undefined {
  return events.findLast(e=>e.time<=time+1e-8&&(e.reason==='transport-change'||['cloud','weather','applied','ack-lost','ack-received','duplicate','rejected','link-restored','reconciled','local'].includes(e.kind)));
}
export function strategyLabel(config:SimulationConfig):string {
  if(config.scenario==='echo')return config.retryPolicy==='observe'?'等待遥测核对':config.deduplicate?'同编号重试并去重':'无去重重试';
  if(config.scenario==='traffic')return config.telemetryEvery+' 秒报告 / '+(config.priority?'关键消息优先':'普通队列');
  return (config.localMode==='restore'?'本地恢复':'下垂响应')+' / '+(config.reconnect==='reconcile'?'先核对':'直接重调');
}
export function compareStrategies(previous:TrialReport,current:TrialReport){
  if(current.modelRevision!==MODEL_REVISION||!comparable(previous,current.config))return null;
  return {previous,current,previousLabel:strategyLabel(previous.config),currentLabel:strategyLabel(current.config),
    messagesDelta:current.metrics.messagesSent-previous.metrics.messagesSent,
    uncertaintyDelta:current.metrics.uncertainSeconds-previous.metrics.uncertainSeconds,
    confirmationDelta:current.metrics.confirmationSeconds===null||previous.metrics.confirmationSeconds===null?null:current.metrics.confirmationSeconds-previous.metrics.confirmationSeconds,
  };
}
