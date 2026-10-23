import { commandEvidence,compareStrategies,knowledgeGap,strategyLabel } from './evidence.ts';
import type { MessageEvidence } from './evidence.ts';
import type { SimEvent,TrialReport } from './simulation.ts';
import type { View } from './protocol.ts';
import { escapeText as esc } from './editor.ts';
import { trialFeedback } from './feedback.ts';
const el=(id:string)=>document.getElementById(id)!;
const markupCache=new Map<string,string>();
function markup(id:string,html:string):void {
  if(markupCache.get(id)===html)return;
  const root=el(id),active=root.contains(document.activeElement)?document.activeElement as HTMLElement:null;
  const proof=active?.dataset['proof'],goals=active?.dataset['goals'],time=active?.dataset['time'];
  root.innerHTML=html;markupCache.set(id,html);
  const selector=proof?'[data-proof="'+proof+'"]'+(time?'[data-time="'+time+'"]':''):goals?'[data-goals="'+goals+'"]':null;
  if(selector){const target=root.querySelector<HTMLButtonElement>(selector);(target&&!target.disabled?target:root.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus({preventScroll:true});}
}
const fmt=(value:number|null|undefined,digits=1)=>value===null||value===undefined?'—':value.toFixed(digits);
type ReviewTab='overview'|'messages'|'goals'|'compare';
interface Actions {seek(time:number):void;inspect(goal?:string):void;redraw():void}
export function goalReviewPage(total:number,requested:number){
  const goalPages=Math.ceil(total/4),page=Math.max(0,Math.min(goalPages,requested));
  return {page,pages:goalPages+1,start:page*4,end:Math.min(total,(page+1)*4),notes:page===goalPages};
}
export class ReviewUI {
  private actions:Actions;
  private tab:ReviewTab='overview';
  private group:'commands'|'world'='commands';
  private index=0;
  private goalPage=0;
  private run=-1;
  private selected=false;
  private reportSeen=false;
  private view:View|null=null;
  private baseline:TrialReport|null=null;
  private messages:MessageEvidence[]=[];
  private world:SimEvent[]=[];
  constructor(actions:Actions){
    this.actions=actions;
    el('review-tabs').addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLElement>('[data-review-tab]');
      if(button)this.open(button.dataset['reviewTab'] as ReviewTab);
    });
    el('message-review').addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLElement>('[data-proof]');if(!button)return;
      const action=button.dataset['proof'];
      if(action==='commands'||action==='world'){this.group=action;this.index=0;this.selected=true;}
      else if(action==='prev'||action==='next'){
        const count=this.group==='commands'?this.messages.length:this.world.length;
        this.index=Math.max(0,Math.min(count-1,this.index+(action==='next'?1:-1)));this.selected=true;
      }else if(action==='seek'){this.actions.seek(Number(button.dataset['time']));return;}
      this.renderMessage();
    });
    el('goal-pager').addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLElement>('[data-goals]');if(!button)return;
      this.goalPage=Math.max(0,this.goalPage+(button.dataset['goals']==='next'?1:-1));this.renderGoals();
    });
    el('revise-rules').addEventListener('click',()=>this.actions.inspect());
  }
  open(tab:ReviewTab):void {
    this.tab=tab;
    for(const panel of document.querySelectorAll<HTMLElement>('[data-review-panel]'))panel.hidden=panel.dataset['reviewPanel']!==tab;
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]'))button.setAttribute('aria-selected',String(button.dataset['reviewTab']===tab));
    if(tab==='messages')this.renderMessage();if(tab==='goals')this.renderGoals();if(tab==='compare')this.renderComparison();
    this.actions.redraw();
  }
  update(runId:number,view:View,baseline:TrialReport|null):void {
    if(this.run!==runId){this.run=runId;this.tab='overview';this.group='commands';this.index=0;this.goalPage=0;this.selected=false;this.reportSeen=false;
      for(const panel of document.querySelectorAll<HTMLElement>('[data-review-panel]'))panel.hidden=panel.dataset['reviewPanel']!=='overview';
      for(const button of document.querySelectorAll<HTMLElement>('[data-review-tab]'))button.setAttribute('aria-selected',String(button.dataset['reviewTab']==='overview'));
    }
    this.view=view;this.baseline=baseline;this.messages=commandEvidence(view.events);
    this.world=view.events.filter(e=>['cloud','weather','power-lost','local','reconcile','reconciled'].includes(e.kind)||e.reason==='transport-change');
    const report=view.report;
    (el('revise-rules') as HTMLButtonElement).disabled=!report;
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]'))button.disabled=['goals','compare'].includes(button.dataset['reviewTab']!)&&!report;
    const gap=knowledgeGap(view.snapshot);
    el('truth-base').textContent=fmt(gap.actualBaseKw)+' kW';el('known-base').textContent=fmt(gap.sampledBaseKw)+' kW';
    el('known-age').textContent='采样 '+fmt(gap.sampledAt)+' s · '+fmt(gap.ageSeconds)+' s 前';
    const status=gap.status==='confirmed'?'已确认 '+fmt(gap.executedAt)+' s 那次执行':gap.status==='rejected'?'设备返回拒绝记录':gap.status==='not-sent'?'尚未发送调节':'执行结果仍未知';
    const difference=gap.hasBaseGap?'基准相差 '+fmt(Math.abs(gap.differenceKw),2)+' kW · 中央记录未跟上':'基准读数一致';
    el('known-result').textContent=difference+'\n'+status+(gap.resultBaseKw===null?'':' · 结果基准 '+fmt(gap.resultBaseKw)+' kW');
    el('knowledge-board').classList.toggle('knowledge-gap',gap.hasBaseGap||gap.status==='unconfirmed'||gap.status==='exhausted');
    if(report&&!this.reportSeen){this.reportSeen=true;if(!this.selected)this.chooseFailure();}
    if(this.tab==='messages')this.renderMessage();if(this.tab==='goals')this.renderGoals();if(this.tab==='compare')this.renderComparison();
  }
  focusFailure():void {this.chooseFailure();this.open('messages');}
  private chooseFailure():void {
    const report=this.view?.report;if(!report)return;
    const loss=this.world.findIndex(e=>e.kind==='power-lost');
    if(loss>=0&&report.metrics.serviceRatio<.95){this.group='world';this.index=loss;return;}
    const changed=this.messages.findLastIndex(m=>m.action?.evidence?.outcome==='applied'&&(m.label!=='M01'));
    const rejected=this.messages.findIndex(m=>m.action?.evidence?.outcome==='expired');
    this.group='commands';this.index=changed>=0?changed:rejected>=0?rejected:Math.max(0,this.messages.length-1);
  }
  private renderMessage():void {
    if(!this.view)return;
    const count=this.group==='commands'?this.messages.length:this.world.length;
    this.index=Math.max(0,Math.min(Math.max(0,count-1),this.index));
    const current=this.group==='commands'?this.messages[this.index]:null,event=this.group==='world'?this.world[this.index]:null;
    const navigation='<div class="proof-toolbar"><div class="proof-groups"><button type="button" data-proof="commands" aria-pressed="'+(this.group==='commands')+'">命令投递 '+this.messages.length+'</button><button type="button" data-proof="world" aria-pressed="'+(this.group==='world')+'">外部事件 '+this.world.length+'</button></div><div class="page-controls"><button type="button" data-proof="prev" aria-label="上一份证据" '+(this.index===0?'disabled':'')+'>‹</button><span>'+(count?this.index+1:0)+' / '+count+'</span><button type="button" data-proof="next" aria-label="下一份证据" '+(this.index>=count-1?'disabled':'')+'>›</button></div></div>';
    if(event){
      markup('message-review',navigation+'<div class="world-proof"><p class="eyebrow">外部条件与控制反应</p><h3>'+esc(event.title)+'</h3><time>'+fmt(event.time)+' s</time><p>'+esc(event.detail)+'</p><button type="button" class="context-button" data-proof="seek" data-time="'+event.time+'">回到此刻</button></div><p class="proof-footnote">点选时刻，同步回看节点、读数与频率。</p>');return;
    }
    if(!current){markup('message-review',navigation+'<div class="empty-proof"><h3>还没有调节报文</h3><p>运行到场景的调节时刻后，这里逐份保留投递和设备处理证据。</p></div>');return;}
    const action=current.action,fact=action?.evidence,receipt=current.receipts.at(-1);
    const steps:[string,SimEvent|null][]=[['发出',current.sent],['到达',current.arrival],['设备处理',action],[receipt?.kind==='ack-lost'?'回执丢失':'中央获知',receipt??null]];
    const stepMarkup=steps.map(([label,e])=>'<button type="button" class="proof-step '+(e&&this.view!.snapshot.time>=e.time?'past':'')+'" data-proof="seek" data-time="'+(e?.time??0)+'" '+(!e?'disabled':'')+'><span>'+label+'</span><b>'+fmt(e?.time)+' s</b><small>'+(!e?'尚无证据':e.kind==='ack-lost'?'这份回执丢失':e.reason==='telemetry-confirmed'?'遥测核对':e.kind==='duplicate'?'复用旧结果':e.kind==='rejected'?'拒绝':e.kind==='applied'?'执行':'')+'</small></button>').join('');
    const receiptTrail=[...current.interruptions,...current.receipts].sort((a,b)=>a.time-b.time).map(e=>fmt(e.time)+' s '+(e.kind==='link-lost'?'链路未送达':e.kind==='ack-lost'?'回执丢失':e.reason==='telemetry-confirmed'?'遥测核对确认':'回执到达')).join(' · ');
    const verdict=fact?.outcome==='applied'?'这份投递改变了基准':fact?.outcome==='cached'?'只回传旧结果，没有新动作':fact?.outcome==='expired'?'超过有效期，未执行':fact?.outcome==='rejected'?'设备拒绝，未改变基准':'仍在等待设备处理';
    markup('message-review',navigation+'<div class="proof-title"><h3>'+current.label+' <span>'+esc(current.commandId)+'</span></h3><p>原创建 '+fmt(current.createdAt)+' s · 本次发出 '+fmt(current.sent.time)+' s'+(current.arrival?' · 到达年龄 '+fmt(current.arrival.time-(current.createdAt??current.sent.time))+' s':'')+'</p></div><div class="proof-steps">'+stepMarkup+'</div>'+ 
      '<div class="proof-columns"><div class="effect-card '+(fact?.outcome==='applied'?'effect-changed':'')+'"><span>储能基准 · 处理时刻 '+fmt(action?.time)+' s</span><div><b>'+fmt(fact?.beforeBaseKw)+'</b><i>→</i><b>'+fmt(fact?.afterBaseKw)+'</b><small>kW</small></div><strong>'+verdict+'</strong></div><div class="rule-proof"><span class="eyebrow">规则与可知信息</span><p>'+esc(action?.detail??'消息尚未到达，不能把发送视为执行。')+'</p>'+(fact?.executedAt!==undefined&&fact.executedAt!==null?'<small>结果引用原执行 '+fmt(fact.executedAt)+' s</small>':'')+(receiptTrail?'<small>'+esc(receiptTrail)+'</small>':'')+'</div></div><p class="proof-footnote">C 是意图，M 是投递；记录来自整局测试。</p>');
  }
  private renderGoals():void {
    const report=this.view?.report;if(!report)return;
    const items=[...el('trial-goals').children] as HTMLElement[],page=goalReviewPage(items.length,this.goalPage);
    this.goalPage=page.page;items.forEach((item,i)=>{item.hidden=page.notes||i<page.start||i>=page.end;});
    el('goal-evidence').hidden=page.notes;el('goal-notes').hidden=!page.notes;
    markup('goal-pager','<button type="button" data-goals="prev" '+(page.page===0?'disabled':'')+'>上一页</button><span>'+(page.notes?'说明':'核验')+' '+(page.page+1)+' / '+page.pages+'</span><button type="button" data-goals="next" '+(page.notes?'disabled':'')+'>下一页</button>');
    el('goal-explanation').textContent=trialFeedback(report.config.scenario,report).detail;
  }
  private renderComparison():void {
    const current=this.view?.report,previous=this.baseline;
    if(!current||!previous){el('strategy-comparison').innerHTML='<div class="empty-proof"><h3>先留下两次试验</h3><p>完成一次后，返回储能更换预案，再运行同一场景。这里比较实际代价。</p></div>';return;}
    const pair=compareStrategies(previous,current);
    if(!pair){el('strategy-comparison').innerHTML='<div class="empty-proof"><h3>这两次条件不同</h3><p>模型修订、设备或外部场景不同，不能归因为单一策略。旧结果仍保留，本次不叠加。</p></div>';return;}
    const row=(label:string,a:string,b:string)=>'<tr><th>'+label+'</th><td>'+a+'</td><td>'+b+'</td></tr>';
    const a=previous.metrics,b=current.metrics,traffic=current.config.scenario==='traffic';
    el('strategy-comparison').innerHTML='<div class="comparison-heading"><span>相同场景、设备初值和故障</span><strong>'+ (previous.success&&current.success?'两种策略均达标':'按结果比较，不预设赢家')+'</strong></div><table class="comparison-table"><thead><tr><th>实际指标</th><th>上次 · '+esc(strategyLabel(previous.config))+'</th><th>本次 · '+esc(strategyLabel(current.config))+'</th></tr></thead><tbody>'+ 
      row('确认等待',fmt(a.confirmationSeconds)+' s',fmt(b.confirmationSeconds)+' s')+row(traffic?'热身后最高数据年龄':'中央不确定',fmt(traffic?a.maxDataAge:a.uncertainSeconds)+' s',fmt(traffic?b.maxDataAge:b.uncertainSeconds)+' s')+row('生成报文',a.messagesSent+' 份',b.messagesSent+' 份')+row('有效执行',a.appliedCount+' 次',b.appliedCount+' 次')+row('整局供电',fmt(a.serviceRatio*100)+'%',fmt(b.serviceRatio*100)+'%')+row('末段偏差',fmt(a.settledDeviationHz,3)+' Hz',fmt(b.settledDeviationHz,3)+' Hz')+'</tbody></table><p class="comparison-conclusion">'+(pair.messagesDelta===0&&pair.confirmationDelta===0?'两次的报文数量与确认等待相同。':'本次较上次 '+(pair.messagesDelta<0?'少 ':pair.messagesDelta>0?'多 ':'增减 ')+Math.abs(pair.messagesDelta)+' 份报文'+(pair.confirmationDelta===null?'': '，确认'+(pair.confirmationDelta>0?'慢 ':'快 ')+fmt(Math.abs(pair.confirmationDelta))+' 秒')+'。')+'</p>';
  }
}
