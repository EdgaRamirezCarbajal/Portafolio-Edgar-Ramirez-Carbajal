// Logic tests with a simulated DOM and GPU interface; not browser or visual tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  fire(type, extra = {}) {
    const event = { target: this, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
  dispatchEvent(event) { this.fire(event.type, event); }
}
class Classes {
  values = new Set();
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name); else this.values.delete(name);
  }
}
class Element extends Events {
  constructor(id = '') {
    super();
    this.id = id;
    this.classList = new Classes();
    this.attributes = new Map();
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.selectors = new Map();
    this.bounds = { top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400 };
    this.parentElement = null;
    this.open = false;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.selectors.get(selector); }
  querySelectorAll(selector) { return this.selectors.get(selector) || []; }
  getBoundingClientRect() { return this.bounds; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrolled = options; }
  contains(node) { return node.parentElement === this; }
  closest(selector) { return this.closestMap?.[selector] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  animate(keyframes, options) {
    const animation = { keyframes, options, cancel() { this.cancelled = true; } };
    this.lastAnimation = animation;
    return animation;
  }
}
function environment() {
  const window = new Events();
  const document = new Events();
  const root = new Element('root');
  root.scrollHeight = 6400;
  const elements = new Map();
  const make = id => { const el = new Element(id); elements.set(id, el); return el; };
  const reduced = new Events(); reduced.matches = false;
  const fine = new Events(); fine.matches = true;
  const media = query => query.includes('prefers-reduced-motion') ? reduced : fine;
  const frames = new Map(), timers = new Map();
  let serial = 0;
  const requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  const cancelAnimationFrame = id => frames.delete(id);
  const setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; };
  const clearTimeout = id => timers.delete(id);
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.node = node; }
    unobserve() {}
  }
  document.documentElement = root;
  document.body = new Element('body');
  document.hidden = false;
  document.getElementById = id => elements.get(id) || null;
  document.querySelector = selector => document.selectors.get(selector);
  document.querySelectorAll = selector => document.selectors.get(selector) || [];
  document.selectors = new Map();
  window.matchMedia = media;
  window.IntersectionObserver = Observer;
  window.ResizeObserver = Observer;
  const storage = new Map();
  const location = { hash: '' };
  const context = vm.createContext({
    window, document, matchMedia: media, IntersectionObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location, history: { pushState(_, __, hash) { location.hash = hash; } },
    innerHeight: 800, scrollY: 0, devicePixelRatio: 2
  });
  return { context, window, document, root, make, elements, reduced, fine, frames, timers, observers, location };
}
const results = [];
const app = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const scene = await fs.readFile(new URL('../scene.js', import.meta.url), 'utf8');
new vm.Script(app);
new vm.Script(scene);

const e = environment();
const motion = e.make('motion-toggle');
motion.selectors.set('.motion-label', e.make('motion-label'));
motion.selectors.set('.motion-symbol', e.make('motion-symbol'));
const menuButton = e.make('menu-button');
const menu = e.make('navigation');
const close = e.make('close-button');
menu.selectors.set('.menu-close', close);
const sections = ['inicio', 'sobre-mi', 'experiencia', 'proyectos', 'habilidades', 'formacion', 'contacto'].map((id, i) => {
  const element = e.make(id);
  element.bounds.top = i * 850;
  element.bounds.height = 850;
  return element;
});
const links = sections.map(section => {
  const link = new Element();
  link.hash = '#' + section.id;
  link.setAttribute('href', link.hash);
  link.closestMap = { 'a[href^="#"]': link };
  link.parentElement = menu;
  return link;
});
const progress = e.make('progress');
const tilt = e.make('tilt');
const magnetic = e.make('magnetic');
const details = e.make('details');
const summary = e.make('summary');
const content = e.make('content');
summary.bounds.height = 65;
content.bounds.height = 360;
details.bounds.height = 67;
details.selectors.set('summary', summary);
details.selectors.set('.details-content', content);
e.make('year');
e.document.selectors = new Map([
  ['.menu-toggle', menuButton], ['.reading-progress', progress],
  ['main > section[id]', sections], ['.desktop-nav a, .menu-links a', links],
  ['[data-tilt]', [tilt]], ['[data-magnetic]', [magnetic]],
  ['.project-details', [details]], ['[data-reveal]', []]
]);
vm.runInContext(app, e.context);
assert.equal(motion.getAttribute('aria-pressed'), 'false');
motion.fire('click');
assert(e.root.classList.contains('motion-paused'));
assert.equal(motion.getAttribute('aria-pressed'), 'true');
motion.fire('click');
assert(!e.root.classList.contains('motion-paused'));
e.reduced.matches = true;
e.reduced.fire('change');
assert(e.root.classList.contains('motion-paused'));
assert.equal(motion.disabled, true);
assert.equal(summary.fire('click').defaultPrevented, false);
e.reduced.matches = false;
e.reduced.fire('change');
assert.equal(motion.disabled, false);
results.push('Pause, resume, live reduced-motion preference and native details fallback');

