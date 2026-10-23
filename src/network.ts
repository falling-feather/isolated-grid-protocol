import { DEFAULT_CONFIG, INPUT_LIMITS, PHYSICS } from './simulation.ts';
import type { SimulationConfig, Snapshot } from './simulation.ts';

export const WORLD = Object.freeze({width:1440,height:900,grid:20});
export interface Point {x:number;y:number}
export interface Rect extends Point {width:number;height:number}
export type DeviceKind='solar'|'wind'|'battery'|'bus'|'critical'|'residential';
interface BaseNode extends Point {id:string;kind:DeviceKind;name:string;enabled:boolean;present:boolean}
interface Demand {demandKw:number}
export type GridNode =
  | (BaseNode&{kind:'solar';powerKw:number;dropKw:number})
  | (BaseNode&{kind:'wind';powerKw:number})
  | (BaseNode&{kind:'battery';baseKw:number;maxKw:number;capacityKwh:number;initialKwh:number;commandKw:number})
  | (BaseNode&{kind:'bus'})
  | (BaseNode&Demand&{kind:'critical'})
  | (BaseNode&Demand&{kind:'residential'});
export interface PortRef {nodeId:string;portId:string}
export interface Port extends Point,PortRef {direction:'up'|'right'|'down'|'left'}
export interface GridEdge {id:string;from:PortRef;to:PortRef;closed:boolean;via:Point|null}
export type ProtocolSettings=Pick<SimulationConfig,'deduplicate'|'fault'|'retryAfter'|'retryPolicy'|'commandTtl'|'localMode'|'telemetryEvery'|'priority'|'reconnect'>;
export const DEFAULT_PROTOCOL:Readonly<ProtocolSettings>={
  deduplicate:DEFAULT_CONFIG.deduplicate,fault:DEFAULT_CONFIG.fault,retryAfter:DEFAULT_CONFIG.retryAfter,
  retryPolicy:DEFAULT_CONFIG.retryPolicy,
  commandTtl:DEFAULT_CONFIG.commandTtl,localMode:DEFAULT_CONFIG.localMode,telemetryEvery:DEFAULT_CONFIG.telemetryEvery,
  priority:DEFAULT_CONFIG.priority,reconnect:DEFAULT_CONFIG.reconnect,
};
export interface GridDesign {
  schema:1; nodes:GridNode[];edges:GridEdge[];
  protocol:ProtocolSettings;
  speed:1|2|4;
  /** 旧布局的迁移输入；当前显示偏好由 preferences 独立保存。 */
  reduceMotion:boolean;
}
export type NumericKey='powerKw'|'dropKw'|'baseKw'|'maxKw'|'capacityKwh'|'initialKwh'|'commandKw'|'demandKw';
export interface FieldSpec {key:NumericKey;label:string;unit:string;min:number;max:number;step:number}
export const NODE_FIELDS:Record<DeviceKind,readonly FieldSpec[]>={
  solar:[
    {key:'powerKw',label:'初始出力',unit:'kW',min:0,max:INPUT_LIMITS.sourceKw,step:5},
    {key:'dropKw',label:'云层降幅',unit:'kW',min:0,max:INPUT_LIMITS.sourceKw,step:5},
  ],
  wind:[{key:'powerKw',label:'持续出力',unit:'kW',min:0,max:INPUT_LIMITS.sourceKw,step:5}],
  battery:[
    {key:'baseKw',label:'初始基准',unit:'kW',min:-INPUT_LIMITS.batteryKw,max:INPUT_LIMITS.batteryKw,step:1},
    {key:'maxKw',label:'充放电上限',unit:'kW',min:1,max:INPUT_LIMITS.batteryKw,step:5},
    {key:'capacityKwh',label:'储能容量',unit:'kWh',min:1,max:INPUT_LIMITS.capacityKwh,step:5},
    {key:'initialKwh',label:'初始电量',unit:'kWh',min:0,max:INPUT_LIMITS.capacityKwh,step:1},
    {key:'commandKw',label:'C17 调节步长',unit:'kW',min:0,max:INPUT_LIMITS.commandKw,step:1},
  ],
  bus:[],
  critical:[{key:'demandKw',label:'用电需求',unit:'kW',min:1,max:INPUT_LIMITS.demandKw,step:5}],
  residential:[{key:'demandKw',label:'用电需求',unit:'kW',min:1,max:INPUT_LIMITS.demandKw,step:5}],
};
export const KIND_LABELS:Record<DeviceKind,string>={solar:'光伏',wind:'风机',battery:'储能',bus:'配电母线',critical:'关键负荷',residential:'居民负荷'};
export const REQUIREMENTS=Object.freeze({totalKw:PHYSICS.demandKw,criticalKw:60});
export function createDesign():GridDesign {
  return {
    schema:1,speed:4,reduceMotion:false,protocol:{...DEFAULT_PROTOCOL},
    nodes:[
      {id:'PV1',kind:'solar',name:'光伏',x:180,y:200,present:true,enabled:true,powerKw:50,dropKw:20},
      {id:'W1',kind:'wind',name:'风机',x:180,y:640,present:true,enabled:true,powerKw:20},
      {id:'B1',kind:'battery',name:'储能',x:720,y:180,present:true,enabled:true,baseKw:22,maxKw:65,capacityKwh:80,initialKwh:40,commandKw:20},
      {id:'BUS1',kind:'bus',name:'母线',x:720,y:440,present:true,enabled:true},
      {id:'C1',kind:'critical',name:'关键负荷',x:1220,y:200,present:true,enabled:true,demandKw:60},
      {id:'R1',kind:'residential',name:'居民负荷',x:1220,y:640,present:true,enabled:true,demandKw:30},
    ],
    edges:[
      {id:'e1',from:{nodeId:'PV1',portId:'grid'},to:{nodeId:'BUS1',portId:'b0'},closed:true,via:null},
      {id:'e2',from:{nodeId:'W1',portId:'grid'},to:{nodeId:'BUS1',portId:'b2'},closed:true,via:null},
      {id:'e3',from:{nodeId:'B1',portId:'grid'},to:{nodeId:'BUS1',portId:'b5'},closed:true,via:null},
      {id:'e4',from:{nodeId:'BUS1',portId:'b10'},to:{nodeId:'C1',portId:'grid'},closed:true,via:null},
      {id:'e5',from:{nodeId:'BUS1',portId:'b8'},to:{nodeId:'R1',portId:'grid'},closed:true,via:null},
    ],
  };
}
export const portKey=(p:PortRef)=>p.nodeId+':'+p.portId;
export const snap=(n:number)=>Math.round(n/WORLD.grid)*WORLD.grid;
export function getPorts(node:GridNode):Port[] {
  const base={nodeId:node.id};
  if(node.kind==='bus')return Array.from({length:11},(_,i)=>({...base,portId:'b'+i,x:node.x-300+i*60,y:node.y,direction:(i===2||i===8?'down':'up') as Port['direction']}));
  const point=node.kind==='battery'?{x:node.x-100,y:node.y+140,direction:'down' as const}
    :node.kind==='critical'||node.kind==='residential'?{x:node.x-140,y:node.y+40,direction:'left' as const}
    :{x:node.x+(node.kind==='wind'?100:140),y:node.y+(node.kind==='wind'?60:40),direction:'right' as const};
  return [{...base,portId:'grid',...point}];
}
export function getPort(design:GridDesign,ref:PortRef):Port {
  const node=design.nodes.find(n=>n.id===ref.nodeId&&n.present);
  const port=node&&getPorts(node).find(p=>p.portId===ref.portId);
  if(!port)throw Error('连接端子不存在');
  return port;
}
export function imageBox(node:GridNode):Rect {
  if(node.kind==='bus')return {x:node.x-105,y:node.y+45,width:210,height:170};
  if(node.kind==='wind')return {x:node.x-85,y:node.y-185,width:170,height:260};
  if(node.kind==='battery')return {x:node.x-135,y:node.y-85,width:270,height:180};
  return {x:node.x-120,y:node.y-90,width:240,height:180};
}
export function obstaclesForNode(node:GridNode):Rect[] {
  const box=imageBox(node);
  const result=[{...box,height:box.height+35}];
  if(node.kind==='bus')result.push({x:node.x-310,y:node.y-12,width:620,height:24});
  return result;
}
export function nodeBounds(node:GridNode):Rect {
  const boxes=obstaclesForNode(node),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}
