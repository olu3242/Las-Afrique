import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import type { WorkflowDerivation } from './derive';

export async function persistDerivation(workflowId:string,derivation:WorkflowDerivation){
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) throw new Error('AUTH_REQUIRED');
 const now=new Date().toISOString();
 const close=await supabase.from('workflow_exceptions').update({status:'RESOLVED',resolved_at:now}).eq('workflow_id',workflowId).eq('status','OPEN'); if(close.error) throw close.error;
 if(derivation.exceptions.length){ const rows=derivation.exceptions.map(x=>({user_id:user.id,workflow_id:workflowId,category:x.category,severity:x.severity,cause:x.cause,recommended_action:x.recommendedAction,retryable:true,status:'OPEN'})); const r=await supabase.from('workflow_exceptions').insert(rows); if(r.error) throw r.error; }
 if(derivation.evidence.length){ const rows=derivation.evidence.map(x=>{const serialized=JSON.stringify(x.metadata);return {user_id:user.id,workflow_id:workflowId,type:x.type,source:x.source,observed_at:now,payload_hash:createHash('sha256').update(serialized).digest('hex'),metadata:x.metadata};}); const r=await supabase.from('workflow_evidence').insert(rows); if(r.error) throw r.error; }
 const context={blockingRequirements:derivation.blockingRequirements,missingInformation:derivation.missingInformation,budgetStatus:derivation.budgetStatus,lastEvaluatedAt:now}; const u=await supabase.from('trip_workflows').update({context,updated_at:now}).eq('id',workflowId); if(u.error) throw u.error;
 return {exceptions:derivation.exceptions.length,evidence:derivation.evidence.length,context};
}
