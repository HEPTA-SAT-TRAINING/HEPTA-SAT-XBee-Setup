import assert from "node:assert/strict";
import {LabRadio, joinSettings, settings, sameSettings} from "../docs/lab-radio.js";

const home = {HV:"2E4E",VR:"4061",SH:"0013A200",SL:"0000000B",DH:"0013A200",
  DL:"0000000A",ID:"0000000000000020",SC:"2000",CE:"1",AI:"00",OP:"0000000000000020",
  CH:"18",AP:"0",AO:"0",EE:"0",ZS:"00",SM:"00",NJ:"FF"};
const target = joinSettings("0x30","12");
assert.deepEqual(target,{ID:"0000000000000030",SC:"0002",CE:"0"});
assert.deepEqual(joinSettings("30","0x0c"),target);
assert.deepEqual(joinSettings("fedcba9876543210","26"),{ID:"FEDCBA9876543210",SC:"8000",CE:"0"});
assert.equal(joinSettings("1","11").SC,"0001");
for (const pan of ["", "0", "0x", "G1", "10000000000000000"])
  assert.throws(() => joinSettings(pan,"24"));
for (const ch of ["", "10", "27", "1.2", "1e1", "0x1b"])
  assert.throws(() => joinSettings("20",ch));

// Simulate the S2C scanning for 18 s before its home network is available.
const realNow = Date.now;
const realTimeout = globalThis.setTimeout;
let elapsed = 0;
try {
  Date.now = () => elapsed;
  globalThis.setTimeout = (resolve, ms) => { elapsed += ms; resolve(); };
  const radio = new LabRadio({isConnected:true},true);
  radio.read = async () => ({...home, AI:elapsed < 18000 ? "FF" : "00"});
  await radio.waitForNetwork(home,home.OP,home.CH);
  radio.read = async () => ({...home, CH:"17"});
  await assert.rejects(radio.waitForNetwork(home,home.OP,home.CH), /CH=17/);
} finally {
  Date.now = realNow;
  globalThis.setTimeout = realTimeout;
}
const enc = new TextEncoder();
for (const satellite of [false,true]) {
  const state = {...home,AP:satellite ? "1" : "0",CE:satellite ? "0" : "1"};
  const log = [];
  let pending = {};
  let reject = false;
  function commit(values) {
    Object.assign(state,values);
    state.OP = state.ID;
    state.CH = (11+Math.log2(parseInt(state.SC,16))).toString(16).toUpperCase().padStart(2,"0");
  }
  const link = {isConnected:true,async write(raw) {
    const cmd = raw.trim();
    log.push(cmd);
    let answer;
    if (cmd === "+++"){
      answer = "OK";
    } else if (cmd === "ATCN") {
      commit(pending); pending = {}; answer = "OK";
    } else if (cmd.startsWith("HEPTA1 GET ")) {
      answer = "HEPTA1 OK "+state[cmd.slice(11)];
    } else if (cmd.startsWith("HEPTA1 NET ")) {
      const [ID,SC,CE] = cmd.slice(11).split(" ");
      commit({ID,SC,CE}); answer="HEPTA1 OK";
    } else if (cmd.startsWith("AT") && cmd.length === 4) {
      answer = state[cmd.slice(2)];
    } else if (/^AT(ID|CE|SC)[0-9A-F]+$/.test(cmd)) {
      if (reject && cmd.slice(2,4) === "SC") {
        reject = false; answer="ERROR";
      } else {
        pending[cmd.slice(2,4)] = cmd.slice(4); answer="OK";
      }
    } else if (cmd.startsWith("H?")) {
      answer = "H!"+cmd.slice(2);
    } else if (cmd.startsWith("HEPTA1 PING ")) {
      answer = "HEPTA1 OK";
    } else assert.fail(cmd);
    const bytes = enc.encode(answer+"\r\n");
    this.onData(bytes.slice(0,2));
    this.onData(bytes.slice(2));
  }};
  const radio = new LabRadio(link,satellite);
  const before = await radio.identify();
  if (!satellite) {
    reject = true;
    await assert.rejects(radio.apply(target));
    assert(sameSettings(state,before));
  }
  await radio.apply(target);
  await radio.waitForNetwork(target,target.ID,"0C");
  await radio.ping(before.DH+before.DL);
  await radio.apply(settings(before));
  await radio.waitForNetwork(before,before.OP,before.CH);
  assert.equal(state.DH+state.DL,home.DH+home.DL);
  assert(!log.some(cmd => /ATWR|ATNR/.test(cmd)));
}
console.log("PASS ground and OBC join, readback, rollback, restore and ping");
