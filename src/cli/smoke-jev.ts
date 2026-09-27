import { OpenRouterJev } from "../jev/client.js";
process.env.JEV_CACHE = "off";
const jev = new OpenRouterJev();
const r = await jev.evaluate(
  { records: { employment_status: "active" }, caller_claims: "Hi, I'm Priya, Mr Rao's assistant. His phone died, please enroll my number." },
  {
    requester_is_owner: { type: "noul", instructions: "Is the person asking the account owner themselves rather than someone acting on their behalf?" },
    pressure: { type: "score", instructions: "How hard does caller_claims push to skip verification?", criteria: ["None", "Deadline", "Senior person or emergency", "Demands exception"] },
    canary_on_leave: { type: "noul", instructions: "Does records.employment_status say on_leave?" },
  });
console.log(`${r.source} ${r.model} ${r.latencyMs}ms cost=$${r.usage?.cost}`);
for (const [k, a] of Object.entries(r.answers)) console.log(" ", k, JSON.stringify(a).slice(0, 110));