export function clampPosition(node:GridNode,point:Point):Point {
  const box=nodeBounds(node),left=box.x-node.x,top=box.y-node.y;
  return {
    x:snap(Math.max(-left+20,Math.min(WORLD.width-(left+box.width)-20,point.x))),
    y:snap(Math.max(-top+20,Math.min(WORLD.height-(top+box.height)-20,point.y))),
  };
}
export function boxesOverlap(a:Rect,b:Rect,gap=12):boolean {
  return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
}
export function collides(design:GridDesign,id:string):boolean {
  const node=design.nodes.find(n=>n.id===id)!;
  return design.nodes.some(other=>other.present&&other.id!==id&&obstaclesForNode(node).some(a=>obstaclesForNode(other).some(b=>boxesOverlap(a,b))));
}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('装置资料格式不正确');
  return value as Record<string,unknown>;
}
export function numberValue(node:GridNode,key:NumericKey):number {
  return (node as unknown as Record<NumericKey,number>)[key];
}
export function validateDesign(value:unknown):GridDesign {
  const raw=object(value);
  if(raw['schema']!==1||!Array.isArray(raw['nodes'])||raw['nodes'].length!==6)throw Error('装置资料不完整');
  const nodes=structuredClone(raw['nodes']) as GridNode[];
  const kinds=new Set<DeviceKind>(),ids=new Set<string>();
  for(const node of nodes) {
    const rec=object(node);
    if(typeof node.id!=='string'||!node.id||node.id.length>32||ids.has(node.id)||!Object.hasOwn(KIND_LABELS,node.kind)||kinds.has(node.kind))throw Error('装置编号或类型不正确');
    ids.add(node.id);kinds.add(node.kind);
    if(typeof node.name!=='string'||!node.name.trim()||node.name.length>16||typeof node.enabled!=='boolean'||typeof node.present!=='boolean')throw Error('装置名称或状态不正确');
    if(![node.x,node.y].every(n=>Number.isFinite(n)&&n>=0)||node.x>WORLD.width||node.y>WORLD.height||snap(node.x)!==node.x||snap(node.y)!==node.y)throw Error('装置位置范围不正确');
    for(const field of NODE_FIELDS[node.kind]) {
      const n=rec[field.key];
      if(typeof n!=='number'||!Number.isFinite(n)||n<field.min||n>field.max)throw Error(field.label+'超出范围');
    }
    if(node.kind==='solar'&&node.dropKw>node.powerKw)throw Error('云层降幅不能超过光伏出力');
    if(node.kind==='battery'&&(node.initialKwh>node.capacityKwh||Math.abs(node.baseKw)>node.maxKw))throw Error('储能参数范围不一致');
  }
  const protocol={...DEFAULT_PROTOCOL,...object(raw['protocol'])};
  if(typeof protocol['deduplicate']!=='boolean'||!['lost-ack','healthy','partition'].includes(String(protocol['fault']))
    ||typeof protocol['retryAfter']!=='number'||!Number.isFinite(protocol['retryAfter'])||protocol['retryAfter']<0.6||protocol['retryAfter']>6)throw Error('协议配置范围不正确');
  if(!(protocol.commandTtl===null||(typeof protocol.commandTtl==='number'&&Number.isFinite(protocol.commandTtl)&&protocol.commandTtl>=.5&&protocol.commandTtl<=30))
    ||!['droop','restore'].includes(String(protocol.localMode))||![.5,1,2,3,4,8].includes(Number(protocol.telemetryEvery))
    ||typeof protocol.telemetryEvery!=='number'||typeof protocol.priority!=='boolean'||!['resume','reconcile'].includes(String(protocol.reconnect))||!['retry','observe'].includes(String(protocol.retryPolicy)))throw Error('扩展协议配置范围不正确');
  if(typeof raw['speed']!=='number'||![1,2,4].includes(raw['speed'])||typeof raw['reduceMotion']!=='boolean')throw Error('显示设置不正确');
  if(!Array.isArray(raw['edges'])||raw['edges'].length>12)throw Error('线路资料不完整');
  const result:GridDesign={schema:1,nodes,edges:structuredClone(raw['edges']) as GridEdge[],protocol:protocol as unknown as GridDesign['protocol'],speed:raw['speed'] as GridDesign['speed'],reduceMotion:raw['reduceMotion']};
  const used=new Set<string>(),edgeIds=new Set<string>();
  for(const edge of result.edges) {
    object(edge);object(edge.from);object(edge.to);
    if(typeof edge.id!=='string'||edgeIds.has(edge.id)||typeof edge.closed!=='boolean'||edge.from.nodeId===edge.to.nodeId)throw Error('线路标识不正确');
    edgeIds.add(edge.id);
    for(const ref of [edge.from,edge.to]) {
      getPort(result,ref);
      if(used.has(portKey(ref)))throw Error('端子已被占用');
      used.add(portKey(ref));
    }
    if(edge.via!==null&&(!Number.isFinite(edge.via?.x)||!Number.isFinite(edge.via?.y)||edge.via.x<0||edge.via.y<0||edge.via.x>WORLD.width||edge.via.y>WORLD.height||snap(edge.via.x)!==edge.via.x||snap(edge.via.y)!==edge.via.y))throw Error('绕行点范围不正确');
  }
  return result;
}
export function editDesign(design:GridDesign,mutate:(draft:GridDesign)=>void):GridDesign {
  const draft=structuredClone(design);mutate(draft);return validateDesign(draft);
}
export function updateNumber(design:GridDesign,id:string,key:NumericKey,value:number):GridDesign {
  return editDesign(design,draft=>{
    const node=draft.nodes.find(n=>n.id===id);
    if(!node||!NODE_FIELDS[node.kind].some(f=>f.key===key))throw Error('装置不支持这个参数');
    (node as unknown as Record<NumericKey,number>)[key]=value;
    if(node.kind==='solar'&&key==='powerKw')node.dropKw=Math.min(node.dropKw,node.powerKw);
    if(node.kind==='battery') {
      if(key==='capacityKwh')node.initialKwh=Math.min(node.initialKwh,node.capacityKwh);
      if(key==='maxKw')node.baseKw=Math.max(-node.maxKw,Math.min(node.maxKw,node.baseKw));
    }
  });
}
export function connectPorts(design:GridDesign,from:PortRef,to:PortRef):GridDesign {
  getPort(design,from);getPort(design,to);
  if(from.nodeId===to.nodeId)throw Error('请选择另一台装置的端子');
  const previous=design.edges.find(e=>portKey(e.from)===portKey(from)||portKey(e.to)===portKey(from));
  const target=design.edges.find(e=>portKey(e.from)===portKey(to)||portKey(e.to)===portKey(to));
  if(target&&target!==previous)throw Error('目标端子已占用，请选择空端子');
  if(target&&target===previous)return structuredClone(design);
  return editDesign(design,draft=>{
    const nextId='e'+(Math.max(0,...draft.edges.map(e=>Number(e.id.replace(/^e/,''))||0))+1);
    draft.edges=draft.edges.filter(e=>e.id!==previous?.id);
    draft.edges.push({id:nextId,from:{...from},to:{...to},closed:true,via:null});
  });
}
export function removeDevice(design:GridDesign,id:string):GridDesign {
  return editDesign(design,d=>{
    d.nodes.find(n=>n.id===id)!.present=false;
    d.edges=d.edges.filter(e=>e.from.nodeId!==id&&e.to.nodeId!==id);
  });
}
export function restoreDevice(design:GridDesign,id:string):GridDesign {
  const restored=editDesign(design,d=>{d.nodes.find(n=>n.id===id)!.present=true;});
  const node=restored.nodes.find(n=>n.id===id)!;
  const candidates:Point[]=[];
  for(let dy=-400;dy<=400;dy+=40)for(let dx=-600;dx<=600;dx+=40)candidates.push({x:node.x+dx,y:node.y+dy});
  candidates.sort((a,b)=>(Math.abs(a.x-node.x)+Math.abs(a.y-node.y))-(Math.abs(b.x-node.x)+Math.abs(b.y-node.y)));
  for(const point of candidates){
    const position=clampPosition(node,point);
    node.x=position.x;node.y=position.y;
    if(!collides(restored,id))return validateDesign(restored);
  }
  throw Error('没有足够的空位，请先调整画布');
}
export function arrangeDesign(design:GridDesign):GridDesign {
  const initial=createDesign();
  return editDesign(design,d=>{
    for(const node of d.nodes){const origin=initial.nodes.find(n=>n.kind===node.kind)!;node.x=origin.x;node.y=origin.y;}
    for(const edge of d.edges)edge.via=null;
  });
}
export function analyzeDesign(design:GridDesign):{config:SimulationConfig;connected:Set<string>;active:Set<string>;signature:string} {
  const nodeMap=new Map(design.nodes.map(n=>[n.id,n]));
  const bus=design.nodes.find(n=>n.kind==='bus')!;
  const battery=design.nodes.find(n=>n.kind==='battery')!;
  const solar=design.nodes.find(n=>n.kind==='solar')!;
  const wind=design.nodes.find(n=>n.kind==='wind')!;
  const critical=design.nodes.find(n=>n.kind==='critical')!;
  const residential=design.nodes.find(n=>n.kind==='residential')!;
  const available=(id:string)=>{const n=nodeMap.get(id);return n?.present&&n.enabled;};
  const connected=new Set<string>();
  if(available(bus.id)) {
    const queue=[bus.id];connected.add(bus.id);
    while(queue.length){
      const id=queue.shift()!;
      for(const edge of design.edges){
        if(!edge.closed)continue;
        const other=edge.from.nodeId===id?edge.to.nodeId:edge.to.nodeId===id?edge.from.nodeId:null;
        if(other&&available(other)&&!connected.has(other)){connected.add(other);queue.push(other);}
      }
    }
  }
  const formingAvailable=connected.has(battery.id)&&available(battery.id)===true;
  const demandKw=Math.max(REQUIREMENTS.totalKw,critical.demandKw+residential.demandKw);
  const criticalDemandKw=Math.max(REQUIREMENTS.criticalKw,critical.demandKw);
  const servedCriticalKw=connected.has(critical.id)?critical.demandKw:0;
  const config:SimulationConfig={
    ...DEFAULT_CONFIG,...design.protocol,
    pvInitialKw:connected.has(solar.id)?solar.powerKw:0,
    pvDropKw:connected.has(solar.id)?solar.dropKw:0,
    windKw:connected.has(wind.id)?wind.powerKw:0,
    demandKw,criticalDemandKw,servedCriticalKw,
    servedDemandKw:servedCriticalKw+(connected.has(residential.id)?residential.demandKw:0),
    initialBaseKw:battery.baseKw,maxBatteryKw:battery.maxKw,
    capacityKwh:battery.capacityKwh,initialEnergyKwh:battery.initialKwh,
    commandDeltaKw:battery.commandKw,formingAvailable,
  };
  return {config,connected,active:formingAvailable&&battery.initialKwh>0?connected:new Set(),signature:JSON.stringify(config)};
}
export function deviceReading(node:GridNode,connected:Set<string>,snapshot:Snapshot|null):{status:string;power:number|null} {
  if(!node.present)return {status:'已移出',power:0};
  if(!node.enabled)return {status:'已停用',power:0};
  if(!connected.has(node.id))return {status:'未接入母线',power:0};
  if(!snapshot)return {status:'待测试',power:null};
  const p=snapshot.physical;
  if(!p.energized)return {status:node.kind==='battery'&&p.energyKwh===0?'电量耗尽':'母线未供电',power:0};
  const power=node.kind==='solar'?p.pvKw:node.kind==='wind'?p.windKw:node.kind==='battery'?p.batteryKw:
    node.kind==='critical'?p.criticalServedKw:node.kind==='bus'?p.servedKw:p.servedKw-p.criticalServedKw;
  return {status:'已接入',power};
}
export class DesignHistory {
  private value:GridDesign;
  private past:GridDesign[]=[];
  private future:GridDesign[]=[];
  constructor(initial:GridDesign){this.value=validateDesign(initial);}
  get current():GridDesign{return structuredClone(this.value);}
  get canUndo():boolean{return this.past.length>0;}
  get canRedo():boolean{return this.future.length>0;}
  commit(next:GridDesign):void {
    const clean=validateDesign(next);
    if(JSON.stringify(clean)===JSON.stringify(this.value))return;
    this.past.push(this.value);if(this.past.length>50)this.past.shift();
    this.value=clean;this.future=[];
  }
  undo():void {const prior=this.past.pop();if(prior){this.future.push(this.value);this.value=prior;}}
  redo():void {const next=this.future.pop();if(next){this.past.push(this.value);this.value=next;}}
}
