import type { DeviceKind, NumericKey } from './network.ts';
import type { Goal, SimulationConfig, TrialMetrics } from './simulation.ts';

export const MISSION_IDS=['training','echo','solar','island','traffic','return','night','lab'] as const;
export type MissionId=typeof MISSION_IDS[number];
export const MISSION_TARGETS=Object.freeze({criticalRatio:.999,serviceRatio:.95,settledDeviationHz:.08,confirmationSeconds:4,settledWindowSeconds:3,
  messages:95,dataAgeSeconds:3.5,expansionKw:30,reserveKwh:.05,peakHz:.9,initialGapKw:.5,reconcileSeconds:2,echoConfirmationSeconds:5});
export type ProtocolKey='deduplicate'|'retryAfter'|'retryPolicy'|'commandTtl'|'localMode'|'telemetryEvery'|'priority'|'reconnect';
export interface WeatherStep {at:number;pvFactor:number;drop?:boolean;windFactor?:number;title:string}
export interface FieldRange {min:number;max:number;step:number}
export interface Mission {
  id:MissionId;number:string;title:string;subtitle:string;description:string;concept:string;
  duration:number;actionAt:number|null;commandLatency:number;capacity:number;
  linkWindow:readonly [number,number]|null;weather:readonly WeatherStep[];
  protocol:Partial<SimulationConfig>;controls:readonly ProtocolKey[];
  fields:Partial<Record<`${DeviceKind}.${NumericKey}`,FieldRange>>;
  overrides?:Partial<Record<DeviceKind,Record<string,number>>>;
  objectives:readonly string[];hints:readonly string[];debrief:string;accent:string;
}
const cloud:WeatherStep={at:3,pvFactor:1,drop:true,title:'云影经过 · 光伏下降'};
const base={duration:24,actionAt:4,commandLatency:.3,capacity:0,linkWindow:null,weather:[cloud],fields:{},accent:'#85c7eb'};
const reliability:ProtocolKey[]=['deduplicate','retryAfter','retryPolicy'];
const freshness:ProtocolKey[]=[...reliability,'commandTtl'];
const autonomy:ProtocolKey[]=[...freshness,'localMode'];
const traffic:ProtocolKey[]=[...autonomy,'telemetryEvery','priority'];
const all:ProtocolKey[]=[...traffic,'reconnect'];
export const MISSIONS:Readonly<Record<MissionId,Mission>>={
  training:{...base,id:'training',number:'00',title:'点亮第一盏灯',subtitle:'接线 / 功率 / 频率',
    description:'接上关键负荷，为储能配平初始出力，再用一次短测试认识电网的反馈。',concept:'电力需要闭合通路；发电与用电需要持续平衡。',duration:14,
    protocol:{fault:'healthy',deduplicate:true},controls:[],fields:{'battery.baseKw':{min:-65,max:65,step:1}},
    overrides:{battery:{baseKw:10}},
    objectives:['将关键负荷接入母线','配平初始供需','运行并完成一次短测试'],
    hints:['从关键负荷的金色端子拖到母线空端子，也可依次点选两端。','点击储能，使用“按接入负荷配平初始基准”。','频率反映持续的功率失配，电量决定储能还能坚持多久。'],
    debrief:'你接通了电路，也配平了功率。kW 是当下的出力速率，kWh 是还能使用的电量。接下来，线路仍然正常，消息却可能不再可靠。'},
  echo:{...base,id:'echo',number:'01',title:'回声',subtitle:'重试与重复执行',
    description:'第一份执行回执将丢失。你愿意花更多报文尽快确认，还是容许更长的不确定，等下一份遥测？',concept:'超时只说明尚未确认，不能证明设备没有执行。',
    protocol:{fault:'lost-ack',deduplicate:false},controls:reliability,
    objectives:['关键与居民负荷正常供电','同一调节只执行一次','在 5 秒容许窗口内确认，比较消息与等待代价'],
    hints:['先运行一次，查看是哪一份 C17 改变了基准。','快速重试需要设备记住已经处理的编号；等待遥测则不新增调节消息。','两种预案都可达标，差别是确认等待和报文占用。复盘时比较中央实际知道什么。'],
    debrief:'稳定编号让重试指向同一件事。返回旧结果并不代表刚刚又执行了一遍。'},
  solar:{...base,id:'solar',number:'02',title:'迟到的太阳',subtitle:'时效与过期命令',
    description:'调节命令要走 7 秒才能到达。9 秒时阳光已经恢复，一条迟到的增量还适用吗？',concept:'到达的时刻与创建的时刻不同；命令也需要有效期。',commandLatency:7,
    weather:[cloud,{at:9,pvFactor:1,title:'云影移开 · 光伏恢复'}],protocol:{fault:'healthy',deduplicate:true},controls:freshness,
    objectives:['保持供电，等待阳光恢复','拒绝尚未执行的过期命令','末段恢复到目标频率'],
    hints:['回看 9 秒和 11 秒，比较天气变化与命令到达。','去重能防止多执行一次，不能阻止第一次执行已经过时。','在储能中为命令设置有效期；过期的未执行命令应被拒绝。'],
    debrief:'有效期限制尚未执行的旧动作。已经执行过的同编号请求，仍返回原结果，不抹去事实。'},
  island:{...base,id:'island',number:'03',title:'安静的半城',subtitle:'失联与本地调节',
    description:'1 秒后通信中断，电力线路仍然相连。储能能否只凭本地频率，让电网稳住？',concept:'通信通路与电力通路是两张不同的网。',duration:28,linkWindow:[1,29],
    protocol:{fault:'healthy',deduplicate:true,localMode:'droop'},controls:autonomy,
    objectives:['失联期间持续供电','不依赖中央成功下发命令','用本地规则恢复末段频率'],
    hints:['通信中断后，观察金色电力线与灰蓝消息链路的区别。','现有下垂响应能缓冲扰动，但会留下频率偏差。','在储能中启用“本地恢复频率”，它只使用设备测到的频率。'],
    debrief:'本地控制让设备在消息缺席时仍能行动。中央没有收到的新状态，仍然只能标为未知。'},
  traffic:{...base,id:'traffic',number:'04',title:'每个人都在说话',subtitle:'带宽与消息优先级',
    description:'六台装置共用每秒 4 份报文的信道，储能记录是本关的关键数据。报告太密会挤占指令与回执，太疏又会让测量过时。',concept:'发得更多，不等于更快知道；有限信道需要节奏与优先级。',duration:28,capacity:4,
    protocol:{fault:'healthy',deduplicate:true,telemetryEvery:.5,priority:false},controls:traffic,
    objectives:['在 95 份报文预算内完成试验','热身后储能数据年龄不超过 3.5 秒','4 秒内确认调节，末段稳定'],
    hints:['先看链路排队与报文数量，找出报告频率对等待时间的影响。','降低报告频率能减少流量，但 8 秒一报会使数据年龄过大。','尝试兼顾适中的报告周期与关键消息优先，别靠无限重试冲开信道。'],
    debrief:'你分配的是稀缺的传输机会。报告密度会占用信道，关键消息即使得到优先，旧测量也不会自动变新。'},
  return:{...base,id:'return',number:'05',title:'恢复之后',subtitle:'状态核对与接管',
    description:'C17 在 4.3 秒执行，随后链路中断。13 秒恢复时，中央仍不知道结果：直接再建一条调节，还是先核对？',concept:'重新连通不代表双方拥有相同状态；接管前先确认事实。',duration:28,linkWindow:[4.4,13],
    protocol:{fault:'healthy',deduplicate:true,reconnect:'resume'},controls:all,
    objectives:['不把同一调节意图重新执行','恢复后 2 秒内完成状态核对','连续供电并恢复末段频率'],
    hints:['回看 4.3 秒：设备已执行，回执却还没到达。','仅去重 C17 无法阻止一条新编号 C18 再加一次。','将恢复策略设为“先核对再接管”，等待新的设备记录到达。'],
    debrief:'核对请求也要经过消息网络。拿到新的设备记录后才继续，避免把“不知道”当成“没做过”。'},
  night:{...base,id:'night',number:'06',title:'一夜供电',subtitle:'能源 / 余量 / 协调',
    description:'1.2 kWh 初始电量，30 kW 扩容额度。云影、弱风与长时间失联接连到来，为 90 秒值班安排足够的余量。',concept:'功率是此刻能做多少，电量是总共能坚持多久。',duration:90,linkWindow:[4.4,60],accent:'#cda96c',
    weather:[cloud,{at:20,pvFactor:.1,title:'日照减弱 · 仅余一成光伏'},
      {at:25,pvFactor:.1,windFactor:.5,title:'风速下降 · 风电减半'},
      {at:50,pvFactor:0,windFactor:.5,title:'夜幕 · 光伏停止出力'},
      {at:55,pvFactor:0,windFactor:1,title:'风速恢复'},
      {at:68,pvFactor:.6,windFactor:1,title:'曙光 · 光伏恢复六成'}],
    protocol:{fault:'healthy',deduplicate:true,localMode:'droop',reconnect:'resume'},controls:all,
    overrides:{battery:{capacityKwh:2,initialKwh:1.2}},
    fields:{'solar.powerKw':{min:50,max:80,step:5},'wind.powerKw':{min:20,max:40,step:5},
      'battery.maxKw':{min:65,max:90,step:5},'battery.baseKw':{min:-65,max:65,step:1}},
    objectives:['扩容不超过 30 kW，初始功率配平','关键供电 100%，总供电至少 95%','末段稳定，保留至少 0.05 kWh','恢复后先核对，调节意图只执行一次'],
    hints:['夜间光伏为零，优先考虑仍能发电的风机；同时核对储能的功率上限。','只加容量不会增加已给定的初始电量。扩容的三项之和不能超过 30 kW。','增加电源后重新配平初始基准，并协调本地恢复、去重和重连核对。'],
    debrief:'可靠消息无法创造能源，充足能源也无法替代正确的规则。你把电路、能源计划与协议接成了一个闭环。'},
  lab:{...base,id:'lab',number:'LAB',title:'自由组网',subtitle:'开放试验台',
    description:'自由配置设备与消息条件，运行可重复的试验。这里保留原有工作台的组网。',concept:'用可比较的实验观察规则的后果。',
    protocol:{},controls:all,objectives:['自由修改拓扑与设备','比较规则与通信条件','导出自己的实验记录'],
    hints:['逐次修改一项配置，比较结果更容易解释。','断开负荷不能使任务需求消失。','顶部仪表是教学观察真值，储能信息中保留中央已收到的记录。'],
    debrief:'一次试验的价值，在于能解释它的条件与结果。'},
};
export const CAMPAIGN=MISSION_IDS.filter((id):id is Exclude<MissionId,'training'|'lab'>=>id!=='training'&&id!=='lab');
export function isMissionId(value:unknown):value is MissionId{return typeof value==='string'&&(MISSION_IDS as readonly string[]).includes(value);}
export function gradeTrial(config:SimulationConfig,m:TrialMetrics):Goal[] {
  const goal=(id:string,label:string,passed:boolean,value:string):Goal=>({id,label,passed,value});
  const pct=(v:number)=>(v*100).toFixed(1)+'%';
  const limit=MISSION_TARGETS;
  const goals:Goal[]=[goal('critical','关键负荷持续供电',m.criticalServiceRatio>=limit.criticalRatio,pct(m.criticalServiceRatio)),
    goal('service','总需求供电 ≥ '+limit.serviceRatio*100+'%',m.serviceRatio>=limit.serviceRatio,pct(m.serviceRatio))];
  const scenario=config.scenario;
  if(scenario==='solar')goals.push(goal('expiry','拒绝过期命令且不误执行',m.expiredCommands>0&&m.appliedCount===0,m.expiredCommands+' 份拒绝 / '+m.appliedCount+' 次执行'));
  else if(scenario==='island')goals.push(goal('local','失联期间本地恢复',m.localSeconds>5&&m.appliedCount===0,m.localSeconds.toFixed(1)+' 秒 / '+m.appliedCount+' 次远程执行'));
  else goals.push(goal('once','一次调节只执行一次',m.appliedCount===1,m.appliedCount+' 次'));
  const confirmLimit=scenario==='echo'?limit.echoConfirmationSeconds:limit.confirmationSeconds;
  if(!['solar','island','return','night'].includes(scenario))goals.push(goal('confirmation',confirmLimit+' 秒内确认调节结果',m.confirmationSeconds!==null&&m.confirmationSeconds<=confirmLimit,m.confirmationSeconds===null?'未确认':m.confirmationSeconds.toFixed(1)+' 秒'));
  if(scenario==='traffic')goals.push(goal('budget','生成报文 ≤ '+limit.messages+' 份',m.messagesSent<=limit.messages,m.messagesSent+' 份'),
    goal('age','热身后储能数据年龄 ≤ '+limit.dataAgeSeconds+' 秒',m.maxDataAge<=limit.dataAgeSeconds,m.maxDataAge.toFixed(1)+' 秒'));
  if(scenario==='return'||scenario==='night')goals.push(goal('reconcile','恢复后 '+limit.reconcileSeconds+' 秒内完成状态核对',m.reconcileSeconds!==null&&m.reconcileSeconds<=limit.reconcileSeconds,m.reconcileSeconds===null?'未核对':m.reconcileSeconds.toFixed(1)+' 秒'));
  if(scenario==='training'||scenario==='night')goals.push(goal('balance','初始功率差 ≤ '+limit.initialGapKw+' kW',Math.abs(m.initialMismatchKw)<=limit.initialGapKw,Math.abs(m.initialMismatchKw).toFixed(1)+' kW'));
  if(scenario==='night')goals.push(goal('expansion','扩容总额 ≤ '+limit.expansionKw+' kW',config.planCost<=limit.expansionKw,config.planCost.toFixed(0)+' / '+limit.expansionKw+' kW'),
    goal('reserve','保留电量 ≥ '+limit.reserveKwh+' kWh',m.finalEnergyKwh>=limit.reserveKwh,m.finalEnergyKwh.toFixed(3)+' kWh'),
    goal('peak','全程频率偏差 ≤ '+limit.peakHz+' Hz',m.peakDeviationHz<=limit.peakHz,m.peakDeviationHz.toFixed(3)+' Hz'));
  goals.push(goal('settled','末段频率偏差 ≤ '+limit.settledDeviationHz+' Hz',m.settledDeviationHz!==null&&m.settledDeviationHz<=limit.settledDeviationHz,m.settledDeviationHz===null?'无有效频率':m.settledDeviationHz.toFixed(3)+' Hz'));
  return goals;
}
export function trialStars(success:boolean,m:TrialMetrics,scenario:MissionId):number {
  if(!success)return 0;
  return 1+ratingCriteria(m,scenario).filter(rule=>rule.passed).length;
}
export function ratingCriteria(m:TrialMetrics,scenario:MissionId):{label:string;passed:boolean;value:string}[] {
  const band=scenario==='night'?.75:.6;
  const calm={label:'峰值偏差 ≤ '+band+' Hz',passed:m.peakDeviationHz<=band,value:m.peakDeviationHz.toFixed(3)+' Hz'};
  const extra=scenario==='echo'?{label:'3 秒内确认，或整局报文不超过 6 份',passed:(m.confirmationSeconds!==null&&m.confirmationSeconds<=3)||m.messagesSent<=6,value:(m.confirmationSeconds?.toFixed(1)??'—')+' 秒 / '+m.messagesSent+' 份'}:
    scenario==='night'?{label:'保留电量 ≥ 0.12 kWh',passed:m.finalEnergyKwh>=.12,value:m.finalEnergyKwh.toFixed(3)+' kWh'}:
    scenario==='return'?{label:'1 秒内完成重连核对',passed:m.reconcileSeconds!==null&&m.reconcileSeconds<=1,value:m.reconcileSeconds===null?'未核对':m.reconcileSeconds.toFixed(1)+' 秒'}:
    scenario==='solar'?{label:'复用拒绝结果，只处理一份过期命令',passed:m.expiredCommands===1,value:m.expiredCommands+' 份'}:
    scenario==='island'?{label:'不依赖远程执行维持供电',passed:m.appliedCount===0&&m.serviceRatio>=.999,value:(m.serviceRatio*100).toFixed(1)+'% 供电'}:
    {label:scenario==='traffic'?'1.5 秒内确认调节':'3 秒内确认调节',passed:m.confirmationSeconds!==null&&m.confirmationSeconds<=(scenario==='traffic'?1.5:3),value:m.confirmationSeconds===null?'未确认':m.confirmationSeconds.toFixed(1)+' 秒'};
  return [calm,extra];
}

