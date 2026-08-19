/**
 * TV Spatial Navigation Engine (iSTB TV Engine)
 * Designed for Smart TVs (Philips TV, Android TV, Tizen, webOS, Fire TV, Opera TV)
 * and Keyboard D-Pad Navigation.
 */

export type TVNavMode = 'auto' | 'tv' | 'pointer';

export type TVDirection = 'up' | 'down' | 'left' | 'right';

export interface TVNavigationOptions {
  getNavMode: () => TVNavMode;
  onBack?: () => boolean; // return true if handled
  onPlayPause?: () => void;
  onChannelNext?: () => void;
  onChannelPrev?: () => void;
  onNumberInput?: (num: number) => void;
}

const FOCUSABLE_SELECTOR = [
  '[data-tv-focusable="true"]',
  'button:not([disabled])',
  'a[href]:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex="0"]',
].join(', ');

class TVNavigationManager {
  private navMode: TVNavMode = 'auto';
  private isTVModeActive: boolean = false;
  private cursorTimeout: NodeJS.Timeout | null = null;
  private memoryByView: Map<string, string> = new Map();
  private memoryByCategory: Map<string, string> = new Map();
  private lastFocusedElement: HTMLElement | null = null;
  private options: TVNavigationOptions | null = null;
  private isInitialized: boolean = false;

  public init(options: TVNavigationOptions) {
    this.options = options;
    this.navMode = options.getNavMode();

    if (this.isInitialized) return;
    this.isInitialized = true;

    // Load saved mode from localStorage
    try {
      const saved = localStorage.getItem('istb_tv_nav_mode');
      if (saved === 'auto' || saved === 'tv' || saved === 'pointer') {
        this.navMode = saved;
      }
    } catch {
      // ignore
    }

    if (this.navMode === 'tv') {
      this.activateTVMode();
    }

    // Attach global listeners
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    window.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    window.addEventListener('click', this.handleClick, { passive: true });
  }

  public setNavMode(mode: TVNavMode) {
    this.navMode = mode;
    try {
      localStorage.setItem('istb_tv_nav_mode', mode);
    } catch {
      // ignore
    }

    if (mode === 'tv') {
      this.activateTVMode();
    } else if (mode === 'pointer') {
      this.deactivateTVMode();
    }
  }

  public getNavMode(): TVNavMode {
    return this.navMode;
  }

  public isTVMode(): boolean {
    return this.isTVModeActive || this.navMode === 'tv';
  }

  private activateTVMode() {
    this.isTVModeActive = true;
    document.documentElement.classList.add('tv-mode-active');
    this.scheduleHideCursor();

    // Auto-focus initial element if nothing is focused
    const current = document.activeElement as HTMLElement | null;
    if (!current || current === document.body || !this.isElementFocusable(current)) {
      this.focusFirstAvailable();
    }
  }

  private deactivateTVMode() {
    this.isTVModeActive = false;
    document.documentElement.classList.remove('tv-mode-active');
    document.documentElement.classList.remove('tv-cursor-hidden');
    if (this.cursorTimeout) {
      clearTimeout(this.cursorTimeout);
      this.cursorTimeout = null;
    }
  }

  private scheduleHideCursor() {
    if (this.cursorTimeout) clearTimeout(this.cursorTimeout);
    document.documentElement.classList.remove('tv-cursor-hidden');

    if (this.isTVMode()) {
      this.cursorTimeout = setTimeout(() => {
        document.documentElement.classList.add('tv-cursor-hidden');
      }, 3000);
    }
  }

  private handleMouseMove = () => {
    this.scheduleHideCursor();
    if (this.navMode === 'auto' && this.isTVModeActive) {
      // If user moved mouse substantially in auto mode, switch to pointer mode
      // but preserve TV class if requested
    }
  };

  private handleTouchStart = () => {
    if (this.navMode === 'auto') {
      this.deactivateTVMode();
    }
  };

