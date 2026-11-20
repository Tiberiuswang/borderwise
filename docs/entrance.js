const entrance = document.querySelector('#entrance');
const emblem = entrance.querySelector('.entrance-emblem');
const mark = emblem.querySelector('img');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const parallax = matchMedia('(min-width: 701px) and (hover: hover) and (pointer: fine)');
let pull = null;
let recoil = null;

function bounce(x = 0, y = 0) {
  if (reduced.matches) return;
  recoil?.cancel();
  mark.style.transform = '';
  recoil = mark.animate([
    { transform: `translate(${x}px, ${y}px) rotate(${x / 2}deg) scale(.94)` },
    { transform: 'translateY(2px) scale(1.12)', offset: .45 },
    { transform: 'translateY(-1px) scale(.98)', offset: .73 },
    { transform: 'none' },
  ], { duration: 380, easing: 'ease-out' });
}

emblem.addEventListener('pointerdown', event => {
  if (reduced.matches || !event.isPrimary || event.button !== 0) return;
  recoil?.cancel();
  pull = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: 0, y: 0 };
  emblem.setPointerCapture(event.pointerId);
});

emblem.addEventListener('pointermove', event => {
  if (event.pointerId !== pull?.id) return;
  pull.x = Math.max(-15, Math.min(15, (event.clientX - pull.startX) * .5));
  pull.y = Math.max(-15, Math.min(15, (event.clientY - pull.startY) * .5));
  mark.style.transform = `translate(${pull.x}px, ${pull.y}px) rotate(${pull.x / 2}deg) scale(.94)`;
});

function release(event) {
  if (event.pointerId !== pull?.id) return;
  const { x, y } = pull;
  pull = null;
  bounce(x, y);
}

for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  emblem.addEventListener(name, release);
}

emblem.addEventListener('click', event => {
  if (event.detail === 0) bounce();
});

function resetMotion() {
  emblem.disabled = reduced.matches;
  entrance.style.removeProperty('--art-x');
  entrance.style.removeProperty('--art-y');
  if (reduced.matches) {
    recoil?.cancel();
    pull = null;
    mark.style.transform = '';
  }
}

entrance.addEventListener('pointermove', event => {
  if (!parallax.matches || reduced.matches || pull || event.pointerType !== 'mouse') return;
  const box = entrance.getBoundingClientRect();
  entrance.style.setProperty('--art-x', `${(event.clientX - box.left) / box.width * 14 - 7}px`);
  entrance.style.setProperty('--art-y', `${(event.clientY - box.top) / box.height * 12 - 6}px`);
});
entrance.addEventListener('pointerleave', resetMotion);
parallax.addEventListener('change', resetMotion);
reduced.addEventListener('change', resetMotion);
resetMotion();
