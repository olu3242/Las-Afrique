import 'server-only';
import { getTrip } from '@/lib/trips/service';
import { getTripReadiness } from '@/lib/readiness/service';
import { getTripBudget } from '@/lib/budget/service';
import { deriveWorkflow } from './derive';
import { getOrCreateWorkflow, transitionWorkflow } from './service';
import type { WorkflowState } from './core';

export async function evaluateTripWorkflow(tripId:string,approvedBudget?:number|null){
 const detail=await getTrip(tripId); if(!detail) throw new Error('TRIP_NOT_FOUND');
 const [readiness,budget]=await Promise.all([getTripReadiness(detail.trip,detail.travelers),getTripBudget(detail.trip)]);
 const derivation=deriveWorkflow(readiness,budget,approvedBudget);
 const current=await getOrCreateWorkflow(tripId);
 return {current,derivation};
}

/**
 * Evaluation never silently mutates workflow state. A caller must explicitly
 * commit a derived transition; transitionWorkflow then enforces the state map,
 * ownership/RLS and optimistic version boundary.
 */
export async function commitDerivedTransition(tripId:string,to:WorkflowState,reason:string){
 const {derivation}=await evaluateTripWorkflow(tripId);
 const allowed=new Set<WorkflowState>([derivation.state,'AWAITING_USER','CANCELLED']);
 if(!allowed.has(to)) throw new Error(`DERIVATION_DOES_NOT_AUTHORIZE:${to}`);
 return transitionWorkflow(tripId,to,reason);
}
