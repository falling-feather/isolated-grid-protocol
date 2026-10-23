import test from 'node:test';
import assert from 'node:assert/strict';
import { goalReviewPage } from '../src/review.ts';
test('目标分页逐项覆盖整局目标，并保留独立说明页',()=>{
 const seen=[];
 for(let i=0;i<4;i++){
   const page=goalReviewPage(9,i);
   assert.equal(page.pages,4);assert.equal(page.notes,i===3);
   if(!page.notes)for(let j=page.start;j<page.end;j++)seen.push(j);
 }
 assert.deepEqual(seen,[0,1,2,3,4,5,6,7,8]);
});
test('目标数变化和越界翻页不会使说明页或返回入口失去位置',()=>{
 assert.equal(goalReviewPage(9,-1).page,0);
 assert.equal(goalReviewPage(9,99).page,3);
 const reduced=goalReviewPage(5,3);assert.equal(reduced.page,2);assert.equal(reduced.notes,true);
 assert.equal(goalReviewPage(4,1).notes,true);
});
