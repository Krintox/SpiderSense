import type { Employee } from "./types.js";

/** Small deterministic PRNG so every run of the seed is identical. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const FIRST = ["Priya", "Arjun", "Meera", "Rohan", "Ananya", "Vikram", "Sneha", "Karthik", "Divya", "Aditya", "Neha", "Rahul", "Ishaan", "Kavya", "Siddharth", "Pooja", "Nikhil", "Tara", "Manish", "Lakshmi", "Omar", "Elena", "Jonas", "Grace", "Mateo", "Hana", "Liam", "Chloe"];
const LAST = ["Rao", "Iyer", "Nair", "Sharma", "Menon", "Gupta", "Reddy", "Kulkarni", "Bhat", "Das", "Singh", "Patel", "Chen", "Novak", "Silva", "Okafor", "Kim", "Fischer"];
const CITIES = ["Bengaluru", "Mumbai", "Pune", "Hyderabad", "Delhi", "Chennai", "Singapore", "London", "Dubai"];
const DEPTS: Array<[string, string[]]> = [
  ["Finance", ["Financial Analyst", "Treasury Manager", "Accounts Lead"]], ["Engineering", ["Software Engineer", "SRE", "Staff Engineer"]],
  ["Sales", ["Account Executive", "Sales Ops"]], ["HR", ["HR Partner", "Recruiter"]], ["Legal", ["Counsel", "Paralegal"]], ["IT", ["Systems Admin", "Support Engineer"]],
];

/** Fixed cast used by the hero demo and the tests. */
export function heroCast(): Employee[] {
  const dev = (id: string, label: string, d: number) => ({ id, label, enrolled_days_ago: d });
  const base = (o: Partial<Employee> & Pick<Employee, "username" | "name" | "title" | "dept">): Employee => ({
    manager: null, privileged: false, account_type: "human", status: "active", emp_no: "0", dob: "1990-01-01",
    phone_of_record: "+91 98000 00000", phone_changed_days_ago: 900, devices: [], factors: [],
    last_login: { city: "Bengaluru", days_ago: 0, device_id: "d0" }, travel: null, breach_exposed: [], ...o,
  });
  return [
    base({ username: "cfo.rao", name: "Suresh Rao", title: "Chief Financial Officer", dept: "Finance", privileged: true, emp_no: "40117", dob: "1971-03-12",
      manager: "ceo.mehta", phone_of_record: "+91 98450 44170", phone_changed_days_ago: 640,
      devices: [dev("d-rao-laptop", "MacBook Pro (Rao)", 410), dev("d-rao-phone", "iPhone 16 (Rao)", 300)],
      factors: [{ id: "f1", type: "push", value: "d-rao-phone", enrolled_days_ago: 300 }, { id: "f2", type: "fido2", value: "yubikey-8841", enrolled_days_ago: 380 }],
      last_login: { city: "Mumbai", days_ago: 0, device_id: "d-rao-laptop" }, travel: { city: "Mumbai", from_days: 3, to_days: -2 },
      breach_exposed: ["emp_no", "dob", "manager", "title"] }),
    base({ username: "ceo.mehta", name: "Anita Mehta", title: "Chief Executive Officer", dept: "Executive", privileged: true, emp_no: "40001", dob: "1968-07-02",
      phone_of_record: "+91 98450 10010", devices: [dev("d-mehta-phone", "iPhone (Mehta)", 200)], factors: [{ id: "f1", type: "push", value: "d-mehta-phone", enrolled_days_ago: 200 }],
      breach_exposed: ["title"] }),
    base({ username: "priya.nair", name: "Priya Nair", title: "Executive Assistant", dept: "Finance", manager: "cfo.rao", emp_no: "51022", dob: "1994-11-05",
      phone_of_record: "+91 99000 55021", devices: [dev("d-nair-phone", "Pixel 9 (Nair)", 150), dev("d-nair-laptop", "ThinkPad (Nair)", 150)],
      factors: [{ id: "f1", type: "push", value: "d-nair-phone", enrolled_days_ago: 150 }], breach_exposed: ["emp_no", "manager"] }),
    base({ username: "arjun.iyer", name: "Arjun Iyer", title: "Treasury Manager", dept: "Finance", manager: "cfo.rao", emp_no: "43310", dob: "1988-02-19", privileged: true,
      phone_of_record: "+91 98860 33101", devices: [dev("d-iyer-laptop", "MacBook Air (Iyer)", 220), dev("d-iyer-phone", "iPhone (Iyer)", 220)],
      factors: [{ id: "f1", type: "push", value: "d-iyer-phone", enrolled_days_ago: 220 }, { id: "f2", type: "totp", value: "authenticator", enrolled_days_ago: 220 }], breach_exposed: ["emp_no", "dob"] }),
    base({ username: "meera.kulkarni", name: "Meera Kulkarni", title: "Software Engineer", dept: "Engineering", manager: "sre.lead", emp_no: "61877", dob: "1996-08-30",
      phone_of_record: "+91 97400 11876", devices: [dev("d-mk-laptop", "ThinkPad (Meera)", 90), dev("d-mk-phone", "OnePlus (Meera)", 90)],
      factors: [{ id: "f1", type: "push", value: "d-mk-phone", enrolled_days_ago: 90 }], breach_exposed: [] }),
    base({ username: "sre.lead", name: "Karthik Bhat", title: "Staff SRE", dept: "Engineering", manager: "cfo.rao", privileged: true, emp_no: "44021", dob: "1985-05-14",
      phone_of_record: "+91 98860 77341", devices: [dev("d-kb-laptop", "ThinkPad (Karthik)", 500), dev("d-kb-phone", "iPhone (Karthik)", 500)],
      factors: [{ id: "f1", type: "push", value: "d-kb-phone", enrolled_days_ago: 500 }, { id: "f2", type: "fido2", value: "yubikey-1177", enrolled_days_ago: 500 }], breach_exposed: ["title"] }),
    base({ username: "svc-payroll", name: "Payroll Batch Service", title: "Service account", dept: "Finance", account_type: "service", privileged: true, manager: "arjun.iyer", emp_no: "svc", dob: "n/a",
      phone_of_record: "+91 98860 33101", devices: [], factors: [{ id: "f1", type: "totp", value: "vault-secret", enrolled_days_ago: 700 }], breach_exposed: [] }),
    base({ username: "rohan.das", name: "Rohan Das", title: "Sales Ops", dept: "Sales", manager: "ceo.mehta", status: "terminated", emp_no: "70112", dob: "1992-01-23",
      phone_of_record: "+91 90080 22119", devices: [dev("d-rd-laptop", "MacBook (Rohan)", 60)], factors: [], last_login: { city: "Pune", days_ago: 21, device_id: "d-rd-laptop" }, breach_exposed: ["emp_no", "dob", "phone"] }),
    base({ username: "tara.singh", name: "Tara Singh", title: "HR Partner", dept: "HR", manager: "ceo.mehta", status: "on_leave", emp_no: "52200", dob: "1990-10-10",
      phone_of_record: "+91 98111 20022", devices: [dev("d-ts-phone", "iPhone (Tara)", 40)], factors: [{ id: "f1", type: "push", value: "d-ts-phone", enrolled_days_ago: 40 }], breach_exposed: ["dob"] }),
    base({ username: "lakshmi.reddy", name: "Lakshmi Reddy", title: "Recruiter", dept: "HR", manager: "tara.singh", emp_no: "62311", dob: "1997-04-04",
      phone_of_record: "+91 98111 41133", phone_changed_days_ago: 6, devices: [dev("d-lr-laptop", "ThinkPad (Lakshmi)", 120)], factors: [{ id: "f1", type: "sms", value: "+91 98111 41133", enrolled_days_ago: 6 }], breach_exposed: ["emp_no"] }),
  ];
}

