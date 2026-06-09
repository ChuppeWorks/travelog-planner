import assert from "node:assert/strict";

const port = process.env.OBSIDIAN_DEBUG_PORT ?? "9223";
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.url === "app://obsidian.md/index.html");
assert.ok(page, "No Obsidian page found on the remote debugging port.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await send("Runtime.enable");
assert.equal(await evaluate('Boolean(window.app?.plugins?.plugins?.["travelog-planner"])'), true);
assert.equal(await evaluate('window.app.commands.executeCommandById("travelog-planner:open-planner")'), true);
await sleep(400);
assert.equal(await evaluate('Boolean(document.querySelector(".travelog-planner"))'), true);

await evaluate(`(${clickPlannerButton.toString()})("New trip")`);
await sleep(100);
await setSetting("Name", "Runtime Test Trip");
await setSetting("Start date", "2026-10-10");
await setSetting("End date", "2026-10-10");
await setSetting("Timezone", "Asia/Tokyo");
await setSetting("Base currency", "JPY");
await setSetting("Destinations", "Kyoto");
await evaluate(`(${clickModalButton.toString()})("Create")`);
await sleep(400);

await evaluate(`(${clickPlannerButton.toString()})("Add point")`);
await sleep(100);
await setSetting("Title", "Kyoto Station");
await setSetting("Start", "09:00");
await setSetting("End", "09:20");
await setSetting("Address", "Kyoto Station");
await setSetting("Latitude", "34.985849");
await setSetting("Longitude", "135.758767");
await setSetting("Opening hours", "06:00-23:00");
await setSetting("Planned cost (JPY)", "500");
await setSetting("Checklist", "Load transit card");
await setSetting("Notes", "Runtime point");
await evaluate(`(${clickModalButton.toString()})("Add")`);
await sleep(400);

await evaluate(`(${clickPlannerButton.toString()})("Add route")`);
await sleep(100);
await setSetting("Title", "Bus to Gion");
await setSetting("Start", "09:20");
await setSetting("End", "09:45");
await setSetting("Mode", "bus");
await setSetting("Line / service", "206");
await setSetting("Operator", "Kyoto City Bus");
await setSetting("Known delay (minutes)", "0");
await setFirstOption("From point");
await setFirstOption("To point");
await setSetting("Fare (JPY)", "230");
await evaluate(`(${clickModalButton.toString()})("Add")`);
await sleep(400);

await evaluate(`(${clickPlannerButton.toString()})("Apply +15m delay")`);
await sleep(400);
await evaluate(`(${clickPlannerButton.toString()})("Export Notion CSV")`);
await sleep(400);

const summary = await evaluate(`(() => {
  const plugin = window.app.plugins.plugins["travelog-planner"];
  const dataset = plugin.store.dataset;
  const route = dataset.timelineItems.find((item) => item.kind === "route");
  return {
    trips: dataset.trips.length,
    points: dataset.timelineItems.filter((item) => item.kind === "point").length,
    routes: dataset.timelineItems.filter((item) => item.kind === "route").length,
    delay: route?.route.delayMinutes,
    baseline: Boolean(route?.schedule.baseline),
    changes: dataset.planChanges.length,
    text: document.querySelector(".travelog-planner")?.textContent ?? ""
  };
})()`);

assert.deepEqual(
  { trips: summary.trips, points: summary.points, routes: summary.routes },
  { trips: 1, points: 1, routes: 1 },
);
assert.equal(summary.delay, 15);
assert.equal(summary.baseline, true);
assert.ok(summary.changes >= 3);
assert.match(summary.text, /Runtime Test Trip/);
assert.match(summary.text, /Kyoto Station/);
assert.match(summary.text, /Bus to Gion/);
assert.match(summary.text, /Delay: 15 minutes/);

console.log(JSON.stringify(summary, null, 2));
socket.close();

async function setSetting(name, value) {
  await evaluate(`(${setSettingValue.toString()})(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
}

async function setFirstOption(name) {
  await evaluate(`(${setFirstSelectOption.toString()})(${JSON.stringify(name)})`);
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function send(method, params = {}) {
  const id = ++commandId;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return promise;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clickPlannerButton(label) {
  const button = [...document.querySelectorAll(".travelog-planner button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Planner button not found: ${label}`);
  button.click();
  return true;
}

function clickModalButton(label) {
  const button = [...document.querySelectorAll(".modal-container button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Modal button not found: ${label}`);
  button.click();
  return true;
}

function setSettingValue(name, value) {
  const setting = [...document.querySelectorAll(".modal-container .setting-item")].find(
    (candidate) => candidate.querySelector(".setting-item-name")?.textContent?.trim() === name,
  );
  if (!setting) throw new Error(`Setting not found: ${name}`);
  const input = setting.querySelector("input, textarea, select");
  if (!input) throw new Error(`Input not found: ${name}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function setFirstSelectOption(name) {
  const setting = [...document.querySelectorAll(".modal-container .setting-item")].find(
    (candidate) => candidate.querySelector(".setting-item-name")?.textContent?.trim() === name,
  );
  if (!setting) throw new Error(`Setting not found: ${name}`);
  const select = setting.querySelector("select");
  if (!select || select.options.length < 2) throw new Error(`Selectable option not found: ${name}`);
  select.value = select.options[1].value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