menuButton.fire('click');
assert(menu.open);
assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
assert(e.document.body.classList.contains('menu-open'));
assert(menu.fire('cancel').defaultPrevented);
for (const callback of [...e.timers.values()]) callback();
assert(!menu.open);
assert(menuButton.focused);
assert(!e.document.body.classList.contains('menu-open'));
menuButton.fire('click');
const click = e.document.fire('click', { target: links[3] });
assert(click.defaultPrevented);
for (const callback of [...e.timers.values()]) callback();
assert(!menu.open);
assert.equal(e.location.hash, '#proyectos');
assert(sections[3].focused);
assert.equal(sections[3].scrolled.behavior, 'smooth');
results.push('Menu state, Escape handling, focus return and section navigation');

summary.fire('click');
assert(details.open);
assert.equal(details.lastAnimation.keyframes[1].height, '427px');
details.lastAnimation.onfinish();
assert(details.open);
summary.fire('click');
assert.equal(details.lastAnimation.keyframes[1].height, '67px');
details.lastAnimation.onfinish();
assert(!details.open);
summary.fire('click');
summary.fire('click');
details.lastAnimation.onfinish();
assert(!details.open);
results.push('Project details open, close and repeated clicks during animation');

tilt.fire('pointermove', { pointerType: 'mouse', clientX: 500, clientY: 50 });
for (const [id, callback] of [...e.frames]) { e.frames.delete(id); callback(16); }
assert(tilt.style['--ry']);
tilt.fire('pointerleave');
assert.equal(tilt.style['--ry'], undefined);
tilt.fire('pointermove', { pointerType: 'touch', clientX: 500, clientY: 50 });
assert.equal(tilt.style['--ry'], undefined);
magnetic.fire('pointermove', { pointerType: 'mouse', clientX: 500, clientY: 100 });
assert(magnetic.style.translate);
motion.fire('click');
assert.equal(magnetic.style.translate, '');
results.push('Fine-pointer interactions, touch exclusion and pause resets');

function sceneEnvironment(useWebGL) {
  const env = environment();
  const figure = env.make('figure');
  const canvas = env.make('hero-canvas');
  env.make('inicio');
  canvas.closestMap = { '.hero-art': figure };
  const arrays = [];
  let draws = 0;
  const noop = () => {};
  const gl = {
    VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,
    ELEMENT_ARRAY_BUFFER:7,DEPTH_TEST:8,CULL_FACE:9,FLOAT:10,COLOR_BUFFER_BIT:16,DEPTH_BUFFER_BIT:32,
    TRIANGLES:11,UNSIGNED_SHORT:12,
    createShader: () => ({}), shaderSource: noop, compileShader: noop, getShaderParameter: () => true,
    deleteShader: noop, createProgram: () => ({}), attachShader: noop, linkProgram: noop,
    getProgramParameter: () => true, useProgram: noop, createBuffer: () => ({}), bindBuffer: noop,
    bufferData(_, array) { arrays.push(array); }, getAttribLocation: () => 0,
    enableVertexAttribArray: noop, vertexAttribPointer: noop, enable: noop, disable: noop,
    clearColor: noop, getUniformLocation: () => ({}), viewport: noop, clear: noop,
    uniformMatrix3fv(_, __, matrix) { assert([...matrix].every(Number.isFinite)); }, uniform1f: noop,
    drawElements(_, count) { assert(count > 0); draws++; }
  };
  const ctx = { clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke() { draws++; } };
  canvas.getContext = type => type === 'webgl' ? (useWebGL ? gl : null) : ctx;
  vm.runInContext(scene, env.context);
  return { ...env, canvas, figure, arrays, get draws() { return draws; } };
}
const s = sceneEnvironment(true);
assert(s.figure.classList.contains('scene-ready'));
const [positions, normals, uv, indices] = s.arrays;
assert(positions.length > 0 && positions.length === normals.length);
assert([...positions].every(Number.isFinite));
assert.equal(uv.length / 2, positions.length / 3);
assert(Math.max(...indices) < positions.length / 3);
for (let i = 0; i < normals.length; i += 3) assert(Math.abs(Math.hypot(normals[i], normals[i+1], normals[i+2]) - 1) < .0001);
assert.equal(s.frames.size, 1);
s.root.classList.add('motion-paused');
s.window.fire('portfolio:motion');
assert.equal(s.frames.size, 0);
s.root.classList.remove('motion-paused');
s.window.fire('portfolio:motion');
assert.equal(s.frames.size, 1);
s.document.hidden = true;
s.document.fire('visibilitychange');
assert.equal(s.frames.size, 0);
s.document.hidden = false;
s.document.fire('visibilitychange');
assert.equal(s.frames.size, 1);
s.observers.find(observer => observer.node === s.figure && observer.callback.toString().includes('isIntersecting')).callback([{isIntersecting:false}]);
assert.equal(s.frames.size, 0);
results.push('Finite 3D mesh, normalized normals, valid indices and render suspension');
s.canvas.fire('webglcontextlost');
assert(!s.figure.classList.contains('scene-ready'));
assert.equal(s.frames.size, 0);
s.canvas.fire('webglcontextrestored');
assert(s.figure.classList.contains('scene-ready'));
const fallback = sceneEnvironment(false);
assert(fallback.figure.classList.contains('scene-ready'));
assert(fallback.draws > 0);
results.push('Context-loss recovery and 2D projection fallback');
export default { passed: results, count: results.length };
