import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { assertTransition, deriveNextAction, type OutcomeContract, type WorkflowState } from './core';

export interface WorkflowSnapshot {
  id:string; tripId:string; state:WorkflowState; version:number; outcomeContract:Partial<OutcomeContract>; context:Record<string,unknown>; updatedAt:string;
  openExceptions:Array<{id:string;category:string;severity:string;cause:string;recommendedAction:string}>;
  pendingApprovals:Array<{id:string;action:string;amount:number|null;currency:string|null;provider:string|null;expiresAt:string}>;
  recentEvents:Array<{id:string;fromState:string|null;toState:string;actor:string;reason:string;createdAt:string}>;
  nextAction:{reason:string;priority:number;blocking:boolean;action:string};
}

async function userId(){ const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) throw new Error('AUTH_REQUIRED'); return {supabase,userId:user.id}; }

export async function getOrCreateWorkflow(tripId:string):Promise<WorkflowSnapshot>{
  const {supabase,userId:uid}=await userId();
  let {data:row,error}=await supabase.from('trip_workflows').select('*').eq('trip_id',tripId).maybeSingle();
  if(error) throw error;
  if(!row){ const created=await supabase.from('trip_workflows').insert({user_id:uid,trip_id:tripId,state:'DREAMING',outcome_contract:{},context:{}}).select('*').single(); if(created.error) throw created.error; row=created.data; }
  const [exceptions,approvals,events]=await Promise.all([
    supabase.from('workflow_exceptions').select('id,category,severity,cause,recommended_action').eq('workflow_id',row.id).eq('status','OPEN'),
    supabase.from('workflow_approvals').select('id,action,amount,currency,provider,expires_at').eq('workflow_id',row.id).eq('status','PENDING'),
    supabase.from('workflow_events').select('id,from_state,to_state,actor,reason,created_at').eq('workflow_id',row.id).order('created_at',{ascending:false}).limit(12),
  ]);
  if(exceptions.error) throw exceptions.error; if(approvals.error) throw approvals.error; if(events.error) throw events.error;
  const context=(row.context??{}) as Record<string,unknown>;
  const nextAction=deriveNextAction({blockingRequirements:Number(context.blockingRequirements??0),missingInformation:Number(context.missingInformation??0),budgetStatus:String(context.budgetStatus??'HEALTHY'),pendingApproval:(approvals.data?.length??0)>0});
  return {id:row.id,tripId:row.trip_id,state:row.state as WorkflowState,version:row.version,outcomeContract:(row.outcome_contract??{}) as Partial<OutcomeContract>,context,updatedAt:row.updated_at,openExceptions:(exceptions.data??[]).map(x=>({id:x.id,category:x.category,severity:x.severity,cause:x.cause,recommendedAction:x.recommended_action})),pendingApprovals:(approvals.data??[]).map(x=>({id:x.id,action:x.action,amount:x.amount==null?null:Number(x.amount),currency:x.currency,provider:x.provider,expiresAt:x.expires_at})),recentEvents:(events.data??[]).map(x=>({id:x.id,fromState:x.from_state,toState:x.to_state,actor:x.actor,reason:x.reason,createdAt:x.created_at})),nextAction};
}

export async function transitionWorkflow(tripId:string,to:WorkflowState,reason:string){
  const {supabase,userId:uid}=await userId(); const current=await getOrCreateWorkflow(tripId); assertTransition(current.state,to); const correlationId=crypto.randomUUID();
  const updated=await supabase.from('trip_workflows').update({state:to,version:current.version+1,updated_at:new Date().toISOString(),correlation_id:correlationId}).eq('id',current.id).eq('version',current.version).select('id').single();
  if(updated.error) throw new Error(`WORKFLOW_CONCURRENCY_OR_UPDATE_FAILED:${updated.error.message}`);
  const event=await supabase.from('workflow_events').insert({user_id:uid,workflow_id:current.id,from_state:current.state,to_state:to,actor:'traveler',reason,correlation_id:correlationId}); if(event.error) throw event.error;
  return getOrCreateWorkflow(tripId);
}
