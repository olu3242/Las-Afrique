import { deriveBudgetStatus, type WorkflowState } from './core';
import type { Readiness } from '@/lib/readiness/engine';
import type { TripBudget } from '@/lib/budget/service';

export interface WorkflowDerivation {
  state:WorkflowState; blockingRequirements:number; missingInformation:number; budgetStatus:'HEALTHY'|'TIGHT'|'OVER_BUDGET'|'REPLAN_REQUIRED';
  exceptions:Array<{category:string;severity:'WARNING'|'BLOCKING';cause:string;recommendedAction:string}>;
  evidence:Array<{type:string;source:string;metadata:Record<string,unknown>}>;
}

export function deriveWorkflow(readiness:Readiness,budget:TripBudget,approvedBudget?:number|null):WorkflowDerivation{
 const blocking=readiness.counts.action_needed+readiness.counts.expiring+readiness.counts.missing;
 const missing=readiness.counts.missing;
 const budgetStatus=approvedBudget&&budget.estimate.unavailableReason===null?deriveBudgetStatus(budget.estimate.planningTarget,approvedBudget):'HEALTHY';
 const exceptions:WorkflowDerivation['exceptions']=[];
 if(readiness.requirementsUnknown||readiness.counts.verify_required>0) exceptions.push({category:'STALE_INFORMATION',severity:'BLOCKING',cause:'Destination requirements still require authoritative verification.',recommendedAction:'Verify destination requirements before booking.'});
 if(blocking>0) exceptions.push({category:'REQUIREMENT_FAILURE',severity:'BLOCKING',cause:`${blocking} readiness item(s) require action.`,recommendedAction:readiness.nextAction?.title??'Resolve readiness requirements.'});
 if(budget.estimate.unavailableReason) exceptions.push({category:'MISSING_INFORMATION',severity:'BLOCKING',cause:budget.estimate.unavailableReason,recommendedAction:'Complete trip details required for a deterministic estimate.'});
 if(budgetStatus==='REPLAN_REQUIRED') exceptions.push({category:'BUDGET_EXCEEDED',severity:'BLOCKING',cause:'The deterministic planning target exceeds the approved budget.',recommendedAction:'Replan before requesting booking approval.'});
 const state:WorkflowState=budgetStatus==='REPLAN_REQUIRED'?'REPLAN_REQUIRED':blocking>0||readiness.requirementsUnknown?'BLOCKED':budget.estimate.unavailableReason?'AWAITING_USER':'REVIEW';
 return {state,blockingRequirements:blocking,missingInformation:missing,budgetStatus,exceptions,evidence:[{type:'READINESS_ASSESSMENT',source:'readiness-engine',metadata:{percent:readiness.percent,counts:readiness.counts,requirementsUnknown:readiness.requirementsUnknown}},{type:'BUDGET_ESTIMATE',source:budget.estimate.engineVersion,metadata:{planningTarget:budget.estimate.planningTarget,currency:budget.estimate.currency,confidence:budget.estimate.confidence,illustrative:budget.estimate.restsOnIllustrativeRates}}]};
}
