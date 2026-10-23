import { CAMPAIGN,CONCEPTS,MISSIONS,ratingCriteria } from './missions.ts';
import type { MissionId } from './missions.ts';
import { nextMission,trainingStage,unlocked } from './campaign.ts';
import type { CampaignState } from './campaign.ts';
import type { GridDesign } from './network.ts';
import type { Snapshot,TrialReport } from './simulation.ts';
import { escapeText as esc } from './editor.ts';

interface Actions {
  select(id:MissionId,restart?:boolean):void;startTutorial():void;skipTutorial():void;
  inspect(goal?:string):void;locate(id:string):void;pause():void;reading():boolean;
  newRecord():void;restoreRecord():void;
}
const el=(id:string)=>document.getElementById(id)!;
const stars=(n:number)=>'★'.repeat(n)+'☆'.repeat(3-n);
export class JourneyUI {
  private actions:Actions;
  private overlay=el('journey-overlay');
  private lastFocus:HTMLElement|null=null;
  private modalMode='';
  private windowPage=0;
  private hints=new Map<MissionId,number>();
  private folded=new Map<MissionId,boolean>();
  private coachKey='';
  private resultKey='';
  private coachStage='';
  private focusPending=false;
  private state:CampaignState|null=null;
  private previous:CampaignState|null=null;
  private id:MissionId='training';
  private design:GridDesign|null=null;
  private hidden=false;
  constructor(actions:Actions){
    this.actions=actions;
    el('open-missions').addEventListener('click',()=>{if(this.state)this.map(this.state,this.id);});
    el('mission-dock').addEventListener('click',event=>{
      const target=(event.target as Element).closest<HTMLElement>('[data-guide]');if(!target)return;
      const action=target.dataset['guide'];
      if(action==='hint'){this.hints.set(this.id,Math.min(2,(this.hints.get(this.id)??-1)+1));this.folded.set(this.id,false);this.coachKey='';this.refreshCoach();}
      else if(action==='fold'){this.folded.set(this.id,!(this.folded.get(this.id)??this.id!=='training'));this.coachKey='';this.refreshCoach();}
      else if(action==='brief')this.brief(this.id);
      else if(action==='locate')this.actions.locate(target.dataset['node']!);
      else if(action==='start')this.actions.startTutorial();
      else if(action==='inspect')this.actions.inspect();
    });
    this.overlay.addEventListener('click',event=>{
      const target=(event.target as Element).closest<HTMLElement>('[data-journey]');
      if(!target){if(event.target===this.overlay)this.dismiss();return;}
      const action=target.dataset['journey'];
      if(action==='page-prev'||action==='page-next'){this.showWindowPage(this.windowPage+(action==='page-next'?1:-1));return;}
      if(action==='close')this.dismiss();
      else if(action==='start'){this.close(false);this.actions.startTutorial();this.focusGuide();}
      else if(action==='skip'){this.close(false);this.actions.skipTutorial();}
      else if(action==='mission'){this.close(false);this.actions.select(target.dataset['mission'] as MissionId,target.dataset['restart']==='true');if(target.dataset['mission']==='lab')el('open-palette').focus();}
      else if(action==='map'&&this.state)this.map(this.state,this.id);
      else if(action==='concepts')this.handbook();
      else if(action==='records')this.recordMenu();
      else if(action==='fresh-record'){this.close(false);this.actions.newRecord();}
      else if(action==='restore-record'){this.close(false);this.actions.restoreRecord();}
    });
    this.overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.dismiss();return;}
      if(event.key!=='Tab')return;
      const items=[...this.overlay.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],summary,[tabindex="0"]')].filter(n=>n.getClientRects().length>0);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    el('trial-goals').addEventListener('click',event=>{const target=(event.target as Element).closest<HTMLElement>('[data-goal]');if(target)this.actions.inspect(target.dataset['goal']);});
    el('next-mission').addEventListener('click',()=>{const next=nextMission(this.id);if(next)this.actions.select(next);else if(this.state)this.map(this.state,this.id);});
    el('pause-test').addEventListener('click',()=>this.actions.pause());
    el('open-handbook').addEventListener('click',()=>this.handbook());
    el('open-journey-map').addEventListener('click',()=>{if(this.state)this.map(this.state,this.id);});
  }
  get modalOpen():boolean{return !this.overlay.hidden;}
  private setModal(mode:string,title:string,content:string):void {
    const paused=this.actions.reading();
    if(this.overlay.hidden)this.lastFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    this.modalMode=mode;this.overlay.hidden=false;
    el('workbench').inert=true;document.querySelector<HTMLElement>('.topbar')!.inert=true;
    this.overlay.innerHTML='<section class="journey-window journey-'+mode+'"><div class="window-chrome"><div class="window-ruler '+(paused?'reading-status':'')+'" '+(paused?'role="status"':'aria-hidden="true"')+'>'+(paused?'<span>测试已暂停。关闭后可继续；切换任务会结束本次测试。</span>':'<span>ISLAND / OPERATIONS</span><i></i><span>PROTOCOL LAB</span>')+'</div>'+ 
      '<button class="journey-close" data-journey="close" type="button" aria-label="关闭引导窗口">×</button></div><div class="journey-window-body">'+
      '<h2 id="journey-title" class="sr-only">'+esc(title)+'</h2>'+content+'</div><div class="window-foot" aria-hidden="true"><span>LOCAL CONTROL / SHARED KNOWLEDGE</span><span>50 HZ</span></div></section>';
    this.showWindowPage(0);
    requestAnimationFrame(()=>{const primary=this.overlay.querySelector<HTMLElement>('[data-primary]');(primary?.getClientRects().length?primary:this.overlay.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});});
  }
  private showWindowPage(index:number):void {
    const pages=[...this.overlay.querySelectorAll<HTMLElement>('[data-window-page]')];
    if(!pages.length)return;
    this.windowPage=Math.max(0,Math.min(pages.length-1,index));pages.forEach((page,i)=>{page.hidden=i!==this.windowPage;});
    let pager=this.overlay.querySelector<HTMLElement>('.window-pager');
    if(!pager){pager=document.createElement('nav');pager.className='window-pager page-controls';pager.setAttribute('aria-label','引导内容分页');this.overlay.querySelector('.window-foot')!.before(pager);}
    const focused=pager.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset['journey']:null;
    pager.innerHTML='<button data-journey="page-prev" type="button" '+(this.windowPage===0?'disabled':'')+'>上一页</button><span>'+(this.windowPage+1)+' / '+pages.length+'</span><button data-journey="page-next" type="button" '+(this.windowPage===pages.length-1?'disabled':'')+'>下一页</button>';
    if(focused){const target=pager.querySelector<HTMLButtonElement>('[data-journey="'+focused+'"]');(target&&!target.disabled?target:pager.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus({preventScroll:true});}
  }
  private close(restore=true):void {
    this.overlay.hidden=true;el('workbench').inert=false;document.querySelector<HTMLElement>('.topbar')!.inert=false;
    if(restore){const target=this.lastFocus?.isConnected&&this.lastFocus.getClientRects().length?this.lastFocus:el('open-missions');target.focus();}
  }
  private dismiss():void {
    const mode=this.modalMode;this.close(mode!=='welcome'&&mode!=='brief');
    if(mode==='welcome'){this.actions.startTutorial();this.focusGuide();}
    else if(mode==='brief'){const target=el('run-test') as HTMLButtonElement;(target.disabled?el('grid'):target).focus({preventScroll:true});}
  }
  private focusGuide():void {
    const target=el('mission-dock').querySelector<HTMLElement>('[data-guide="locate"]')??el('run-test');
    if(target instanceof HTMLButtonElement&&target.disabled){this.focusPending=true;return;}
    if(target.getClientRects().length){target.focus({preventScroll:true});this.focusPending=false;}
  }
  ready():void {if(this.focusPending&&!this.modalOpen&&!this.hidden&&this.id==='training')this.focusGuide();}
  welcome(warning=''):void {
    this.setModal('welcome','孤网协议 · 接线训练',
      '<div class="welcome-copy"><p class="journey-kicker">孤网协议 / 接线训练</p><h3>让灯，<br>继续亮着。</h3>'+ 
      '<p class="welcome-description">风光发电，负荷用电，储能协调余缺。你要为一座离网运行的小城接好电路，再为不可靠的消息设计规则。</p>'+
      '<div class="mini-grid" aria-label="电源汇入母线，储能协调，负荷取电"><span>风 · 光</span><i></i><b>母线</b><i></i><span>负荷</span><em>储能 ↔</em></div>'+ 
      '<div class="journey-primary-row"><button class="journey-primary" data-primary data-journey="start" type="button">开始接线训练 <span>↗</span></button><button class="journey-text-button" data-journey="skip" type="button">已了解基础，进入任务</button></div>'+ 
      (warning?'<p class="journey-warning">'+esc(warning)+'</p>':'')+'</div>'+ 
      '<div class="welcome-route"><span class="tiny-label">你的第一次值班</span><ol><li><b>01</b><div><strong>接通电路</strong><p>端子与开关决定谁真正得电。</p></div></li><li><b>02</b><div><strong>配平功率</strong><p>供给和需求要持续协调。</p></div></li><li><b>03</b><div><strong>读懂反馈</strong><p>运行测试，让结果验证计划。</p></div></li></ol><div class="route-note">不需要电力或编程基础<br>随时可以回看、改动、再试一次</div><button class="journey-text-button" data-journey="mission" data-mission="lab" type="button">先探索自由组网 →</button></div>');
  }
  brief(id:MissionId):void {
    const mission=MISSIONS[id];
    const weather=mission.weather.map(step=>'<span style="left:'+Math.min(95,step.at/mission.duration*100)+'%"><i></i><b>'+step.at+'s</b><small>'+esc(step.title.split(' · ')[0]!)+'</small></span>').join('');
    this.setModal('brief',mission.title,
      '<p class="journey-kicker">值班任务 / '+mission.number+'</p><div class="brief-heading"><span class="brief-number">'+mission.number+'</span><div><h3>'+esc(mission.title)+'</h3><p>'+esc(mission.subtitle)+'</p></div></div>'+ 
      '<div data-window-page><p class="brief-description">'+esc(mission.description)+'</p>'+(mission.linkWindow?'<p class="brief-condition">通信中断时段：'+mission.linkWindow[0]+'—'+Math.min(mission.duration,mission.linkWindow[1])+' 秒</p>':'')+'<div class="forecast" aria-label="本关预告时间轴">'+weather+'<strong>'+mission.duration+' 秒模拟</strong></div></div><div data-window-page hidden><div class="brief-grid"><div><span class="tiny-label">这次要完成</span><ol class="brief-objectives">'+mission.objectives.map((v,i)=>'<li><b>0'+(i+1)+'</b>'+esc(v)+'</li>').join('')+'</ol></div>'+ 
      '<div class="concept-note"><span class="tiny-label">本关认识</span><p>'+esc(mission.concept)+'</p><small>频率与设备读数来自模拟；目标由实际结果判断。</small></div></div>'+ 
      '</div>'+ 
      '<p class="brief-reset-note">每关初值独立；你对这关的修改会保留，随时可回来重试。</p><div class="journey-primary-row"><button class="journey-primary" data-primary data-journey="close" type="button">进入工作台 <span>↗</span></button><button class="journey-text-button" data-journey="concepts" type="button">先看概念手册</button></div>');
  }
  map(state:CampaignState,current:MissionId):void {
    const wins=CAMPAIGN.filter(id=>(state.progress[id]?.wins??0)>0).length;
    const ids=['training',...CAMPAIGN] as MissionId[],perPage=4;
    const rowItems=ids.map(id=>{
      const mission=MISSIONS[id],available=unlocked(state,id),p=state.progress[id];
      return '<button class="mission-route '+(id===current?'current ':'')+(p?.wins?'completed ':'')+'" type="button" '+(id===current?'data-primary ':'')+'data-journey="mission" data-mission="'+id+'" data-restart="'+(id==='training'&&Boolean(p?.wins))+'" '+(!available?'disabled':'')+'><span class="mission-route-number">'+mission.number+'</span><span class="mission-route-copy"><strong>'+esc(mission.title)+'</strong><small>'+esc(mission.subtitle)+'</small></span><span class="mission-route-state">'+(p?.wins?'<b aria-label="'+p.stars+' 星">'+stars(p.stars)+'</b><small>'+(id==='training'?'重新训练':p.attempts+' 次试验')+'</small>':available?'<span>进入 ↗</span>':'<small>完成上一站后开放</small>')+'</span></button>';
    });
    const rows=Array.from({length:Math.ceil(rowItems.length/perPage)},(_,i)=>'<div data-window-page '+(i?'hidden':'')+'>'+rowItems.slice(i*perPage,(i+1)*perPage).join('')+'</div>').join('');
    this.setModal('map','任务航图',
      '<div class="map-heading"><div><p class="journey-kicker">TRAINING ROUTE</p><h3>任务航图</h3></div><p><b>'+wins+'</b> / 6 已完成</p></div><p class="map-intro">从接线开始，逐渐把能源与消息接成一个可靠的系统。</p><div class="mission-routes">'+rows+'</div>'+ 
      '<div class="map-footer"><button class="journey-text-button" data-journey="mission" data-mission="lab" type="button">自由组网 <span>↗</span></button><button class="journey-text-button" data-journey="concepts" type="button">概念手册</button><button class="journey-text-button" data-journey="records" type="button">值班记录</button></div>');
    this.showWindowPage(Math.max(0,Math.floor(ids.indexOf(current)/perPage)));
  }
  private recordMenu():void {
    const completed=CAMPAIGN.filter(id=>(this.state?.progress[id]?.wins??0)>0).length;
    const previous=CAMPAIGN.filter(id=>(this.previous?.progress[id]?.wins??0)>0).length;
    this.setModal('records','值班记录','<p class="journey-kicker">LOCAL RECORDS / 本设备</p><h3>开始下一次值班。</h3><p class="brief-description">当前已完成 '+completed+' / 6 个任务。开始新记录会保留一份上次进度，可随时恢复；自由组网始终保留。</p><div class="record-options"><button class="journey-primary" data-primary data-journey="fresh-record" type="button">开始新的值班 <span>↗</span></button>'+
      (this.previous?'<button class="journey-secondary" data-journey="restore-record" type="button">恢复上次值班 <span>'+previous+' / 6 已完成</span></button>':'<p class="record-empty">尚无上次值班记录。</p>')+'</div><button class="journey-text-button" data-journey="map" type="button">返回任务航图 →</button>');
  }
  handbook():void {
    this.setModal('handbook','概念手册',
      '<h3>概念手册</h3><div class="concept-pages">'+CONCEPTS.map((c,i)=>'<article data-window-page '+(i?'hidden':'')+'><header><b>0'+(i+1)+'</b><h4>'+esc(c.title)+'</h4><small>'+esc(c.short)+'</small></header><p>'+esc(c.body)+'</p><aside>'+esc(c.observe)+'</aside></article>').join('')+'</div>'+ 
      '<p class="source-note">本作品采用单区域有功教学近似。概念参考 <a href="https://www.nlr.gov/news/detail/features/2022/microgrids-for-anyone" target="_blank" rel="noreferrer">NLR 微电网介绍</a>、<a href="https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/" target="_blank" rel="noreferrer">AWS 重试与拥塞</a>；不作为真实电网操作指南。</p>'+ 
      '<button class="journey-text-button" data-journey="close" type="button">返回工作台 →</button>');
  }
  coach(state:CampaignState,id:MissionId,design:GridDesign,hidden:boolean,previous:CampaignState|null):void {
    this.state=state;this.previous=previous;this.id=id;this.design=design;this.hidden=hidden;if(hidden)this.focusPending=false;this.refreshCoach();
  }
  private refreshCoach():void {
    if(!this.state||!this.design)return;
    const dock=el('mission-dock');dock.hidden=this.hidden;if(this.hidden)return;
    const id=this.id,mission=MISSIONS[id],state=this.state,stage=trainingStage(this.design),hint=this.hints.get(id)??-1;
    const stageChanged=this.coachStage!==id+':'+stage;this.coachStage=id+':'+stage;
    const count=state.progress[id]?.attempts??0;
    const folded=this.folded.get(id)??id!=='training';dock.classList.toggle('coach-folded',folded);
    const fold='<button type="button" data-guide="fold" aria-label="'+(folded?'展开任务提示':'收起任务提示')+'" aria-expanded="'+!folded+'">'+(folded?'⌃':'⌄')+'</button>';
    const key=id+':'+stage+':'+state.tutorial+':'+hint+':'+count+':'+folded;if(this.coachKey===key)return;this.coachKey=key;
    if(id==='training'){
      const number=stage==='wire'?1:stage==='balance'?2:3;
      const heading=stage==='wire'?'接上关键负荷':stage==='balance'?'把初始功率配平':'运行第一次测试';
      const copy=stage==='wire'?'依次点选标记的两端，或拖线相接。保持合闸；交叉线不会自动连接。':stage==='balance'?'打开储能，补足风光与用电的差额。正数放电，负数吸收余电；kW 表示当下的供用电速率。':'运行测试，观察供电与频率。供给不足时频率下降，设备响应会改变它。';
      dock.innerHTML='<div class="coach-header"><span>'+(folded?heading:'接线训练')+'</span><b>'+number+' / 3</b>'+fold+'</div><div class="coach-steps" aria-hidden="true"><i class="done"></i><i class="'+(number>=2?'done':'')+'"></i><i class="'+(number===3?'done':'')+'"></i></div><h2>'+heading+'</h2><p>'+copy+'</p>'+ 
        (stage==='test'?'<small class="coach-ready">就绪 · 测试后才展开频率记录</small>':'<button class="coach-action" data-guide="locate" data-node="'+(stage==='wire'?'C1':'B1')+'" type="button">'+(stage==='wire'?'定位接线位置':'打开储能参数')+' <span>↗</span></button>');
    }else{
      dock.innerHTML='<div class="coach-header"><span>'+mission.number+' / '+esc(mission.subtitle)+'</span>'+fold+'<button type="button" data-guide="brief" aria-label="查看本关说明">?</button></div><h2>'+esc(mission.title)+'</h2><p class="mission-objective">'+esc(mission.objectives[id==='lab'?0:id==='night'?0:1]??mission.objectives[0]!)+'</p>'+ 
        '<div class="mission-context-row"><span id="link-readout">组网就绪'+(count?' · 已试 '+count+' 次':'')+'</span><button class="hint-button" type="button" data-guide="hint">'+(hint<0?'一点提示':hint<2?'再一点提示':'查看提示')+'</button></div>'+ 
        (hint<0?'':'<p class="coach-hint">'+esc(mission.hints[hint]!)+'</p><button class="coach-action" type="button" data-guide="inspect">查看相关装置 <span>↗</span></button>');
    }
    if(id==='training'&&stageChanged){this.focusPending=true;requestAnimationFrame(()=>this.ready());}
  }
  signal(snapshot:Snapshot):void {
    const target=document.getElementById('link-readout');if(!target)return;
    const n=snapshot.network;
    target.textContent=snapshot.time===0?'组网就绪':!n.connected?'通信失联 · 电力通路独立':n.queued>6?'信道排队 '+n.queued+' · 已发 '+n.sent+' 份':n.reconciled?'状态已核对 · 链路恢复':'链路正常 · 数据年龄 '+(snapshot.time-snapshot.known.device.sampledAt).toFixed(1)+' s';
    target.classList.toggle('offline',!n.connected);
  }
  results(id:MissionId,report:TrialReport|null,phase:string,attempt:number):void {
    const pause=el('pause-test') as HTMLButtonElement;
    pause.hidden=Boolean(report);pause.textContent=phase==='paused'?'继续测试':'暂停';pause.setAttribute('aria-label',phase==='paused'?'继续测试':'暂停测试');
    el('export-trial').hidden=!report;
    const key=id+':'+(report?JSON.stringify([report.metrics,report.stars]):'running');if(this.resultKey===key)return;this.resultKey=key;
    el('trial-goals').innerHTML=report?report.goals.map(g=>'<li class="'+(g.passed?'passed':'failed')+'"><span class="goal-mark" aria-hidden="true">'+(g.passed?'✓':'·')+'</span><span>'+esc(g.label)+'<small>'+esc(g.value)+'</small></span>'+(!g.passed?'<button type="button" data-goal="'+esc(g.id??'')+'" aria-label="查看：'+esc(g.label)+'">↗</button>':'')+'</li>').join(''):'';
    if(report)el('goal-summary').textContent=report.success?'目标核验 · '+report.goals.length+' 项全部通过':'目标核验 · '+report.goals.filter(g=>g.passed).length+' / '+report.goals.length+' 项达标';
    el('goal-evidence').hidden=!report;
    el('result-debrief').hidden=!report;
    el('rating-explanation').hidden=!report?.success;
    const next=el('next-mission') as HTMLButtonElement;next.hidden=!report?.success||id==='lab';
    if(!report)return;
    el('trial-stars').textContent=report.success?stars(report.stars):'第 '+attempt+' 次试验';
    el('trial-stars').setAttribute('aria-label',report.success?report.stars+' 星完成':'本次尚未通过');
    el('rating-rules').innerHTML=report.success?'<li class="passed">✓ 完成全部目标 <b>＋1 星</b></li>'+ratingCriteria(report.metrics,id).map(rule=>'<li class="'+(rule.passed?'passed':'')+'">'+(rule.passed?'✓ ':'· ')+esc(rule.label)+'<small>'+esc(rule.value)+'</small><b>'+(rule.passed?'＋1 星':'待达成')+'</b></li>').join(''):'';
    const following=nextMission(id);next.textContent=following?'下一站 →':'任务航图 →';next.setAttribute('aria-label',following?'下一站：'+MISSIONS[following].title:'完成值班，返回任务航图');
  }
}
