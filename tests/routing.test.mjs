import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesign } from '../src/network.ts';
import { routeOrthogonal, routeDesign, segmentHitsRect, wireControls } from '../src/routing.ts';

const a={nodeId:'a',portId:'grid',x:100,y:200,direction:'right'};
const b={nodeId:'b',portId:'grid',x:600,y:200,direction:'left'};
test('正交寻路避开装置占用的区域',()=>{
 const obstacle={x:280,y:120,width:120,height:180};
 const route=routeOrthogonal(a,b,[obstacle]);
 assert.equal(route.blocked,false);
 assert.deepEqual(route.points[0],{x:100,y:200});
 assert.deepEqual(route.points.at(-1),{x:600,y:200});
 for(let i=1;i<route.points.length;i++){
  const p=route.points[i-1],q=route.points[i];
  assert.ok(p.x===q.x||p.y===q.y);
  assert.equal(segmentHitsRect(p,q,obstacle),false);
 }
});
test('手动绕行点真实参与路径，重复计算结果一致',()=>{
 const via={x:340,y:400};
 const r=routeOrthogonal(a,b,[],via);
 assert.equal(r.blocked,false);
 assert.ok(r.points.some(p=>p.x===via.x&&p.y===via.y));
 assert.deepEqual(r,routeOrthogonal(a,b,[],via));
});
test('没有可走路径时明确报告受阻，不用穿过装置的假路线兜底',()=>{
 const r=routeOrthogonal(a,b,[{x:260,y:0,width:100,height:900}]);
 assert.equal(r.blocked,true);
 assert.equal(r.points.length,0);
});
test('默认电网的每条支路都能获得正交路径',()=>{
 const routes=routeDesign(createDesign());
 assert.equal(routes.size,5);
 for(const route of routes.values()){
  assert.equal(route.blocked,false);
  for(let i=1;i<route.points.length;i++){
   const p=route.points[i-1],q=route.points[i];
   assert.ok(p.x===q.x||p.y===q.y);
  }
 }
});
test('线路开关避开自动或手动的绕行拖点',()=>{
 const points=[{x:100,y:100},{x:100,y:300},{x:500,y:300}];
 for(const via of [null,{x:100,y:250},{x:400,y:300}]){
  const controls=wireControls(points,via);
  if(via)assert.deepEqual(controls.bend,via);
  assert.ok(Math.hypot(controls.breaker.x-controls.bend.x,controls.breaker.y-controls.bend.y)>30);
 }
});
