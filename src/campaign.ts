import { CAMPAIGN,MISSIONS,MISSION_TARGETS,isMissionId } from './missions.ts';
import type { MissionId,FieldRange,ProtocolKey } from './missions.ts';
import { NODE_FIELDS,analyzeDesign,createDesign,numberValue,validateDesign } from './network.ts';
import type { GridDesign,GridNode,NumericKey } from './network.ts';
import type { SimulationConfig,TrialReport,SimEvent } from './simulation.ts';
import { MODEL_REVISION,requiredBase } from './simulation.ts';
import { decodeReport } from './storage.ts';

export const CAMPAIGN_KEY='island-protocol.campaign.1';
export interface MissionProgress {attempts:number;wins:number;stars:number;bestPeak:number|null;last:TrialReport|null}
export interface CampaignState {
  schema:1;selected:MissionId;tutorial:'new'|'started'|'done'|'skipped';
  designs:Partial<Record<MissionId,GridDesign>>;progress:Partial<Record<MissionId,MissionProgress>>;
}
export function newCampaign():CampaignState{return {schema:1,selected:'training',tutorial:'new',designs:{},progress:{}};}
export interface CampaignRecords {schema:1;current:CampaignState;previous:CampaignState|null}
export function newCampaignRecords():CampaignRecords{return {schema:1,current:newCampaign(),previous:null};}
export function decodeCampaignRecords(raw:string|null):CampaignRecords {
  if(raw===null)return newCampaignRecords();
  const source=record(JSON.parse(raw));
  // 已存在的单份存档保持原编号，下一次保存时迁移为单键原子写入。
  if(!Object.hasOwn(source,'current'))return {schema:1,current:decodeCampaign(raw),previous:null};
  if(source['schema']!==1)throw Error('值班记录版本不正确');
  return {schema:1,current:decodeCampaign(JSON.stringify(source['current'])),previous:source['previous']===null?null:decodeCampaign(JSON.stringify(source['previous']))};
}
export function freshCampaignRecord(records:CampaignRecords):CampaignRecords {
  return {schema:1,current:newCampaign(),previous:structuredClone(records.current)};
}
export function restoreCampaignRecord(records:CampaignRecords):CampaignRecords {
  if(!records.previous)throw Error('没有可恢复的上次值班记录');
  return {schema:1,current:structuredClone(records.previous),previous:structuredClone(records.current)};
}
export function createMissionDesign(id:MissionId):GridDesign {
  const design=createDesign(),mission=MISSIONS[id];
  Object.assign(design.protocol,mission.protocol);
  for(const node of design.nodes)Object.assign(node,mission.overrides?.[node.kind]);
  if(id==='training'){design.edges=design.edges.filter(e=>e.id!=='e4');design.speed=2;}
  return validateDesign(design);
}
export function fieldRange(id:MissionId,node:GridNode,key:NumericKey):FieldRange|null {
  if(id==='lab')return NODE_FIELDS[node.kind].find(field=>field.key===key)??null;
  return MISSIONS[id].fields[`${node.kind}.${key}`]??null;
}
export function protocolEditable(id:MissionId,key:ProtocolKey|'fault'):boolean {
  return id==='lab'||(key!=='fault'&&MISSIONS[id].controls.includes(key));
}
export function validateMissionDesign(id:MissionId,value:unknown):GridDesign {
  const design=validateDesign(value);if(id==='lab')return design;
  const preset=createMissionDesign(id);
  for(const node of design.nodes)for(const field of NODE_FIELDS[node.kind]){
    const range=fieldRange(id,node,field.key),actual=numberValue(node,field.key);
    if(range){if(actual<range.min||actual>range.max)throw Error(field.label+'应在 '+range.min+'—'+range.max+' '+field.unit+' 之间');}
    else if(actual!==numberValue(preset.nodes.find(n=>n.kind===node.kind)!,field.key))throw Error('本关的'+field.label+'为固定条件');
  }
  for(const key of Object.keys(design.protocol) as (ProtocolKey|'fault')[]){
    if(!protocolEditable(id,key)&&design.protocol[key]!==preset.protocol[key])throw Error('本关尚未开放此通信设置');
  }
  return design;
}
export function expansionCost(design:GridDesign):number {
  const solar=design.nodes.find(n=>n.kind==='solar')!,wind=design.nodes.find(n=>n.kind==='wind')!,battery=design.nodes.find(n=>n.kind==='battery')!;
  return Math.max(0,solar.powerKw-50)+Math.max(0,wind.powerKw-20)+Math.max(0,battery.maxKw-65);
}
export function missionConfig(id:MissionId,design:GridDesign):SimulationConfig {
  const clean=validateMissionDesign(id,design);
  return {...analyzeDesign(clean).config,scenario:id,duration:MISSIONS[id].duration,planCost:id==='night'?expansionCost(clean):0};
}
export function unlocked(state:CampaignState,id:MissionId):boolean {
  if(id==='training'||id==='lab')return true;
  const index=CAMPAIGN.indexOf(id);
  return index===0?state.tutorial==='done'||state.tutorial==='skipped':((state.progress[CAMPAIGN[index-1]!]?.wins??0)>0);
}
export function nextMission(id:MissionId):MissionId|null {
  if(id==='training')return 'echo';
  const index=CAMPAIGN.indexOf(id as typeof CAMPAIGN[number]);
  return index>=0&&index<CAMPAIGN.length-1?CAMPAIGN[index+1]!:null;
}
export function startAttempt(state:CampaignState,id:MissionId):void {
  const p=state.progress[id]??{attempts:0,wins:0,stars:0,bestPeak:null,last:null};p.attempts++;state.progress[id]=p;
}
export function finishAttempt(state:CampaignState,id:MissionId,report:TrialReport):void {
  if(report.config.scenario!==id)throw Error('测试结果不属于当前关卡');
  const p=state.progress[id]??{attempts:1,wins:0,stars:0,bestPeak:null,last:null};
  p.last=structuredClone(report);
  if(report.success){p.wins++;p.stars=Math.max(p.stars,report.stars);p.bestPeak=p.bestPeak===null?report.metrics.peakDeviationHz:Math.min(p.bestPeak,report.metrics.peakDeviationHz);if(id==='training')state.tutorial='done';}
  state.progress[id]=p;
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('训练进度格式不正确');return value as Record<string,unknown>;}
export function decodeCampaign(raw:string|null):CampaignState {
  if(raw===null)return newCampaign();
  const source=record(JSON.parse(raw)),designs=record(source['designs']),progress=record(source['progress']);
  if(source['schema']!==1||!isMissionId(source['selected'])||!['new','started','done','skipped'].includes(String(source['tutorial'])))throw Error('训练进度版本不正确');
  const state=newCampaign();state.selected=source['selected'];state.tutorial=source['tutorial'] as CampaignState['tutorial'];
  for(const [id,value] of Object.entries(designs)){
    if(!isMissionId(id)||id==='lab')throw Error('关卡配置标识不正确');state.designs[id]=validateMissionDesign(id,value);
  }
  for(const [id,value] of Object.entries(progress)){
    if(!isMissionId(id))throw Error('成绩标识不正确');
    const p=record(value);
    if(!['attempts','wins','stars'].every(key=>typeof p[key]==='number'&&Number.isInteger(p[key])&&p[key]>=0)||Number(p['stars'])>3||Number(p['wins'])>Number(p['attempts'])
      ||!(p['bestPeak']===null||(typeof p['bestPeak']==='number'&&Number.isFinite(p['bestPeak'])&&p['bestPeak']>=0)))throw Error('成绩范围不正确');
    const last=p['last']===null?null:decodeReport(JSON.stringify(p['last']));
    if(last&&last.config.scenario!==id)throw Error('成绩与场景不匹配');
    state.progress[id]={attempts:Number(p['attempts']),wins:Number(p['wins']),stars:Number(p['stars']),bestPeak:p['bestPeak'] as number|null,last};
  }
  if(!unlocked(state,state.selected))throw Error('当前关卡尚未解锁');
  return state;
}
export function trainingStage(design:GridDesign):'wire'|'balance'|'test' {
  const analysis=analyzeDesign(design),critical=design.nodes.find(n=>n.kind==='critical')!,battery=design.nodes.find(n=>n.kind==='battery')!;
  if(!analysis.active.has(critical.id))return 'wire';
  const balance=requiredBase(analysis.config);
  return Math.abs(battery.baseKw-balance)>MISSION_TARGETS.initialGapKw?'balance':'test';
}
export function experiment(design:GridDesign,report:TrialReport,events:SimEvent[]):string {
  if(report.modelRevision!==MODEL_REVISION)throw Error('记录来自不同模型，请重新运行后导出');
  const config=missionConfig(report.config.scenario,design);
  if(JSON.stringify(config)!==JSON.stringify(report.config))throw Error('当前配置已改变，请重新运行后导出');
  return JSON.stringify({format:'island-protocol.experiment',schema:1,scenario:report.config.scenario,design,report,events},null,2);
}
