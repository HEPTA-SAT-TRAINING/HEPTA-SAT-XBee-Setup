import {SerialConnection} from "./serial.js";
import {LabRadio, joinSettings, sameSettings, settings} from "./lab-radio.js";

const el = id => document.getElementById(id);
const link = new SerialConnection();
let radio, info, preview, busy = false;
const key = () => "hepta.zigbee.home.v1." + info.SH + info.SL;
const shortId = id => "0x" + id.replace(/^0+(?=.)/, "");
const channelNumber = mask => 11 + Math.log2(parseInt(mask, 16));

function status(text, error = false) {
  el("status").textContent = text;
  el("status").classList.toggle("error", error);
}

function render() {
  el("host").disabled = busy || Boolean(info);
  el("connect").hidden = Boolean(info);
  el("connect").disabled = busy;
  el("disconnect").hidden = !info;
  el("disconnect").disabled = busy;
  el("kind").disabled = busy || Boolean(info);
  el("pan").disabled = el("channel").disabled = busy;
  el("connected").hidden = el("actions").hidden = !info;
  el("actions").disabled = busy || !info;
  el("restore").hidden = el("restore").disabled = !info || !localStorage.getItem(key());
  el("apply").hidden = !preview;
  el("preview").hidden = Boolean(preview);
  if (!info) return;
  el("device-id").textContent = info.SH + info.SL;
  el("current").textContent = info.AI === "00"
    ? "Current network " + shortId(info.OP) + " · Channel " + parseInt(info.CH,16)
    : "Searching for a network";
  el("identity").textContent = [
    "Radio address   " + info.SH + info.SL,
    "Paired radio    " + info.DH + info.DL,
    "Role            " + (info.CE === "1" ? "Coordinator" : "Router"),
    "Configured ID   " + shortId(info.ID),
    "Channel mask    0x" + info.SC,
    "Join status     0x" + info.AI,
  ].join("\n");
}

function clearPreview() {
  preview = null;
  el("plan").textContent = "";
  el("apply").hidden = true;
  el("preview").hidden = false;
}

function action(id, fn) {
  el(id).onclick = async () => {
    if (busy) return;
    busy = true;
    render();
    try { await fn(); }
    catch (e) {
      const messages = {
        NotFoundError: "No USB port selected.",
        NetworkError: "USB port unavailable. Disconnect the serial monitor and try again.",
        SecurityError: "USB access blocked. Open this page in Chrome or Edge.",
      };
      status(messages[e.name] || e.message, true);
    } finally { busy = false; render(); }
  };
}

async function openRadio(connection, satellite) {
  const port = await SerialConnection.requestNewPort();
  const {usbVendorId} = port.getInfo();
  if ((satellite && usbVendorId === 0x0403) || (!satellite && usbVendorId === 0x2e8a))
    throw Error(satellite ? "Select the satellite’s USB port." : "Select the USB ground station.");
  await connection.connect(port, satellite ? 115200 : 38400);
  if (port.setSignals) await port.setSignals({dataTerminalReady: satellite, requestToSend: false});
  return new LabRadio(connection, satellite);
}

action("host", async () => {
  const hostLink = new SerialConnection();
  clearPreview();
  if (!el("source").hidden) {
    el("source").hidden = true;
    el("pan").value = el("channel").value = "";
  }
  try {
    status("Reading the host ground station…");
    const host = await openRadio(hostLink, false);
    const live = await host.identify();
    if (live.CE !== "1" || live.AI !== "00")
      throw Error("Select the ground station that runs the destination network.");
    const pan = shortId(live.OP);
    const channel = String(parseInt(live.CH, 16));
    joinSettings(pan, channel);
    el("pan").value = el("source-pan").textContent = pan;
    el("channel").value = el("source-channel").textContent = channel;
    el("source").hidden = false;
    el("manual").open = false;
    status("Host read. Keep it powered and connect the device to join.");
  } finally { await hostLink.disconnect(); }
});

