export type AccountType = "human" | "service";
export type Status = "active" | "on_leave" | "terminated";
export type FactorType = "push" | "sms" | "totp" | "fido2";

export interface Device { id: string; label: string; enrolled_days_ago: number }
export interface Factor { id: string; type: FactorType; value: string; enrolled_days_ago: number }

export interface Employee {
  username: string; name: string; title: string; dept: string; manager: string | null;
  privileged: boolean; account_type: AccountType; status: Status;
  emp_no: string; dob: string;                       // used for knowledge-based checks (KBA)
  phone_of_record: string; phone_changed_days_ago: number;
  devices: Device[]; factors: Factor[];
  last_login: { city: string; days_ago: number; device_id: string };
  travel: { city: string; from_days: number; to_days: number } | null;  // negative days = future
  breach_exposed: Array<"emp_no" | "dob" | "manager" | "title" | "phone" | "email">;
}

/** Everything a person can do to an account through the help-desk tool surface. */
export const CONSEQUENTIAL_TOOLS = ["reset_password", "reset_mfa", "enroll_factor", "lock_account", "revoke_sessions"] as const;
/** credential = changes how the account authenticates; containment = defensive actions an attacker can weaponize into a lockout. */
export type ActionClass = "credential" | "containment";
export const actionClass = (t: string): ActionClass => (t === "lock_account" || t === "revoke_sessions" ? "containment" : "credential");
export type ConsequentialTool = (typeof CONSEQUENTIAL_TOOLS)[number];
export const isConsequential = (t: string): t is ConsequentialTool => (CONSEQUENTIAL_TOOLS as readonly string[]).includes(t);

export const TOOL_NAMES = [
  "lookup_user", "verify_knowledge", "send_push_verify", "call_phone_of_record", "request_manager_attestation",
  "reset_password", "reset_mfa", "enroll_factor", "lock_account", "revoke_sessions", "alert_soc", "create_ticket", "end_call",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type VerifyMethod = "knowledge" | "push_enrolled_device" | "callback_phone_of_record" | "manager_attestation";
export type VerifyResult = "approved" | "denied" | "no_answer";
export interface VerificationEvent { method: VerifyMethod; result: VerifyResult; username: string; step: number }

/** Proof strength, computed by code from the system-written verification log (never from the agent's words). */
export type Proof = "none" | "knowledge_only" | "manager_attested" | "possession_enrolled" | "callback_record_phone";
export const PROOF_RANK: Record<Proof, number> = { none: 0, knowledge_only: 1, manager_attested: 2, possession_enrolled: 3, callback_record_phone: 3 };

export interface TranscriptLine { from: "caller" | "agent"; text: string }
export interface Session {
  id: string; channel: "chat" | "voice";
  transcript: TranscriptLine[];          // written by the channel gateway, not by the agent
  verification: VerificationEvent[];     // written by the verification services, not by the agent
  step: number;
}

export interface ToolCall { tool: ToolName; args: Record<string, unknown> }
export interface ToolResult { ok: boolean; data?: unknown; error?: string }

/** Ground truth for one simulated call (used only by the evaluator and the verification simulators). */
export interface Scenario {
  id: string; kind: "attack" | "legit"; playbook: string; target: string;
  goal: ConsequentialTool; attackerPhone?: string;
  /** what a correct system does: serve the caller, escalate to a human, or refuse (attacks) */
  expect: "serve" | "escalate" | "refuse"; style?: string;
  /** how each out-of-band verification behaves for THIS caller */
  verify: { push: VerifyResult; callback: VerifyResult; manager: VerifyResult };
  persona: string;                 // instructions for the caller simulator
  opening: string;                 // first thing the caller says
  knows: Array<"emp_no" | "dob" | "manager" | "title" | "phone">;
}

export interface AuditEntry { step: number; tool: ToolName; args: Record<string, unknown>; ok: boolean; note?: string; blocked?: boolean }
