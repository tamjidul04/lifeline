/**
 * Browser test of the UI, driving headless Edge/Chrome over the DevTools protocol (no extra deps).
 *   BASE_URL=http://localhost:3000 node --env-file=.env scripts/ui-smoke.mjs
 * Ends by resetting the demo data. Screenshots go to SHOTS_DIR if set.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = process.env.SEED_PASSWORD;
const SHOTS = process.env.SHOTS_DIR;
const PORT = 9334;
const BROWSER = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => p && existsSync(p));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(BROWSER, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "ll-ui-"))}`, "--no-first-run", "about:blank",
]);

let ws, nextId = 0;
const waiting = new Map();
const consoleErrors = [];

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id) { waiting.get(msg.id)?.(msg); waiting.delete(msg.id); return; }
          if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
          if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
        };
        return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("could not connect to the browser");
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

async function js(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluation failed");
  return r.result.value;
}

async function until(expression, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await js(`!!(${expression})`)) return true; } catch {}
    await sleep(200);
  }
  return false;
}

const hasText = (t) => `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(t.toLowerCase())})`;

async function goto(path) {
  await js(`window.__leaving = true`).catch(() => {});
  await send("Page.navigate", { url: BASE + path });
  await until(`!window.__leaving && document.readyState === "complete"`);
  await sleep(600); // let React hydrate
}

/** Set a React-controlled field the way a user would (fires input + change). */
const fill = (selector, value) =>
  js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no element ${selector.replace(/"/g, "'")}");
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);

const clickText = (text, times = 1) =>
  js(`(() => { const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
    if (!b) return false; for (let i = 0; i < ${times}; i++) b.click(); return true; })()`);

async function viewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  // Test the design as drawn: stop a dark-mode machine force-darkening the headless browser.
  // (Resizing resets this, so it is re-applied here.)
  await send("Emulation.setAutoDarkModeOverride", { enabled: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
}

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}

async function layoutAtPhone(path, name) {
  await viewport(375, 800, true);
  await goto(path);
  await sleep(2500);
  const w = await js(`({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })`);
  check(`phone 375px: ${name} has no sideways page scroll`, w.scroll <= w.client + 1, `${w.scroll} vs ${w.client}`);
  await shot(`phone-${name}`);
  await viewport(1366, 900, false);
}

async function signIn(who) {
  await send("Network.clearBrowserCookies");
  await goto("/login");
  await until(`document.querySelector("#email")`);
  await sleep(400);
  await fill("#email", `${who}@lifeline.demo`);
  await fill("#password", PW);
  await js(`document.querySelector("form").requestSubmit()`);
  return until(`location.pathname === "/dashboard" && ${hasText("Overview")}`, 40_000);
}

const api = (path, method = "GET", body) =>
  js(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}${body ? `, headers: {"content-type":"application/json"}, body: ${JSON.stringify(JSON.stringify(body))}` : ""} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`);

async function main() {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await viewport(1366, 900, false);

  await goto("/");
  check("landing page loads", await until(hasText("LifeLine")));
  await goto("/requests");
  check("signed-out visit to a protected page goes to sign-in", await until(`location.pathname === "/login"`));

  // ---- hospital: preview, validation, double submit
  check("hospital signs in through the form", await signIn("hospital.city"));
  await goto("/requests/new");
  await fill("#bloodType", "A_POS");
  await fill("#units", "2");
  check("preview shows what would be reserved", await until(hasText("2 of 2 would be reserved"), 40_000));
  await shot("desk-new-request");
  await fill("#units", "21");
  await clickText("Submit and reserve");
  check("21 units shows a clear validation message", await until(hasText("At most 20 units per request.")));
  await fill("#units", "2");
  await until(hasText("2 of 2 would be reserved"), 40_000);
  const before = (await api("/api/requests?limit=100")).json.requests.length;
  await js(`(() => { const f = document.querySelector("form"); f.requestSubmit(); f.requestSubmit(); })()`);
  check("submitting lands on the request", await until(`location.pathname === "/requests" && ${hasText("Units for this request")}`, 40_000));
  const after = (await api("/api/requests?limit=100")).json.requests;
  check("double submit created exactly one request", after.length === before + 1, `${before} -> ${after.length}`);
  check("board shows the explanation and bag labels", (await until(`document.querySelectorAll(".ll-bag").length === 2`)) && (await js(hasText("matched"))));
  await shot("desk-requests-hospital");
  await goto("/inventory");
  check("hospital is kept out of inventory", await until(`location.pathname === "/dashboard" && ${hasText("do not have access")}`));
  await layoutAtPhone("/requests", "requests");
  await layoutAtPhone("/requests/new", "new-request");

  // ---- bank: deliver, stock filters, add units
  const bankName = after[0].reservations[0].unit.bank.name;
  const bank = bankName.startsWith("Central") ? "bank.central" : "bank.riverside";
  check(`${bank} signs in`, await signIn(bank));
  await goto("/requests");
  check("bank sees the request holding its bags", await until(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Mark delivered")`, 40_000));
  await clickText("Mark delivered");
  check("bank marks a unit delivered", await until(hasText("Marked as delivered."), 40_000));
  await goto("/inventory");
  check("stock list loads", await until(`document.querySelectorAll(".ll-table tbody tr").length > 0`, 40_000));
  await shot("desk-inventory");
  await fill('input[placeholder="e.g. ab- or riverside"]', "o+");
  check("search 'o+' leaves only O+ rows", await until(`(() => { const r = [...document.querySelectorAll(".ll-table tbody tr td:first-child")]; return r.length > 0 && r.every((c) => c.textContent === "O+"); })()`, 40_000));
  await clickText("Add to stock");
  check("bank adds a unit", await until(hasText("Added 1 unit(s)."), 40_000));
  await sleep(1500);
  await clickText("Edit");
  check("edit panel opens", await until(hasText("Save changes"), 20_000));
  await clickText("Save changes");
  check("bank edits a unit", await until(hasText("Unit updated."), 40_000));
  await layoutAtPhone("/inventory", "inventory");
  await layoutAtPhone("/dashboard", "bank-overview");

  // ---- admin + judge demo
  check("admin signs in", await signIn("admin"));
  await shot("desk-overview-admin");
  await goto("/admin");
  check("admin sees accounts and the audit log", await until(`document.querySelectorAll(".ll-table").length === 2`, 40_000));
  await shot("desk-admin");
  await layoutAtPhone("/admin", "admin");
  await goto("/demo");
  await clickText("Run the race");
  check("A05 button: race passes with exactly one winner", await until(`${hasText("PASS: 1 winner")} && ${hasText("0 double-booked")}`, 90_000));
  await clickText("Conflicting constraints");
  check("A02 button: conflicting constraints explained", await until(hasText("Conflicting constraints: the remaining compatible stock"), 40_000));
  await clickText("Infeasible request");
  check("A02 button: infeasible request explained", await until(hasText("UNFULFILLABLE"), 40_000));
  await shot("desk-demo");
  await layoutAtPhone("/demo", "demo");

  // ---- donor
  check("donor signs in", await signIn("donor2"));
  check("donor sees eligibility", await until(hasText("You can donate again in")));

  // ---- cleanup
  await signIn("admin");
  const reset = await api("/api/admin/reset", "POST");
  check("demo data reset", reset.status === 200);

  const real = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
  check("no JavaScript errors in the console", real.length === 0, real.slice(0, 3).join(" | ").slice(0, 600));
}

try {
  await main();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
}
console.log(failures === 0 ? "\nUI CHECKS PASSED" : `\n${failures} UI CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
