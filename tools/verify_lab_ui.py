"""Run with Python Playwright and its Chromium installed."""
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

docs = Path(__file__).resolve().parents[1] / "docs"


def serve(route):
    path = (docs / route.request.url.split("/")[-1]).resolve()
    if path.parent != docs or not path.is_file():
        route.abort()
        return
    mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}
    route.fulfill(body=path.read_bytes(), content_type=mime[path.suffix] + "; charset=utf-8")


# Keep the simulated radio powered across page reloads, independent of the
# restore record in localStorage. Channel 0C exercises single-digit hex reads.
mock = r"""
const regs = JSON.parse(sessionStorage.getItem('radio') || 'null') || {
  HV:'2E4E', VR:'4061', SH:'13A200', SL:'0000000A', DH:'13A200', DL:'0000000B',
  ID:'20', SC:'2000', CE:'0', AI:'0', OP:'20', CH:'18', AP:'1', AO:'0', EE:'0',
  ZS:'0', SM:'0', NJ:'FF'
};
const host = {
  getInfo: () => ({usbVendorId:0x0403}),
  async open() {
    let receiver;
    this.readable = new ReadableStream({start(c) { receiver = c; }});
    this.writable = new WritableStream({write(bytes) {
      const cmd = new TextDecoder().decode(bytes).trim();
      const values = {...regs, AP:'0', CE:'1', ID:'0', OP:'33', SC:'FFFF', CH:'C'};
      let reply;
      if (cmd === '+++' || cmd === 'ATCN') reply = 'OK';
      else if (/^AT[A-Z]{2}$/.test(cmd) && cmd.slice(2) in values) reply = values[cmd.slice(2)];
      else throw Error('Unexpected write to host: '+cmd);
      receiver.enqueue(new TextEncoder().encode(reply+'\r'));
    }});
  },
  async close() { window.hostReleased = true; }
};
const port = {
  getInfo: () => ({usbVendorId:0x2e8a}),
  async open() {
    let receiver;
    this.readable = new ReadableStream({start(c) { receiver = c; }});
    this.writable = new WritableStream({write(bytes) {
      const [prefix,op,...args] = new TextDecoder().decode(bytes).trim().split(' ');
      if (prefix !== 'HEPTA1') throw Error(prefix);
      let answer = 'HEPTA1 OK';
      if (op === 'GET') answer += ' ' + regs[args[0]];
      else if (op === 'NET') {
        [regs.ID,regs.SC,regs.CE] = args;
        regs.OP = regs.ID;
        regs.CH = (11 + Math.log2(parseInt(regs.SC,16))).toString(16);
        sessionStorage.setItem('radio',JSON.stringify(regs));
      } else if (op !== 'PING') throw Error(op);
      receiver.enqueue(new TextEncoder().encode(answer+'\r\n'));
    }});
  },
  async close() {}
};
Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>window.selectHost ? host : port}});
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 520, "height": 700})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(mock)
    page.route("http://localhost:18824/**", serve)
    page.goto("http://localhost:18824/index.html")

    def connect():
        page.evaluate("window.selectHost = false")
        page.get_by_role("radio", name="Satellite", exact=True).check()
        page.click("#connect")
        expect(page.locator("#device-id")).to_contain_text("0000000A")

    expect(page.locator("html")).to_have_attribute("lang", "en")
    page.evaluate("window.selectHost = true")
    page.click("#host")
    expect(page.locator("#source-pan")).to_have_text("0x33", timeout=10000)
    expect(page.locator("#source-channel")).to_have_text("12")
    expect(page.locator("#pan")).to_have_value("0x33")
    assert page.evaluate("window.hostReleased")
    connect()
    page.click("#preview")
    expect(page.locator("#plan")).to_contain_text("0x33")
    page.locator("#manual summary").click()
    page.fill("#pan", "0x33")
    page.fill("#channel", "27")
    page.click("#preview")
    expect(page.locator("#apply")).to_be_hidden()
    page.fill("#channel", "12")
    page.click("#preview")
    expect(page.locator("#apply")).to_be_visible()
    page.fill("#pan", "0x34")
    expect(page.locator("#apply")).to_be_hidden()
    page.fill("#pan", "0x33")
    page.click("#preview")
    page.click("#apply")
    expect(page.locator("#current")).to_contain_text("0x33")
    page.reload()
    connect()
    page.click("#restore")
    expect(page.locator("#current")).to_contain_text("0x20")
    expect(page.locator("#restore")).to_be_disabled()
    page.locator("#test summary").click()
    page.click("#ping")
    expect(page.locator("#status")).to_contain_text("Peer radio replied.")
    page.click("#disconnect")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not errors, errors
    browser.close()
print("PASS navigation, join, reload, restore, ping and disconnect")
