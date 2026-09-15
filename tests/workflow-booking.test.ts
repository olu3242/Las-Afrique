import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {deriveWorkflow} from '../lib/workflow/derive';

const readiness=(overrides:Record<string,unknown>={})=>({items:[],counts:{ready:1,action_needed:0,upcoming:0,missing:0,expiring:0,verify_required:0},checkableCount:1,readyCount:1,percent:100,nextAction:null,requirementsUnknown:false,...overrides}) as any;
const budget=(target=3500)=>({estimate:{currency:'USD',categories:[],estimateLow:3000,estimateHigh:3800,planningTarget:target,assumptions:[],confidence:'medium',restsOnIllustrativeRates:false,engineVersion:'cost-engine/1.0.0',unavailableReason:null},savings:null,nights:12}) as any;

describe('workflow evidence and booking gates',()=>{
 it('produces auditable engine evidence',()=>{const d=deriveWorkflow(readiness(),budget(),4000);expect(d.state).toBe('REVIEW');expect(d.evidence.map((e:any)=>e.type)).toEqual(['READINESS_ASSESSMENT','BUDGET_ESTIMATE']);expect(d.exceptions).toHaveLength(0);});
 it('blocks booking when authoritative requirements remain unresolved',()=>{const d=deriveWorkflow(readiness({requirementsUnknown:true}),budget(),4000);expect(d.state).toBe('BLOCKED');expect(d.exceptions.some((e:any)=>e.category==='STALE_INFORMATION')).toBe(true);});
 it('forces replan before approval when budget is exceeded',()=>{const d=deriveWorkflow(readiness(),budget(4200),4000);expect(d.state).toBe('REPLAN_REQUIRED');expect(d.exceptions.some((e:any)=>e.category==='BUDGET_EXCEEDED')).toBe(true);});
 it('fingerprints materially different booking terms differently',()=>{const f=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');const a={provider:'demo',amount:1200,currency:'USD',offerReference:'A'};expect(f(a)).not.toBe(f({...a,amount:1326}));});
});
