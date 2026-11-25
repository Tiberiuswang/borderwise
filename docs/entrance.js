const entrance = document.querySelector('#entrance');
const image = entrance.querySelector('.entrance-image img');
const start = entrance.querySelector('.entrance-button');
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const parallax = matchMedia('(min-width: 701px) and (hover: hover) and (pointer: fine)');
let flight = null;

function visibleBrandMark() {
  return [...document.querySelectorAll('.app-shell .brand .brand-mark img')].find(mark => {
    const { width, height } = mark.getBoundingClientRect();
    return width > 0 && height > 0 && getComputedStyle(mark).visibility === 'visible';
  });
}

function finishFlight(revealWordmark = false) {
  if (!flight) return;
  const { ghost, brand, animation } = flight;
  flight = null;
  animation?.cancel();
  ghost.remove();
  brand?.removeAttribute('data-brand-arriving');
  root.removeAttribute('data-brand-flight');
  if (revealWordmark && !reduced.matches) {
    brand?.querySelector('.brand-wordmark')?.animate([
      { opacity: 0, transform: 'translateX(-4px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 210, easing: 'ease-out' });
  }
}

function moveToBrand(current, from, filter) {
  if (flight !== current) return;
  const target = location.hash === start.hash && visibleBrandMark();
  if (!target || reduced.matches) {
    finishFlight();
    return;
  }

  const to = target.getBoundingClientRect();
  current.brand = target.closest('.brand');
  current.brand.setAttribute('data-brand-arriving', '');
  current.animation = current.ghost.animate([
    { transform: 'none', filter },
    {
      transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
      filter: getComputedStyle(target).filter,
    },
  ], { duration: 690, easing: 'cubic-bezier(.28, .68, .24, 1)', fill: 'forwards' });
  current.animation.finished.then(() => {
    if (flight === current) finishFlight(true);
  }, () => {
    if (flight === current) finishFlight();
  });
}

start.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey || reduced.matches || typeof image.animate !== 'function' ||
      !image.naturalWidth || location.hash === start.hash) return;
  const from = image.getBoundingClientRect();
  if (!from.width || !from.height) return;

  event.preventDefault();
  finishFlight();
  const filter = getComputedStyle(image).filter;
  const ghost = image.cloneNode();
  ghost.className = 'brand-flight';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    filter,
  });
  const current = { ghost };
  flight = current;
  root.setAttribute('data-brand-flight', '');
  document.body.append(ghost);
  location.hash = start.hash;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => moveToBrand(current, from, filter));
});

function resetArt() {
  entrance.style.removeProperty('--art-x');
  entrance.style.removeProperty('--art-y');
}

entrance.addEventListener('pointermove', event => {
  if (!parallax.matches || reduced.matches || event.pointerType !== 'mouse') return;
  const box = entrance.getBoundingClientRect();
  entrance.style.setProperty('--art-x', `${(event.clientX - box.left) / box.width * 14 - 7}px`);
  entrance.style.setProperty('--art-y', `${(event.clientY - box.top) / box.height * 12 - 6}px`);
});
entrance.addEventListener('pointerleave', resetArt);
parallax.addEventListener('change', resetArt);
reduced.addEventListener('change', () => { resetArt(); finishFlight(); });
window.addEventListener('resize', () => finishFlight());
window.addEventListener('pagehide', () => finishFlight());
window.addEventListener('hashchange', () => { if (location.hash !== start.hash) finishFlight(); });
