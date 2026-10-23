import { GridEditor, escapeText } from './editor.ts';
import type { Selection } from './editor.ts';
import { DesignHistory, KIND_LABELS, NODE_FIELDS, analyzeDesign, arrangeDesign, createDesign, deviceReading, editDesign, numberValue, removeDevice, restoreDevice, updateNumber } from './network.ts';
import type { GridDesign, GridNode, NumericKey } from './network.ts';
import { DEFAULT_CONFIG, MODEL_REVISION,PHYSICS, requiredBase } from './simulation.ts';
import type { TrialReport, SimulationConfig } from './simulation.ts';
import type { View, WorkerRequest, WorkerResponse } from './protocol.ts';
import { DESIGN_KEY, REPORT_KEY,PREFERENCES_KEY, comparable, decodeDesign,decodePreferences, decodeReport, readStored, saveStored } from './storage.ts';
import { drawFrequency, timeAtCanvas } from './plot.ts';
import { routeDesign } from './routing.ts';
import { MISSIONS,MISSION_TARGETS,isMissionId,strategiesFor } from './missions.ts';
import type { MissionId,ProtocolKey } from './missions.ts';
import { CAMPAIGN_KEY,createMissionDesign,decodeCampaignRecords,expansionCost,experiment,fieldRange,finishAttempt,freshCampaignRecord,missionConfig,newCampaignRecords,
  protocolEditable,restoreCampaignRecord,startAttempt,trainingStage,unlocked,validateMissionDesign } from './campaign.ts';
import { JourneyUI } from './journey.ts';
import { trialFeedback } from './feedback.ts';
import { ReviewUI } from './review.ts';
import { recentEventAt } from './evidence.ts';

