import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

export interface BookingTerms { action:string; provider:string; amount:number; currency:string; offerReference:string; cancellationTerms?:string; }
const fingerprint=(t:BookingTerms)=>createHash('sha256').update(JSON.stringify(t)).digest('hex');

async function context(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('AUTH_REQUIRED');return {supabase,user};}

export async function requestBookingApproval(workflowId:string,terms:BookingTerms,ttlMinutes=15){
 const {supabase,user}=await context(); if(!Number.isFinite(terms.amount)||terms.amount<=0) throw new Error('INVALID_BOOKING_AMOUNT');
 const expiresAt=new Date(Date.now()+ttlMinutes*60_000).toISOString();
 const r=await supabase.from('workflow_approvals').insert({user_id:user.id,workflow_id:workflowId,action:terms.action,amount:terms.amount,currency:terms.currency,provider:terms.provider,terms_fingerprint:fingerprint(terms),status:'PENDING',expires_at:expiresAt}).select('*').single(); if(r.error)throw r.error; return r.data;
}

export async function decideBookingApproval(approvalId:string,decision:'APPROVED'|'REJECTED'){
 const {supabase}=await context(); const now=new Date().toISOString(); const existing=await supabase.from('workflow_approvals').select('*').eq('id',approvalId).single(); if(existing.error)throw existing.error;
 if(existing.data.status!=='PENDING')throw new Error('APPROVAL_NOT_PENDING'); if(new Date(existing.data.expires_at)<=new Date()){await supabase.from('workflow_approvals').update({status:'EXPIRED',decided_at:now}).eq('id',approvalId);throw new Error('APPROVAL_EXPIRED');}
 const r=await supabase.from('workflow_approvals').update({status:decision,decided_at:now}).eq('id',approvalId).eq('status','PENDING').select('*').single();if(r.error)throw r.error;return r.data;
}

export async function consumeBookingApproval(approvalId:string,terms:BookingTerms){
 const {supabase}=await context();const r=await supabase.from('workflow_approvals').select('*').eq('id',approvalId).single();if(r.error)throw r.error;const a=r.data;
 if(a.status!=='APPROVED')throw new Error('VALID_APPROVAL_REQUIRED');if(new Date(a.expires_at)<=new Date())throw new Error('APPROVAL_EXPIRED');if(a.terms_fingerprint!==fingerprint(terms))throw new Error('BOOKING_TERMS_CHANGED');
 const consumed=await supabase.from('workflow_approvals').update({status:'CONSUMED',consumed_at:new Date().toISOString()}).eq('id',approvalId).eq('status','APPROVED').select('id').single();if(consumed.error)throw new Error('APPROVAL_ALREADY_CONSUMED');return {approvalId,termsFingerprint:a.terms_fingerprint};
}
