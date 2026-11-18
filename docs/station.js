import {SerialConnection} from "./serial.js";
import {GroundRadio, BROADCAST, addressHex} from "./ground-radio.js";
import {saveBlobWithPicker} from "./save_file.js";
import {PictureDownload, isPictureReply} from "./picture.js";

const el = id => document.getElementById(id);
const to = el("destination");
const input = el("send-input");
const output = el("output");
const link = new SerialConnection();
const endings = {none:"", lf:"\n", cr:"\r", crlf:"\r\n"};
const history = [];
let historyIndex = 0, draft = "";
let radio, info, activity = "", sending = false, scanning = false, restoreOnly = false;
let picture, pictureUrl;
const destination = () => to.value === "manual" ? el("manual-address").value.trim().toUpperCase() : to.value;
const paired = () => info.DH + info.DL;

function log(message, level = "system") {
  const line = document.createElement("div");
  line.className = "line-" + level;
  line.textContent = message;
  output.append(line);
  if (output.childElementCount > 3000) output.firstElementChild.remove();
  if (el("auto-scroll").checked) output.scrollTop = output.scrollHeight;
}

function render() {
  const online = Boolean(info);
  const idleSession = online && !activity && !restoreOnly;
  el("btn-select-port").disabled = Boolean(activity) || online;
  el("btn-disconnect").disabled = Boolean(activity) || !online;
  el("discover").disabled = !idleSession || scanning;
  el("discover").textContent = scanning ? "Finding radios…" : "Find radios";
  el("port-display").textContent = online ? info.SH + info.SL : "— no port selected —";
  const status = el("connection-status");
  status.textContent = activity || (restoreOnly ? "Retry Disconnect" : online ? "Connected" : "Disconnected");
  status.className = "status-badge " + (online ? "connected" : "disconnected");
  to.disabled = input.disabled = !idleSession;
  el("btn-send").disabled = !idleSession || sending;
  const address = destination();
  el("get-picture").disabled = !idleSession || Boolean(picture) || address === BROADCAST ||
    !/^[0-9A-F]{16}$/.test(address) || /^0{16}$/.test(address);
  el("manual-address").hidden = to.value !== "manual";
  el("btn-send").textContent = to.value === BROADCAST ? "Broadcast" : "Send";
}

function addRadio(address) {
  if (!info || address === info.SH + info.SL || Array.from(to.options).some(o => o.value === address)) return;
  to.add(new Option("Radio · " + address, address), to.querySelector('[value="manual"]'));
}

function receive(source, bytes, broadcast) {
  if (isPictureReply(bytes)) {
    if (!broadcast) picture?.receive(source, bytes);
    return;
  }
  const hex = el("display-mode").value === "hex";
  const message = hex ? Array.from(bytes, byte => addressHex([byte])).join(" ")
    : new TextDecoder().decode(bytes).replace(/[\r\n]+$/, "");
  log("← " + source + (broadcast ? " · broadcast" : "") + "   " + message, hex ? "hex" : "rx");
}

async function discover() {
  if (!info || scanning || activity || restoreOnly) return;
  const session = radio;
  scanning = true;
  render();
  try { await session.discover(); }
  catch (e) { if (session === radio && !activity) log(e.message, "error"); }
  finally { if (session === radio) { scanning = false; render(); } }
}

function reset() {
  picture?.cancel();
  picture = null;
  radio?.cancelPending();
  radio = info = null;
  sending = scanning = restoreOnly = false;
  to.replaceChildren(new Option("Paired radio", ""));
  el("manual-address").value = "";
  render();
}

async function connect() {
  if (activity || info) return;
  activity = "Connecting…";
  render();
  try {
    const port = await SerialConnection.requestNewPort();
    if (port.getInfo().usbVendorId === 0x2e8a) throw Error("Select the USB ground station.");
    await link.connect(port, 38400);
    if (port.setSignals) await port.setSignals({dataTerminalReady:false, requestToSend:false});
    radio = new GroundRadio(link, receive, addRadio);
    info = await radio.start();
    to.replaceChildren(new Option("Paired radio · " + paired(), paired()),
      new Option("Enter radio address…", "manual"), new Option("Broadcast · all radios", BROADCAST));
    log("Network 0x" + info.OP.replace(/^0+(?=.)/, "") + " · Channel " + parseInt(info.CH,16));
  } catch (e) {
    log(e.name === "NotFoundError" ? "No port selected." : e.message, "error");
    if (radio?.restoreNeeded && link.isConnected) {
      try { await radio.restore(); } catch { log("Reconnect here and select Disconnect to restore monitor mode.", "error"); }
    }
    await link.disconnect();
    reset();
  } finally { activity = ""; render(); }
  if (info) { input.focus(); void discover(); }
}

