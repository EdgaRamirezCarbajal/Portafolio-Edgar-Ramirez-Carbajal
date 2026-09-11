// Real-browser checks using an isolated, headless Edge profile and its DevTools protocol.
// Run: node tests/browser-checks.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tests', 'browser-results');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-edge-'));
const executable = process.env.PORTFOLIO_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await fs.mkdir(output, { recursive: true });
const edge = spawn(executable, [
  '--headless', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  '--disable-background-networking', `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let startupError;
let diagnostics = '';
edge.on('error', error => { startupError = error; });
edge.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
let socket;
let session;
let serial = 0;
const pending = new Map();
const errors = [];
const report = { date: new Date().toISOString(), browser: '', checks: [], layouts: [], errors };

function command(method, params = {}, target = session) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await pause(400);
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(500);
}
async function key(key, code, virtualKey) {
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, ...(text ? { text, unmodifiedText: text } : {}) });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
  await pause(450);
}
async function screenshot(name) {
  const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
}
async function navigate(fragment = '') {
  await command('Page.navigate', { url: 'about:blank' });
  await command('Page.navigate', { url: pathToFileURL(path.join(root, 'index.html')).href + fragment });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#hero-title')`)) break;
    await pause(100);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  await pause(1700);
}
function passed(message) { report.checks.push(message); console.log(`PASS ${message}`); }

