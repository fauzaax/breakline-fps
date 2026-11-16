// Keyboard and mouse, and the pointer lock that turns the mouse into look. Held keys
// live in a set; fresh presses live in a second set the simulation drains once per frame,
// so semi-auto weapons and one-shot actions (reload, throw, buy) fire exactly once.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0, clickEdge: false };

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    if (!event.repeat) {
      keys.add(event.code);
      pressed.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) {
      state.firing = true;
      state.clickEdge = true;
    }
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => {
    if (state.locked) event.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takePressed() {
      const list = [...pressed];
      pressed.clear();
      return list;
    },
    takeClickEdge() {
      const edge = state.clickEdge;
      state.clickEdge = false;
      return edge;
    },
  };
}
