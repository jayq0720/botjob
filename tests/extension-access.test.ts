import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExtensionBridge } from '../bot/lib/boards/extension-bridge.js';
import { createExtensionAccess } from '../bot/lib/boards/extension-access.js';
import type { ApplicationRecord } from '../bot/lib/store.js';

test('browser adapter pairs without revealing token and validates live job identity before requesting a click', async()=>{
 const token='c'.repeat(64);
 const bridge=await createExtensionBridge(token,0);
 let opened='';
 const access=createExtensionAccess(async()=>({...bridge,pairingUrl:`${bridge.address}/#${token}`}),async url=>{opened=url;});
 let stop=false, clicked=0, journal=0, company='示例科技';
 const controller=new AbortController();
 let worker:Promise<void>|undefined;
 const url='https://www.liepin.com/job/123.shtml';
 const app:ApplicationRecord={id:'a1',status:'queued',createdAt:'',updatedAt:'',job:{id:'j1',board:'liepin',title:'薪酬经理',company,companyIndustry:'软件服务',city:'上海',url,matchScore:80,matchReason:'测试'}};
 try{
  const first=await access.open('liepin');
  assert.equal(first.status,'awaiting_browser_connection');
  assert.ok(opened.includes(token));
  assert.ok(!JSON.stringify(first).includes(token));
  const missing=await access.reader('liepin')(url);
  assert.equal('error' in missing && missing.reason,'browser_connection_required');
  worker=(async()=>{while(!stop){
   const command=await (await fetch(bridge.address+'/poll',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})).json() as any;
   if(command.type==='idle')continue;
   let value:any;
   if(command.type==='open')value={opened:true};
   if(command.type==='prepare_apply')value={body:`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'薪酬经理',description:'负责薪酬管理、绩效管理和人力成本预算及员工关系工作。',industry:'软件服务',dateModified:new Date(Date.now()-1000).toISOString(),hiringOrganization:{name:company},url})}</script>`,finalUrl:url,raw:{jobs:[],cardCount:0,empty:false,restricted:false},state:'ready',elapsedMs:10,token:'one-attempt',inspection:{reason:'',alreadySubmitted:false}};
   if(command.type==='click_apply'){assert.equal(journal,1);clicked++;value={outcome:'submitted',message:'测试',evidence:'已投递'};}
   await fetch(bridge.address+'/result',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({id:command.id,value}),signal:controller.signal});
  }})().catch(error=>{if(!stop)throw error;});
  for(let i=0;i<100&&!bridge.connected();i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await access.open('liepin')).status,'awaiting_login');
  const result=await access.deliver(app,async()=>{journal++;});
  assert.equal(result.outcome,'submitted');assert.equal(clicked,1);
  company='不同公司';
  assert.equal((await access.deliver(app,async()=>{journal++;})).outcome,'paused');
  assert.equal(journal,1);assert.equal(clicked,1);
 }finally{stop=true;controller.abort();await worker;await bridge.close();}
});