try {
  let endpoint;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw startupError;
    if (edge.exitCode !== null) throw new Error(`Edge exited: ${edge.exitCode}\n${diagnostics}`);
    try {
      const [port, route] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      endpoint = `ws://127.0.0.1:${port}${route}`;
      break;
    } catch { await pause(100); }
  }
  assert(endpoint, `Edge did not start. ${diagnostics}`);
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter) {
      clearTimeout(waiter.timeout);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry);
  });
  report.browser = (await command('Browser.getVersion')).product;
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  session = (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate();
  assert(await evaluate(`(() => { const photo = document.querySelector('.hero-portrait img'); return photo?.complete && photo.naturalWidth > 0 && photo.getAttribute('src') === 'img/perfil.jpg'; })()`));
  assert.equal(await evaluate('document.fonts.check(\'16px "Space Grotesk"\')'), true);
  passed('Local page, font and supplied profile photo load');
  await screenshot('desktop-inicio');

  await click('#motion-toggle');
  assert.equal(await evaluate(`document.querySelector('#motion-toggle').getAttribute('aria-pressed')`), 'true');
  await command('Page.reload');
  await pause(900);
  assert.equal(await evaluate(`document.querySelector('#motion-toggle').getAttribute('aria-pressed')`), 'true');
  await click('#motion-toggle');
  passed('Pause preference survives a reload and resumes with the control');

  await click('.menu-toggle');
  assert(await evaluate(`document.querySelector('#navigation').open`));
  await screenshot('desktop-menu');
  report.menuFocus = [];
  for (let i = 0; i < 10; i++) {
    await key('Tab', 'Tab', 9);
    const focus = await evaluate(`({inMenu:document.querySelector('#navigation').contains(document.activeElement), pageFocused:document.hasFocus(), tag:document.activeElement.tagName, text:document.activeElement.textContent.trim().slice(0,60)})`);
    report.menuFocus.push(focus);
    // Native Tab navigation briefly uses BODY at the browser-chrome boundary in headless Edge.
    // Background links and buttons must remain unreachable while the modal is open.
    assert(focus.inMenu || focus.tag === 'BODY', JSON.stringify(focus));
  }
  assert(report.menuFocus.at(-1).inMenu);
  await key('Escape', 'Escape', 27);
  assert(!await evaluate(`document.querySelector('#navigation').open`));
  assert(await evaluate(`document.activeElement.matches('.menu-toggle')`));
  passed('Modal menu contains keyboard focus and Escape returns it to the trigger');

  await click('.menu-toggle');
  await click('#navigation a[href="#proyectos"]');
  assert.equal(await evaluate('location.hash'), '#proyectos');
  assert.equal(await evaluate('document.activeElement.id'), 'proyectos');
  assert(!await evaluate(`document.querySelector('#navigation').open`));
  await pause(600);
  passed('Menu section link updates URL, closes dialog and moves focus');

  for (const project of ['proyecto-erp', 'proyecto-clinico']) {
    const selector = `#${project} summary`;
    await click(selector);
    assert(await evaluate(`document.querySelector('#${project} details').open`));
    await key('Enter', 'Enter', 13);
    assert(!await evaluate(`document.querySelector('#${project} details').open`));
    await key(' ', 'Space', 32);
    assert(await evaluate(`document.querySelector('#${project} details').open`));
    await screenshot(`desktop-${project}-expanded`);
    await key('Enter', 'Enter', 13);
  }
  passed('Both project disclosures work with mouse, Enter and Space');

  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(150);
  assert(await evaluate(`document.querySelector('#motion-toggle').disabled && document.documentElement.classList.contains('motion-paused')`));
  await click('#proyecto-erp summary');
  assert(await evaluate(`document.querySelector('#proyecto-erp details').open`));
  await click('#proyecto-erp summary');
  passed('System reduced-motion preference disables animation and keeps native disclosures usable');
  await command('Emulation.setEmulatedMedia', { features: [] });
  await pause(150);

  const sections = ['inicio', 'sobre-mi', 'experiencia', 'proyectos', 'habilidades', 'formacion', 'contacto'];
  for (const width of [1440, 768, 390, 320]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await command('Emulation.setTouchEmulationEnabled', { enabled: width < 600 });
    await navigate();
    for (const section of sections) {
      await evaluate(`document.getElementById('${section}').scrollIntoView({block:'start',behavior:'instant'})`);
      await pause(1000);
      const layout = await evaluate(`(() => {
        const section = document.getElementById('${section}');
        const outside = [...section.querySelectorAll('*')].filter(el => {
          if (el.closest('svg, .sr-only, [aria-hidden="true"]')) return false;
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && r.width > 0 && (r.left < -1 || r.right > ${width} + 1);
        }).map(el => ({tag:el.tagName, class:el.className, text:el.textContent.trim().slice(0,70)}));
        return {width:${width}, innerWidth, section:'${section}', documentWidth:document.documentElement.scrollWidth, outside};
      })()`);
      report.layouts.push(layout);
      if (width === 1440 || width === 390 || (width === 320 && ['inicio','proyectos','formacion','contacto'].includes(section))) await screenshot(`${width}-${section}`);
    }
    if (width === 390) {
      await click('.menu-toggle');
      await screenshot('390-menu');
      await click('#navigation a[href="#contacto"]');
      assert.equal(await evaluate('location.hash'), '#contacto');
    }
  }
  const overflow = report.layouts.filter(layout => layout.documentWidth > layout.width + 1 || layout.outside.length);
  report.overflow = overflow;
  assert.equal(overflow.length, 0, `Layout overflow: ${JSON.stringify(overflow)}`);
  passed('Seven sections fit at 1440, 768, 390 and 320 CSS pixels; mobile menu navigates');

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await navigate('#proyectos');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.menu-toggle')).display`), 'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#proyecto-erp')).opacity`), '1');
  await click('#proyecto-erp summary');
  assert(await evaluate(`document.querySelector('#proyecto-erp details').open`));
  await screenshot('390-no-javascript');
  passed('No-JavaScript page retains visible content and native disclosures');
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  passed('No page JavaScript or resource errors');
} catch (error) {
  report.failure = error.stack || String(error);
  console.error(report.failure);
  if (session) {
    try {
      report.failureState = await evaluate(`({active:document.activeElement.outerHTML, hash:location.hash, details:[...document.querySelectorAll('details')].map(d => ({open:d.open, height:d.getBoundingClientRect().height}))})`);
      await screenshot('failure');
    } catch { /* Preserve the original failure if the browser has already exited. */ }
  }
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close', {}, null); } catch { /* Browser may close the socket first. */ }
    socket.close();
  }
  if (edge.exitCode === null) edge.kill();
  console.log(`Results: ${path.join(output, 'report.json')}`);
  // The isolated profile stays in the OS temporary directory for normal system cleanup.
}
