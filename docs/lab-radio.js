const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const numberHex = n => n.toString(16).toUpperCase();
export function hex(value, width) {
  if (!/^[a-fA-F0-9]+$/.test(value)) throw Error("The radio returned an invalid hexadecimal value.");
  const digits = value.replace(/^0+(?=.)/, "").toUpperCase();
  if (digits.length > width) throw Error("The radio returned an out-of-range setting.");
  return digits.padStart(width, "0");
}

export function joinSettings(panText, channelText) {
  const pan = panText.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,16}$/i.test(pan) || /^0+$/.test(pan))
    throw Error("Read the host station or enter its network ID (1–16 hex digits, nonzero).");
  const input = channelText.trim();
  const channel = Number(input);
  if (!/^(?:[0-9]{1,2}|0x[0-9a-f]{1,2})$/i.test(input) || channel < 11 || channel > 26)
    throw Error("Use the host channel (11–26).");
  return {ID: hex(pan,16), SC: hex(numberHex(1 << (channel - 11)),4), CE:"0"};
}

const widths = {HV:4,VR:4,SH:8,SL:8,DH:8,DL:8,ID:16,SC:4,CE:1,
                AI:2,OP:16,CH:2,AP:1,AO:1,EE:1,ZS:2,SM:2,NJ:2};
export function settings(info) {
  return {ID:info.ID,SC:info.SC,CE:info.CE};
}

export function sameSettings(a,b) {
  return ["ID","SC","CE"].every(k => a[k] === b[k]);
}

export class LabRadio {
  constructor(link, satellite) {
    this.link = link;
    this.satellite = satellite;
    this.buffer = "";
    this.decoder = new TextDecoder();
    link.onData = bytes => {
      this.buffer = (this.buffer + this.decoder.decode(bytes,{stream:true})).slice(-8192);
    };
  }
  async request(text, pattern, timeout = 1700) {
    this.buffer = "";
    await this.link.write(text);
    const start = Date.now();
    while (Date.now()-start < timeout) {
      if (!this.link.isConnected) throw Error("USB disconnected.");
      const failure = /(?:^|[\r\n])(ERROR|HEPTA1 ERR(?: [^\r\n]*)?)[\r\n]/.exec(this.buffer);
      if (failure) throw Error("Radio error: " + failure[1]);
      const match = pattern.exec(this.buffer);
      if (match) return match[1] ?? "";
      await sleep(12);
    }
    throw Error("No reply. Check the USB port and device type. Satellites need power and Lab5-07.");
  }
  async session(fn) {
    if (this.satellite) return fn();
    // Guard times apply to host transmissions; do not send CR after +++.
    await sleep(1150);
    await this.request("+++", /(?:^|[\r\n])OK\r/, 2400);
    try { return await fn(); }
    finally { await this.request("ATCN\r", /(?:^|[\r\n])OK\r/); }
  }
  async read(names) {
    return this.session(async () => {
      const info = {};
      for (const key of names) {
        const value = this.satellite
          ? await this.request("HEPTA1 GET "+key+"\n", /(?:^|[\r\n])HEPTA1 OK ([a-f0-9]+)\r?\n/i)
          : await this.request("AT"+key+"\r", /(?:^|[\r\n])([a-f0-9]+)\r/i);
        info[key] = hex(value,widths[key]);
      }
      return info;
    });
  }
  async identify() {
    const info = await this.read(Object.keys(widths));
    if (!/^2E/i.test(info.HV) || !/^4/.test(info.VR) || info.EE !== "0" ||
        info.ZS !== "00" || info.SM !== "00" ||
        info.AP !== (this.satellite ? "1":"0") || (this.satellite && info.AO !== "0"))
      throw Error("Unsupported radio settings. Use the S2C Zigbee lab configuration.");
    return info;
  }
  async apply(params) {
    const {ID,SC,CE} = params;
    if (!/^[0-9A-F]{16}$/.test(ID) || !/^[0-9A-F]{4}$/.test(SC) ||
        SC === "0000" || !/^[01]$/.test(CE)) throw Error("Invalid saved radio settings.");
    if (this.satellite) {
      await this.request("HEPTA1 NET "+ID+" "+SC+" "+CE+"\n", /HEPTA1 OK\r?\n/, 24000);
    } else {
      const original = await this.read(["ID","SC","CE"]);
      await this.session(async () => {
        const stage = async values => {
          for (const [k,v] of Object.entries(values))
            await this.request("AT"+k+v+"\r", /(?:^|[\r\n])OK\r/);
        };
        try { await stage({ID,SC,CE}); }
        catch (e) { await stage(original); throw e; }
      });
    }
  }
  async waitForNetwork(params, operatingPan, expectedChannel) {
    let last = "";
    // Rejoining after a scan on the wrong channel can take longer than 10 s.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await sleep(700);
      try {
        const info = await this.read(["ID","SC","CE","AI","OP","CH"]);
        if (sameSettings(info,params) && info.AI === "00" &&
            (!operatingPan || info.OP === operatingPan) &&
            (!expectedChannel || info.CH === expectedChannel)) return info;
        last = "AI="+info.AI+" OP="+info.OP+" CH="+info.CH;
      } catch (e) { last = e.message; }
      if (!this.link.isConnected) break;
    }
    throw Error("Network not found. Check the host power and channel. "+last);
  }
  async ping(peer) {
    if (!/^[0-9A-F]{16}$/.test(peer) || /^0{12}/.test(peer)) throw Error("Enter the peer radio’s 16-digit hex address.");
    if (this.satellite) {
      await this.request("HEPTA1 PING "+peer+"\n", /HEPTA1 OK\r?\n/, 23000);
    } else {
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)),
        n => n.toString(16).padStart(2,"0")).join("");
      await this.request("H?"+nonce+"\n", new RegExp("H!"+nonce), 9000);
    }
  }
}
