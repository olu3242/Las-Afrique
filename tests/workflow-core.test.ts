import {describe,expect,it} from 'vitest';
import {assertTransition,deriveBudgetStatus,deriveNextAction,ToolRegistry,type ApprovalRequest} from '../lib/workflow/core';

describe('agentic workflow governance',()=>{
 it('allows the golden lifecycle and rejects unsafe jumps',()=>{ expect(()=>assertTransition('DREAMING','DISCOVERING')).not.toThrow(); expect(()=>assertTransition('DREAMING','BOOKED')).toThrow(/INVALID_WORKFLOW_TRANSITION/); });
 it('forces replanning when a plan exceeds budget',()=>{ expect(deriveBudgetStatus(4200,4000)).toBe('REPLAN_REQUIRED'); expect(deriveNextAction({blockingRequirements:0,missingInformation:0,budgetStatus:'REPLAN_REQUIRED',pendingApproval:false}).action).toBe('REPLAN'); });
 it('resolves blockers before financial approval',()=>{ expect(deriveNextAction({blockingRequirements:1,missingInformation:0,budgetStatus:'HEALTHY',pendingApproval:true}).action).toBe('RESOLVE_REQUIREMENTS'); });
 it('rejects unregistered tools and financial execution without current approval',async()=>{ const registry=new ToolRegistry(); expect(()=>registry.get('flight.purchase')).toThrow(/UNREGISTERED_TOOL/); registry.register({name:'flight.purchase',version:'1',riskLevel:'FINANCIAL',requiredPermissions:['booking:execute'],requiresApproval:true,timeoutMs:1000,execute:async()=>({confirmation:'ok'}),validate:o=>Boolean((o as {confirmation?:string}).confirmation)}); await expect(registry.execute('flight.purchase',{})).rejects.toThrow('VALID_APPROVAL_REQUIRED'); const approval:ApprovalRequest={id:'a',workflowId:'w',action:'flight.purchase',termsFingerprint:'v1',status:'APPROVED',expiresAt:new Date(Date.now()+60000).toISOString()}; await expect(registry.execute('flight.purchase',{},approval)).resolves.toEqual({confirmation:'ok'}); });
});
