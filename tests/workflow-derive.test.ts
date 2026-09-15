import {describe,expect,it} from 'vitest';
import {deriveWorkflow} from '../lib/workflow/derive';

const readiness=(overrides:Record<string,unknown>={})=>({items:[],counts:{ready:1,action_needed:0,upcoming:0,missing:0,expiring:0,verify_required:0},checkableCount:1,readyCount:1,percent:100,nextAction:null,requirementsUnknown:false,...overrides});
const budget=(target=3000,unavailableReason:string|null=null)=>({estimate:{currency:'USD',categories:[],estimateLow:target,estimateHigh:target,planningTarget:target,assumptions:[],confidence:'high' as const,restsOnIllustrativeRates:false,engineVersion:'cost-engine/1.0.0',unavailableReason},savings:null,nights:10});

describe('workflow convergence',()=>{
 it('moves a clear trip to review',()=>{expect(deriveWorkflow(readiness() as never,budget() as never,4000).state).toBe('REVIEW');});
 it('blocks when destination requirements are not verified',()=>{const result=deriveWorkflow(readiness({requirementsUnknown:true,counts:{ready:1,action_needed:0,upcoming:0,missing:0,expiring:0,verify_required:1}}) as never,budget() as never,4000); expect(result.state).toBe('BLOCKED'); expect(result.exceptions.some(x=>x.category==='STALE_INFORMATION')).toBe(true);});
 it('blocks on readiness action before booking',()=>{const result=deriveWorkflow(readiness({counts:{ready:0,action_needed:1,upcoming:0,missing:0,expiring:0,verify_required:0}}) as never,budget() as never,4000); expect(result.state).toBe('BLOCKED'); expect(result.blockingRequirements).toBe(1);});
 it('forces replan when deterministic target exceeds approved budget',()=>{const result=deriveWorkflow(readiness() as never,budget(4200) as never,4000); expect(result.state).toBe('REPLAN_REQUIRED'); expect(result.budgetStatus).toBe('REPLAN_REQUIRED');});
 it('waits for user data when deterministic budget cannot run',()=>{expect(deriveWorkflow(readiness() as never,budget(0,'Add how many people are travelling.') as never,4000).state).toBe('AWAITING_USER');});
});
