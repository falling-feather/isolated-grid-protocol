import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePreferences } from '../src/storage.ts';
test('首次读取沿用旧的减少动画与慢速偏好，不把教程默认速度误当全局选择',()=>{
 assert.deepEqual(decodePreferences(null),{schema:1,reduceMotion:false,speed:null});
 assert.deepEqual(decodePreferences(null,true,2),{schema:1,reduceMotion:true,speed:2});
});
test('明确选择优先于旧布局，重新开始和切换关卡不改变独立偏好',()=>{
 const raw=JSON.stringify({schema:1,reduceMotion:false,speed:null});
 assert.deepEqual(decodePreferences(raw,true,1),{schema:1,reduceMotion:false,speed:null});
 assert.deepEqual(decodePreferences(JSON.stringify({schema:1,reduceMotion:true,speed:1})),{schema:1,reduceMotion:true,speed:1});
});
test('损坏或范围错误的偏好明确拒绝，不悄悄覆盖用户选择',()=>{
 for(const value of [{schema:2,reduceMotion:true,speed:1},{schema:1,reduceMotion:'yes',speed:2},{schema:1,reduceMotion:false,speed:8}])assert.throws(()=>decodePreferences(JSON.stringify(value)));
});
