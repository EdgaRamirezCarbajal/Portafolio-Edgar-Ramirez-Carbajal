'use strict';

// A procedural torus knot: no model downloads, textures or external runtime.
(() => {
  const canvas = document.getElementById('hero-canvas');
  const figure = canvas.closest('.hero-art');
  const hero = document.getElementById('inicio');
  const root = document.documentElement;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const tau = Math.PI * 2;
  let gl;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' }); } catch { gl = null; }
  let inView = true;
  let pageActive = true;
  let lost = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let pointerX = 0;
  let pointerY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let aspect = 1;
  let gpu = null;
  let fallbackContext = null;
  const paused = () => root.classList.contains('motion-paused');
  const normalize = a => {
    const length = Math.hypot(...a) || 1;
    return a.map(value => value / length);
  };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const center = t => {
    const radius = 1.22 + .39 * Math.cos(3 * t);
    return [radius * Math.cos(2 * t), radius * Math.sin(2 * t), .52 * Math.sin(3 * t)];
  };
  function frameAt(t) {
    const p = center(t);
    const next = center(t + .001);
    const tangent = normalize(next.map((value, i) => value - p[i]));
    const normal = normalize(cross(tangent, [0, 0, 1]));
    const binormal = normalize(cross(tangent, normal));
    return { p, normal, binormal };
  }

  const longitudinal = finePointer.matches ? 240 : 160;
  const radial = finePointer.matches ? 36 : 24;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= longitudinal; i++) {
    const t = i / longitudinal * tau;
    const { p, normal, binormal } = frameAt(t);
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * tau;
      const n = normal.map((value, axis) => value * Math.cos(angle) + binormal[axis] * Math.sin(angle));
      // A subtly varying tube produces a sculptural, machined silhouette.
      const radius = .335 + .025 * Math.cos(t * 3);
      positions.push(...p.map((value, axis) => value + radius * n[axis]));
      normals.push(...n);
      uvs.push(i / longitudinal, j / radial);
      if (i < longitudinal && j < radial) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  const vertexSource = [
    'attribute vec3 aPosition;',
    'attribute vec3 aNormal;',
    'attribute vec2 aUV;',
    'uniform mat3 uRotation;',
    'uniform float uAspect;',
    'uniform float uFloat;',
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'varying vec2 vUV;',
    'void main() {',
    '  vec3 p = uRotation * aPosition;',
    '  p.y += uFloat;',
    '  vNormal = uRotation * aNormal;',
    '  vPosition = p;',
    '  vUV = aUV;',
    '  float depth = 6.6 - p.z;',
    '  gl_Position = vec4(p.x * 2.65 / uAspect, p.y * 2.65, (depth - 1.0) * 1.02 - 1.0, depth);',
    '}'
  ].join('\n');
  const fragmentSource = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'varying vec2 vUV;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  vec3 view = normalize(vec3(0.0, 0.0, 6.6) - vPosition);',
    '  vec3 key = normalize(vec3(-3.5, 4.5, 5.0));',
    '  vec3 fill = normalize(vec3(4.0, -1.5, 2.0));',
    '  vec3 rimLight = normalize(vec3(-1.0, -3.0, -2.5));',
    '  float diffuse = max(dot(n, key), 0.0);',
    '  float fillAmount = max(dot(n, fill), 0.0);',
    '  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);',
    '  vec3 reflection = reflect(-view, n);',
    '  float strip = exp(-pow((reflection.y - 0.38) * 7.0, 2.0));',
    '  float edgeStrip = exp(-pow((reflection.x + 0.6) * 13.0, 2.0));',
    '  float spec = pow(max(dot(n, normalize(key + view)), 0.0), 100.0);',
    '  float fillSpec = pow(max(dot(n, normalize(fill + view)), 0.0), 64.0);',
    '  float grooves = 0.96 + 0.04 * sin(vUV.x * 1256.64);',
    '  vec3 cobalt = vec3(0.018, 0.055, 0.39);',
    '  vec3 color = cobalt * (0.25 + diffuse * 1.3 + fillAmount * 0.45);',
    '  color += vec3(0.15, 0.28, 0.72) * strip * 0.72;',
    '  color += vec3(0.42, 0.62, 1.0) * edgeStrip * 0.27;',
    '  color += vec3(0.76, 0.86, 1.0) * spec * 1.0;',
    '  color += vec3(0.09, 0.3, 1.0) * fillSpec * 0.8;',
    '  color += vec3(0.1, 0.23, 0.8) * rim * (0.2 + max(dot(n, rimLight), 0.0));',
    '  color *= grooves;',
    '  color = pow(color, vec3(0.78));',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Unable to compile the decorative scene.');
    }
    return shader;
  }
  function initGPU() {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Unable to link the decorative scene.');
    gl.useProgram(program);
    [['aPosition', positions, 3], ['aNormal', normals, 3], ['aUV', uvs, 2]].forEach(([name, data, size]) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    });
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gpu = {
      rotation: gl.getUniformLocation(program, 'uRotation'),
      aspect: gl.getUniformLocation(program, 'uAspect'),
      float: gl.getUniformLocation(program, 'uFloat')
    };
  }
  function rotationMatrix(x, y, z) {
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    return new Float32Array([
      cz*cy, sz*cy, -sy,
      cz*sy*sx-sz*cx, sz*sy*sx+cz*cx, cy*sx,
      cz*sy*cx+sz*sx, sz*sy*cx-cz*sx, cy*cx
    ]);
  }
  function render() {
    if (lost || (!gpu && !fallbackContext)) return;
    const rotation = rotationMatrix(.5 + smoothY * .22 + Math.sin(elapsed * .18) * .08, -.3 + smoothX * .3 + Math.sin(elapsed * .13) * .16, -.3 + Math.sin(elapsed * .12) * .06);
    const float = Math.sin(elapsed * .5) * .045;
    if (gpu) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(gpu.rotation, false, rotation);
      gl.uniform1f(gpu.aspect, aspect);
      gl.uniform1f(gpu.float, float);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    } else {
      // The same actual 3D geometry is projected to a 2D wireframe when WebGL is absent.
      const ctx = fallbackContext;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const project = p => {
        const x = rotation[0]*p[0] + rotation[3]*p[1] + rotation[6]*p[2];
        const y = rotation[1]*p[0] + rotation[4]*p[1] + rotation[7]*p[2] + float;
        const z = rotation[2]*p[0] + rotation[5]*p[1] + rotation[8]*p[2];
        const scale = canvas.height * 1.325 / (6.6 - z);
        return [canvas.width / 2 + x * scale, canvas.height / 2 - y * scale, z];
      };
      for (let j = 0; j < radial; j += 2) {
        ctx.beginPath();
        for (let i = 0; i <= longitudinal; i++) {
          const offset = (i * (radial + 1) + j) * 3;
          const p = project(positions.slice(offset, offset + 3));
          if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        }
        ctx.strokeStyle = j % 4 === 0 ? '#6689ee' : '#2e4da2';
        ctx.lineWidth = Math.min(devicePixelRatio || 1, 2);
        ctx.stroke();
      }
    }
    figure.classList.add('scene-ready');
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(devicePixelRatio || 1, finePointer.matches ? 1.75 : 1.4);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    aspect = canvas.width / canvas.height;
    render();
  }
  function tick(now) {
    frame = 0;
    if (!inView || !pageActive || document.hidden || paused() || lost) { lastTime = 0; return; }
    const delta = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60;
    lastTime = now;
    elapsed += delta;
    const damping = 1 - Math.exp(-delta * 4);
    smoothX += (pointerX - smoothX) * damping;
    smoothY += (pointerY - smoothY) * damping;
    render();
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function sync() {
    stop();
    if (lost || (!gpu && !fallbackContext)) return;
    render();
    if (inView && pageActive && !document.hidden && !paused()) frame = requestAnimationFrame(tick);
  }
  try {
    if (gl) initGPU();
    else fallbackContext = canvas.getContext('2d');
  } catch {
    // Keep the typographic fallback visible if the driver rejects a shader.
    return;
  }
  resize();
  sync();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(figure);
  else window.addEventListener('resize', resize, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(figure);
  }
  hero.addEventListener('pointermove', event => {
    if (paused() || !finePointer.matches || event.pointerType === 'touch') return;
    const bounds = hero.getBoundingClientRect();
    pointerX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    pointerY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  window.addEventListener('portfolio:motion', sync);
  document.addEventListener('visibilitychange', sync);
  finePointer.addEventListener('change', () => { pointerX = 0; pointerY = 0; resize(); });
  window.addEventListener('pagehide', () => { pageActive = false; stop(); });
  window.addEventListener('pageshow', () => { pageActive = true; sync(); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    stop();
    figure.classList.remove('scene-ready');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { initGPU(); lost = false; resize(); sync(); } catch { figure.classList.remove('scene-ready'); }
  });
})();
