import {
  type Action,
  type Binding,
  type KeyMap,
  ACTIONS,
  ACTION_IDS,
  bindingFromKey,
  bindingIndex,
  resolvePress,
} from './keymap.js';
import { type Stick, type StickOptions, DEFAULT_STICK, moveStick, stickFromCursor } from './joystick.js';

/**
 * Live input: keyboard and mouse → held actions, pressed-action events, the virtual joystick and
 * free mouse deltas (for orbit/turret views). Pointer lock is used when the browser grants it;
 * without it the stick follows the cursor's offset from screen centre.
 */
export class Input {
  private map: KeyMap;
  private idx: Map<Binding, Action>;
  private down = new Set<Binding>(); // unmodified codes and MouseN currently held
  private pressed: Action[] = [];
  private captureCb: ((b: Binding | null) => void) | null = null;
  stick: Stick = { x: 0, y: 0 };
  stickOpts: StickOptions = { ...DEFAULT_STICK };
  /** Mouse movement since the last frame (consumed by orbit/turret cameras). */
  look = { dx: 0, dy: 0, wheel: 0 };
  /** When false, the mouse drives `look` instead of the stick (orbit and turret views). */
  mouseFlies = true;
  enabled = false;

  constructor(
    private readonly el: HTMLElement,
    map: KeyMap,
  ) {
    this.map = map;
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.idx = bindingIndex(map);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('mousedown', this.onMouseDown);
    // Rebinding a mouse button: the menu overlay covers the canvas, so listen on the window.
    window.addEventListener('mousedown', this.onCaptureMouse, true);
    window.addEventListener('click', this.onCaptureClick, true);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setKeyMap(map: KeyMap): void {
    this.map = map;
    this.idx = bindingIndex(map);
  }
  get keyMap(): KeyMap {
    return this.map;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.el;
  }

  /**
   * Whether the game currently wants the mouse. Pointer lock is granted asynchronously, so a panel
   * can open (and release the mouse) before a lock asked for a moment earlier arrives; a lock that
   * arrives when it's no longer wanted is dropped at once.
   */
  private wantLock = false;

  async lockPointer(): Promise<boolean> {
    this.wantLock = true;
    if (this.pointerLocked) return true;
    try {
      await this.el.requestPointerLock();
    } catch {
      return false; // e.g. headless browsers, or the cooldown right after Esc
    }
    if (!this.wantLock) {
      this.unlockPointer();
      return false;
    }
    return this.pointerLocked;
  }
  unlockPointer(): void {
    this.wantLock = false;
    if (this.pointerLocked) document.exitPointerLock();
  }

  private onLockChange = (): void => {
    if (this.pointerLocked && !this.wantLock) document.exitPointerLock();
  };

  /** True while any binding of a held action is down. */
  held(a: Action): boolean {
    if (!this.enabled) return false;
    for (const b of this.map[a]) {
      const code = b.startsWith('Shift+') ? b.slice(6) : b;
      if (this.down.has(code)) return true;
    }
    return false;
  }

  /** Pressed-action events since the last call. */
  drainPressed(): Action[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  consumeLook(): { dx: number; dy: number; wheel: number } {
    const l = this.look;
    this.look = { dx: 0, dy: 0, wheel: 0 };
    return l;
  }

  centreStick(): void {
    this.stick = { x: 0, y: 0 };
  }

  /** True while the rebinding UI waits for a key or button. */
  get capturing(): boolean {
    return this.captureCb !== null;
  }

  private suppressClick = false;

  private onCaptureMouse = (e: MouseEvent): void => {
    if (!this.captureCb) return;
    e.preventDefault();
    e.stopPropagation();
    this.suppressClick = true; // the click that follows must not start another capture
    this.finishCapture(`Mouse${e.button}`);
  };

  private onCaptureClick = (e: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  /** Capture the next key or mouse button as a binding (rebinding UI). Esc cancels (null). */
  capture(cb: (b: Binding | null) => void): void {
    this.captureCb = cb;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onCaptureMouse, true);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('click', this.onCaptureClick, true);
  }

  private emit(binding: Binding): boolean {
    const a = resolvePress(this.idx, binding);
    if (!a) return false;
    const def = ACTIONS[a];
    if (!('held' in def && def.held)) this.pressed.push(a);
    return true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.captureCb) {
      if (e.code === 'Escape') {
        this.finishCapture(null);
      } else {
        const b = bindingFromKey(e);
        if (b && !b.endsWith('ShiftLeft') && !b.endsWith('ShiftRight')) this.finishCapture(b);
      }
      e.preventDefault();
      return;
    }
    if (!this.enabled || e.ctrlKey || e.altKey || e.metaKey) return;
    const b = bindingFromKey(e);
    if (!b) return;
    const known = this.idx.has(b) || this.idx.has(e.code);
    if (known) e.preventDefault(); // Tab, Space, F1, arrows must not move the page
    if (e.repeat) return;
    this.down.add(e.code);
    this.emit(b);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
  };

  private onMouseDown = (e: MouseEvent): void => {
    const b = `Mouse${e.button}`;
    if (this.captureCb) {
      this.finishCapture(b);
      e.preventDefault();
      return;
    }
    if (!this.enabled) return;
    this.down.add(b);
    this.emit(b);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      if (this.mouseFlies) this.stick = moveStick(this.stick, e.movementX, e.movementY, this.stickOpts);
      else {
        this.look.dx += e.movementX * this.stickOpts.sensitivity;
        this.look.dy += e.movementY * this.stickOpts.sensitivity;
      }
    } else if (this.mouseFlies) {
      this.stick = stickFromCursor(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight,
        this.stickOpts,
      );
    } else if (e.buttons & 1) {
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.look.wheel += Math.sign(e.deltaY);
  };

  private finishCapture(b: Binding | null): void {
    const cb = this.captureCb;
    this.captureCb = null;
    cb?.(b);
  }
}

export { ACTION_IDS };
