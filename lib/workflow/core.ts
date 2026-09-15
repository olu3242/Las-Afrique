export const WORKFLOW_STATES = [
  'DREAMING','DISCOVERING','READINESS_CHECK','PLANNING','BUDGETING','REQUIREMENTS','REVIEW','READY_TO_BOOK','BOOKING','BOOKED','PRE_DEPARTURE','IN_TRIP','RETURNING','COMPLETED','BLOCKED','AWAITING_USER','AWAITING_APPROVAL','REPLAN_REQUIRED','CANCELLED','FAILED','EXPIRED',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  DREAMING:['DISCOVERING','AWAITING_USER','CANCELLED'], DISCOVERING:['READINESS_CHECK','AWAITING_USER','BLOCKED','CANCELLED'],
  READINESS_CHECK:['PLANNING','AWAITING_USER','BLOCKED','CANCELLED'], PLANNING:['BUDGETING','AWAITING_USER','FAILED','CANCELLED'],
  BUDGETING:['REQUIREMENTS','REPLAN_REQUIRED','AWAITING_USER','FAILED','CANCELLED'], REQUIREMENTS:['REVIEW','BLOCKED','AWAITING_USER','CANCELLED'],
  REVIEW:['READY_TO_BOOK','REPLAN_REQUIRED','AWAITING_USER','CANCELLED'], READY_TO_BOOK:['BOOKING','AWAITING_APPROVAL','REPLAN_REQUIRED','CANCELLED'],
  BOOKING:['BOOKED','AWAITING_APPROVAL','REPLAN_REQUIRED','FAILED','CANCELLED'], BOOKED:['PRE_DEPARTURE','REPLAN_REQUIRED','CANCELLED'],
  PRE_DEPARTURE:['IN_TRIP','BLOCKED','REPLAN_REQUIRED','CANCELLED'], IN_TRIP:['RETURNING','BLOCKED','FAILED'], RETURNING:['COMPLETED','BLOCKED','FAILED'],
  COMPLETED:[], BLOCKED:['AWAITING_USER','READINESS_CHECK','REQUIREMENTS','REPLAN_REQUIRED','FAILED','CANCELLED'],
  AWAITING_USER:['DISCOVERING','READINESS_CHECK','PLANNING','BUDGETING','REQUIREMENTS','REVIEW','CANCELLED'],
  AWAITING_APPROVAL:['READY_TO_BOOK','BOOKING','REPLAN_REQUIRED','CANCELLED'], REPLAN_REQUIRED:['PLANNING','BUDGETING','REVIEW','CANCELLED'],
  CANCELLED:[], FAILED:['DISCOVERING','REPLAN_REQUIRED','CANCELLED'], EXPIRED:['DISCOVERING','CANCELLED'],
};

export function canTransition(from: WorkflowState, to: WorkflowState) { return TRANSITIONS[from].includes(to); }
export function assertTransition(from: WorkflowState, to: WorkflowState) {
  if (!canTransition(from,to)) throw new Error(`INVALID_WORKFLOW_TRANSITION:${from}->${to}`);
}

export type RiskLevel='LOW'|'MEDIUM'|'HIGH'|'FINANCIAL';
export interface OutcomeContract { id:string; workflowId:string; version:number; travelerId:string; origin?:string; destination?:string; departureWindow?:string; returnWindow?:string; tripDuration?:number; travelerCount:number; budget?:number; currency:string; travelPurpose?:string; preferences:string[]; constraints:string[]; requiredOutcome:string; completionCriteria:string[]; approvalRules:string[]; prohibitedActions:string[]; evidenceRequirements:string[]; escalationRules:string[]; createdAt:string; updatedAt:string; }
export interface TravelIntent { origin?:string; destination?:string; duration?:number; budget?:number; currency?:string; purpose?:string; missingRequiredFields:string[]; confidence:number; }
export interface WorkflowStep { id:string; objective:string; capability:string; tool?:string; dependencies:string[]; expectedOutput:string; validation:string; risk:RiskLevel; requiresApproval:boolean; status:'PENDING'|'READY'|'RUNNING'|'WAITING'|'SUCCEEDED'|'FAILED'|'SKIPPED'|'BLOCKED'; }
export interface EvidenceRecord { id:string; workflowId:string; stepId?:string; type:string; source:string; sourceReference?:string; observedAt:string; validUntil?:string; payloadHash?:string; metadata:Record<string,unknown>; }
export interface WorkflowException { category:'MISSING_INFORMATION'|'LOW_CONFIDENCE'|'STALE_INFORMATION'|'POLICY_VIOLATION'|'TOOL_FAILURE'|'PRICE_CHANGE'|'REQUIREMENT_FAILURE'|'BUDGET_EXCEEDED'|'APPROVAL_REQUIRED'|'BOOKING_FAILURE'|'SECURITY_EXCEPTION'|'UNKNOWN'; severity:'INFO'|'WARNING'|'BLOCKING'|'CRITICAL'; cause:string; recommendedAction:string; retryable:boolean; }
export interface ApprovalRequest { id:string; workflowId:string; action:string; amount?:number; currency?:string; provider?:string; termsFingerprint:string; status:'PENDING'|'APPROVED'|'REJECTED'|'EXPIRED'|'CONSUMED'; expiresAt:string; }
export interface ToolDefinition<I=unknown,O=unknown> { name:string; version:string; riskLevel:RiskLevel; requiredPermissions:string[]; requiresApproval:boolean; timeoutMs:number; execute(input:I):Promise<O>; validate(output:O):boolean; }

export class ToolRegistry {
  private tools=new Map<string,ToolDefinition>();
  register(tool:ToolDefinition){ if(this.tools.has(tool.name)) throw new Error(`DUPLICATE_TOOL:${tool.name}`); this.tools.set(tool.name,tool); }
  get(name:string){ const tool=this.tools.get(name); if(!tool) throw new Error(`UNREGISTERED_TOOL:${name}`); return tool; }
  async execute(name:string,input:unknown,approval?:ApprovalRequest){ const tool=this.get(name); if(tool.requiresApproval){ if(!approval||approval.status!=='APPROVED'||new Date(approval.expiresAt)<=new Date()) throw new Error('VALID_APPROVAL_REQUIRED'); } const output=await tool.execute(input); if(!tool.validate(output)) throw new Error(`INVALID_TOOL_OUTPUT:${name}`); return output; }
}

export function deriveBudgetStatus(total:number,budget:number):'HEALTHY'|'TIGHT'|'OVER_BUDGET'|'REPLAN_REQUIRED'{ if(total>budget) return 'REPLAN_REQUIRED'; return total>=budget*.9?'TIGHT':'HEALTHY'; }
export function deriveNextAction(input:{blockingRequirements:number; missingInformation:number; budgetStatus:string; pendingApproval:boolean}){
  if(input.missingInformation>0) return {reason:'Required traveler information is missing',priority:100,blocking:true,action:'COMPLETE_INFORMATION'};
  if(input.blockingRequirements>0) return {reason:'Blocking travel requirements remain unresolved',priority:95,blocking:true,action:'RESOLVE_REQUIREMENTS'};
  if(input.budgetStatus==='REPLAN_REQUIRED'||input.budgetStatus==='OVER_BUDGET') return {reason:'Plan exceeds the approved budget',priority:90,blocking:true,action:'REPLAN'};
  if(input.pendingApproval) return {reason:'A governed action requires traveler approval',priority:85,blocking:true,action:'REVIEW_APPROVAL'};
  return {reason:'No blocking requirement remains',priority:50,blocking:false,action:'CONTINUE_WORKFLOW'};
}
