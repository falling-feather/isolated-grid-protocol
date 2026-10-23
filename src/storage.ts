import { createDesign, validateDesign } from './network.ts';
import type { GridDesign } from './network.ts';
import { DEFAULT_CONFIG,MODEL_REVISION,validateSimulationConfig } from './simulation.ts';
import type { TrialReport, PlotPoint, TrialMetrics, SimulationConfig } from './simulation.ts';
export const DESIGN_KEY='island-protocol.grid.design.1';
export const REPORT_KEY='island-protocol.echo.comparison.1';
export const PREFERENCES_KEY='island-protocol.preferences.1';
export interface ViewPreferences {schema:1;reduceMotion:boolean;speed:1|2|4|null}
export function decodePreferences(raw:string|null,legacyMotion=false,legacySpeed:1|2|4|null=null):ViewPreferences {
  if(raw===null)return {schema:1,reduceMotion:legacyMotion,speed:legacySpeed};
  const source=record(JSON.parse(raw));
  if(source['schema']!==1||typeof source['reduceMotion']!=='boolean'||!(source['speed']===null||[1,2,4].includes(source['speed'] as number)))throw Error('显示偏好格式不正确');
  return {schema:1,reduceMotion:source['reduceMotion'],speed:source['speed'] as ViewPreferences['speed']};
}
export function decodeDesign(raw:string|null):GridDesign {
  return raw===null?createDesign():validateDesign(JSON.parse(raw) as unknown);
}
function finite(n:unknown):n is number{return typeof n==='number'&&Number.isFinite(n);}
function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('本地记录格式不正确');
  return value as Record<string,unknown>;
}
export function decodeReport(raw:string|null):TrialReport|null {
  if(raw===null)return null;
  const source=record(JSON.parse(raw) as unknown);
  if(source['schema']!==1||!Array.isArray(source['trace'])||source['trace'].length<1||source['trace'].length>2000)throw Error('对照记录不完整');
  const input=record(source['config']),config={...DEFAULT_CONFIG,...input} as SimulationConfig;
  validateSimulationConfig(config);
  const m=record(source['metrics']);
  for(const key of ['serviceRatio','energyUsedKwh','appliedCount','peakDeviationHz','unservedKwh','attempts'])if(!finite(m[key]))throw Error('对照指标不正确');
  if(m['settledDeviationHz']!==null&&!finite(m['settledDeviationHz']))throw Error('频率记录不正确');
  if(m['confirmationSeconds']!==null&&!finite(m['confirmationSeconds']))throw Error('确认记录不正确');
  const metrics={finalEnergyKwh:0,initialMismatchKw:0,expiredCommands:0,localSeconds:0,messagesSent:0,peakQueue:0,maxDataAge:0,reconcileSeconds:null,uncertainSeconds:0,commandPackets:0,
    ...m,criticalServiceRatio:finite(m['criticalServiceRatio'])?m['criticalServiceRatio']:m['serviceRatio']} as unknown as TrialMetrics;
  for(const key of ['finalEnergyKwh','initialMismatchKw','expiredCommands','localSeconds','messagesSent','peakQueue','maxDataAge','uncertainSeconds','commandPackets'] as const)if(!finite(metrics[key]))throw Error('扩展指标不正确');
  if(metrics.reconcileSeconds!==null&&!finite(metrics.reconcileSeconds))throw Error('核对时间不正确');
  const trace=source['trace'].map(value=>{
    const p=record(value);
    if(!finite(p['time'])||p['time']<0||p['time']>120||!(p['frequencyHz']===null||finite(p['frequencyHz']))
      ||!(p['knownFrequencyHz']===null||finite(p['knownFrequencyHz'])))throw Error('曲线记录不正确');
    return {...p,windKw:finite(p['windKw'])?p['windKw']:config.windKw,criticalServedKw:finite(p['criticalServedKw'])?p['criticalServedKw']:p['servedKw']} as unknown as PlotPoint;
  });
  if(typeof source['success']!=='boolean'||!(source['commandAt']===null||finite(source['commandAt'])))throw Error('试验记录不正确');
  const stars=source['stars']??0;
  if(!Number.isInteger(stars)||Number(stars)<0||Number(stars)>3)throw Error('星级记录不正确');
  const goals=Array.isArray(source['goals'])?source['goals'].map(value=>{
    const g=record(value);if(typeof g['label']!=='string'||typeof g['passed']!=='boolean'||typeof g['value']!=='string')throw Error('目标记录不正确');
    return g as unknown as TrialReport['goals'][number];
  }):[];
  const modelRevision=source['modelRevision']??1;
  if(!Number.isInteger(modelRevision)||Number(modelRevision)<1)throw Error('模型记录不正确');
  // 旧版本所有负荷均为关键负荷；保留旧记录和原配置，不改写成新场景。
  return {schema:1,modelRevision:Number(modelRevision),config,trace,metrics,commandAt:source['commandAt'] as number|null,success:source['success'],stars:Number(stars),goals};
}
export function comparable(report:TrialReport,config:SimulationConfig):boolean {
  const conditions=(c:SimulationConfig)=>{
    const {deduplicate,retryAfter,retryPolicy,commandTtl,localMode,telemetryEvery,priority,reconnect,...fixed}=c;
    return fixed;
  };
  return report.modelRevision===MODEL_REVISION&&report.commandAt===4&&JSON.stringify(conditions(report.config))===JSON.stringify(conditions(config));
}
export function readStored(key:string):string|null{return localStorage.getItem(key);}
export function saveStored(key:string,value:unknown):string|null {
  try{localStorage.setItem(key,JSON.stringify(value));return null;}
  catch{return '浏览器未能保存，本次配置仍保留在页面内';}
}