action("connect", async () => {
  const satellite = document.querySelector('input[name="kind"]:checked').value === "sat";
  try {
    status("Reading device…");
    radio = await openRadio(link, satellite);
    info = await radio.identify();
    el("peer").value = info.DH + info.DL;
    el("peer").readOnly = !satellite;
    status(el("pan").value && el("channel").value ? "Device ready. Review the change."
      : "Device connected. Enter the host settings, or disconnect to read the host.");
  } catch (e) { await link.disconnect(); info = null; throw e; }
});
action("disconnect", async () => {
  await link.disconnect(); info = null; clearPreview(); status("Device disconnected.");
});
link.onDisconnect = () => {
  info = null; clearPreview(); render(); status("USB disconnected.", true);
};
for (const input of ["pan", "channel"]) {
  el(input).oninput = () => { el("source").hidden = true; clearPreview(); status(""); };
}
action("preview", async () => {
  clearPreview();
  if (!el("pan").value || !el("channel").value) el("manual").open = true;
  const target = joinSettings(el("pan").value, el("channel").value);
  info = await radio.identify();
  const channel = channelNumber(target.SC);
  if (info.AI === "00" && info.OP === target.ID && parseInt(info.CH,16) === channel)
    throw Error(info.CE === "1" ? "This is the host. Connect the device you want to join."
      : "This device is already on the selected network.");
  preview = target;
  const destination = shortId(target.ID) + " · Channel " + channel;
  el("plan").textContent = (info.AI === "00" ? shortId(info.OP) : "Offline") + " → " + destination;
  status(info.CE === "1" ? "This station will leave its network and join as a router." : "");
});

async function verify(params,pan,channel) {
  try { await radio.waitForNetwork(params,pan,channel); }
  finally { if (link.isConnected) info = await radio.identify(); }
}
action("apply", async () => {
  const target = preview;
  clearPreview();
  const fresh = await radio.identify();
  if (fresh.SH+fresh.SL !== info.SH+info.SL || !sameSettings(fresh,info))
    throw Error("Device or settings changed. Review again.");
  if (!localStorage.getItem(key()))
    localStorage.setItem(key(), JSON.stringify({params:settings(fresh),pan:fresh.OP,channel:fresh.CH,
      joined:fresh.AI === "00"}));
  try {
    status("Joining network…");
    await radio.apply(target);
    await verify(target,target.ID,channelNumber(target.SC).toString(16).toUpperCase().padStart(2,"0"));
  } catch (e) { throw Error(e.message + " Restore original network to return."); }
  status("Joined network " + shortId(target.ID) + ".");
});
action("restore", async () => {
  clearPreview();
  const originalKey = key();
  info = await radio.identify();
  if (key() !== originalKey) throw Error("Radio changed. Reconnect the device.");
  const home = JSON.parse(localStorage.getItem(originalKey));
  if (!home) throw Error("No original settings saved for this radio in this browser.");
  status("Restoring original network…");
  if (home.joined) {
    const fixed = joinSettings(home.pan, "0x"+home.channel);
    fixed.CE = home.params.CE;
    if (!sameSettings(info,fixed)) await radio.apply(fixed);
    await verify(fixed,home.pan,home.channel);
  }
  if (!home.joined || !sameSettings(info,home.params)) {
    await radio.apply(home.params);
    if (home.joined) await verify(home.params,home.pan,null);
    else {
      info = await radio.identify();
      if (!sameSettings(info,home.params)) throw Error("Restore could not be verified. Try again.");
    }
  }
  localStorage.removeItem(originalKey);
  status(home.joined ? "Original network restored." : "Original settings restored. The radio was offline when saved.");
});
action("ping", async () => {
  status("Testing radio link…");
  await radio.ping(el("peer").value.trim().toUpperCase());
  status(radio.satellite ? "Peer radio replied." : "Paired satellite replied.");
});
render();
