import { WORLD, getPort, obstaclesForNode } from './network.ts';
import type { Point, Rect, Port, GridDesign } from './network.ts';
export interface Route {points:Point[];blocked:boolean}
const DELTAS=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}] as const;
const NORMALS={right:{x:1,y:0},down:{x:0,y:1},left:{x:-1,y:0},up:{x:0,y:-1}};
const pointKey=(x:number,y:number)=>x+':'+y;
const same=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y;
export function segmentHitsRect(a:Point,b:Point,r:Rect):boolean {
  if(a.x===b.x)return a.x>=r.x&&a.x<=r.x+r.width&&Math.max(a.y,b.y)>=r.y&&Math.min(a.y,b.y)<=r.y+r.height;
  if(a.y===b.y)return a.y>=r.y&&a.y<=r.y+r.height&&Math.max(a.x,b.x)>=r.x&&Math.min(a.x,b.x)<=r.x+r.width;
  throw Error('路径必须正交');
}
interface State {x:number;y:number;direction:number;g:number;f:number;order:number;parent:State|null}
class Heap {
  private values:State[]=[];
  get size():number{return this.values.length;}
  private less(a:State,b:State):boolean{return a.f<b.f||(a.f===b.f&&a.order<b.order);}
  push(value:State):void {
    const items=this.values;items.push(value);let index=items.length-1;
    while(index>0){const parent=(index-1)>>1;if(!this.less(items[index]!,items[parent]!))break;[items[index],items[parent]]=[items[parent]!,items[index]!];index=parent;}
  }
  pop():State {
    const items=this.values,first=items[0]!,last=items.pop()!;
    if(items.length){items[0]=last;let index=0;
      while(true){const left=index*2+1,right=left+1;let best=index;
        if(left<items.length&&this.less(items[left]!,items[best]!))best=left;
        if(right<items.length&&this.less(items[right]!,items[best]!))best=right;
        if(best===index)break;
        [items[index],items[best]]=[items[best]!,items[index]!];index=best;
      }
    }return first;
  }
}
function findPath(start:Point,end:Point,obstacles:Rect[],reserved:Map<string,number>):Point[]|null {
  const grid=WORLD.grid,sx=start.x/grid,sy=start.y/grid,ex=end.x/grid,ey=end.y/grid;
  const maxX=WORLD.width/grid,maxY=WORLD.height/grid;
  const inside=(x:number,y:number)=>obstacles.some(r=>x*grid>=r.x&&x*grid<=r.x+r.width&&y*grid>=r.y&&y*grid<=r.y+r.height);
  if(inside(sx,sy)||inside(ex,ey))return null;
  const open=new Heap(),cost=new Map<string,number>();let order=0;
  open.push({x:sx,y:sy,direction:-1,g:0,f:Math.abs(ex-sx)+Math.abs(ey-sy),order:order++,parent:null});
  while(open.size) {
    const state=open.pop(),key=pointKey(state.x,state.y)+':'+state.direction;
    if(state.g>(cost.get(key)??Infinity)+1e-9)continue;
    if(state.x===ex&&state.y===ey){
      const path:Point[]=[];let cursor:State|null=state;
      while(cursor){path.push({x:cursor.x*grid,y:cursor.y*grid});cursor=cursor.parent;}
      return path.reverse();
    }
    for(let direction=0;direction<4;direction++){
      const delta=DELTAS[direction]!,x=state.x+delta.x,y=state.y+delta.y;
      if(x<0||y<0||x>maxX||y>maxY||inside(x,y))continue;
      const a={x:state.x*grid,y:state.y*grid},b={x:x*grid,y:y*grid};
      if(obstacles.some(r=>segmentHitsRect(a,b,r)))continue;
      const g=state.g+1+(state.direction!==-1&&state.direction!==direction?0.4:0)+(reserved.get(pointKey(x,y))??0)*1.5;
      const nextKey=pointKey(x,y)+':'+direction;
      if(g>=(cost.get(nextKey)??Infinity)-1e-9)continue;
      cost.set(nextKey,g);
      open.push({x,y,direction,g,f:g+Math.abs(ex-x)+Math.abs(ey-y),order:order++,parent:state});
    }
  }
  return null;
}
function simplify(points:Point[],via:Point|null):Point[] {
  const output:Point[]=[];
  for(const point of points){
    if(output.length&&same(output.at(-1)!,point))continue;
    while(output.length>=2){
      const a=output.at(-2)!,b=output.at(-1)!;
      if(via&&same(b,via))break;
      if((a.x===b.x&&b.x===point.x)||(a.y===b.y&&b.y===point.y))output.pop();else break;
    }output.push(point);
  }return output;
}
export function routeOrthogonal(start:Port,end:Port,rectangles:Rect[],via:Point|null=null,reserved=new Map<string,number>()):Route {
  const obstacles=rectangles.map(r=>({x:r.x-14,y:r.y-14,width:r.width+28,height:r.height+28}));
  const normalA=NORMALS[start.direction],normalB=NORMALS[end.direction];
  const a={x:start.x+normalA.x*40,y:start.y+normalA.y*40};
  const b={x:end.x+normalB.x*40,y:end.y+normalB.y*40};
  const goals=via?[a,via,b]:[a,b];
  const points:Point[]=[{x:start.x,y:start.y}];
  for(let index=1;index<goals.length;index++){
    const path=findPath(goals[index-1]!,goals[index]!,obstacles,reserved);
    if(!path)return {points:[],blocked:true};
    points.push(...path);
  }
  points.push({x:end.x,y:end.y});
  return {points:simplify(points,via),blocked:false};
}
export function routeDesign(design:GridDesign):Map<string,Route> {
  const result=new Map<string,Route>(),reserved=new Map<string,number>();
  const obstacles=design.nodes.filter(n=>n.present).flatMap(obstaclesForNode);
  for(const edge of design.edges){
    const route=routeOrthogonal(getPort(design,edge.from),getPort(design,edge.to),obstacles,edge.via,reserved);
    result.set(edge.id,route);
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1]!,b=route.points[i]!,length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);
      for(let step=0;step<=length;step+=WORLD.grid){
        const x=a.x+Math.sign(b.x-a.x)*step,y=a.y+Math.sign(b.y-a.y)*step;
        const key=pointKey(x/WORLD.grid,y/WORLD.grid);reserved.set(key,(reserved.get(key)??0)+1);
      }
    }
  }return result;
}
export function pathData(points:Point[]):string{return points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');}
export function pointAlong(points:Point[],ratio=0.5):Point {
  let total=0;for(let i=1;i<points.length;i++)total+=Math.abs(points[i]!.x-points[i-1]!.x)+Math.abs(points[i]!.y-points[i-1]!.y);
  let remaining=total*ratio;
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);
    if(remaining<=length)return {x:a.x+Math.sign(b.x-a.x)*remaining,y:a.y+Math.sign(b.y-a.y)*remaining};
    remaining-=length;
  }return points.at(-1)??{x:0,y:0};
}
export function wireControls(points:Point[],via:Point|null):{bend:Point;breaker:Point} {
  const bend=via??pointAlong(points);
  const candidates=[pointAlong(points,.25),pointAlong(points,.75)];
  const distance=(point:Point)=>Math.hypot(point.x-bend.x,point.y-bend.y);
  const breaker=distance(candidates[0]!)>=distance(candidates[1]!)?candidates[0]!:candidates[1]!;
  return {bend,breaker};
}
