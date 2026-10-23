import type { PlotPoint,SimEvent } from './simulation.ts';
import { MISSION_TARGETS } from './missions.ts';
export interface PlotState {trace:PlotPoint[];events:SimEvent[];time:number;duration:number;previous:PlotPoint[]}
export function drawFrequency(canvas:HTMLCanvasElement,state:PlotState):void {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const width=canvas.clientWidth,height=canvas.clientHeight;if(width<1||height<1)return;
  const dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const samples=[...state.trace,...state.previous].map(p=>p.frequencyHz).filter((n):n is number=>n!==null);
  const band=MISSION_TARGETS.settledDeviationHz;
  const low=Math.min(49.5,Math.floor((Math.min(50,...samples)-band)*2)/2);
  const high=Math.max(50.5,Math.ceil((Math.max(50,...samples)+band)*2)/2);
  const left=47,right=width-16,top=31,bottom=height-28;
  const x=(t:number)=>left+t/state.duration*(right-left);
  const y=(f:number)=>top+(high-f)/(high-low)*(bottom-top);
  ctx.fillStyle='rgba(80,155,131,.055)';ctx.fillRect(left,y(50+band),right-left,y(50-band)-y(50+band));
  ctx.font='10px Consolas,monospace';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const f=low+(high-low)*i/4;
    ctx.strokeStyle=Math.abs(f-50)<.001?'#52616b':'#25323a';ctx.beginPath();ctx.moveTo(left,y(f));ctx.lineTo(right,y(f));ctx.stroke();
    ctx.fillStyle='#7e929f';ctx.textAlign='right';ctx.fillText(f.toFixed(high-low<=2?2:1),left-9,y(f)+3);
  }
  ctx.textAlign='center';
  for(let i=0;i<=4;i++){const t=state.duration*i/4;ctx.fillStyle='#718795';ctx.fillText(t.toFixed(0)+'s',x(t),height-8);}
  function line(points:PlotPoint[],key:'frequencyHz'|'knownFrequencyHz',color:string,dash:number[],stepped=false):void {
    ctx!.save();ctx!.beginPath();ctx!.rect(left,top,right-left,bottom-top);ctx!.clip();
    ctx!.strokeStyle=color;ctx!.lineWidth=key==='frequencyHz'?1.8:1.2;ctx!.setLineDash(dash);ctx!.beginPath();
    let previous:number|null=null;
    for(const p of points){
      const f=p[key];if(f===null){previous=null;continue;}
      if(previous===null)ctx!.moveTo(x(p.time),y(f));
      else{if(stepped)ctx!.lineTo(x(p.time),y(previous));ctx!.lineTo(x(p.time),y(f));}
      previous=f;
    }ctx!.stroke();ctx!.restore();
  }
  if(state.previous.length)line(state.previous,'frequencyHz','#65737d',[4,5]);
  line(state.trace,'knownFrequencyHz','#6b9cbe',[3,4],true);
  line(state.trace,'frequencyHz','#edb94e',[]);
  const annotations=[state.events.find(e=>e.kind==='applied'),state.events.find(e=>e.kind==='retry')].filter((e):e is SimEvent=>Boolean(e));
  annotations.forEach((event,index)=>{
    const px=x(event.time);ctx.strokeStyle='#77643c';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#c5b389';ctx.textAlign='left';ctx.fillText(event.kind==='applied'?'执行':'重试',px+5,13+index*12);
  });
  ctx.strokeStyle='#9cb9ce';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x(state.time),top);ctx.lineTo(x(state.time),bottom);ctx.stroke();ctx.setLineDash([]);
}
export function timeAtCanvas(canvas:HTMLCanvasElement,clientX:number,duration:number):number {
  const box=canvas.getBoundingClientRect();
  return Math.max(0,Math.min(duration,(clientX-box.left-47)/(box.width-63)*duration));
}