function element<T extends Element=HTMLElement>(id:string):T {
  const node=document.getElementById(id);if(!node)throw Error('缺少界面元素：'+id);return node as unknown as T;
}
function text(id:string,value:string):void {const node=document.getElementById(id);if(node)node.textContent=value;}
const format=(value:number|null|undefined,digits=1)=>value===null||value===undefined?'—':value.toFixed(digits);
const inspector=element('inspector'),palette=element('palette'),results=element('results');
const runButton=element<HTMLButtonElement>('run-test'),canvas=element<HTMLCanvasElement>('frequency-chart');
let toastTimer:ReturnType<typeof setTimeout>|undefined;
function notify(message:string):void {
  const node=element('toast');node.textContent=message;node.hidden=false;
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{node.hidden=true;},4000);
}
let labDesign=createDesign(),labLast:TrialReport|null=null,storageBlocked=false,campaignBlocked=false,loadWarning='';
try {labDesign=decodeDesign(readStored(DESIGN_KEY));}
catch {storageBlocked=true;loadWarning='本地布局未能读取，当前打开示例，原记录未覆盖';}
try {labLast=decodeReport(readStored(REPORT_KEY));}
catch {loadWarning=loadWarning||'旧对照记录不可用，本次测试将重新记录';}
let records=newCampaignRecords();
try {records=decodeCampaignRecords(readStored(CAMPAIGN_KEY));}
catch {campaignBlocked=true;loadWarning='训练进度未能读取，本次可游玩但不会覆盖旧进度';}
let campaign=records.current;
let missionId:MissionId=campaign.selected;
let history=new DesignHistory(missionId==='lab'?labDesign:campaign.designs[missionId]??createMissionDesign(missionId));
let preferences=decodePreferences(null,labDesign.reduceMotion||history.current.reduceMotion,labDesign.speed!==4?labDesign.speed:null);
try{
  const raw=readStored(PREFERENCES_KEY);preferences=decodePreferences(raw,preferences.reduceMotion,preferences.speed);
  if(raw===null){const warning=saveStored(PREFERENCES_KEY,preferences);if(warning)loadWarning=loadWarning||warning;}
}catch{loadWarning=loadWarning||'显示偏好未能读取，暂按已有布局显示；可在测试设置中重新选择';}
let lastReport:TrialReport|null=missionId==='lab'?labLast:campaign.progress[missionId]?.last??null;
let selection:Selection=null,view:View|null=null,runId=0;
let activeConfig:SimulationConfig={...DEFAULT_CONFIG};
let currentReport:TrialReport|null=null,baseline:TrialReport|null=null;
let resultsOpen=false,workerError:string|null=null;
let focusedInspector=false;
let savedRun=-1,inspectorPage='device';
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module',name:'grid-simulation'});
const post=(message:WorkerRequest)=>worker.postMessage(message);
function testing():boolean{return resultsOpen&&(!view||view.phase==='running'||view.phase==='paused');}
const editor=new GridEditor(element<SVGSVGElement>('grid'),history.current,{
  commit:applyDesign,
  select:(next,open)=>{
    selection=next;
    if(!next){closeInspector();return;}
    if(open&&testing()){notify('测试正在运行，返回组网后可修改；节点状态仍实时显示');return;}
    if(open){
      if(resultsOpen)closeResults();
      palette.hidden=true;updatePaletteHandle();
      setInspectorOpen(true);inspector.scrollTop=0;inspectorPage=selection?.type==='node'&&history.current.nodes.find(n=>n.id===selection!.id)?.kind==='battery'&&missionId!=='training'?(strategiesFor(missionId).length?'presets':'rules'):'device';
    }
    if(!inspector.hidden){renderInspector();if(open)element('inspector-title').focus({preventScroll:true});}
  },
  notify,
});
const review=new ReviewUI({
  seek:time=>{if(!view)return;if(view.phase==='running')post({type:'pause',runId});post({type:'seek',runId,value:Math.min(view.actualTime,time)});},
  inspect:showCause,redraw:renderResults,
});
const journey=new JourneyUI({
  select:selectMission,startTutorial,skipTutorial,inspect:showCause,
  locate:id=>{
    if(missionId==='training'&&trainingStage(history.current)==='wire'){
      closeInspector();editor.focusNode(id);palette.hidden=true;updatePaletteHandle();selection={type:'node',id};editor.setSelection(selection);
      element('grid').querySelector<SVGElement>('[data-port-node="BUS1"][data-port="b10"]')?.focus();
    }else{
      editor.fit();focusedInspector=true;
      openNode(id,missionId!=='training');
      if(missionId==='training')inspector.querySelector<HTMLInputElement>('[data-number="baseKw"]')?.focus();
    }
  },
  pause:pauseTrial,
  newRecord:()=>replaceRecord(false),restoreRecord:()=>replaceRecord(true),
  reading:()=>{if(resultsOpen&&view?.phase==='running')post({type:'pause',runId});return resultsOpen&&!currentReport;},
});
function saveCampaign():void {
  if(campaignBlocked)return;
  records.current=campaign;
  const warning=saveStored(CAMPAIGN_KEY,records);if(warning)notify(warning);
}
function playbackSpeed():1|2|4{return preferences.speed??history.current.speed;}
function savePreferences():void {
  document.body.classList.toggle('reduce-motion',preferences.reduceMotion);
  const warning=saveStored(PREFERENCES_KEY,preferences);if(warning)notify(warning);
  renderPalette();
}
function saveDesign(design:GridDesign):void {
  if(missionId==='lab'){
    labDesign=design;if(!storageBlocked){const warning=saveStored(DESIGN_KEY,design);if(warning)notify(warning);}
  }else{campaign.designs[missionId]=design;saveCampaign();}
}
function refreshJourney():void {
  text('mission-number',MISSIONS[missionId].number);text('mission-name',MISSIONS[missionId].title);
  document.body.dataset['mission']=missionId;
  text('restore-example',missionId==='lab'?'恢复示例组网':'重置本关配置');
  journey.coach(campaign,missionId,history.current,resultsOpen,records.previous);
  if(missionId==='training'&&!resultsOpen){
    const stage=trainingStage(history.current);
    editor.setGuide(stage==='wire'?['C1','BUS1']:stage==='balance'?['B1']:[],stage==='wire'?[{nodeId:'C1',portId:'grid'},{nodeId:'BUS1',portId:'b10'}]:[]);
    runButton.classList.toggle('guided-run',stage==='test');
  }else{editor.setGuide([]);runButton.classList.remove('guided-run');}
}
function selectMission(id:MissionId,restart=false):void {
  if(!isMissionId(id)||!unlocked(campaign,id)){notify('先完成前一站，再继续这段值班');return;}
  if(resultsOpen)closeResults();
  saveDesign(history.current);campaign.selected=id;
  const design=id==='lab'?labDesign:restart?createMissionDesign(id):campaign.designs[id]??createMissionDesign(id);
  if(restart&&id!=='lab')campaign.designs[id]=design;
  saveCampaign();mountMission(id,design);
  if(id==='training'&&restart)journey.welcome();else if(id!=='training'&&id!=='lab')journey.brief(id);
}
function mountMission(id:MissionId,design:GridDesign):void {
  missionId=id;history=new DesignHistory(design);lastReport=id==='lab'?labLast:campaign.progress[id]?.last??null;
  selection=null;editor.setSelection(null);editor.setDesign(design);editor.fit();
  palette.hidden=true;updatePaletteHandle();closeInspector();element('inspector-content').innerHTML='';
  document.body.classList.toggle('reduce-motion',preferences.reduceMotion);
  currentReport=null;baseline=null;renderPalette();refreshJourney();preview();
}
function replaceRecord(restore:boolean):void {
  if(campaignBlocked){notify('旧训练进度未能读取，本次不会覆盖它；当前仍可继续临时试玩');return;}
  if(resultsOpen)closeResults();
  saveDesign(history.current);
  try{
    const replacement=restore?restoreCampaignRecord(records):freshCampaignRecord(records);
    const warning=saveStored(CAMPAIGN_KEY,replacement);
    if(warning){notify('未能保存新的值班记录，当前进度已保留');return;}
    records=replacement;campaign=records.current;
    const id=campaign.selected;
    mountMission(id,id==='lab'?labDesign:campaign.designs[id]??createMissionDesign(id));
    if(campaign.tutorial==='new'&&id==='training')journey.welcome();else journey.brief(id);
  }catch(error){notify(error instanceof Error?error.message:String(error));}
}
function startTutorial():void {
  if(campaign.tutorial==='new')campaign.tutorial='started';
  saveCampaign();if(missionId!=='training')selectMission('training',true);else refreshJourney();
}
function skipTutorial():void {
  if(campaign.tutorial==='new'||campaign.tutorial==='started')campaign.tutorial='skipped';
  saveCampaign();selectMission('echo');
}
function pauseTrial():void {
  if(!resultsOpen||currentReport)return;
  if(view?.phase==='running')post({type:'pause',runId});else if(view?.phase==='paused')post({type:'start',runId});
}
function prepareExport():void {
  const link=element<HTMLAnchorElement>('export-trial');link.removeAttribute('href');
  if(!currentReport||!view)return;
  try{
    const data=experiment(history.current,currentReport,view.events);
    link.href='data:application/json;charset=utf-8,'+encodeURIComponent(data);link.download='island-protocol-'+missionId+'.json';
  }catch(error){notify(error instanceof Error?error.message:String(error));}
}
function updatePaletteHandle():void {element('open-palette').setAttribute('aria-expanded',String(!palette.hidden));}
function preview():void {
  activeConfig=missionConfig(missionId,history.current);
  runId++;view=null;currentReport=null;workerError=null;
  runButton.disabled=true;
  post({type:'reset',runId,config:activeConfig});
}
function applyDesign(next:GridDesign,renderForm=true):void {
  if(testing())throw Error('测试期间不能修改组网');
  if(resultsOpen)closeResults();
  if([...routeDesign(next).values()].some(route=>route.blocked))throw Error('线路没有可用路径，请调整装置或绕行点');
  const previous=JSON.stringify(missionConfig(missionId,history.current));
  history.commit(validateMissionDesign(missionId,next));
  const design=history.current;
  editor.setDesign(design);
  document.body.classList.toggle('reduce-motion',preferences.reduceMotion);
  saveDesign(design);
  if(previous!==JSON.stringify(missionConfig(missionId,design)))preview();
  renderPalette();if(!inspector.hidden){if(renderForm)renderInspector();else refreshInspectorValues();}
  refreshJourney();
}
function change(mutate:(draft:GridDesign)=>void,renderForm=true):void {
  try{applyDesign(editDesign(history.current,mutate),renderForm);}
  catch(error){notify(error instanceof Error?error.message:String(error));}
}
function setInspectorOpen(open:boolean):void {inspector.hidden=!open;document.body.classList.toggle('inspector-open',open);}
function closeInspector():void {
  const restore=inspector.contains(document.activeElement);setInspectorOpen(false);
  if(focusedInspector){editor.fit();focusedInspector=false;}
  if(restore)(selection?.type==='node'?document.getElementById('device-'+selection.id)??element('grid'):element('grid')).focus({preventScroll:true});
}
function openNode(id:string,expandProtocol=false):void {
  if(testing()){notify('请先返回组网再调整装置');return;}
  if(resultsOpen)closeResults();
  selection={type:'node',id};editor.setSelection(selection);
  palette.hidden=true;updatePaletteHandle();setInspectorOpen(true);inspector.scrollTop=0;inspectorPage=expandProtocol?'rules':history.current.nodes.find(n=>n.id===id)?.kind==='battery'&&missionId!=='training'?(strategiesFor(missionId).length?'presets':'rules'):'device';
  renderInspector();element('inspector-title').focus({preventScroll:true});
}
function beginTest():void {
  if(testing())return;
  const design=history.current;
  if([...editor.routeMap.values()].some(route=>route.blocked)){notify('请先修复受阻线路');return;}
  baseline=lastReport;currentReport=null;workerError=null;savedRun=-1;
  activeConfig=missionConfig(missionId,design);
  startAttempt(campaign,missionId);saveCampaign();
  runId++;view=null;resultsOpen=true;results.hidden=false;document.body.classList.add('review-open');element('construction-layer').inert=true;
  palette.hidden=true;updatePaletteHandle();closeInspector();editor.cancel();editor.setLocked(true);
  if(missionId!=='lab')editor.fit();
  runButton.classList.add('testing');runButton.disabled=true;
  text('result-title','频率记录');text('result-time','正在启动测试');text('diagnosis','正在运行');
  element<HTMLButtonElement>('diagnosis').disabled=true;
  text('result-count','0');text('result-deviation','—');text('result-energy','—');
  text('result-count-label','当前执行');text('result-service-label','当前供电');text('result-service','—');
  text('truth-base','—');text('known-base','—');text('known-age','等待本次初始采样');text('known-result','正在建立本次初始状态');
  text('trial-context','');text('cursor-reading','等待本次初始状态。');
  element('previous-legend').hidden=true;element('comparison-note').hidden=true;
  drawFrequency(canvas,{trace:[],events:[],time:0,duration:activeConfig.duration,previous:[]});
  prepareExport();review.open('overview');
  for(const button of results.querySelectorAll<HTMLButtonElement>('[data-review-tab],#revise-rules'))button.disabled=true;
  journey.results(missionId,null,'running',campaign.progress[missionId]?.attempts??1);refreshJourney();
  element('pause-test').focus({preventScroll:true});
  post({type:'replay',runId,config:activeConfig});
  post({type:'speed',runId,value:playbackSpeed()});
}
function closeResults():void {
  const restore=results.contains(document.activeElement);
  post({type:'pause',runId});
  if(view&&view.selectedTime!==null)post({type:'live',runId});
  resultsOpen=false;results.hidden=true;document.body.classList.remove('review-open');element('construction-layer').inert=false;editor.setLocked(false);runButton.classList.remove('testing');runButton.disabled=false;
  document.body.classList.remove('app-running','app-paused');element('live-event').hidden=true;refreshJourney();
  if(restore)runButton.focus({preventScroll:true});
}
runButton.addEventListener('click',beginTest);
element('return-grid').addEventListener('click',closeResults);
element('close-inspector').addEventListener('click',closeInspector);
element('open-palette').addEventListener('click',()=>{
  palette.hidden=!palette.hidden;if(!palette.hidden){closeInspector();renderPalette();}updatePaletteHandle();
});
element('close-palette').addEventListener('click',()=>{palette.hidden=true;updatePaletteHandle();});
element('fit-view').addEventListener('click',()=>editor.fit());
element('arrange').addEventListener('click',()=>{try{applyDesign(arrangeDesign(history.current));editor.fit();notify('已整理装置和自动走线，可撤销');}catch(error){notify(String(error));}});
function moveHistory(direction:'undo'|'redo'):void {
  if(testing()){notify('测试结束后可撤销');return;}
  if(direction==='undo'?!history.canUndo:!history.canRedo)return;
  if(resultsOpen)closeResults();
  history[direction]();const design=history.current;
  editor.setDesign(design);
  document.body.classList.toggle('reduce-motion',preferences.reduceMotion);
  saveDesign(design);
  preview();renderPalette();if(!inspector.hidden)renderInspector();refreshJourney();
}
element('undo').addEventListener('click',()=>moveHistory('undo'));
element('redo').addEventListener('click',()=>moveHistory('redo'));
element('restore-example').addEventListener('click',()=>{
  if(testing()){notify('请先返回组网');return;}
  if(missionId==='lab')storageBlocked=false;
  applyDesign(missionId==='lab'?createDesign():createMissionDesign(missionId));editor.fit();selection=null;editor.setSelection(null);closeInspector();notify('已恢复'+(missionId==='lab'?'示例组网':'本关配置')+'，可撤销');
});
element('speed').addEventListener('change',event=>{
  const value=(event.target as HTMLSelectElement).value;preferences.speed=value==='auto'?null:Number(value) as 1|2|4;
  savePreferences();post({type:'speed',runId,value:playbackSpeed()});
});
element('reduce-motion').addEventListener('change',event=>{preferences.reduceMotion=(event.target as HTMLInputElement).checked;savePreferences();});
element('device-catalog').addEventListener('click',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-catalog]');
  if(!button)return;
  const node=history.current.nodes.find(n=>n.id===button.dataset['catalog'])!;
  if(testing()){notify('测试中装置只读');return;}
  if(!node.present){try{applyDesign(restoreDevice(history.current,node.id));}catch(error){notify(String(error));return;}}
  openNode(node.id);
});
palette.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLElement>('[data-palette-tab]');if(!button)return;for(const page of palette.querySelectorAll<HTMLElement>('[data-palette-page]'))page.hidden=page.dataset['palettePage']!==button.dataset['paletteTab'];for(const tab of palette.querySelectorAll<HTMLElement>('[data-palette-tab]'))tab.setAttribute('aria-selected',String(tab===button));});
function renderPalette():void {
  const design=history.current;
  const symbols={solar:'PV',wind:'W',battery:'B',bus:'≡',critical:'C',residential:'R'};
  element('device-catalog').innerHTML=design.nodes.map(node=>'<button class="catalog-device" data-catalog="'+escapeText(node.id)+'" type="button"><span class="catalog-symbol" aria-hidden="true">'+symbols[node.kind]+'</span><strong>'+escapeText(node.name)+'</strong><small>'+(node.present?'查看':'放入画布')+'</small></button>').join('');
  element<HTMLButtonElement>('undo').disabled=!history.canUndo||testing();
  element<HTMLButtonElement>('redo').disabled=!history.canRedo||testing();
  element<HTMLSelectElement>('speed').value=preferences.speed===null?'auto':String(preferences.speed);
  element<HTMLInputElement>('reduce-motion').checked=preferences.reduceMotion;
  text('playback-note','当前使用 '+playbackSpeed()+'×；显示偏好对所有任务生效。');
}
function fieldLabel(key:NumericKey,node:GridNode):string {
  return NODE_FIELDS[node.kind].find(field=>field.key===key)?.label??key;
}
function protocolPages(design:GridDesign):[string,string,string][] {
  const p=design.protocol;
  const check=(key:'deduplicate'|'priority',label:string)=>'<label class="toggle-row"><span>'+label+'</span><input type="checkbox" data-protocol="'+key+'" '+(p[key]?'checked':'')+'></label>';
  const select=(key:keyof GridDesign['protocol'],label:string,options:readonly (readonly [string,string])[],aria=label)=>'<label class="field-row"><span>'+label+'</span><select data-protocol="'+key+'" aria-label="'+aria+'">'+options.map(([value,title])=>'<option value="'+value+'" '+(String(p[key]??'')===value?'selected':'')+'>'+title+'</option>').join('')+'</select></label>';
  const rows:Record<keyof GridDesign['protocol'],string>={
    deduplicate:check('deduplicate','同编号只执行一次'),
    retryPolicy:select('retryPolicy','超时后',[["retry","同编号重试"],["observe","等待遥测核对"]]),
    retryAfter:select('retryAfter','超时重试',[["1","1 秒"],["2","2 秒"],["4","4 秒"]],'超时重试间隔'),
    fault:select('fault','通信情况',[["lost-ack","首份回执丢失"],["healthy","正常通信"],["partition","通信分区"]]),
    commandTtl:select('commandTtl','命令有效期',[["","不设有效期"],["2","2 秒"],["4","4 秒"],["8","8 秒"]]),
    localMode:select('localMode','本地预案',[["droop","下垂响应"],["restore","本地恢复频率"]]),
    telemetryEvery:select('telemetryEvery','报告周期',[["0.5","0.5 秒"],["1","1 秒"],["2","2 秒"],["3","3 秒"],["4","4 秒"],["8","8 秒"]]),
    priority:check('priority','关键消息优先'),
    reconnect:select('reconnect','恢复策略',[["resume","直接重新调节"],["reconcile","先核对再接管"]]),
  };
  const primary:Partial<Record<MissionId,ProtocolKey[]>>={echo:['deduplicate','retryAfter','retryPolicy'],solar:['commandTtl'],island:['localMode'],traffic:['telemetryEvery','priority'],return:['reconnect'],night:['localMode','reconnect','deduplicate']};
  const available=(Object.keys(rows) as (keyof GridDesign['protocol'])[]).filter(key=>protocolEditable(missionId,key)&&!(missionId==='lab'&&['priority','reconnect'].includes(key)));
  const focus=primary[missionId]??available;
  const pages:[string,string,string][]=[];
  const presets=strategiesFor(missionId);
  if(presets.length)pages.push(['presets','预案参考',presets.map(preset=>'<button class="strategy-preset" type="button" data-strategy="'+preset.id+'" aria-pressed="'+Object.entries(preset.protocol).every(([key,value])=>design.protocol[key as ProtocolKey]===value)+'"><strong>'+escapeText(preset.title)+'</strong><span>'+escapeText(preset.description)+'</span></button>').join('')+'<p class="field-hint">预案会一并设置相关规则。两种方案都能达标；确认时间、信息新鲜度与报文数量由实际试验比较。</p>']);
  const groups=[available.filter(key=>focus.includes(key as ProtocolKey)),available.filter(key=>!focus.includes(key as ProtocolKey))];
  groups.forEach((keys,group)=>{for(let i=0;i<keys.length;i+=3)pages.push([group===0&&i===0?'rules':'rules-'+group+'-'+i,group===0?'本关规则'+(keys.length>3?' '+(i/3+1)+' / '+Math.ceil(keys.length/3):''):'已学规则 '+(i/3+1),keys.slice(i,i+3).map(key=>rows[key]).join('')+'<p class="field-hint">重试保留原编号，最多发送 '+PHYSICS.maxAttempts+' 次。回执确认那次处理，不代表最新测量。</p>']);});
  return pages;
}
function panelPages(pages:[string,string,string][],nodeId:string,disabled:string):string {
  if(!pages.some(([id])=>id===inspectorPage))inspectorPage=pages[0]![0];
  return '<fieldset class="parameter-fields" data-node-id="'+escapeText(nodeId)+'"'+disabled+'><nav class="inspector-navigation" aria-label="装置信息分页"><button type="button" data-inspector-step="-1" aria-label="上一页装置信息">‹</button><label><span>查看内容</span><select aria-label="装置信息页面" data-inspector-page>'+pages.map(([id,title])=>'<option value="'+id+'" '+(id===inspectorPage?'selected':'')+'>'+title+'</option>').join('')+'</select></label><button type="button" data-inspector-step="1" aria-label="下一页装置信息">›</button></nav>'+pages.map(([id,title,body])=>'<section data-inspector-panel="'+id+'" '+(id!==inspectorPage?'hidden':'')+'><h3 class="panel-page-title">'+title+'</h3>'+body+'</section>').join('')+'</fieldset>';
}
function activateInspectorPage(id:string):void {
  inspectorPage=id;
  for(const page of inspector.querySelectorAll<HTMLElement>('[data-inspector-panel]'))page.hidden=page.dataset['inspectorPanel']!==id;
  const select=inspector.querySelector<HTMLSelectElement>('[data-inspector-page]');if(select)select.value=id;
}
function renderInspector():void {
  if(!selection){closeInspector();return;}
  const design=history.current,content=element('inspector-content'),disabled=testing()?' disabled':'';
  if(selection.type==='edge'){
    const edge=design.edges.find(e=>e.id===selection!.id);
    if(!edge){closeInspector();return;}
    const from=design.nodes.find(n=>n.id===edge.from.nodeId)!,to=design.nodes.find(n=>n.id===edge.to.nodeId)!;
    text('inspector-kind','线路');text('inspector-title',from.name+' — '+to.name);
    content.innerHTML='<fieldset class="parameter-fields" data-edge-id="'+escapeText(edge.id)+'"'+disabled+'><label class="toggle-row"><span>线路合闸</span><input type="checkbox" data-edge-state '+(edge.closed?'checked':'')+'></label><p class="field-hint">拖动线路上的蓝色折点调整绕行。交叉线段不会自动连接。</p><button id="auto-route" class="context-button wide-button" type="button">恢复自动走线</button><button id="remove-edge" class="quiet-danger" type="button">移除这条连接</button></fieldset>';return;
  }
  const node=design.nodes.find(n=>n.id===selection!.id);
  if(!node||!node.present){closeInspector();return;}
  text('inspector-title',node.name);
  const editable=NODE_FIELDS[node.kind].filter(field=>fieldRange(missionId,node,field.key));
  const fields=editable.map(original=>{
    const field={...original,...fieldRange(missionId,node,original.key)!};
    const max=node.kind==='solar'&&field.key==='dropKw'?Math.min(field.max,node.powerKw):node.kind==='battery'&&field.key==='initialKwh'?node.capacityKwh:node.kind==='battery'&&field.key==='baseKw'?Math.min(field.max,node.maxKw):field.max;
    const min=node.kind==='battery'&&field.key==='baseKw'?Math.max(field.min,-node.maxKw):field.min;
    return '<label class="field-row"><span>'+field.label+'</span><span class="input-unit"><input data-number="'+field.key+'" aria-label="'+field.label+'" type="number" min="'+min+'" max="'+max+'" step="'+field.step+'" value="'+numberValue(node,field.key)+'"><small>'+field.unit+'</small></span></label>';
  });
  const pages:[string,string,string][]=[];
  const budget=missionId==='night'&&['battery','wind','solar'].includes(node.kind)?'<div class="plan-budget" id="plan-budget"><span>扩容额度</span><span><b id="plan-budget-value">'+expansionCost(design)+'</b> / '+MISSION_TARGETS.expansionKw+' kW</span></div>':'';
  const balance=node.kind==='battery'&&fieldRange(missionId,node,'baseKw')?'<div class="balance-preview"><small id="balance-context"></small><strong id="balance-required"></strong><span id="balance-gap"></span><button id="balance-base" class="context-button wide-button" type="button">配平初始基准</button></div>':'';
  pages.push(['device','功率与投入','<input class="name-input" data-rename aria-label="装置名称" maxlength="16" value="'+escapeText(node.name)+'"><div class="device-state-row"><p id="device-status" class="inspector-state">已接入</p><label class="toggle-row"><span>装置投入</span><input type="checkbox" data-enabled '+(node.enabled?'checked':'')+'></label></div>'+budget+fields.slice(0,2).join('')+(fields.length<=1?balance:'')]);
  if(balance&&fields.length>1)pages.push(['planning','初始功率计划',balance]);
  if(fields.length>2)pages.push(['energy','容量与调节',fields.slice(2).join('')]);
  if(node.kind==='battery')pages.push(...protocolPages(design));
  pages.push(['readings','物理实际状态','<dl class="reading-list"><div><dt>'+(['bus','critical','residential'].includes(node.kind)?'实际供电':'实际出力')+'</dt><dd id="inspect-power">—</dd></div>'+(node.kind==='battery'?'<div><dt>实际基准</dt><dd id="inspect-base">—</dd></div><div><dt>本地修正</dt><dd id="inspect-local">—</dd></div><div><dt>剩余电量</dt><dd id="inspect-energy">—</dd></div>':'')+'<div><dt>母线频率</dt><dd id="inspect-frequency">—</dd></div></dl><p class="reading-note">教学观察视角。中央调度只使用已收到的记录。</p>']);
  if(node.kind==='battery')pages.push(['knowledge','中央已收记录','<dl class="reading-list"><div><dt>执行结果</dt><dd id="inspect-command">—</dd></div><div><dt>已报告出力</dt><dd id="inspect-known-power">—</dd></div><div><dt>该次采样频率</dt><dd id="inspect-known-frequency">—</dd></div><div><dt>数据年龄</dt><dd id="inspect-age">—</dd></div></dl><p id="inspect-receipt" class="reading-note"></p>']);
  const attached=design.edges.filter(e=>e.from.nodeId===node.id||e.to.nodeId===node.id);
  pages.push(['connections','连接 · '+attached.length,attached.map(edge=>{
    const other=design.nodes.find(n=>n.id===(edge.from.nodeId===node.id?edge.to.nodeId:edge.from.nodeId))!;
    return '<div class="connection-row"><span>'+escapeText(other.name)+' · '+(edge.closed?'合闸':'断开')+'</span><button type="button" data-disconnect="'+escapeText(edge.id)+'" aria-label="断开与'+escapeText(other.name)+'的连接">×</button></div>';
  }).join('')+(attached.length?'':'<p class="empty-reading">尚未接线，从端子拖出线路。</p>')+'<button id="remove-device" class="quiet-danger" type="button" '+disabled+'>移出画布</button>']);
  const fixed=NODE_FIELDS[node.kind].filter(field=>!fieldRange(missionId,node,field.key));
  if(fixed.length)pages.push(['specifications','本关固定规格','<dl class="fixed-specs">'+fixed.map(field=>'<dt>'+field.label+'</dt><dd>'+numberValue(node,field.key)+' '+field.unit+'</dd>').join('')+'</dl>']);
  content.innerHTML=panelPages(pages,node.id,disabled);updateInspectorReadings();
}
function updateInspectorReadings():void {
  if(inspector.hidden||selection?.type!=='node')return;
  const design=history.current,node=design.nodes.find(n=>n.id===selection!.id)!;
  text('inspector-kind',missionId==='lab'?KIND_LABELS[node.kind]+'参数':missionId==='training'?'接线训练 · '+(trainingStage(design)==='wire'?'接通负荷':trainingStage(design)==='balance'?'配平功率':'运行验证'):MISSIONS[missionId].number+' / '+MISSIONS[missionId].title);
  const reading=deviceReading(node,analyzeDesign(design).connected,view?.snapshot??null);
  text('device-status',reading.status);element('device-status').classList.toggle('off',reading.status!=='已接入');
  text('inspect-power',format(reading.power)+' kW');
  text('inspect-frequency',format(view?.snapshot.physical.frequencyHz,3)+' Hz');
  const budget=document.getElementById('plan-budget');
  if(budget){const cost=expansionCost(design);text('plan-budget-value',String(cost));budget.classList.toggle('over',cost>MISSION_TARGETS.expansionKw);}
  if(document.getElementById('balance-required')&&node.kind==='battery'){
    const c=analyzeDesign(design).config,needed=requiredBase(c),gap=node.baseKw-needed;
    text('balance-context','风光 '+(c.pvInitialKw+c.windKw).toFixed(1)+' · 接入用电 '+c.servedDemandKw.toFixed(1)+' · 损耗 '+PHYSICS.lossKw+' kW');
    text('balance-required',needed>=0?'储能需补足 '+needed.toFixed(1)+' kW':'储能需吸收 '+Math.abs(needed).toFixed(1)+' kW');
    text('balance-gap',Math.abs(gap)<=MISSION_TARGETS.initialGapKw?'初始计划已配平':gap<0?'当前计划缺口 '+Math.abs(gap).toFixed(1)+' kW':'当前计划余电 '+gap.toFixed(1)+' kW');
    element('balance-gap').classList.toggle('balanced',Math.abs(gap)<=MISSION_TARGETS.initialGapKw);
  }
  if(node.kind!=='battery')return;
  const snapshot=view?.snapshot;
  text('inspect-base',format(snapshot?.physical.baseKw)+' kW');
  text('inspect-local',format(snapshot?.physical.localKw)+' kW');
  text('inspect-energy',format(snapshot?.physical.energyKwh,3)+' kWh');
  const command=snapshot?.known.command;
  text('inspect-command',!command?'未发送':command.status==='confirmed'?'已确认':command.status==='rejected'?'设备拒绝':command.status==='exhausted'?'仍未知，已停重试':'执行结果未知');
  text('inspect-known-power',format(snapshot?.known.device.batteryKw)+' kW');
  text('inspect-known-frequency',format(snapshot?.known.device.frequencyHz,3)+' Hz');
  text('inspect-age',snapshot?format(snapshot.time-snapshot.known.device.sampledAt)+' s':'—');
  text('inspect-receipt',command?.status==='confirmed'?'执行于 '+format(command.executedAt)+' s，'+format(command.confirmedAt)+' s 收到'+(command.source==='ack'?'回执':'遥测核对')+'。回执不代表当前遥测。':command?.status==='rejected'?'设备返回拒绝记录；原因见处理事件。拒绝回执也不代替当前遥测。':'回执丢失时，实际执行可能已经发生。');
}
function refreshInspectorValues():void {
  if(!selection||selection.type!=='node')return;
  const node=history.current.nodes.find(n=>n.id===selection!.id)!;
  text('inspector-title',node.name);
  for(const input of inspector.querySelectorAll<HTMLInputElement>('[data-number]')){
    const key=input.dataset['number'] as NumericKey;
    input.value=String(numberValue(node,key));
    const field={...NODE_FIELDS[node.kind].find(f=>f.key===key)!,...fieldRange(missionId,node,key)!};
    input.max=String(node.kind==='solar'&&key==='dropKw'?Math.min(field.max,node.powerKw)
      :node.kind==='battery'&&key==='initialKwh'?node.capacityKwh
      :node.kind==='battery'&&key==='baseKw'?Math.min(field.max,node.maxKw):field.max);
    input.min=String(node.kind==='battery'&&key==='baseKw'?Math.max(field.min,-node.maxKw):field.min);
  }
  const rename=inspector.querySelector<HTMLInputElement>('[data-rename]');if(rename)rename.value=node.name;
  for(const control of inspector.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-protocol]')){
    const value=history.current.protocol[control.dataset['protocol'] as keyof GridDesign['protocol']];
    if(control instanceof HTMLInputElement)control.checked=Boolean(value);else control.value=String(value??'');
  }
  for(const button of inspector.querySelectorAll<HTMLButtonElement>('[data-strategy]')){const preset=strategiesFor(missionId).find(p=>p.id===button.dataset['strategy']);if(preset)button.setAttribute('aria-pressed',String(Object.entries(preset.protocol).every(([key,value])=>history.current.protocol[key as ProtocolKey]===value)));}
  updateInspectorReadings();
}
function commitInspectorInput(input:HTMLInputElement|HTMLSelectElement):void {
  if(!selection||testing())return;
  const form=input.closest<HTMLElement>('[data-node-id],[data-edge-id]');
  // 替换点选对象时旧输入仍会触发失焦；它只能提交给所属装置，不能套用新选择。
  if(!form||form.dataset[selection.type==='node'?'nodeId':'edgeId']!==selection.id)return;
  try{
    const design=history.current;
    if(selection.type==='edge'&&input.hasAttribute('data-edge-state')){
      const checked=(input as HTMLInputElement).checked;
      if(design.edges.find(e=>e.id===selection!.id)!.closed===checked)return;
      applyDesign(editDesign(design,d=>{d.edges.find(e=>e.id===selection!.id)!.closed=checked;}),false);return;
    }
    if(selection.type!=='node')return;
    const id=selection.id,key=input.dataset['number'] as NumericKey|undefined;
    if(key){
      if(!fieldRange(missionId,design.nodes.find(n=>n.id===id)!,key))throw Error('这个参数是本关固定条件');
      if(input.value.trim()==='')throw Error('请输入'+fieldLabel(key,design.nodes.find(n=>n.id===id)!));
      if(Number(input.value)===numberValue(design.nodes.find(n=>n.id===id)!,key))return;
      applyDesign(updateNumber(design,id,key,Number(input.value)),false);
    }else if(input.hasAttribute('data-rename')){
      if(design.nodes.find(n=>n.id===id)!.name===input.value.trim())return;
      applyDesign(editDesign(design,d=>{d.nodes.find(n=>n.id===id)!.name=input.value.trim();}),false);
    }else if(input.hasAttribute('data-enabled')){
      const checked=(input as HTMLInputElement).checked;
      if(design.nodes.find(n=>n.id===id)!.enabled===checked)return;
      applyDesign(editDesign(design,d=>{d.nodes.find(n=>n.id===id)!.enabled=checked;}),false);
    }else if(input.dataset['protocol']){
      const setting=input.dataset['protocol'] as keyof GridDesign['protocol'];
      if(!protocolEditable(missionId,setting))throw Error('本关尚未开放此规则');
      const value=setting==='deduplicate'||setting==='priority'?(input as HTMLInputElement).checked:
        setting==='retryAfter'||setting==='telemetryEvery'?Number(input.value):setting==='commandTtl'?(input.value===''?null:Number(input.value)):input.value;
      if(design.protocol[setting]===value)return;
      applyDesign(editDesign(design,d=>Object.assign(d.protocol,{[setting]:value})),false);
    }
  }catch(error){notify(error instanceof Error?error.message:String(error));refreshInspectorValues();}
}
inspector.addEventListener('change',event=>{
  const input=event.target;
  if(input instanceof HTMLSelectElement&&input.hasAttribute('data-inspector-page')){activateInspectorPage(input.value);return;}
  if(input instanceof HTMLInputElement||input instanceof HTMLSelectElement)commitInspectorInput(input);
});
inspector.addEventListener('focusout',event=>{
  const input=event.target;
  if(input instanceof HTMLInputElement&&inspector.contains(input))commitInspectorInput(input);
});
inspector.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();commitInspectorInput(event.target);}
});
document.addEventListener('pointerdown',event=>{
  const active=document.activeElement;
  if(active instanceof HTMLInputElement&&inspector.contains(active)&&active!==event.target)commitInspectorInput(active);
},true);
inspector.addEventListener('click',event=>{
  const target=event.target as Element;
  if(testing()||!selection)return;
  const step=target.closest<HTMLElement>('[data-inspector-step]');
  if(step){const select=inspector.querySelector<HTMLSelectElement>('[data-inspector-page]');if(select){const index=(select.selectedIndex+Number(step.dataset['inspectorStep'])+select.options.length)%select.options.length;activateInspectorPage(select.options[index]!.value);}return;}
  const preset=target.closest<HTMLElement>('[data-strategy]');
  if(preset){const choice=strategiesFor(missionId).find(p=>p.id===preset.dataset['strategy']);if(choice){change(d=>Object.assign(d.protocol,choice.protocol));inspector.querySelector<HTMLElement>('[data-strategy="'+choice.id+'"]')?.focus({preventScroll:true});notify('已采用「'+choice.title+'」，运行试验比较实际代价');}return;}
  const disconnect=target.closest<HTMLButtonElement>('[data-disconnect]');
  if(disconnect){change(d=>{d.edges=d.edges.filter(e=>e.id!==disconnect.dataset['disconnect']);});return;}
  if(target.id==='remove-edge'&&selection.type==='edge'){change(d=>{d.edges=d.edges.filter(e=>e.id!==selection!.id);});closeInspector();selection=null;editor.setSelection(null);}
  else if(target.id==='auto-route'&&selection.type==='edge')change(d=>{d.edges.find(e=>e.id===selection!.id)!.via=null;});
  else if(target.id==='remove-device'&&selection.type==='node'){
    try{applyDesign(removeDevice(history.current,selection.id));selection=null;editor.setSelection(null);closeInspector();notify('装置已移出，可在装置库放回或撤销');}catch(error){notify(String(error));}
  }else if(target.id==='balance-base'&&selection.type==='node'){
    const design=history.current,node=design.nodes.find(n=>n.id===selection!.id)!;
    if(node.kind!=='battery')return;
    const needed=requiredBase(analyzeDesign(design).config);
    if(Math.abs(needed)>node.maxKw){notify('需要 '+needed.toFixed(1)+' kW，已超出储能上限；请先调整电源或负荷');return;}
    try{applyDesign(updateNumber(design,node.id,'baseKw',Number(needed.toFixed(2))),false);notify('初始基准已配平；云层后的调节仍由协议执行');}catch(error){notify(String(error));}
  }
});
function showCause(goal?:string):void {
  if(testing())return;
  const feedback=trialFeedback(missionId,currentReport,goal);
  const node=history.current.nodes.find(n=>n.kind===feedback.kind)!;
  if(!node.present){closeResults();palette.hidden=false;renderPalette();updatePaletteHandle();notify('请从装置库放回'+node.name);return;}
  editor.fit();focusedInspector=true;openNode(node.id,feedback.kind==='battery');
  const selector=feedback.protocol?'[data-protocol="'+feedback.protocol+'"]':feedback.field?'[data-number="'+feedback.field+'"]':null;
  if(selector)requestAnimationFrame(()=>{
    const input=inspector.querySelector<HTMLElement>(selector);
    if(input){const page=input.closest<HTMLElement>('[data-inspector-panel]');if(page)activateInspectorPage(page.dataset['inspectorPanel']!);input.focus({preventScroll:true});}
  });
}
element('diagnosis').addEventListener('click',()=>review.focusFailure());
function renderResults():void {
  if(!resultsOpen||!view)return;
  const running=view.phase==='running',report=currentReport;
  text('result-title',workerError?'测试无法运行':running?'频率记录':view.phase==='paused'?'测试已暂停':report?.success?missionId==='lab'?'当前配置通过':MISSIONS[missionId].title+' · 完成':'测试结果');
  text('result-time',format(view.actualTime)+' / '+format(activeConfig.duration)+' s');
  text('return-grid',running?'停止测试':'返回组网');
  element('return-grid').setAttribute('aria-label',running?'停止测试并返回组网':'返回组网');
  text('result-count',String(report?.metrics.appliedCount??view.snapshot.appliedCount));
  text('result-count-label',report?'整局执行':'当前执行');text('result-service-label',report?'整局供电':'当前供电');
  const signal=view.snapshot.network,age=view.snapshot.time-view.snapshot.known.device.sampledAt;
  text('trial-context',(view.selectedTime===null?'':'回看 · ')+(missionId==='traffic'?'排队 '+signal.queued+' · 报文 '+signal.sent+' / '+MISSION_TARGETS.messages:
    missionId==='night'?'储能剩余 '+view.snapshot.physical.energyKwh.toFixed(3)+' kWh':
    !signal.connected?'链路失联 · 设备记录年龄 '+age.toFixed(1)+' s':signal.reconciled?'状态已核对 · 记录年龄 '+age.toFixed(1)+' s':'设备记录年龄 '+age.toFixed(1)+' s'));
  const ratio=report?.metrics.serviceRatio??(activeConfig.demandKw>0?view.snapshot.physical.servedKw/activeConfig.demandKw:0);
  text('result-service',(ratio*100).toFixed(0));
  const message=workerError??(report?trialFeedback(missionId,report).title+(report.success?'':' · 查看'):!view.snapshot.network.connected?'通信失联，本地仍在响应':view.snapshot.known.command?.status==='confirmed'?'执行结果已确认':view.snapshot.known.command?'执行与确认正在分离':'观察供需与频率');
  text('diagnosis',message);
  const diagnosisButton=element<HTMLButtonElement>('diagnosis');
  diagnosisButton.disabled=!report||report.success;diagnosisButton.classList.toggle('ok',Boolean(report?.success));
  text('result-deviation',report?format(report.metrics.settledDeviationHz,3)+' Hz':'—');
  text('result-energy',report?(report.metrics.energyUsedKwh*1000).toFixed(1)+' Wh':'—');
  const previous=baseline&&comparable(baseline,activeConfig)?baseline.trace:[];
  element('previous-legend').hidden=!previous.length;
  element('comparison-note').hidden=!baseline||Boolean(previous.length);
  if(baseline&&!previous.length)text('comparison-note',baseline.modelRevision!==MODEL_REVISION?'试验规则已更新，旧曲线未叠加':'设备或场景条件不同，旧曲线未叠加');
  drawFrequency(canvas,{trace:view.trace,events:view.events,time:view.snapshot.time,duration:activeConfig.duration,previous});
  const p=view.snapshot;
  const command=p.known.command;
  text('cursor-reading',(view.selectedTime===null?'当前 ':'回看 ')+format(p.time)+' s · 实际 '+format(p.physical.frequencyHz,3)+' Hz · 中央 '+format(p.known.device.frequencyHz,3)+' Hz'+(command?' · '+(command.status==='confirmed'?'已确认':command.status==='rejected'?'设备拒绝':'结果仍未知'):''));
  journey.results(missionId,report,view.phase,campaign.progress[missionId]?.attempts??1);
  review.update(runId,view,baseline);
}
function renderView(data:View):void {
  view=data;
  const finished=Boolean(data.report&&savedRun!==runId);
  const snapshot=data.snapshot;
  runButton.disabled=testing();
  journey.ready();
  editor.setLocked(resultsOpen);editor.setSnapshot(snapshot);
  document.body.classList.toggle('app-running',resultsOpen&&data.phase==='running');
  document.body.classList.toggle('app-paused',resultsOpen&&data.phase!=='running');
  element('trial-progress').style.setProperty('--progress',(data.actualTime/activeConfig.duration*100).toFixed(2)+'%');
  const frequency=snapshot.physical.frequencyHz;
  text('frequency',format(frequency,2));
  element('frequency').classList.toggle('warning',frequency!==null&&Math.abs(frequency-50)>MISSION_TARGETS.settledDeviationHz);
  text('service',(activeConfig.demandKw>0?snapshot.physical.servedKw/activeConfig.demandKw*100:0).toFixed(0));
  const status=data.selectedTime!==null?'回看 '+format(snapshot.time)+' s':data.phase==='running'?'测试中 '+format(data.actualTime)+' s':data.phase==='review'?'已完成测试':data.phase==='paused'?resultsOpen?'测试已暂停':'测试已停止':'组网就绪';
  text('work-status',status);element('work-status').classList.toggle('testing',testing());
  if(data.report&&savedRun!==runId){
    savedRun=runId;currentReport=data.report;lastReport=data.report;prepareExport();
    finishAttempt(campaign,missionId,data.report);saveCampaign();
    if(missionId==='lab'){labLast=data.report;const warning=saveStored(REPORT_KEY,data.report);if(warning)notify(warning);}
  }
  journey.signal(snapshot);
  if(resultsOpen){
    const recent=recentEventAt(data.events,snapshot.time);
    element('live-event').hidden=!recent;
    if(recent){text('live-event-text',recent.title);element('live-event').dataset['kind']=recent.kind;}
  }
  updateInspectorReadings();renderResults();
  if(finished&&resultsOpen&&!journey.modalOpen)element('result-title').focus({preventScroll:true});
}
worker.addEventListener('message',(event:MessageEvent<WorkerResponse>)=>{
  const data=event.data;if(data.runId!==runId)return;
  if(data.type==='error'){
    workerError=data.message;editor.setLocked(false);runButton.disabled=false;
    text('result-title','测试无法运行');text('diagnosis',data.message);notify('测试已停止：'+data.message);return;
  }renderView(data);
});
worker.addEventListener('error',event=>{workerError=event.message||'无法载入模拟器';notify(workerError);runButton.disabled=false;editor.setLocked(false);});
canvas.addEventListener('click',event=>{
  if(view&&view.phase!=='running')post({type:'seek',runId,value:timeAtCanvas(canvas,event.clientX,activeConfig.duration)});
});
canvas.addEventListener('keydown',event=>{
  if(event.key===' '&&!currentReport){event.preventDefault();pauseTrial();return;}
  if(!view||view.phase==='running'||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const time=event.key==='Home'?0:event.key==='End'?view.actualTime:view.snapshot.time+(event.key==='ArrowLeft'?-.5:.5);
  post({type:'seek',runId,value:Math.max(0,Math.min(view.actualTime,time))});
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(resultsOpen)closeResults();else{closeInspector();palette.hidden=true;updatePaletteHandle();editor.cancel();}
    return;
  }
  const target=event.target as Element;
  if(target.closest('input,select,textarea,[contenteditable]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();moveHistory(event.shiftKey?'redo':'undo');}
  else if(event.key==='Delete'&&selection&&!testing()){
    if(selection.type==='edge')change(d=>{d.edges=d.edges.filter(e=>e.id!==selection!.id);});
    else{try{applyDesign(removeDevice(history.current,selection.id));}catch(error){notify(String(error));}}
    selection=null;editor.setSelection(null);closeInspector();
  }
});
new ResizeObserver(()=>{if(resultsOpen)renderResults();}).observe(canvas);
document.body.classList.toggle('reduce-motion',preferences.reduceMotion);
renderPalette();refreshJourney();preview();
if(campaign.tutorial==='new'&&missionId==='training')journey.welcome(loadWarning);
else if(loadWarning)setTimeout(()=>notify(loadWarning),300);