async function disconnect() {
  if (activity) return false;
  if (!info) return true;
  activity = "Restoring monitor mode…";
  picture?.cancel();
  render();
  try {
    await radio.restore();
    await link.disconnect();
    reset();
    log("Disconnected · Transparent mode restored.");
    return true;
  } catch (e) {
    restoreOnly = Boolean(info);
    log(e.message + " Reconnect here or retry Disconnect to restore monitor mode.", "error");
    return false;
  } finally { activity = ""; render(); }
}

link.onDisconnect = () => {
  reset();
  log("USB disconnected. Reconnect here and select Disconnect before using a serial monitor.", "error");
};

async function send() {
  if (!info || activity || sending || restoreOnly) return;
  const text = input.value;
  const address = destination();
  const session = radio;
  const payload = new TextEncoder().encode(text + endings[el("line-ending").value]);
  if (to.value === "manual" && (address === BROADCAST || /^0{16}$/.test(address))) {
    log("Choose a radio address or select Broadcast from the list.", "error");
    return;
  }
  sending = true;
  render();
  try {
    await session.send(address, payload);
    if (session !== radio) return;
    log("→ " + (address === BROADCAST ? "Broadcast sent" : address + " · delivered") + "   " + text, "warn");
    if (address !== BROADCAST) addRadio(address);
    if (history.at(-1) !== text) history.push(text);
    if (history.length > 100) history.shift();
    historyIndex = history.length;
    if (input.value === text) input.value = "";
    draft = "";
  } catch (e) { if (session === radio && !activity) log(e.message, "error"); }
  finally { if (session === radio) { sending = false; render(); } }
}

input.onkeydown = event => {
  if (event.isComposing) return;
  if (event.key === "Enter") { event.preventDefault(); void send(); }
  if (["ArrowUp","ArrowDown"].includes(event.key) && history.length) {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
    input.value = history[historyIndex] ?? draft;
  }
};
input.oninput = () => { historyIndex = history.length; };
el("btn-select-port").onclick = connect;
el("btn-disconnect").onclick = disconnect;
el("btn-send").onclick = send;
el("discover").onclick = discover;
to.onchange = render;
el("manual-address").oninput = render;
el("get-picture").onclick = async () => {
  if (el("get-picture").disabled) return;
  const source = destination();
  const transfer = picture = new PictureDownload(radio, source);
  const progress = el("picture-progress");
  const save = el("save-picture");
  if (pictureUrl) URL.revokeObjectURL(pictureUrl);
  pictureUrl = null;
  save.hidden = true;
  progress.removeAttribute("value");
  progress.hidden = false;
  render();
  try {
    const bytes = await transfer.download((received, total) => {
      progress.max = total;
      progress.value = received;
    });
    if (picture !== transfer || transfer.cancelled) return;
    pictureUrl = URL.createObjectURL(new Blob([bytes], {type: "image/jpeg"}));
    save.href = pictureUrl;
    save.download = "picture-" + source + ".jpg";
    save.hidden = false;
    log("← " + source + "   Picture verified · " + bytes.length + " bytes · " + transfer.retries + " retries", "rx");
  } catch (e) {
    if (picture === transfer && !transfer.cancelled) log(e.message, "error");
  } finally {
    if (picture === transfer) picture = null;
    if (!picture) progress.hidden = true;
    render();
  }
};
el("btn-clear").onclick = () => output.replaceChildren();
el("btn-save-log").onclick = async () => {
  try { await saveBlobWithPicker(new Blob([output.innerText + "\n"], {type:"text/plain"}), "hepta-ground-station.txt"); }
  catch (e) { if (e.name !== "AbortError") log(e.message, "error"); }
};
el("setup-link").onclick = async event => {
  event.preventDefault();
  if (await disconnect()) location.assign(el("setup-link").href);
};
window.addEventListener("beforeunload", event => {
  if (info || activity) { event.preventDefault(); event.returnValue = ""; }
});
render();