export const CONCEPTS=[
  {id:'circuit',title:'电路与母线',short:'先接通，才谈调度',body:'母线汇集各支路。本作品由储能建立频率，风光跟随它供电。装置只有通过投入的设备和合闸线路接到母线，才参与这个区域；图上的交叉线不会自动相连，必须接到端子。',observe:'试着断开关键负荷：它不再得电，但需求仍在。'},
  {id:'power',title:'功率与电量',short:'kW 是速率，kWh 是储量',body:'功率表示此刻发电或用电的速率；电量是功率随时间的累计。1 kW 持续 1 小时对应 1 kWh，充放电还会有损耗。增加容量不会凭空增加初始电量。',observe:'储能的信息中，实际出力和剩余电量分别变化。'},
  {id:'frequency',title:'频率与平衡',short:'持续失配会留下偏差',body:'本作品以 50 Hz 为基准。供给暂时不足时，频率向下偏移；供给过多时向上偏移。下垂响应缓冲变化，本地恢复进一步消除偏差，但二者都受设备功率和电量限制。',observe:'先配平初始基准，再比较云影到来后的变化。'},
  {id:'knowledge',title:'执行与确认',short:'设备做过，中央未必知道',body:'发送、到达、执行和收到回执是不同的事实。回执丢失时，设备可能已经执行；界面中的物理实际与中央所知因此可以不同。',observe:'在事件记录中回看“回执丢失”的时刻。'},
  {id:'identity',title:'编号与时效',short:'同一件事，也有适用时间',body:'重试复用编号与内容。设备对重复请求返回原处理结果；相同编号携带不同内容会被拒绝。有效期拒绝尚未执行的迟到命令，不能撤销已经发生的执行。',observe:'去重防止重复，时效防止过时，两者解决不同问题。'},
  {id:'network',title:'失联、排队与重连',short:'消息也需要通路和余量',body:'通信失联不等于电路断开；有限信道会排队。报告太密会挤占控制报文，太疏会使信息变旧。恢复连通后先请求新的设备记录，再决定是否接管。',observe:'查看链路队列、数据年龄以及恢复后的核对事件。'},
] as const;

export interface StrategyPreset {id:string;title:string;description:string;protocol:Partial<Pick<SimulationConfig,ProtocolKey>>}
export function strategiesFor(id:MissionId):StrategyPreset[] {
  if(id==='echo')return [
    {id:'fast',title:'快速确认',description:'同编号重试并复用设备结果。花更多报文，缩短中央的不确定。',protocol:{deduplicate:true,retryPolicy:'retry',retryAfter:2}},
    {id:'patient',title:'节省消息',description:'等待下一份遥测核对。不新增调节报文，容许更长的等待。',protocol:{deduplicate:false,retryPolicy:'observe',retryAfter:2}},
  ];
  if(id==='traffic')return [
    {id:'fresh',title:'更鲜的记录',description:'2 秒报告，关键消息优先。数据更新更勤，报文占用更高。',protocol:{deduplicate:true,telemetryEvery:2,priority:true}},
    {id:'sparse',title:'更轻的信道',description:'3 秒报告，普通队列。减少报文，接受更旧一些的储能记录。',protocol:{deduplicate:true,telemetryEvery:3,priority:false}},
  ];
  return [];
}
