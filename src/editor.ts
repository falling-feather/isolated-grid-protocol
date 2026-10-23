import { WORLD, analyzeDesign, clampPosition, collides, connectPorts, deviceReading, editDesign, getPort, getPorts, imageBox, nodeBounds, obstaclesForNode, portKey, snap } from './network.ts';
import { EQUIPMENT } from './equipment.ts';
import type { GridDesign, GridNode, Point, PortRef } from './network.ts';
import { pathData, routeDesign, routeOrthogonal, wireControls } from './routing.ts';
import type { Route } from './routing.ts';
import type { Snapshot } from './simulation.ts';
export type Selection={type:'node'|'edge';id:string}|null;
interface Callbacks {
  commit(design:GridDesign):void;
  select(value:Selection,open:boolean):void;
  notify(message:string):void;
}
type Gesture=
  | {type:'pan';pointer:number;start:Point;camera:Point}
  | {type:'node';pointer:number;id:string;start:Point;design:GridDesign;moved:boolean}
  | {type:'bend';pointer:number;id:string;design:GridDesign;moved:boolean}
  | {type:'wire';pointer:number;from:PortRef;start:Point;moved:boolean};
export function escapeText(value:string):string {
  return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export class GridEditor {
  private root:SVGSVGElement;
  private world:SVGGElement;
  private scene:SVGGElement;
  private preview:SVGPathElement;
  private bend:SVGRectElement;
  private design:GridDesign;
  private analysis:ReturnType<typeof analyzeDesign>;
  private routes:Map<string,Route>;
  private snapshot:Snapshot|null=null;
  private selection:Selection=null;
  private gesture:Gesture|null=null;
  private pending:PortRef|null=null;
  private camera={x:0,y:0,scale:1};
  private locked=false;
  private guide:{nodes:string[];ports:PortRef[]}={nodes:[],ports:[]};
  private callbacks:Callbacks;
  constructor(root:SVGSVGElement,design:GridDesign,callbacks:Callbacks){
    this.root=root;this.callbacks=callbacks;this.design=design;this.analysis=analyzeDesign(design);this.routes=routeDesign(design);
    this.world=root.querySelector<SVGGElement>('#world')!;
    this.scene=root.querySelector<SVGGElement>('#scene')!;
    this.preview=root.querySelector<SVGPathElement>('#wire-preview')!;
    this.bend=root.querySelector<SVGRectElement>('#bend-handle')!;
    root.addEventListener('pointerdown',e=>this.pointerDown(e));
    root.addEventListener('pointermove',e=>this.pointerMove(e));
    root.addEventListener('pointerup',e=>this.pointerUp(e));
    root.addEventListener('pointercancel',()=>this.cancelGesture());
    root.addEventListener('wheel',e=>this.zoom(e),{passive:false});
    root.addEventListener('keydown',e=>this.keyDown(e));
    this.renderScene();
  }
  get routeMap():Map<string,Route>{return this.routes;}
  setLocked(value:boolean):void {if(value&&!this.locked)this.cancelGesture();this.locked=value;this.root.classList.toggle('testing',value);this.updateBend();}
  setDesign(value:GridDesign):void {
    const next=analyzeDesign(value);
    if(next.signature!==this.analysis.signature)this.snapshot=null;
    this.design=value;this.analysis=next;this.routes=routeDesign(value);this.renderScene();
  }
  setSnapshot(snapshot:Snapshot):void {this.snapshot=snapshot;this.updateSignals();}
  setSelection(value:Selection):void {
    this.selection=value;
    for(const node of this.scene.querySelectorAll<SVGGElement>('[data-node]')){
      const selected=value?.type==='node'&&node.dataset['node']===value.id;
      node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));
    }
    for(const edge of this.scene.querySelectorAll<SVGGElement>('.wire'))edge.classList.toggle('selected',value?.type==='edge'&&edge.dataset['edge']===value.id);
    for(const port of this.scene.querySelectorAll<SVGGElement>('.port'))port.classList.toggle('selected',value?.type==='node'&&port.dataset['portNode']===value.id);
    this.updateBend();
  }
  fit():void {this.camera={x:0,y:0,scale:1};this.transform();}
  focusNode(id:string):void {
    const node=this.design.nodes.find(n=>n.id===id&&n.present);if(!node)return;
    this.camera.x=WORLD.width/2-node.x*this.camera.scale;this.camera.y=WORLD.height/2-node.y*this.camera.scale;this.transform();
  }
  setGuide(nodes:string[],ports:PortRef[]=[]):void {this.guide={nodes,ports};this.updateGuide();}
  private updateGuide():void {
    for(const node of this.scene.querySelectorAll<SVGGElement>('[data-node]'))node.classList.toggle('guided',this.guide.nodes.includes(node.dataset['node']!));
    for(const port of this.scene.querySelectorAll<SVGGElement>('[data-port-node]'))port.classList.toggle('guided',this.guide.ports.some(p=>p.nodeId===port.dataset['portNode']&&p.portId===port.dataset['port']));
    const annotations=this.guide.ports.filter(ref=>this.design.nodes.some(n=>n.id===ref.nodeId&&n.present)).map(ref=>{
      const port=getPort(this.design,ref),node=this.design.nodes.find(n=>n.id===ref.nodeId)!;
      const down=port.direction==='down',left=port.direction==='left',right=port.direction==='right';
      const x=port.x+(down||right?24:left?-20:0),y=port.y+(down?36:-22);
      return '<text class="guide-port-label" x="'+x+'" y="'+y+'" text-anchor="'+(left?'end':down||right?'start':'middle')+'">'+(node.kind==='bus'?'母线空端':'负荷端子')+'</text>';
    }).join('');
    this.scene.querySelector('#connection-guide')!.innerHTML=annotations;
  }
  cancel():void {this.pending=null;this.preview.classList.remove('visible');this.root.classList.remove('wiring');}
  private transform():void {this.world.setAttribute('transform','translate('+this.camera.x+' '+this.camera.y+') scale('+this.camera.scale+')');}
  private worldPoint(event:Pick<PointerEvent,'clientX'|'clientY'>):Point {
    const matrix=this.world.getScreenCTM();
    if(!matrix)throw Error('无法定位画布');
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};
  }
  private svgPoint(event:Pick<PointerEvent,'clientX'|'clientY'>):Point {
    const matrix=this.root.getScreenCTM()!;
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};
  }
  private portAt(point:Point,from?:PortRef):PortRef|null {
    let found:PortRef|null=null,distance=28;
    for(const node of this.design.nodes.filter(n=>n.present))for(const port of getPorts(node)){
      if(from&&portKey(port)===portKey(from))continue;
      const d=Math.hypot(port.x-point.x,port.y-point.y);
      if(d<distance){found={nodeId:port.nodeId,portId:port.portId};distance=d;}
    }return found;
  }
  private choose(value:Selection,open=true):void {this.setSelection(value);this.callbacks.select(value,open);}
  private toggleEdge(id:string):void {
    this.callbacks.commit(editDesign(this.design,d=>{const edge=d.edges.find(e=>e.id===id)!;edge.closed=!edge.closed;}));
    this.choose({type:'edge',id},false);
  }
  private pointerDown(event:PointerEvent):void {
    if(event.button!==0)return;
    const target=event.target as Element;
    const switchNode=target.closest<SVGElement>('[data-switch]');
    if(switchNode&&!this.locked){
      this.toggleEdge(switchNode.dataset['switch']!);event.preventDefault();return;
    }
    const port=target.closest<SVGElement>('[data-port-node]');
    if(port){
      if(this.locked){this.callbacks.notify('测试中只读，返回组网后可修改接线');return;}
      const ref={nodeId:port.dataset['portNode']!,portId:port.dataset['port']!};
      if(this.pending){this.completeWire(this.pending,ref);return;}
      this.gesture={type:'wire',pointer:event.pointerId,from:ref,start:this.worldPoint(event),moved:false};
      this.pending=ref;this.root.classList.add('wiring');
    }else if(target.closest('[data-bend]')&&!this.locked&&this.selection?.type==='edge'){
      this.gesture={type:'bend',pointer:event.pointerId,id:this.selection.id,design:structuredClone(this.design),moved:false};
    }else{
      const node=target.closest<SVGElement>('[data-node]'),edge=target.closest<SVGElement>('[data-edge]');
      if(node){
        const id=node.dataset['node']!;this.choose({type:'node',id},false);
        this.gesture={type:'node',pointer:event.pointerId,id,start:this.worldPoint(event),design:structuredClone(this.design),moved:false};
      }else if(edge){this.choose({type:'edge',id:edge.dataset['edge']!});return;}
      else{
        if(this.pending){this.cancel();return;}
        this.choose(null,false);
        this.gesture={type:'pan',pointer:event.pointerId,start:this.svgPoint(event),camera:{x:this.camera.x,y:this.camera.y}};
      }
    }
    this.root.setPointerCapture(event.pointerId);event.preventDefault();
  }
  private pointerMove(event:PointerEvent):void {
    const gesture=this.gesture,point=this.worldPoint(event);
    if(!gesture){if(this.pending)this.drawPreview(this.pending,point);return;}
    if(gesture.type==='pan'){
      const p=this.svgPoint(event);this.camera.x=gesture.camera.x+p.x-gesture.start.x;this.camera.y=gesture.camera.y+p.y-gesture.start.y;this.transform();return;
    }
    if(gesture.type==='wire'){
      gesture.moved ||= Math.hypot(point.x-gesture.start.x,point.y-gesture.start.y)>8;
      this.drawPreview(gesture.from,point);return;
    }
    if(this.locked)return;
    if(gesture.type==='node'){
      const node=gesture.design.nodes.find(n=>n.id===gesture.id)!;
      const position=clampPosition(node,{x:node.x+point.x-gesture.start.x,y:node.y+point.y-gesture.start.y});
      if(position.x===node.x&&position.y===node.y)return;
      gesture.moved=true;
      const next=editDesign(gesture.design,d=>{const n=d.nodes.find(n=>n.id===gesture.id)!;n.x=position.x;n.y=position.y;});
      this.setDesign(next);this.root.classList.toggle('invalid-placement',collides(next,gesture.id));
    }else{
      gesture.moved=true;
      const next=editDesign(gesture.design,d=>{d.edges.find(e=>e.id===gesture.id)!.via={x:Math.max(0,Math.min(WORLD.width,snap(point.x))),y:Math.max(0,Math.min(WORLD.height,snap(point.y)))};});
      this.setDesign(next);
    }
  }
  private pointerUp(event:PointerEvent):void {
    const gesture=this.gesture;if(!gesture)return;this.gesture=null;
    if(this.root.hasPointerCapture(event.pointerId))this.root.releasePointerCapture(event.pointerId);
    this.root.classList.remove('invalid-placement');
    if(gesture.type==='pan')return;
    if(gesture.type==='wire'){
      if(!gesture.moved){this.callbacks.notify('再选择一个空端子完成接线');return;}
      const target=this.portAt(this.worldPoint(event),gesture.from);
      if(target)this.completeWire(gesture.from,target);
      else{this.cancel();this.callbacks.notify('请把线路接到装置的端子');}
      return;
    }
    if(gesture.type==='node'&&!gesture.moved){this.choose({type:'node',id:gesture.id});return;}
    if(!gesture.moved)return;
    const invalid=(gesture.type==='node'&&collides(this.design,gesture.id))||[...this.routes.values()].some(r=>r.blocked);
    if(invalid){
      this.setDesign(gesture.design);
      this.callbacks.notify('这个位置占用了装置或通路，已保留原布局');
    }else this.callbacks.commit(this.design);
  }
  private cancelGesture():void {
    const gesture=this.gesture;this.gesture=null;
    if(gesture?.type==='node'||gesture?.type==='bend')this.setDesign(gesture.design);
    this.root.classList.remove('invalid-placement');this.cancel();
  }
  private completeWire(from:PortRef,to:PortRef):void {
    try{
      const next=connectPorts(this.design,from,to),routes=routeDesign(next);
      if([...routes.values()].some(r=>r.blocked))throw Error('没有可用的走线路径，请先移动装置');
      this.callbacks.commit(next);this.callbacks.notify('线路已接入');
    }catch(error){this.callbacks.notify(error instanceof Error?error.message:String(error));}
    this.cancel();
  }
  private drawPreview(from:PortRef,point:Point):void {
    const start=getPort(this.design,from),target=this.portAt(point,from);
    const end=target?getPort(this.design,target):{nodeId:'cursor',portId:'cursor',x:snap(point.x),y:snap(point.y),direction:(point.x>start.x?'left':'right') as 'left'|'right'};
    const route=routeOrthogonal(start,end,this.design.nodes.filter(n=>n.present).flatMap(obstaclesForNode));
    // 预览可以跟随游标；真正接线时必须再次通过完整避障验证。
    const points=route.blocked?[{x:start.x,y:start.y},{x:end.x,y:start.y},{x:end.x,y:end.y}]:route.points;
    this.preview.setAttribute('d',pathData(points));this.preview.classList.add('visible');
    this.preview.classList.toggle('invalid',route.blocked||Boolean(target&&this.design.edges.some(e=>(portKey(e.from)===portKey(target)||portKey(e.to)===portKey(target))&&portKey(e.from)!==portKey(from)&&portKey(e.to)!==portKey(from))));
  }
  private zoom(event:WheelEvent):void {
    event.preventDefault();if(this.gesture)return;
    const point=this.svgPoint(event),factor=event.deltaY>0?0.9:1.1;
    const next=Math.max(0.55,Math.min(1.8,this.camera.scale*factor));
    this.camera.x=point.x-(point.x-this.camera.x)*next/this.camera.scale;
    this.camera.y=point.y-(point.y-this.camera.y)*next/this.camera.scale;
    this.camera.scale=next;this.transform();
  }
  private keyDown(event:KeyboardEvent):void {
    if(event.key==='Escape'){this.cancel();return;}
    const target=event.target as Element,switchNode=target.closest<SVGElement>('[data-switch]'),port=target.closest<SVGElement>('[data-port-node]');
    if(switchNode&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();if(!this.locked)this.toggleEdge(switchNode.dataset['switch']!);return;
    }
    if(port&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();if(this.locked)return;
      const ref={nodeId:port.dataset['portNode']!,portId:port.dataset['port']!};
      if(this.pending)this.completeWire(this.pending,ref);else{this.pending=ref;this.root.classList.add('wiring');this.callbacks.notify('选择另一个端子并按 Enter');}
      return;
    }
    const nodeElement=target.closest<SVGElement>('[data-node]');
    if(nodeElement&&(event.key==='Enter'||event.key===' ')){event.preventDefault();this.choose({type:'node',id:nodeElement.dataset['node']!});return;}
    if(nodeElement&&!this.locked&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault();
      const id=nodeElement.dataset['node']!,node=this.design.nodes.find(n=>n.id===id)!;
      const position=clampPosition(node,{x:node.x+(event.key==='ArrowLeft'?-20:event.key==='ArrowRight'?20:0),y:node.y+(event.key==='ArrowUp'?-20:event.key==='ArrowDown'?20:0)});
      const next=editDesign(this.design,d=>Object.assign(d.nodes.find(n=>n.id===id)!,position));
      if(!collides(next,id)&&![...routeDesign(next).values()].some(r=>r.blocked)){this.callbacks.commit(next);document.getElementById('device-'+id)?.focus();}
    }
  }
  private renderScene():void {
    const focused=(document.activeElement as HTMLElement|null)?.dataset?.['node'];
    const wireMarkup=this.design.edges.map(edge=>{
      const route=this.routes.get(edge.id)!,a=getPort(this.design,edge.from),b=getPort(this.design,edge.to);
      const points=route.blocked?[a,{x:b.x,y:a.y},b]:route.points;
      const mid=wireControls(points,edge.via).breaker;
      return '<g class="wire'+(route.blocked?' blocked':'')+'" data-edge="'+escapeText(edge.id)+'" id="wire-'+escapeText(edge.id)+'">'+
        '<path class="wire-bed" d="'+pathData(points)+'"/><path class="wire-core" d="'+pathData(points)+'"/><path class="wire-flow" d="'+pathData(points)+'"/>'+
        '<path class="wire-hit" d="'+pathData(points)+'"/><g class="breaker" data-switch="'+escapeText(edge.id)+'" transform="translate('+mid.x+' '+mid.y+')" role="button" tabindex="0" aria-label="切换线路开关">'+
        '<rect x="-10" y="-10" width="20" height="20" rx="1"/><path d="'+(edge.closed?'M-5 0H5':'M-5 4 5-4')+'"/></g></g>';
    }).join('');
    const nodes=this.design.nodes.filter(n=>n.present);
    const nodeMarkup=nodes.map(node=>{
      const box=imageBox(node),sprite=EQUIPMENT[node.kind],crop=sprite.crop,bounds=nodeBounds(node),labelY=node.kind==='bus'?node.y+30:box.y+box.height+22;
      const scale=Math.min(box.width/crop.width,box.height/crop.height);
      const spriteStyle='width:100%;height:100%;overflow:hidden;background-repeat:no-repeat;background-image:url(./assets/'+node.kind+'.png);background-size:'+(sprite.width*scale)+'px '+(sprite.height*scale)+'px;background-position:'+((box.width-crop.width*scale)/2-crop.x*scale)+'px '+((box.height-crop.height*scale)/2-crop.y*scale)+'px';
      return '<g class="device kind-'+node.kind+'" data-node="'+escapeText(node.id)+'" id="device-'+escapeText(node.id)+'" role="button" tabindex="0" aria-label="'+escapeText(node.name)+'，点击查看参数">'+
        '<rect class="device-hit" x="'+bounds.x+'" y="'+bounds.y+'" width="'+bounds.width+'" height="'+bounds.height+'"/>'+
        (node.kind==='bus'?'<path class="busbar" d="M'+(node.x-300)+' '+node.y+'H'+(node.x+300)+'"/>':'')+
        '<foreignObject class="equipment" x="'+box.x+'" y="'+box.y+'" width="'+box.width+'" height="'+box.height+'" aria-hidden="true"><div xmlns="http://www.w3.org/1999/xhtml" style="'+spriteStyle+'"></div></foreignObject>'+
        '<rect class="selection-outline" x="'+(box.x-8)+'" y="'+(box.y-6)+'" width="'+(box.width+16)+'" height="'+(box.height+12)+'" rx="3"/>'+
        '<text class="device-label" x="'+node.x+'" y="'+labelY+'" text-anchor="middle">'+escapeText(node.name)+'</text>'+
        (node.kind==='bus'?'':'<text class="device-value" data-value="'+escapeText(node.id)+'" x="'+node.x+'" y="'+(labelY+20)+'" text-anchor="middle"></text>')+
        (node.kind==='battery'?'<g class="energy-gauge"><rect class="energy-gauge-bg" x="'+(node.x-60)+'" y="'+(labelY+33)+'" width="120" height="4" rx="1"/><rect class="energy-gauge-fill" data-energy="'+escapeText(node.id)+'" x="'+(node.x-60)+'" y="'+(labelY+33)+'" width="0" height="4" rx="1"/></g>':'')+
        '<circle class="device-alert" data-alert="'+escapeText(node.id)+'" cx="'+(box.x+box.width-10)+'" cy="'+(box.y+12)+'" r="5"/></g>';
    }).join('');
    const ports=nodes.flatMap(getPorts).map(port=>{
      const connected=this.design.edges.some(e=>portKey(e.from)===portKey(port)||portKey(e.to)===portKey(port));
      const node=this.design.nodes.find(n=>n.id===port.nodeId)!;
      const label=escapeText(node.name)+' 接线端子'+(node.kind==='bus'?' '+(Number(port.portId.slice(1))+1):'');
      return '<g class="port'+(connected?' connected':'')+'" data-port-node="'+escapeText(port.nodeId)+'" data-port="'+port.portId+'" transform="translate('+port.x+' '+port.y+')" role="button" tabindex="0" aria-label="'+label+'"><title>'+label+'</title><circle class="port-hit" r="15"/><circle class="port-ring" r="5"/></g>';
    }).join('');
    const battery=nodes.find(n=>n.kind==='battery');
    const communication=battery?'<g class="comms-layer" aria-hidden="true"><path class="communication-link" d="M1120 63V76H'+battery.x+'V'+imageBox(battery).y+'"/><rect class="communication-head" x="1056" y="30" width="128" height="33" rx="2"/><circle class="communication-dot" cx="1068" cy="47" r="3"/><text class="communication-label" x="1120" y="51" text-anchor="middle">中央调度</text></g>':'';
    this.scene.innerHTML=wireMarkup+nodeMarkup+'<g class="ports">'+ports+'</g>'+communication+'<g id="connection-guide" aria-hidden="true"></g>';
    this.setSelection(this.selection);this.updateSignals();this.updateGuide();
    if(focused)document.getElementById('device-'+focused)?.focus({preventScroll:true});
  }
  private updateSignals():void {
    const state=this.snapshot?.physical,active=state?.energized?this.analysis.connected:new Set<string>();
    for(const node of this.design.nodes.filter(n=>n.present)){
      const element=document.getElementById('device-'+node.id)!;
      element.classList.toggle('powered',active.has(node.id));element.classList.toggle('disabled',!node.enabled);
      const label=this.scene.querySelector<SVGTextElement>('[data-value="'+node.id+'"]');
      if(label)label.textContent=this.nodeValue(node);
      const alert=this.scene.querySelector<SVGCircleElement>('[data-alert="'+node.id+'"]')!;
      alert.classList.toggle('visible',node.kind==='battery'&&(this.snapshot?.appliedCount??0)>1);
      if(node.kind==='battery'){
        const energy=this.snapshot?.physical.energyKwh??node.initialKwh;
        element.classList.toggle('energy-low',energy/node.capacityKwh<.15);
        this.scene.querySelector<SVGRectElement>('[data-energy="'+node.id+'"]')?.setAttribute('width',String(Math.max(0,Math.min(120,120*energy/node.capacityKwh))));
      }
    }
    for(const edge of this.design.edges){
      const element=document.getElementById('wire-'+edge.id)!;
      element.classList.toggle('powered',edge.closed&&active.has(edge.from.nodeId)&&active.has(edge.to.nodeId));
      element.classList.toggle('open',!edge.closed);
      const bus=this.design.nodes.find(n=>n.kind==='bus')!;
      const other=this.design.nodes.find(n=>n.id===(edge.from.nodeId===bus.id?edge.to.nodeId:edge.from.nodeId))!;
      const power=deviceReading(other,this.analysis.connected,this.snapshot).power??0;
      const supply=['solar','wind','battery'].includes(other.kind);
      const direction=(supply?(edge.from.nodeId===other.id?1:-1):(edge.to.nodeId===other.id?1:-1))*power;
      element.classList.toggle('quiet',Math.abs(power)<.5);
      element.style.setProperty('--flow-direction',direction>=0?'normal':'reverse');
      element.style.setProperty('--flow-speed',Math.max(1.2,5-Math.abs(power)/20).toFixed(1)+'s');
    }
    const comms=this.scene.querySelector<SVGGElement>('.comms-layer'),network=this.snapshot?.network;
    if(comms&&network){comms.classList.toggle('online',network.connected);comms.classList.toggle('offline',!network.connected);comms.classList.toggle('busy',network.queued>0);comms.querySelector('text')!.textContent=network.connected?'中央调度':'调度失联';}
  }
  private nodeValue(node:GridNode):string {
    const reading=deviceReading(node,this.analysis.connected,this.snapshot);
    return reading.status==='已接入'&&reading.power!==null?reading.power.toFixed(1)+' kW':reading.status;
  }
  private updateBend():void {
    const edge=this.selection?.type==='edge'?this.design.edges.find(e=>e.id===this.selection!.id):null;
    const route=edge?this.routes.get(edge.id):null;
    this.bend.classList.toggle('visible',Boolean(edge&&route&&!route.blocked&&!this.locked));
    if(edge&&route&&!route.blocked){
      const point=wireControls(route.points,edge.via).bend;
      this.bend.setAttribute('x',String(point.x-6));this.bend.setAttribute('y',String(point.y-6));
      this.bend.dataset['bend']=edge.id;
    }
  }
}
