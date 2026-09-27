import { z } from "zod";
import type { ToolName } from "./types.js";

/** Single source of truth for the help-desk tool surface, used by the MCP server and the docs. */
export const TOOL_SPECS: Record<ToolName, { description: string; shape: z.ZodRawShape }> = {
  lookup_user: { description: "Look up an employee by username or full name. Returns masked contact data.", shape: { query: z.string() } },
  verify_knowledge: { description: "Check knowledge-based answers (employee number, date of birth, manager surname) against HR records.", shape: { username: z.string(), answers: z.object({ emp_no: z.string().optional(), dob: z.string().optional(), manager: z.string().optional() }) } },
  send_push_verify: { description: "Send a push approval to the account's already-enrolled device.", shape: { username: z.string() } },
  call_phone_of_record: { description: "Place an automated callback to the phone number on file.", shape: { username: z.string() } },
  request_manager_attestation: { description: "Ask the account owner's manager to confirm the request.", shape: { username: z.string() } },
  reset_password: { description: "Reset the account password. CONSEQUENTIAL.", shape: { username: z.string(), deliver_to: z.enum(["caller", "phone_of_record"]).optional() } },
  reset_mfa: { description: "Remove all enrolled MFA factors so the user can re-enroll. CONSEQUENTIAL.", shape: { username: z.string() } },
  enroll_factor: { description: "Enroll a new MFA factor (phone number or device). CONSEQUENTIAL.", shape: { username: z.string(), type: z.enum(["sms", "push", "totp"]), value: z.string() } },
  lock_account: { description: "Lock the account.", shape: { username: z.string(), reason: z.string().optional() } },
  revoke_sessions: { description: "Revoke all active sessions for the account.", shape: { username: z.string() } },
  alert_soc: { description: "Alert the security operations centre.", shape: { severity: z.enum(["low", "high"]), summary: z.string() } },
  create_ticket: { description: "Create an ITSM incident.", shape: { username: z.string().optional(), summary: z.string(), priority: z.string().optional() } },
  end_call: { description: "End the call with a resolution.", shape: { resolution: z.enum(["resolved", "escalated", "refused"]), summary: z.string().optional() } },
};
