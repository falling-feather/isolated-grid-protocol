import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign,newCampaignRecords,decodeCampaignRecords,freshCampaignRecord,restoreCampaignRecord } from '../src/campaign.ts';
test('已有单份训练记录可迁移到当前与上次记录，首次读取不改原对象',()=>{
 const current=newCampaign();current.tutorial='skipped';current.selected='echo';
 const records=decodeCampaignRecords(JSON.stringify(current));
 assert.deepEqual(records.current,current);assert.equal(records.previous,null);
 assert.deepEqual(decodeCampaignRecords(JSON.stringify(records)),records);
});
test('重新开始暂存旧进度，恢复交换记录且不共享可变引用',()=>{
 const records=newCampaignRecords();records.current.tutorial='skipped';records.current.selected='echo';
 const fresh=freshCampaignRecord(records);assert.equal(fresh.current.tutorial,'new');assert.equal(fresh.previous.selected,'echo');
 fresh.current.tutorial='started';assert.equal(records.current.tutorial,'skipped');
 const restored=restoreCampaignRecord(fresh);assert.equal(restored.current.selected,'echo');assert.equal(restored.previous.tutorial,'started');
 restored.current.tutorial='done';assert.equal(fresh.previous.tutorial,'skipped');
});
test('没有旧记录或旧记录损坏时明确拒绝恢复，不伪造已完成进度',()=>{
 assert.throws(()=>restoreCampaignRecord(newCampaignRecords()),/没有/);
 assert.throws(()=>decodeCampaignRecords(JSON.stringify({schema:1,current:newCampaign(),previous:{bad:true}})),/格式|版本/);
});
