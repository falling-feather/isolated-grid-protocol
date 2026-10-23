import { MISSIONS,MISSION_TARGETS } from './missions.ts';
import type { MissionId,ProtocolKey } from './missions.ts';
import type { DeviceKind,NumericKey } from './network.ts';
import type { TrialReport } from './simulation.ts';
export interface TrialFeedback {title:string;detail:string;kind:DeviceKind;protocol?:ProtocolKey|'fault';field?:NumericKey}
export function trialFeedback(id:MissionId,report:TrialReport|null,requested?:string):TrialFeedback {
  const result=(title:string,detail:string,kind:DeviceKind='battery',protocol?:TrialFeedback['protocol'],field?:NumericKey):TrialFeedback=>({title,detail,kind,...(protocol?{protocol}:{}),...(field?{field}:{})});
  if(!report)return id==='night'?result('检查能源计划',MISSIONS[id].hints[0]!,'wind',undefined,'powerKw'):result('查看本关规则',MISSIONS[id].hints[0]!);
  if(report.success)return result('当前配置通过',id==='echo'&&report.config.retryPolicy==='observe'
    ?'你没有再次下发调节，而是等到下一份遥测核对了先前执行。确认耗时 '+report.metrics.confirmationSeconds!.toFixed(1)+' 秒，整局生成 '+report.metrics.messagesSent+' 份报文。节省消息需要接受更长的未知。'
    :MISSIONS[id].debrief);
  const c=report.config,m=report.metrics,goal=requested??report.goals.find(g=>!g.passed)?.id;
  if(!c.formingAvailable)return result('储能未接入母线','本作品由储能建立频率。先恢复储能与母线的电气连接，再讨论调度规则。');
  if(c.servedCriticalKw<c.criticalDemandKw)return result('关键负荷尚未接入','这部分需求仍计入成绩。检查关键负荷的端子、装置投入与线路开关。','critical');
  if(c.servedDemandKw<c.demandKw)return result('仍有需求未接入','断开或移出负荷不会让需求消失。检查用电支路与投入状态。','residential');
  if(m.finalEnergyKwh<=0)return result('储能电量已耗尽','协议不会增加可用电量。先检查发电计划和能源余量；容量与初始电量是不同的量。',id==='night'?'wind':'battery',undefined,id==='night'?'powerKw':'initialKwh');
  if(m.serviceRatio<MISSION_TARGETS.serviceRatio)return result('功率失配触发保护','电量仍有余量，但持续的供需失配使成网源退出。检查电源接入、初始计划与储能的瞬时功率上限。','battery',undefined,id==='night'?'maxKw':'baseKw');
  if((id==='return'||id==='night')&&c.reconnect==='resume'&&m.appliedCount>1)return result('未核对就重新调节',
    'C17 已经执行，恢复后又创建了新编号 C18。C17 的去重记录拦不住它；先请求新的设备记录，再决定是否接管。','battery','reconnect');
  if(m.appliedCount>1)return result('调节意图重复执行','同一编号重试应返回原处理结果，不再增加基准。对照执行事件与原创建时刻。','battery','deduplicate');
  if(id==='solar'&&m.expiredCommands===0)return result('迟到命令仍被执行','阳光已恢复，旧调节却仍然到达。去重不能代替时效，为尚未执行的命令设置有效期。','battery','commandTtl');
  if(id==='island'&&m.localSeconds<5)return result('本地恢复尚未完成','下垂能缓冲扰动，但会留下频率偏差。启用只依据本地频率的恢复规则，无需中央成功下发命令。','battery','localMode');
  if(id==='traffic'&&m.messagesSent>MISSION_TARGETS.messages)return result('共享信道负载过高','报告过密会挤占信道。关键消息优先能缩短等待，但不会减少已经产生的报文；同时调整报告节奏。','battery','telemetryEvery');
  if(id==='traffic'&&m.maxDataAge>MISSION_TARGETS.dataAgeSeconds)return result('设备记录已经过时','报告过疏也会让测量变旧。比较排队、数据年龄与报告周期，找到兼顾时效和预算的节奏。','battery','telemetryEvery');
  if(goal==='reconcile')return result('恢复后尚未核对','链路恢复不等于状态已经一致。让核对请求和新的设备记录真正往返后，再接管。','battery','reconnect');
  if(goal==='balance')return result('初始功率尚未配平','先用初始功率计划检查缺口或余电。增大发电后，也要重新配平储能的初始基准。','battery',undefined,'baseKw');
  if(goal==='expansion')return result('扩容超过额度','所有新增的光伏、风电与储能功率都占用额度，移出设备不会消掉费用。重新安排各部分的余量。','wind',undefined,'powerKw');
  if(goal==='reserve')return result('能源余量不足','给后续变化保留电量。先看夜间仍能发电的风机，再比较光伏和储能功率之间的扩容取舍。','wind',undefined,'powerKw');
  if(c.fault==='partition'&&m.appliedCount===0)return result('通信失联，调节未送达','零次执行并不是重复执行。自由试验的默认目标要求确认一次调节；失联时仍可观察本地供电。','battery','fault');
  if(m.appliedCount===0)return result('调节尚未执行','检查命令到达与拒绝事件。没有确认不一定没有执行，但这里的物理记录确实是零次。');
  if(goal==='confirmation')return c.retryPolicy==='observe'
    ?result('等待遥测超过确认窗口','当前策略在超时后等待遥测核对，修改重试间隔不会催生新投递。缩短报告周期以更早核对，或改用同编号重试并复用结果，再比较报文与等待的代价。','battery','retryPolicy')
    :result('调节尚未及时确认','过短的超时会增加重试，过长则延后确认。结合这次链路条件调整等待节奏。','battery','retryAfter');
  if(id==='night')return result('供需余量仍需协调','检查弱风和夜间的储能功率上限，并协调本地恢复与重连核对；在额度内给最紧张的时段留出余量。','battery',undefined,'maxKw');
  return result('供需基准仍有偏差','沿频率记录回看天气、执行与确认的顺序，再调整相关装置；频率门槛由实际轨迹判断。');
}