  private handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target) {
      const focusable = target.closest(FOCUSABLE_SELECTOR) as HTMLElement | null;
      if (focusable) {
        this.lastFocusedElement = focusable;
        this.recordMemory(focusable);
      }
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    const keyCode = e.keyCode || e.which;

    // Check if user is currently typing in an input or textarea
    const activeEl = document.activeElement as HTMLElement | null;
    const isTextInput = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );

    // 1. Detect directional navigation keys
    const isUp = key === 'ArrowUp' || key === 'Up' || keyCode === 38;
    const isDown = key === 'ArrowDown' || key === 'Down' || keyCode === 40;
    const isLeft = key === 'ArrowLeft' || key === 'Left' || keyCode === 37;
    const isRight = key === 'ArrowRight' || key === 'Right' || keyCode === 39;
    const isEnter = key === 'Enter' || key === 'OK' || key === 'Select' || keyCode === 13;
    
    // Back / Return keys (Philips TV, Android TV, Tizen, webOS, Escape, Backspace)
    const isBack = key === 'Escape' ||
      key === 'BrowserBack' ||
      key === 'GoBack' ||
      key === 'Back' ||
      keyCode === 27 ||
      keyCode === 10009 || // Tizen Back
      keyCode === 461 ||   // webOS Back
      keyCode === 166 ||
      keyCode === 178 ||
      keyCode === 65385 ||
      (!isTextInput && (key === 'Backspace' || keyCode === 8));

    // Media Keys
    const isPlayPause = key === 'MediaPlayPause' ||
      key === 'MediaPlay' ||
      key === 'MediaPause' ||
      key === 'Play' ||
      key === 'Pause' ||
      keyCode === 179 ||
      keyCode === 415 ||
      keyCode === 19 ||
      keyCode === 250;

    // Channel Next / Prev
    const isChannelUp = key === 'ChannelUp' || key === 'PageUp' || keyCode === 33 || keyCode === 427;
    const isChannelDown = key === 'ChannelDown' || key === 'PageDown' || keyCode === 34 || keyCode === 428;

    // Digits
    const isDigit = !isTextInput && (
      (keyCode >= 48 && keyCode <= 57) ||
      (keyCode >= 96 && keyCode <= 105) ||
      (key >= '0' && key <= '9')
    );

    // Auto-activate TV mode if directional or TV key pressed
    if (this.navMode === 'auto' && !this.isTVModeActive) {
      if (isUp || isDown || isLeft || isRight || isBack || isPlayPause || isChannelUp || isChannelDown) {
        this.activateTVMode();
      }
    }

    // Process Spatial Navigation for Arrow Keys
    if (isUp || isDown || isLeft || isRight) {
      // In text inputs, allow left/right cursor movement unless at ends
      if (isTextInput && (isLeft || isRight)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const direction: TVDirection = isUp ? 'up' : isDown ? 'down' : isLeft ? 'left' : 'right';
      this.navigateDirection(direction);
      return;
    }

    // Process Enter / OK Key
    if (isEnter) {
      if (activeEl && this.isElementFocusable(activeEl)) {
        // If it's a button or link, let native click trigger, or dispatch click
        if (activeEl.tagName !== 'BUTTON' && activeEl.tagName !== 'A' && activeEl.tagName !== 'INPUT') {
          e.preventDefault();
          activeEl.click();
        }
      } else {
        // Nothing focused; focus first item
        e.preventDefault();
        this.focusFirstAvailable();
      }
      return;
    }

    // Process Back Key
    if (isBack) {
      e.preventDefault();
      e.stopPropagation();

      if (this.options?.onBack) {
        const handled = this.options.onBack();
        if (handled) return;
      }

      // Fallback: If in a modal, try to click the close button
      const openModal = this.getActiveModalContainer();
      if (openModal) {
        const closeBtn = openModal.querySelector<HTMLElement>('[data-tv-close="true"], button[title*="Fermer"], button[aria-label*="Close"], button:has(svg.lucide-x)');
        if (closeBtn) {
          closeBtn.click();
          return;
        }
      }
      return;
    }

    // Process Media Play/Pause
    if (isPlayPause) {
      e.preventDefault();
      if (this.options?.onPlayPause) {
        this.options.onPlayPause();
      }
      return;
    }

    // Process Channel Up / Down
    if (isChannelUp) {
      e.preventDefault();
      if (this.options?.onChannelNext) {
        this.options.onChannelNext();
      }
      return;
    }
    if (isChannelDown) {
      e.preventDefault();
      if (this.options?.onChannelPrev) {
        this.options.onChannelPrev();
      }
      return;
    }

    // Process Numeric Digits
    if (isDigit && this.options?.onNumberInput) {
      const num = parseInt(key, 10);
      if (!isNaN(num)) {
        this.options.onNumberInput(num);
      }
    }
  };

  /**
   * Spatial algorithm to find and focus candidate in a direction
   */
  public navigateDirection(direction: TVDirection): boolean {
    const scopeContainer = this.getActiveModalContainer() || document.body;
    const candidates = this.getFocusableElements(scopeContainer);

    if (candidates.length === 0) return false;

    let current = document.activeElement as HTMLElement | null;

    // If nothing currently focused in scope, focus the first candidate or restored candidate
    if (!current || !scopeContainer.contains(current) || !this.isElementFocusable(current)) {
      return this.focusFirstAvailable(scopeContainer);
    }

    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };

    let bestCandidate: HTMLElement | null = null;
    let minScore = Infinity;

    for (const cand of candidates) {
      if (cand === current) continue;

      const candRect = cand.getBoundingClientRect();
      const candCenter = {
        x: candRect.left + candRect.width / 2,
        y: candRect.top + candRect.height / 2,
      };

      // Check directional geometry
      let isInDirection = false;
      let primaryDistance = 0;
      let secondaryDistance = 0;
      let perpendicularOverlap = 0;

      switch (direction) {
        case 'right':
          // Candidate must be to the right
          isInDirection = candCenter.x > currentCenter.x + 2 && candRect.right > currentRect.right - 2;
          if (isInDirection) {
            primaryDistance = Math.max(0, candRect.left - currentRect.right);
            secondaryDistance = Math.abs(candCenter.y - currentCenter.y);
            // Overlap along vertical axis Y
            const overlapTop = Math.max(currentRect.top, candRect.top);
            const overlapBottom = Math.min(currentRect.bottom, candRect.bottom);
            perpendicularOverlap = Math.max(0, overlapBottom - overlapTop);
          }
          break;

        case 'left':
          // Candidate must be to the left
          isInDirection = candCenter.x < currentCenter.x - 2 && candRect.left < currentRect.left + 2;
          if (isInDirection) {
            primaryDistance = Math.max(0, currentRect.left - candRect.right);
            secondaryDistance = Math.abs(candCenter.y - currentCenter.y);
            // Overlap along vertical axis Y
            const overlapTop = Math.max(currentRect.top, candRect.top);
            const overlapBottom = Math.min(currentRect.bottom, candRect.bottom);
            perpendicularOverlap = Math.max(0, overlapBottom - overlapTop);
          }
          break;

        case 'down':
          // Candidate must be below
          isInDirection = candCenter.y > currentCenter.y + 2 && candRect.bottom > currentRect.bottom - 2;
          if (isInDirection) {
            primaryDistance = Math.max(0, candRect.top - currentRect.bottom);
            secondaryDistance = Math.abs(candCenter.x - currentCenter.x);
            // Overlap along horizontal axis X
            const overlapLeft = Math.max(currentRect.left, candRect.left);
            const overlapRight = Math.min(currentRect.right, candRect.right);
            perpendicularOverlap = Math.max(0, overlapRight - overlapLeft);
          }
          break;

        case 'up':
          // Candidate must be above
          isInDirection = candCenter.y < currentCenter.y - 2 && candRect.top < currentRect.top + 2;
          if (isInDirection) {
            primaryDistance = Math.max(0, currentRect.top - candRect.bottom);
            secondaryDistance = Math.abs(candCenter.x - currentCenter.x);
            // Overlap along horizontal axis X
            const overlapLeft = Math.max(currentRect.left, candRect.left);
            const overlapRight = Math.min(currentRect.right, candRect.right);
            perpendicularOverlap = Math.max(0, overlapRight - overlapLeft);
          }
          break;
      }

      if (!isInDirection) continue;

      // Calculate score (lower is better)
      // Alignment bonus if elements overlap on the perpendicular axis
      const alignmentPenaltyMultiplier = perpendicularOverlap > 0 ? 1.2 : 2.8;
      const score = primaryDistance + (secondaryDistance * alignmentPenaltyMultiplier) - (perpendicularOverlap * 0.4);

      if (score < minScore) {
        minScore = score;
        bestCandidate = cand;
      }
    }

    if (bestCandidate) {
      this.applyFocus(bestCandidate);
      return true;
    }

    return false;
  }

  /**
   * Applies focus, styling, and smooth scroll to element
   */
  public applyFocus(el: HTMLElement) {
    if (!el) return;

    // Remove old .tv-focused class
    if (this.lastFocusedElement && this.lastFocusedElement !== el) {
      this.lastFocusedElement.classList.remove('tv-focused');
    }

    this.lastFocusedElement = el;
    el.classList.add('tv-focused');
    el.focus({ preventScroll: true });

    try {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    } catch {
      // ignore
    }

    this.recordMemory(el);
  }

  /**
   * Focuses first available element or remembered element in scope
   */
  public focusFirstAvailable(container?: HTMLElement): boolean {
    const scope = container || this.getActiveModalContainer() || document.body;
    const candidates = this.getFocusableElements(scope);

    if (candidates.length === 0) return false;

    // Try to find a primary element (active channel, first category, or first button)
    const activeItem = candidates.find((el) => 
      el.getAttribute('data-tv-primary') === 'true' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.classList.contains('bg-indigo-500') ||
      el.classList.contains('border-amber-500')
    );

    const target = activeItem || candidates[0];
    this.applyFocus(target);
    return true;
  }

  /**
   * Focuses specific channel by ID
   */
  public focusChannel(channelId: string): boolean {
    const el = document.querySelector<HTMLElement>(`[data-channel-id="${channelId}"]`);
    if (el && this.isElementFocusable(el)) {
      this.applyFocus(el);
      return true;
    }
    return false;
  }

  /**
   * Restores focus when returning to a view or category
   */
  public restoreViewFocus(viewId: string, categoryName?: string): boolean {
    if (categoryName && this.memoryByCategory.has(categoryName)) {
      const channelId = this.memoryByCategory.get(categoryName);
      if (channelId && this.focusChannel(channelId)) return true;
    }

    if (this.memoryByView.has(viewId)) {
      const selector = this.memoryByView.get(viewId);
      if (selector) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && this.isElementFocusable(el)) {
          this.applyFocus(el);
          return true;
        }
      }
    }

    return this.focusFirstAvailable();
  }

  /**
   * Memorizes focused element for views and categories
   */
  private recordMemory(el: HTMLElement) {
    const channelId = el.getAttribute('data-channel-id');
    const category = el.getAttribute('data-channel-category');
    const viewId = el.getAttribute('data-tv-view');

    if (category && channelId) {
      this.memoryByCategory.set(category, channelId);
    }

    if (viewId) {
      const id = el.id ? `#${el.id}` : el.getAttribute('data-tv-id') ? `[data-tv-id="${el.getAttribute('data-tv-id')}"]` : null;
      if (id) {
        this.memoryByView.set(viewId, id);
      }
    }
  }

  /**
   * Gets currently active modal container if one is open
   */
  public getActiveModalContainer(): HTMLElement | null {
    // Check all open modals in descending z-index order
    const modals = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"]:not([aria-hidden="true"]), .tv-modal-container:not(.hidden), [data-tv-modal="true"]'
      )
    ).filter((m) => this.isElementVisible(m));

    if (modals.length > 0) {
      return modals[modals.length - 1];
    }
    return null;
  }

  /**
   * Returns list of visible and enabled focusable elements inside container
   */
  public getFocusableElements(container: HTMLElement = document.body): HTMLElement[] {
    const rawElements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    return rawElements.filter((el) => {
      // Must not be disabled or tabindex -1
      if ((el as any).disabled) return false;
      if (el.getAttribute('tabindex') === '-1') return false;
      if (el.getAttribute('data-tv-ignore') === 'true') return false;

      return this.isElementFocusable(el);
    });
  }

  private isElementFocusable(el: HTMLElement): boolean {
    if (!el || !el.isConnected) return false;
    return this.isElementVisible(el);
  }

  private isElementVisible(el: HTMLElement): boolean {
    if (!el) return false;
    if (el.offsetParent === null && el.tagName !== 'BODY') return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    // Check viewport bounds
    if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
      // In scrollable containers, element may be slightly off-screen; allow if within scroll container
      return true;
    }

    return true;
  }

  public destroy() {
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('touchstart', this.handleTouchStart);
    window.removeEventListener('click', this.handleClick);
    if (this.cursorTimeout) clearTimeout(this.cursorTimeout);
    this.isInitialized = false;
  }
}

export const tvNavigation = new TVNavigationManager();