/** 40 people: the hero cast plus generated employees. Deterministic for a given seed. */
export function buildEmployees(seed = 42, total = 40): Employee[] {
  const r = rng(seed);
  const out = heroCast();
  const used = new Set(out.map((e) => e.username));
  while (out.length < total) {
    const first = pick(r, FIRST), last = pick(r, LAST);
    const username = `${first}.${last}`.toLowerCase();
    if (used.has(username)) continue; used.add(username);
    const [dept, titles] = pick(r, DEPTS);
    const city = pick(r, CITIES);
    const nDev = 1 + Math.floor(r() * 2);
    const devices = Array.from({ length: nDev }, (_, i) => ({ id: `d-${username}-${i}`, label: i === 0 ? `Laptop (${first})` : `Phone (${first})`, enrolled_days_ago: 30 + Math.floor(r() * 600) }));
    const phone = `+91 9${Math.floor(r() * 1e9).toString().padStart(9, "0").replace(/(\d{4})(\d{5})/, "$1 $2")}`;
    const exposed = (["emp_no", "dob", "manager", "title", "phone"] as const).filter(() => r() < 0.25);
    out.push({
      username, name: `${first} ${last}`, title: pick(r, titles), dept, manager: "ceo.mehta",
      privileged: dept === "IT" && r() < 0.6, account_type: "human", status: "active",
      emp_no: String(50000 + Math.floor(r() * 30000)), dob: `${1975 + Math.floor(r() * 28)}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`,
      phone_of_record: phone, phone_changed_days_ago: r() < 0.1 ? Math.floor(r() * 20) : 100 + Math.floor(r() * 800),
      devices, factors: [{ id: "f1", type: "push", value: devices[devices.length - 1].id, enrolled_days_ago: devices[devices.length - 1].enrolled_days_ago }],
      last_login: { city, days_ago: Math.floor(r() * 3), device_id: devices[0].id }, travel: r() < 0.12 ? { city: pick(r, CITIES), from_days: 2, to_days: -3 } : null, breach_exposed: exposed,
    });
  }
  return out;
}
