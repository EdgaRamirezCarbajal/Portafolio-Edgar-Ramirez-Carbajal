'use strict';

(() => {
  const root = document.documentElement;
  root.classList.add('js-enabled');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const motionButton = document.getElementById('motion-toggle');
  let userPaused = false;
  try { userPaused = localStorage.getItem('er-motion-paused') === 'true'; } catch { /* File and private modes may block storage. */ }
  const isPaused = () => reducedMotion.matches || userPaused;

  function updateMotion() {
    const paused = isPaused();
    root.classList.toggle('motion-paused', paused);
    root.classList.toggle('has-motion', !paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.disabled = reducedMotion.matches;
    motionButton.querySelector('.motion-label').textContent = reducedMotion.matches
      ? 'Movimiento reducido' : paused ? 'Activar movimiento' : 'Pausar movimiento';
    motionButton.querySelector('.motion-symbol').textContent = paused ? '▷' : 'Ⅱ';
    motionButton.setAttribute('aria-label', reducedMotion.matches
      ? 'Movimiento reducido por la preferencia del sistema'
      : paused ? 'Activar animaciones' : 'Pausar animaciones');
    window.dispatchEvent(new CustomEvent('portfolio:motion', { detail: { paused } }));
  }
  motionButton.addEventListener('click', () => {
    userPaused = !userPaused;
    try { localStorage.setItem('er-motion-paused', String(userPaused)); } catch { /* Keep this session usable. */ }
    updateMotion();
  });
  reducedMotion.addEventListener('change', updateMotion);
  updateMotion();

  // Native modal semantics provide focus containment and an inert background.
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.getElementById('navigation');
  let closingMenu = false;
  let closeTimer;
  let menuDestination = null;
  function finishMenuClose() {
    clearTimeout(closeTimer);
    if (menu.open) menu.close();
    menu.classList.remove('is-closing');
    document.body.classList.remove('menu-open');
    menuButton.setAttribute('aria-expanded', 'false');
    closingMenu = false;
    const destination = menuDestination;
    menuDestination = null;
    if (destination) {
      navigateTo(destination);
    } else {
      menuButton.focus({ preventScroll: true });
    }
  }
  function closeMenu(destination = null) {
    if (!menu.open || closingMenu) return;
    menuDestination = destination;
    closingMenu = true;
    if (isPaused()) { finishMenuClose(); return; }
    menu.classList.add('is-closing');
    closeTimer = setTimeout(finishMenuClose, 260);
  }
  menuButton.addEventListener('click', () => {
    if (menu.open) { closeMenu(); return; }
    menu.showModal();
    menu.scrollTop = 0;
    document.body.classList.add('menu-open');
    menuButton.setAttribute('aria-expanded', 'true');
  });
  menu.querySelector('.menu-close').addEventListener('click', () => closeMenu());
  menu.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
  menu.addEventListener('click', event => {
    if (event.target !== menu) return;
    const rect = menu.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
  });
  menu.addEventListener('close', () => {
    document.body.classList.remove('menu-open');
    menuButton.setAttribute('aria-expanded', 'false');
  });

  // Keep native scrolling, deep links, URL history and keyboard focus in agreement.
  function showTarget(target) {
    target.classList.add('is-visible');
    target.querySelectorAll('[data-reveal]').forEach(element => element.classList.add('is-visible'));
    let ancestor = target.parentElement;
    while (ancestor) {
      if (ancestor.hasAttribute('data-reveal')) ancestor.classList.add('is-visible');
      ancestor = ancestor.parentElement;
    }
  }
  function navigateTo(target) {
    showTarget(target);
    target.focus({ preventScroll: true });
    try {
      if (location.hash !== '#' + target.id) history.pushState(null, '', '#' + target.id);
    } catch { location.hash = target.id; }
    target.scrollIntoView({ behavior: isPaused() ? 'instant' : 'smooth', block: 'start' });
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault();
    if (menu.contains(link)) closeMenu(target);
    else navigateTo(target);
  });

  // Content is visible by default, including when JavaScript is unavailable.
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: '0px 0px -35px 0px' });
    const revealElements = document.querySelectorAll('[data-reveal]');
    revealElements.forEach(element => revealObserver.observe(element));
    root.classList.add('reveal-ready');
    document.addEventListener('focusin', event => {
      const reveal = event.target.closest('[data-reveal]');
      if (reveal) showTarget(reveal);
    });
  }

  const sections = [...document.querySelectorAll('main > section[id]')];
  const sectionLinks = [...document.querySelectorAll('.desktop-nav a, .menu-links a')];
  const progress = document.querySelector('.reading-progress');
  let scrollFrame = 0;
  function updateScroll() {
    scrollFrame = 0;
    const range = root.scrollHeight - innerHeight;
    progress.style.transform = 'scaleX(' + (range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0) + ')';
    const heroBounds = sections[0].getBoundingClientRect();
    const depth = isPaused() ? 0 : Math.min(1, Math.max(0, -heroBounds.top / Math.max(heroBounds.height, 1)));
    root.style.setProperty('--hero-depth', depth.toFixed(3));
    const marker = Math.min(260, innerHeight * .35);
    let current = sections[0];
    sections.forEach(section => {
      if (section.getBoundingClientRect().top <= marker) current = section;
    });
    if (range > 0 && scrollY >= range - 8) current = sections[sections.length - 1];
    sectionLinks.forEach(link => {
      if (link.hash === '#' + current.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function scheduleScroll() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', scheduleScroll, { passive: true });
  window.addEventListener('load', scheduleScroll);
  window.addEventListener('portfolio:motion', scheduleScroll);
  window.addEventListener('hashchange', () => {
    const target = document.getElementById(location.hash.slice(1));
    if (target) showTarget(target);
    scheduleScroll();
  });
  const initialTarget = document.getElementById(location.hash.slice(1));
  if (initialTarget) showTarget(initialTarget);
  updateScroll();

  // Tilt affects only the diagram; the case-study text stays still.
  document.querySelectorAll('[data-tilt]').forEach(surface => {
    let frame = 0;
    let pointer = null;
    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      ['--rx', '--ry', '--mx', '--my'].forEach(property => surface.style.removeProperty(property));
    }
    surface.addEventListener('pointermove', event => {
      if (isPaused() || !finePointer.matches || event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pointer) return;
        const bounds = surface.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (pointer.x - bounds.left) / bounds.width));
        const y = Math.min(1, Math.max(0, (pointer.y - bounds.top) / bounds.height));
        surface.style.setProperty('--rx', ((.5 - y) * 5).toFixed(2) + 'deg');
        surface.style.setProperty('--ry', ((x - .5) * 6).toFixed(2) + 'deg');
        surface.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        surface.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
    }, { passive: true });
    surface.addEventListener('pointerleave', reset);
    window.addEventListener('portfolio:motion', reset);
    finePointer.addEventListener('change', reset);
  });

  document.querySelectorAll('[data-magnetic]').forEach(button => {
    let animation;
    function reset() {
      if (animation) animation.cancel();
      button.style.translate = '';
    }
    button.addEventListener('pointermove', event => {
      if (isPaused() || !finePointer.matches || event.pointerType === 'touch') return;
      if (animation) animation.cancel();
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * .075;
      const y = (event.clientY - rect.top - rect.height / 2) * .15;
      button.style.translate = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px';
    }, { passive: true });
    button.addEventListener('pointerleave', () => {
      if (isPaused() || !button.animate) { reset(); return; }
      const from = button.style.translate || '0px 0px';
      button.style.translate = '';
      animation = button.animate([{ translate: from }, { translate: '0px 0px' }], {
        duration: 350, easing: 'cubic-bezier(.2,.8,.2,1)'
      });
    });
    button.addEventListener('blur', reset);
    window.addEventListener('portfolio:motion', reset);
    finePointer.addEventListener('change', reset);
  });

  // Animate intrinsic detail height while preserving native keyboard behavior.
  document.querySelectorAll('.project-details').forEach(details => {
    const summary = details.querySelector('summary');
    const content = details.querySelector('.details-content');
    let animation = null;
    let desiredOpen = details.open;
    function finish() {
      if (animation) animation.cancel();
      animation = null;
      details.open = desiredOpen;
      details.style.height = '';
      scheduleScroll();
    }
    summary.addEventListener('click', event => {
      if (isPaused() || !details.animate) return;
      event.preventDefault();
      const start = details.getBoundingClientRect().height;
      desiredOpen = animation ? !desiredOpen : !details.open;
      if (animation) animation.cancel();
      details.open = true;
      const end = summary.getBoundingClientRect().height + (desiredOpen ? content.getBoundingClientRect().height : 0) + 2;
      animation = details.animate([{ height: start + 'px' }, { height: end + 'px' }], {
        duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)'
      });
      animation.onfinish = finish;
    });
    details.addEventListener('toggle', () => {
      if (!animation) desiredOpen = details.open;
      scheduleScroll();
    });
    window.addEventListener('portfolio:motion', () => { if (animation) finish(); });
  });

  // Expanded content remains present on printed copies.
  let printDetails = [];
  window.addEventListener('beforeprint', () => {
    printDetails = [...document.querySelectorAll('.project-details')].map(details => [details, details.open]);
    printDetails.forEach(([details]) => { details.open = true; });
  });
  window.addEventListener('afterprint', () => {
    printDetails.forEach(([details, open]) => { details.open = open; });
    printDetails = [];
  });
  document.getElementById('year').textContent = String(new Date().getFullYear());
})();
