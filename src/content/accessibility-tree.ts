export {};

declare global {
  interface Window {
    __piElementMap?: Record<string, { element: WeakRef<Element>; role: string; name: string }>;
    __piLastSnapshot?: { content: string; timestamp: number };
    __piHelpers?: typeof piHelpersImpl;
    piHelpers?: typeof piHelpersImpl;
    __piRefs?: Record<string, Element>;
  }
}

interface ModalState {
  type: 'dialog' | 'alertdialog';
  description: string;
  clearedBy: string;
}

const VALID_ARIA_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "blockquote",
  "button", "caption", "cell", "checkbox", "code", "columnheader", "combobox",
  "complementary", "contentinfo", "definition", "deletion", "dialog", "directory",
  "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
  "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem",
  "log", "main", "mark", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note",
  "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup",
  "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox",
  "separator", "slider", "spinbutton", "status", "strong", "subscript",
  "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term",
  "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"
]);

function isFocusable(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (["button", "input", "select", "textarea"].includes(tagName)) {
    return !(element as HTMLButtonElement).disabled;
  }
  if (tagName === "a" && element.hasAttribute("href")) return true;
  if (element.hasAttribute("tabindex")) {
    const tabindex = parseInt(element.getAttribute("tabindex") || "", 10);
    return !isNaN(tabindex) && tabindex >= 0;
  }
  if (element.getAttribute("contenteditable") === "true") return true;
  return false;
}

function getExplicitRole(element: Element): string | null {
  const roleAttr = element.getAttribute("role");
  if (!roleAttr) return null;
  const roles = roleAttr.split(/\s+/).filter(r => r);
  for (const role of roles) {
    if (VALID_ARIA_ROLES.has(role)) {
      return role;
    }
  }
  return null;
}

function getImplicitRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute("type");

  const tagRoles: Record<string, string | ((el: Element) => string)> = {
    a: (el) => el.hasAttribute("href") ? "link" : "generic",
    article: "article",
    aside: "complementary",
    button: "button",
    datalist: "listbox",
    dd: "definition",
    details: "group",
    dialog: "dialog",
    dt: "term",
    fieldset: "group",
    figure: "figure",
    footer: (el) => el.closest("article, aside, main, nav, section") ? "generic" : "contentinfo",
    form: (el) => el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "form" : "generic",
    h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
    header: (el) => el.closest("article, aside, main, nav, section") ? "generic" : "banner",
    hr: "separator",
    img: (el) => el.getAttribute("alt") === "" ? "presentation" : "img",
    li: "listitem",
    main: "main",
    math: "math",
    menu: "list",
    meter: "meter",
    nav: "navigation",
    ol: "list",
    optgroup: "group",
    option: "option",
    output: "status",
    p: "paragraph",
    progress: "progressbar",
    search: "search",
    section: (el) => el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "generic",
    select: (el) => {
      const s = el as HTMLSelectElement;
      return s.hasAttribute("multiple") || (s.size && s.size > 1) ? "listbox" : "combobox";
    },
    table: "table",
    tbody: "rowgroup",
    td: "cell",
    textarea: "textbox",
    tfoot: "rowgroup",
    th: "columnheader",
    thead: "rowgroup",
    time: "time",
    tr: "row",
    ul: "list",
  };

  if (tag === "input") {
    const inputRoles: Record<string, string> = {
      button: "button",
      checkbox: "checkbox",
      email: "textbox",
      file: "button",
      image: "button",
      number: "spinbutton",
      radio: "radio",
      range: "slider",
      reset: "button",
      search: "searchbox",
      submit: "button",
      tel: "textbox",
      text: "textbox",
      url: "textbox",
    };
    return inputRoles[type || ""] || "textbox";
  }

  const roleOrFn = tagRoles[tag];
  if (typeof roleOrFn === "function") {
    return roleOrFn(element);
  }
  return roleOrFn || "generic";
}

function getResolvedRole(element: Element): string {
  const explicitRole = getExplicitRole(element);
  
  if (!explicitRole) {
    return getImplicitRole(element);
  }
  
  if ((explicitRole === "none" || explicitRole === "presentation") && isFocusable(element)) {
    return getImplicitRole(element);
  }
  
  return explicitRole;
}

if (!window.__piElementMap) window.__piElementMap = {};

let globalRefCounter = 0;

function getOrAssignRef(element: Element, role: string, name: string): string {
  const existing = (element as any)._piRef as { role: string; name: string; ref: string } | undefined;
  if (existing && existing.role === role && existing.name === name) {
    return existing.ref;
  }
  
  const ref = `e${++globalRefCounter}`;
  (element as any)._piRef = { role, name, ref };
  return ref;
}

function detectModalStates(): ModalState[] {
  const modals: ModalState[] = [];
  
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
  dialogs.forEach(dialog => {
    const style = window.getComputedStyle(dialog);
    const isVisible = style.display !== 'none' && 
                      style.visibility !== 'hidden' && 
                      style.opacity !== '0' &&
                      (dialog as HTMLElement).offsetWidth > 0 &&
                      (dialog as HTMLElement).offsetHeight > 0;
    if (!isVisible) return;
    
    const role = dialog.getAttribute('role') || 'dialog';
    let title = dialog.getAttribute('aria-label') || 
                dialog.querySelector('[role="heading"], h1, h2, h3')?.textContent?.trim() ||
                'Dialog';
    if (title.length > 100) title = title.substring(0, 100) + '...';
    modals.push({
      type: role as 'dialog' | 'alertdialog',
      description: `${role}: ${title}`,
      clearedBy: 'computer(action=key, text=Escape)',
    });
  });
  
  return modals;
}

const piHelpersImpl = {
  wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async waitForSelector(
      selector: string,
      options: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number } = {}
    ): Promise<Element | null> {
      const { state = 'visible', timeout = 20000 } = options;

      const isElementVisible = (el: Element | null): boolean => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               (el as HTMLElement).offsetWidth > 0 &&
               (el as HTMLElement).offsetHeight > 0;
      };

      const checkElement = (): Element | null => {
        const el = document.querySelector(selector);
        switch (state) {
          case 'attached':
            return el;
          case 'detached':
            return el ? null : document.body;
          case 'hidden':
            if (!el) return document.body;
            return isElementVisible(el) ? null : el;
          case 'visible':
          default:
            return isElementVisible(el) ? el : null;
        }
      };

      return new Promise((resolve, reject) => {
        const result = checkElement();
        if (result) {
          resolve(state === 'detached' || state === 'hidden' ? null : result);
          return;
        }

        const observer = new MutationObserver(() => {
          const result = checkElement();
          if (result) {
            observer.disconnect();
            clearTimeout(timeoutId);
            resolve(state === 'detached' || state === 'hidden' ? null : result);
          }
        });

        const timeoutId = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout waiting for "${selector}" to be ${state}`));
        }, timeout);

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden']
        });
      });
    },

    async waitForText(
      text: string,
      options: { selector?: string; timeout?: number } = {}
    ): Promise<Element | null> {
      const { selector, timeout = 20000 } = options;

      const checkText = (): Element | null => {
        const root = selector ? document.querySelector(selector) : document.body;
        if (!root) return null;
        
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.includes(text)) {
            return walker.currentNode.parentElement;
          }
        }
        return null;
      };

      return new Promise((resolve, reject) => {
        const result = checkText();
        if (result) {
          resolve(result);
          return;
        }

        const observer = new MutationObserver(() => {
          const result = checkText();
          if (result) {
            observer.disconnect();
            clearTimeout(timeoutId);
            resolve(result);
          }
        });

        const timeoutId = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout waiting for text "${text}"`));
        }, timeout);

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true
        });
      });
    },

    async waitForHidden(selector: string, timeout = 20000): Promise<void> {
      await piHelpersImpl.waitForSelector(selector, { state: 'hidden', timeout });
    },

    getByRole(role: string, options: { name?: string } = {}): Element | null {
      const { name } = options;
      
      const implicitRoles: Record<string, string[]> = {
        button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'],
        link: ['a[href]'],
        textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea'],
        checkbox: ['input[type="checkbox"]'],
        radio: ['input[type="radio"]'],
        combobox: ['select'],
        heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        list: ['ul', 'ol'],
        listitem: ['li'],
        navigation: ['nav'],
        main: ['main'],
        banner: ['header'],
        contentinfo: ['footer'],
        form: ['form'],
        img: ['img'],
        table: ['table'],
      };

      const candidates: Element[] = [];
      candidates.push(...document.querySelectorAll(`[role="${role}"]`));
      
      const implicitSelectors = implicitRoles[role];
      if (implicitSelectors) {
        for (const sel of implicitSelectors) {
          candidates.push(...document.querySelectorAll(`${sel}:not([role])`));
        }
      }

      if (!name) return candidates[0] || null;

      const normalizedName = name.toLowerCase().trim();
      for (const el of candidates) {
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase().trim();
        const textContent = el.textContent?.toLowerCase().trim();
        const title = el.getAttribute('title')?.toLowerCase().trim();
        const placeholder = el.getAttribute('placeholder')?.toLowerCase().trim();

        if (ariaLabel === normalizedName || textContent === normalizedName || 
            title === normalizedName || placeholder === normalizedName) {
          return el;
        }
        if (ariaLabel?.includes(normalizedName) || textContent?.includes(normalizedName)) {
          return el;
        }
      }

      return null;
    }
};

if (!window.__piHelpers) {
  window.__piHelpers = piHelpersImpl;
  window.piHelpers = piHelpersImpl;
}

function getElementMap() {
  return window.__piElementMap!;
}

function generateAccessibilityTree(
  filter: "all" | "interactive" = "interactive",
  maxDepth = 15,
  refId?: string,
  forceFullSnapshot = false,
  compact = false
): { 
  pageContent: string;
  diff?: string;
  viewport: { width: number; height: number }; 
  error?: string;
  modalStates?: ModalState[];
  modalLimitations?: string;
  isIncremental?: boolean;
} {
  try {
    window.__piRefs = {};

    function getRole(element: Element): string {
      return getResolvedRole(element);
    }

    function getName(element: Element): string {
      const tag = element.tagName.toLowerCase();

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const names = labelledBy.split(/\s+/).map(id => {
          const el = document.getElementById(id);
          return el?.textContent?.trim() || '';
        }).filter(Boolean);
        if (names.length) {
          const joined = names.join(' ');
          return joined.length > 100 ? joined.substring(0, 100) + '...' : joined;
        }
      }

      if (tag === "select") {
        const select = element as HTMLSelectElement;
        const selected = select.querySelector("option[selected]") || 
          (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
        if (selected?.textContent?.trim()) return selected.textContent.trim();
      }

      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel?.trim()) return ariaLabel.trim();

      const placeholder = element.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();

      const title = element.getAttribute("title");
      if (title?.trim()) return title.trim();

      const alt = element.getAttribute("alt");
      if (alt?.trim()) return alt.trim();

      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }

      if (tag === "input") {
        const input = element as HTMLInputElement;
        const type = element.getAttribute("type") || "";
        const value = element.getAttribute("value");
        if (type === "submit" && value?.trim()) return value.trim();
        if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
      }

      if (["button", "a", "summary"].includes(tag)) {
        const textContent = element.textContent || "";
        if (textContent.trim()) return textContent.trim();
      }

      if (/^h[1-6]$/.test(tag)) {
        const text = element.textContent;
        if (text?.trim()) {
          const t = text.trim();
          return t.length > 100 ? t.substring(0, 100) + "..." : t;
        }
      }

      if (tag === "img") return "";

      let directText = "";
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          directText += node.textContent;
        }
      }
      if (directText?.trim() && directText.trim().length >= 3) {
        const text = directText.trim();
        return text.length > 100 ? text.substring(0, 100) + "..." : text;
      }

      return "";
    }

    interface AriaProps {
      checked?: boolean | 'mixed';
      disabled?: boolean;
      expanded?: boolean;
      level?: number;
      pressed?: boolean | 'mixed';
      selected?: boolean;
      active?: boolean;
    }

    function getAriaProps(element: Element): AriaProps {
      const props: AriaProps = {};
      
      const checkedAttr = element.getAttribute('aria-checked');
      if (checkedAttr === 'true') props.checked = true;
      else if (checkedAttr === 'false') props.checked = false;
      else if (checkedAttr === 'mixed') props.checked = 'mixed';
      else if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        if (element.type === 'checkbox' && element.indeterminate) {
          props.checked = 'mixed';
        } else {
          props.checked = element.checked;
        }
      }
      
      const isDisableable = element instanceof HTMLButtonElement || 
                            element instanceof HTMLInputElement || 
                            element instanceof HTMLSelectElement || 
                            element instanceof HTMLTextAreaElement;
      if (element.getAttribute('aria-disabled') === 'true' || 
          (isDisableable && (element as HTMLButtonElement).disabled) ||
          element.closest('fieldset:disabled')) {
        props.disabled = true;
      }
      
      const expandedAttr = element.getAttribute('aria-expanded');
      if (expandedAttr === 'true') props.expanded = true;
      else if (expandedAttr === 'false') props.expanded = false;
      
      const pressedAttr = element.getAttribute('aria-pressed');
      if (pressedAttr === 'true') props.pressed = true;
      else if (pressedAttr === 'false') props.pressed = false;
      else if (pressedAttr === 'mixed') props.pressed = 'mixed';
      
      const selectedAttr = element.getAttribute('aria-selected');
      if (selectedAttr === 'true') props.selected = true;
      else if (selectedAttr === 'false') props.selected = false;
      
      const activeAttr = element.getAttribute('aria-current');
      if (activeAttr && activeAttr !== 'false') {
        props.active = true;
      }
      
      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        props.level = parseInt(tag[1], 10);
      } else {
        const levelAttr = element.getAttribute('aria-level');
        if (levelAttr) props.level = parseInt(levelAttr, 10);
      }
      
      return props;
    }

    function formatAriaProps(props: AriaProps): string {
      const parts: string[] = [];
      
      if (props.checked !== undefined) {
        parts.push(props.checked === 'mixed' ? '[checked=mixed]' : props.checked ? '[checked]' : '[unchecked]');
      }
      if (props.disabled) parts.push('[disabled]');
      if (props.expanded !== undefined) {
        parts.push(props.expanded ? '[expanded]' : '[collapsed]');
      }
      if (props.pressed !== undefined) {
        parts.push(props.pressed === 'mixed' ? '[pressed=mixed]' : props.pressed ? '[pressed]' : '[not-pressed]');
      }
      if (props.selected !== undefined) {
        parts.push(props.selected ? '[selected]' : '[not-selected]');
      }
      if (props.active) parts.push('[active]');
      if (props.level !== undefined) {
        parts.push(`[level=${props.level}]`);
      }
      
      return parts.join(' ');
    }

    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        (element as HTMLElement).offsetWidth > 0 &&
        (element as HTMLElement).offsetHeight > 0
      );
    }

    function isInteractive(element: Element): boolean {
      const tag = element.tagName.toLowerCase();
      return (
        ["a", "button", "input", "select", "textarea", "details", "summary"].includes(tag) ||
        element.hasAttribute("onclick") ||
        element.hasAttribute("tabindex") ||
        element.getAttribute("role") === "button" ||
        element.getAttribute("role") === "link" ||
        element.getAttribute("contenteditable") === "true"
      );
    }

    function isLandmark(element: Element): boolean {
      const tag = element.tagName.toLowerCase();
      return (
        ["h1", "h2", "h3", "h4", "h5", "h6", "nav", "main", "header", "footer", "section", "article", "aside"].includes(tag) ||
        element.hasAttribute("role")
      );
    }

    function hasCursorPointer(element: Element): boolean {
      const style = window.getComputedStyle(element);
      return style.cursor === "pointer";
    }

    function shouldInclude(element: Element, options: { filter: string; refId: string | null; compact: boolean }): boolean {
      const tag = element.tagName.toLowerCase();
      if (["script", "style", "meta", "link", "title", "noscript"].includes(tag)) return false;
      if (options.filter !== "all" && element.getAttribute("aria-hidden") === "true") return false;
      if (options.filter !== "all" && !isVisible(element)) return false;

      if (options.filter !== "all" && !options.refId) {
        const rect = element.getBoundingClientRect();
        if (!(rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0)) {
          return false;
        }
      }

      if (options.filter === "interactive") return isInteractive(element);
      if (isInteractive(element)) return true;
      if (isLandmark(element)) return true;
      if (getName(element).length > 0) return true;

      const role = getRole(element);
      
      // In compact mode, skip empty structural elements
      if (options.compact) {
        const emptyStructuralRoles = new Set(["generic", "group", "region", "article", "section", "complementary"]);
        if (emptyStructuralRoles.has(role) && getName(element).length === 0) {
          return false;
        }
      }
      
      return role !== "generic" && role !== "img";
    }

    function traverse(element: Element, depth: number): string[] {
      const lines: string[] = [];
      const options = { filter, refId: refId || null, compact };
      const elementMap = getElementMap();

      const include = shouldInclude(element, options) || (refId && depth === 0);

      if (include) {
        const role = getRole(element);
        const name = getName(element);
        const ariaProps = getAriaProps(element);

        const elemRefId = getOrAssignRef(element, role, name);
        window.__piRefs![elemRefId] = element;
        elementMap[elemRefId] = {
          element: new WeakRef(element),
          role,
          name,
        };

        const indent = "  ".repeat(depth);
        let line = `${indent}${role}`;
        if (name) {
          const escapedName = name.replace(/\s+/g, " ").replace(/"/g, '\\"');
          line += ` "${escapedName}"`;
        }
        line += ` [${elemRefId}]`;

        const propsStr = formatAriaProps(ariaProps);
        if (propsStr) line += ` ${propsStr}`;

        if (hasCursorPointer(element)) {
          line += " [cursor=pointer]";
        }

        const href = element.getAttribute("href");
        if (href) line += ` href="${href}"`;

        const type = element.getAttribute("type");
        if (type) line += ` type="${type}"`;

        const placeholder = element.getAttribute("placeholder");
        if (placeholder) line += ` placeholder="${placeholder}"`;

        lines.push(line);
      }

      if (depth < maxDepth) {
        for (const child of element.children) {
          lines.push(...traverse(child, include ? depth + 1 : depth));
        }
      }

      return lines;
    }

    function normalizeLineForDiff(line: string): string {
      return line.replace(/\[e\d+\]/g, '[REF]');
    }

    function countOccurrences(lines: string[]): Map<string, number> {
      const counts = new Map<string, number>();
      for (const line of lines) {
        if (!line.trim()) continue;
        const norm = normalizeLineForDiff(line);
        counts.set(norm, (counts.get(norm) || 0) + 1);
      }
      return counts;
    }

    function computeSimpleDiff(oldContent: string, newContent: string): { diff: string; hasChanges: boolean } {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      
      const oldCounts = countOccurrences(oldLines);
      const newCounts = countOccurrences(newLines);
      
      const added: string[] = [];
      const removed: string[] = [];
      
      for (const line of newLines) {
        if (!line.trim()) continue;
        const norm = normalizeLineForDiff(line);
        const oldCount = oldCounts.get(norm) || 0;
        const newCount = newCounts.get(norm) || 0;
        if (newCount > oldCount) {
          added.push(line);
          oldCounts.set(norm, oldCount + 1);
        }
      }
      
      const oldCountsReset = countOccurrences(oldLines);
      for (const line of oldLines) {
        if (!line.trim()) continue;
        const norm = normalizeLineForDiff(line);
        const oldCount = oldCountsReset.get(norm) || 0;
        const newCount = newCounts.get(norm) || 0;
        if (oldCount > newCount) {
          removed.push(line);
          oldCountsReset.set(norm, oldCount - 1);
        }
      }
      
      if (added.length === 0 && removed.length === 0) {
        return { diff: '[NO CHANGES]', hasChanges: false };
      }
      
      const diffLines: string[] = [];
      if (removed.length > 0) {
        diffLines.push(...removed.map(l => `- ${l}`));
      }
      if (added.length > 0) {
        diffLines.push(...added.map(l => `+ ${l}`));
      }
      
      return { diff: diffLines.join('\n'), hasChanges: true };
    }

    const elementMap = getElementMap();
    let startElement: Element | null = null;

    if (refId) {
      const elemRef = elementMap[refId];
      if (!elemRef) {
        return {
          error: `Element with ref_id '${refId}' not found. Use read_page without ref_id to get current elements.`,
          pageContent: "",
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      }
      const element = elemRef.element.deref();
      if (!element) {
        delete elementMap[refId];
        return {
          error: `Element with ref_id '${refId}' no longer exists. Use read_page without ref_id to get current elements.`,
          pageContent: "",
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      }
      startElement = element;
    } else {
      startElement = document.body;
    }

    const lines = startElement ? traverse(startElement, 0) : [];

    for (const id of Object.keys(elementMap)) {
      if (!elementMap[id].element.deref()) {
        delete elementMap[id];
      }
    }

    const content = lines.join("\n");

    if (content.length > 50000) {
      return {
        error: `Output exceeds 50000 character limit (${content.length} characters). Try using filter="interactive" or specify a ref_id.`,
        pageContent: "",
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    const modalStates = detectModalStates();

    let diff: string | undefined;
    let isIncremental = false;
    const lastSnapshot = window.__piLastSnapshot;

    if (!forceFullSnapshot && !refId && lastSnapshot && 
        Date.now() - lastSnapshot.timestamp < 5000) {
      const diffResult = computeSimpleDiff(lastSnapshot.content, content);
      diff = diffResult.diff;
      isIncremental = true;
    }

    window.__piLastSnapshot = { content, timestamp: Date.now() };

    return {
      pageContent: content + `\n\n[Viewport: ${window.innerWidth}x${window.innerHeight}]`,
      diff: isIncremental ? diff : undefined,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      modalStates: modalStates.length > 0 ? modalStates : undefined,
      modalLimitations: 'Only custom modals ([role=dialog]) detected. Native alert/confirm/prompt dialogs and system file choosers cannot be detected from content scripts.',
      isIncremental,
    };
  } catch (err) {
    return {
      error: `Error generating accessibility tree: ${err instanceof Error ? err.message : "Unknown error"}`,
      pageContent: "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }
}

function yamlEscapeValue(str: string): string {
  if (!str.length) return '""';
  if (/[\n\r]/.test(str) || /^[\s]/.test(str) || /[\s]$/.test(str) || /[:"{}[\]]/.test(str)) {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  }
  return str;
}

function generateYamlTree(
  filter: "all" | "interactive" = "interactive",
  maxDepth = 15
): { yaml: string; viewport: { width: number; height: number }; error?: string } {
  try {
    window.__piRefs = {};
    
    const lines: string[] = [];

    function getRole(element: Element): string {
      return getResolvedRole(element);
    }

    function getName(element: Element): string {
      const tag = element.tagName.toLowerCase();

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const names = labelledBy.split(/\s+/).map(id => {
          const el = document.getElementById(id);
          return el?.textContent?.trim() || '';
        }).filter(Boolean);
        if (names.length) {
          const joined = names.join(' ');
          return joined.length > 100 ? joined.substring(0, 100) + '...' : joined;
        }
      }

      if (tag === "select") {
        const select = element as HTMLSelectElement;
        const selected = select.querySelector("option[selected]") || 
          (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
        if (selected?.textContent?.trim()) return selected.textContent.trim();
      }

      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel?.trim()) return ariaLabel.trim();

      const placeholder = element.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();

      const title = element.getAttribute("title");
      if (title?.trim()) return title.trim();

      const alt = element.getAttribute("alt");
      if (alt?.trim()) return alt.trim();

      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }

      if (tag === "input") {
        const input = element as HTMLInputElement;
        const type = element.getAttribute("type") || "";
        const value = element.getAttribute("value");
        if (type === "submit" && value?.trim()) return value.trim();
        if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
      }

      if (["button", "a", "summary"].includes(tag)) {
        const textContent = element.textContent || "";
        if (textContent.trim()) return textContent.trim();
      }

      if (/^h[1-6]$/.test(tag)) {
        const text = element.textContent;
        if (text?.trim()) {
          const t = text.trim();
          return t.length > 100 ? t.substring(0, 100) + "..." : t;
        }
      }

      if (tag === "img") return "";

      let directText = "";
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          directText += node.textContent;
        }
      }
      if (directText?.trim() && directText.trim().length >= 3) {
        const text = directText.trim();
        return text.length > 100 ? text.substring(0, 100) + "..." : text;
      }

      return "";
    }

    interface AriaProps {
      checked?: boolean | 'mixed';
      disabled?: boolean;
      expanded?: boolean;
      level?: number;
      pressed?: boolean | 'mixed';
      selected?: boolean;
      active?: boolean;
    }

    function getAriaProps(element: Element): AriaProps {
      const props: AriaProps = {};
      
      const checkedAttr = element.getAttribute('aria-checked');
      if (checkedAttr === 'true') props.checked = true;
      else if (checkedAttr === 'false') props.checked = false;
      else if (checkedAttr === 'mixed') props.checked = 'mixed';
      else if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        if (element.type === 'checkbox' && element.indeterminate) {
          props.checked = 'mixed';
        } else {
          props.checked = element.checked;
        }
      }
      
      const isDisableable = element instanceof HTMLButtonElement || 
                            element instanceof HTMLInputElement || 
                            element instanceof HTMLSelectElement || 
                            element instanceof HTMLTextAreaElement;
      if (element.getAttribute('aria-disabled') === 'true' || 
          (isDisableable && (element as HTMLButtonElement).disabled) ||
          element.closest('fieldset:disabled')) {
        props.disabled = true;
      }
      
      const expandedAttr = element.getAttribute('aria-expanded');
      if (expandedAttr === 'true') props.expanded = true;
      else if (expandedAttr === 'false') props.expanded = false;
      
      const pressedAttr = element.getAttribute('aria-pressed');
      if (pressedAttr === 'true') props.pressed = true;
      else if (pressedAttr === 'false') props.pressed = false;
      else if (pressedAttr === 'mixed') props.pressed = 'mixed';
      
      const selectedAttr = element.getAttribute('aria-selected');
      if (selectedAttr === 'true') props.selected = true;
      else if (selectedAttr === 'false') props.selected = false;
      
      const activeAttr = element.getAttribute('aria-current');
      if (activeAttr && activeAttr !== 'false') {
        props.active = true;
      }
      
      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        props.level = parseInt(tag[1], 10);
      } else {
        const levelAttr = element.getAttribute('aria-level');
        if (levelAttr) props.level = parseInt(levelAttr, 10);
      }
      
      return props;
    }

    function formatAriaProps(props: AriaProps): string {
      const parts: string[] = [];
      
      if (props.checked !== undefined) {
        parts.push(props.checked === 'mixed' ? '[checked=mixed]' : props.checked ? '[checked]' : '[unchecked]');
      }
      if (props.disabled) parts.push('[disabled]');
      if (props.expanded !== undefined) {
        parts.push(props.expanded ? '[expanded]' : '[collapsed]');
      }
      if (props.pressed !== undefined) {
        parts.push(props.pressed === 'mixed' ? '[pressed=mixed]' : props.pressed ? '[pressed]' : '[not-pressed]');
      }
      if (props.selected !== undefined) {
        parts.push(props.selected ? '[selected]' : '[not-selected]');
      }
      if (props.active) parts.push('[active]');
      if (props.level !== undefined) {
        parts.push(`[level=${props.level}]`);
      }
      
      return parts.join(' ');
    }

    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        (element as HTMLElement).offsetWidth > 0 &&
        (element as HTMLElement).offsetHeight > 0
      );
    }

    function isInteractive(element: Element): boolean {
      const tag = element.tagName.toLowerCase();
      return (
        ["a", "button", "input", "select", "textarea", "details", "summary"].includes(tag) ||
        element.hasAttribute("onclick") ||
        element.hasAttribute("tabindex") ||
        element.getAttribute("role") === "button" ||
        element.getAttribute("role") === "link" ||
        element.getAttribute("contenteditable") === "true"
      );
    }

    function isLandmark(element: Element): boolean {
      const tag = element.tagName.toLowerCase();
      return (
        ["h1", "h2", "h3", "h4", "h5", "h6", "nav", "main", "header", "footer", "section", "article", "aside"].includes(tag) ||
        element.hasAttribute("role")
      );
    }

    function hasCursorPointer(element: Element): boolean {
      const style = window.getComputedStyle(element);
      return style.cursor === "pointer";
    }

    function buildKey(role: string, name: string, element: Element, ariaProps: AriaProps): string {
      let key = role;
      if (name) {
        key += ' ' + yamlEscapeValue(name);
      }
      
      const ref = getOrAssignRef(element, role, name);
      window.__piRefs![ref] = element;
      key += ` [ref=${ref}]`;
      
      const propsStr = formatAriaProps(ariaProps);
      if (propsStr) key += ` ${propsStr}`;
      
      if (hasCursorPointer(element)) {
        key += ' [cursor=pointer]';
      }
      
      return key;
    }

    function getElementProps(element: Element): Record<string, string> {
      const props: Record<string, string> = {};
      const href = element.getAttribute("href");
      if (href) props.url = href;
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) props.placeholder = placeholder;
      return props;
    }

    function traverse(element: Element, depth: number, parentIncluded: boolean): void {
      if (depth > maxDepth) return;
      
      const tag = element.tagName.toLowerCase();
      if (["script", "style", "meta", "link", "title", "noscript"].includes(tag)) return;
      if (filter !== "all" && element.getAttribute("aria-hidden") === "true") return;
      if (filter !== "all" && !isVisible(element)) return;
      
      if (filter !== "all") {
        const rect = element.getBoundingClientRect();
        if (!(rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0)) {
          return;
        }
      }
      
      const role = getRole(element);
      const name = getName(element);
      const ariaProps = getAriaProps(element);
      
      const isInteractiveEl = isInteractive(element);
      const isLandmarkEl = isLandmark(element);
      const hasName = name.length > 0;
      
      let include: boolean;
      if (filter === "interactive") {
        include = isInteractiveEl;
      } else if (filter === "all") {
        include = true;
      } else {
        include = isInteractiveEl || isLandmarkEl || hasName || (role !== "generic" && role !== "img");
      }
      
      if (include) {
        const indent = "  ".repeat(depth);
        const key = buildKey(role, name, element, ariaProps);
        const props = getElementProps(element);
        
        const children: Element[] = [];
        for (const child of element.children) {
          children.push(child);
        }
        
        const hasChildren = children.length > 0;
        const hasProps = Object.keys(props).length > 0;
        
        if (!hasChildren && !hasProps) {
          lines.push(`${indent}- ${key}`);
        } else {
          lines.push(`${indent}- ${key}:`);
          for (const [propName, propValue] of Object.entries(props)) {
            lines.push(`${indent}  - /${propName}: ${yamlEscapeValue(propValue)}`);
          }
          for (const child of children) {
            traverse(child, depth + 1, true);
          }
        }
      } else {
        for (const child of element.children) {
          traverse(child, depth, parentIncluded);
        }
      }
    }

    traverse(document.body, 0, false);

    const yaml = lines.join('\n');
    
    if (yaml.length > 50000) {
      return {
        error: `Output exceeds 50000 character limit (${yaml.length} characters). Try using filter="interactive".`,
        yaml: "",
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    return {
      yaml: yaml + `\n\n[Viewport: ${window.innerWidth}x${window.innerHeight}]`,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  } catch (err) {
    return {
      error: `Error generating YAML tree: ${err instanceof Error ? err.message : "Unknown error"}`,
      yaml: "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }
}

function getElementCoordinates(ref: string): { x: number; y: number; error?: string } {
  const elementMap = getElementMap();
  const elemRef = elementMap[ref];
  let element: Element | undefined;
  
  if (elemRef) {
    element = elemRef.element.deref();
    if (!element) {
      delete elementMap[ref];
    }
  }
  
  if (!element && window.__piRefs) {
    element = window.__piRefs[ref];
  }
  
  if (!element) {
    return { x: 0, y: 0, error: `Element ${ref} not found. Use read_page to get current elements.` };
  }

  const rect = element.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);

  return { x, y };
}

function setFormValue(ref: string, value: string | boolean | number): { success: boolean; error?: string } {
  const elementMap = getElementMap();
  const elemRef = elementMap[ref];
  let element: Element | undefined;
  
  if (elemRef) {
    element = elemRef.element.deref();
    if (!element) {
      delete elementMap[ref];
    }
  }
  
  if (!element && window.__piRefs) {
    element = window.__piRefs[ref];
  }
  
  if (!element) {
    return { success: false, error: `Element ${ref} not found. Use read_page to get current elements.` };
  }

  const tagName = element.tagName.toLowerCase();

  try {
    if (tagName === "input") {
      const input = element as HTMLInputElement;
      const type = input.type.toLowerCase();

      if (type === "checkbox" || type === "radio") {
        input.checked = Boolean(value);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (tagName === "textarea") {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = String(value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (tagName === "select") {
      const select = element as HTMLSelectElement;
      const strValue = String(value);

      let found = false;
      for (const option of select.options) {
        if (option.value === strValue || option.textContent?.trim() === strValue) {
          select.value = option.value;
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, error: `Option "${value}" not found in select element ${ref}` };
      }

      select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.getAttribute("contenteditable") === "true") {
      element.textContent = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      return { success: false, error: `Element ${ref} (${tagName}) is not a form field` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to set value: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

function getPageText(): { text: string; title: string; url: string; error?: string } {
  try {
    const article = document.querySelector("article");
    const main = document.querySelector("main");
    const content = article || main || document.body;

    const text = content.textContent
      ?.replace(/\s+/g, " ")
      .trim()
      .substring(0, 50000) || "";

    return {
      text,
      title: document.title,
      url: window.location.href,
    };
  } catch (err) {
    return {
      text: "",
      title: "",
      url: "",
      error: `Failed to extract text: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

function scrollToElement(ref: string): { success: boolean; error?: string } {
  const elementMap = getElementMap();
  const elemRef = elementMap[ref];
  let element: Element | undefined;
  
  if (elemRef) {
    element = elemRef.element.deref();
    if (!element) {
      delete elementMap[ref];
    }
  }
  
  if (!element && window.__piRefs) {
    element = window.__piRefs[ref];
  }
  
  if (!element) {
    return { success: false, error: `Element ${ref} not found. Run read_page to get current element refs.` };
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return { success: true };
}

function uploadImage(
  base64: string,
  ref?: string,
  coordinate?: [number, number],
  filename: string = "screenshot.png"
): { success: boolean; error?: string } {
  try {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: "image/png" });
    const file = new File([blob], filename, { type: "image/png" });

    let targetElement: HTMLElement | null = null;

    if (ref) {
      const elementMap = getElementMap();
      const elemRef = elementMap[ref];
      
      if (elemRef) {
        targetElement = elemRef.element.deref() as HTMLElement | null;
        if (!targetElement) {
          delete elementMap[ref];
        }
      }
      
      if (!targetElement && window.__piRefs) {
        targetElement = window.__piRefs[ref] as HTMLElement | null;
      }
      
      if (!targetElement) {
        return { success: false, error: `Element ${ref} not found. Run read_page to get current element refs.` };
      }
    } else if (coordinate) {
      targetElement = document.elementFromPoint(coordinate[0], coordinate[1]) as HTMLElement | null;
      if (!targetElement) {
        return { success: false, error: `No element at (${coordinate[0]}, ${coordinate[1]})` };
      }
    }

    if (!targetElement) {
      return { success: false, error: "No target element" };
    }

    if (targetElement.tagName === "INPUT" && (targetElement as HTMLInputElement).type === "file") {
      const input = targetElement as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });

    targetElement.dispatchEvent(dropEvent);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GENERATE_ACCESSIBILITY_TREE": {
      const options = message.options || {};
      
      if (options.format === "yaml") {
        const result = generateYamlTree(
          options.filter || "interactive",
          options.depth ?? 15
        );
        const modalStates = detectModalStates();
        if (result.error) {
          sendResponse({ error: result.error, pageContent: "", viewport: result.viewport });
        } else {
          sendResponse({ 
            pageContent: result.yaml, 
            viewport: result.viewport,
            modalStates: modalStates.length > 0 ? modalStates : undefined,
            modalLimitations: 'Only custom modals ([role=dialog]) detected. Native alert/confirm/prompt dialogs and system file choosers cannot be detected from content scripts.',
          });
        }
      } else {
        const result = generateAccessibilityTree(
          options.filter || "interactive",
          options.depth ?? 15,
          options.refId,
          options.forceFullSnapshot ?? false,
          options.compact ?? false
        );
        sendResponse(result);
      }
      break;
    }
    case "GET_ELEMENT_COORDINATES": {
      const result = getElementCoordinates(message.ref);
      sendResponse(result);
      break;
    }
    case "CLICK_ELEMENT": {
      const elementMap = getElementMap();
      const elemRef = elementMap[message.ref];
      let element: Element | undefined;
      if (elemRef) {
        element = elemRef.element.deref();
        if (!element) delete elementMap[message.ref];
      }
      if (!element && window.__piRefs) {
        element = window.__piRefs[message.ref];
      }
      if (!element) {
        sendResponse({ error: `Element ${message.ref} not found. Use read_page to get current elements.` });
        break;
      }
      if (message.button === "triple") {
        const tripleClick = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, detail: 3 });
        element.dispatchEvent(tripleClick);
      } else if (message.button === "double") {
        element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      } else if (message.button === "right") {
        element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window }));
      } else {
        (element as HTMLElement).click();
      }
      sendResponse({ success: true });
      break;
    }
    case "FORM_INPUT": {
      const result = setFormValue(message.ref, message.value);
      sendResponse(result);
      break;
    }
    case "EVAL_IN_PAGE": {
      try {
        const script = document.createElement('script');
        script.textContent = `(function() { ${message.code} })();`;
        document.documentElement.appendChild(script);
        script.remove();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "GET_PAGE_TEXT": {
      const result = getPageText();
      sendResponse(result);
      break;
    }
    case "GET_FRAME_BY_SELECTOR": {
      try {
        const iframe = document.querySelector(message.selector) as HTMLIFrameElement;
        if (!iframe || iframe.tagName.toLowerCase() !== 'iframe') {
          sendResponse({ error: `No iframe found with selector "${message.selector}"` });
          break;
        }
        // Return what info we can - the service worker will match by URL or name
        sendResponse({ 
          url: iframe.src,
          name: iframe.name || undefined,
        });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "GET_FRAME_NAME": {
      // Return this frame's name (for frame matching by name)
      try {
        sendResponse({ name: window.name || null });
      } catch (err) {
        sendResponse({ name: null });
      }
      break;
    }
    case "LOCATE_ROLE": {
      try {
        const { role, name, all } = message;
        const elementMap = getElementMap();
        
        // Mapping of role to possible selectors
        const implicitRoles: Record<string, string[]> = {
          button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
          link: ['a[href]', '[role="link"]'],
          textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
          checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
          radio: ['input[type="radio"]', '[role="radio"]'],
          combobox: ['select', '[role="combobox"]'],
          listbox: ['[role="listbox"]', 'select[multiple]'],
          option: ['option', '[role="option"]'],
          heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
          navigation: ['nav', '[role="navigation"]'],
          main: ['main', '[role="main"]'],
          img: ['img[alt]', '[role="img"]'],
          dialog: ['dialog', '[role="dialog"]', '[role="alertdialog"]'],
          tab: ['[role="tab"]'],
          tabpanel: ['[role="tabpanel"]'],
          menu: ['[role="menu"]'],
          menuitem: ['[role="menuitem"]'],
        };
        
        // Build selectors for the role
        const selectors = implicitRoles[role] || [`[role="${role}"]`];
        const candidates: Element[] = [];
        
        for (const sel of selectors) {
          try {
            candidates.push(...document.querySelectorAll(sel));
          } catch {}
        }
        
        // Filter by visibility
        const visible = candidates.filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 (el as HTMLElement).offsetWidth > 0 &&
                 (el as HTMLElement).offsetHeight > 0;
        });
        
        // Filter by name if provided
        let matches = visible;
        if (name) {
          const lowerName = name.toLowerCase();
          matches = visible.filter(el => {
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
            const text = el.textContent?.trim().toLowerCase();
            const title = el.getAttribute('title')?.toLowerCase();
            const placeholder = (el as HTMLInputElement).placeholder?.toLowerCase();
            const value = (el as HTMLInputElement).value?.toLowerCase();
            
            return ariaLabel?.includes(lowerName) || 
                   text?.includes(lowerName) || 
                   title?.includes(lowerName) ||
                   placeholder?.includes(lowerName) ||
                   value?.includes(lowerName);
          });
        }
        
        if (matches.length === 0) {
          sendResponse({ error: `No element found with role "${role}"${name ? ` and name "${name}"` : ''}` });
          break;
        }
        
        // Generate refs for matches
        const results = matches.map(el => {
          const ref = getOrAssignRef(el, role, name || '');
          window.__piRefs = window.__piRefs || {};
          window.__piRefs[ref] = el;
          elementMap[ref] = { element: new WeakRef(el), role, name: name || '' };
          return { ref, text: el.textContent?.trim().slice(0, 50) };
        });
        
        if (all) {
          sendResponse({ matches: results });
        } else {
          sendResponse({ ref: results[0].ref, text: results[0].text });
        }
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "LOCATE_TEXT": {
      try {
        const { text, exact } = message;
        const elementMap = getElementMap();
        
        // Find elements containing the text
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const matches: Element[] = [];
        
        while (walker.nextNode()) {
          const nodeText = walker.currentNode.textContent || '';
          const hasMatch = exact 
            ? nodeText.trim() === text 
            : nodeText.toLowerCase().includes(text.toLowerCase());
          
          if (hasMatch) {
            const parent = walker.currentNode.parentElement;
            if (parent && !matches.includes(parent)) {
              // Check visibility
              const style = window.getComputedStyle(parent);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                matches.push(parent);
              }
            }
          }
        }
        
        if (matches.length === 0) {
          sendResponse({ error: `No element found with text "${text}"` });
          break;
        }
        
        // Pick the most specific (smallest) element
        const el = matches.sort((a, b) => 
          (a.textContent?.length || 0) - (b.textContent?.length || 0)
        )[0];
        
        const role = getResolvedRole(el);
        const ref = getOrAssignRef(el, role, text);
        window.__piRefs = window.__piRefs || {};
        window.__piRefs[ref] = el;
        elementMap[ref] = { element: new WeakRef(el), role, name: text };
        
        sendResponse({ ref, text: el.textContent?.trim().slice(0, 50) });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "LOCATE_LABEL": {
      try {
        const { label } = message;
        const elementMap = getElementMap();
        
        // Find label element
        const labels = document.querySelectorAll('label');
        let input: Element | null = null;
        
        for (const lbl of labels) {
          const lblText = lbl.textContent?.trim().toLowerCase();
          if (lblText?.includes(label.toLowerCase())) {
            // Check for 'for' attribute
            const forId = lbl.getAttribute('for');
            if (forId) {
              input = document.getElementById(forId);
            }
            // Check for nested input
            if (!input) {
              input = lbl.querySelector('input, select, textarea');
            }
            if (input) break;
          }
        }
        
        // Also check aria-label and placeholder
        if (!input) {
          const lowerLabel = label.toLowerCase();
          input = document.querySelector(
            `input[aria-label*="${label}" i], input[placeholder*="${label}" i], ` +
            `textarea[aria-label*="${label}" i], textarea[placeholder*="${label}" i], ` +
            `select[aria-label*="${label}" i]`
          );
        }
        
        if (!input) {
          sendResponse({ error: `No form field found with label "${label}"` });
          break;
        }
        
        const role = getResolvedRole(input);
        const ref = getOrAssignRef(input, role, label);
        window.__piRefs = window.__piRefs || {};
        window.__piRefs[ref] = input;
        elementMap[ref] = { element: new WeakRef(input), role, name: label };
        
        sendResponse({ ref, label });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "GET_ELEMENT_STYLES": {
      try {
        const { selector } = message;
        const elementMap = getElementMap();
        
        // Helper to extract styles from an element
        const extractStyles = (el: Element) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el as HTMLElement).innerText?.trim().slice(0, 80) || null,
            box: {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
            styles: {
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              fontFamily: s.fontFamily.split(',')[0].trim().replace(/"/g, ''),
              color: s.color,
              backgroundColor: s.backgroundColor,
              borderRadius: s.borderRadius,
              border: s.border !== 'none' && s.borderWidth !== '0px' ? s.border : null,
              boxShadow: s.boxShadow !== 'none' ? s.boxShadow : null,
              padding: s.padding,
            },
          };
        };
        
        // Check if selector is a ref (e.g., "e5")
        if (/^e\d+$/.test(selector)) {
          const elemRef = elementMap[selector];
          let element: Element | undefined;
          if (elemRef) {
            element = elemRef.element.deref();
            if (!element) delete elementMap[selector];
          }
          if (!element && window.__piRefs) {
            element = window.__piRefs[selector];
          }
          
          if (!element) {
            sendResponse({ error: `Element ${selector} not found` });
            break;
          }
          
          sendResponse({ styles: [extractStyles(element)] });
        } else {
          // CSS selector - can match multiple elements
          const elements = document.querySelectorAll(selector);
          if (elements.length === 0) {
            sendResponse({ error: `No elements found matching "${selector}"` });
            break;
          }
          
          const styles = Array.from(elements).map(extractStyles);
          sendResponse({ styles });
        }
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "SELECT_OPTION": {
      try {
        const { selector, values, by } = message;
        const elementMap = getElementMap();
        
        // Find the select element
        let selectEl: HTMLSelectElement | null = null;
        
        if (/^e\d+$/.test(selector)) {
          const elemRef = elementMap[selector];
          let element: Element | undefined;
          if (elemRef) {
            element = elemRef.element.deref();
            if (!element) delete elementMap[selector];
          }
          if (!element && window.__piRefs) {
            element = window.__piRefs[selector];
          }
          
          if (!element) {
            sendResponse({ error: `Element ${selector} not found` });
            break;
          }
          if (element.tagName !== 'SELECT') {
            sendResponse({ error: `Element ${selector} is not a <select>` });
            break;
          }
          selectEl = element as HTMLSelectElement;
        } else {
          selectEl = document.querySelector(selector) as HTMLSelectElement;
          if (!selectEl) {
            sendResponse({ error: `No element found matching "${selector}"` });
            break;
          }
          if (selectEl.tagName !== 'SELECT') {
            sendResponse({ error: `Element "${selector}" is not a <select>` });
            break;
          }
        }
        
        // Clear current selection for multi-select
        if (selectEl.multiple) {
          for (const opt of selectEl.options) {
            opt.selected = false;
          }
        }
        
        const selected: string[] = [];
        const notFound: string[] = [];
        
        // For single-select, only use the first value
        const valuesToSelect = selectEl.multiple ? values : [values[0]];
        
        for (const val of valuesToSelect) {
          let found = false;
          
          for (const opt of selectEl.options) {
            let matches = false;
            
            if (by === 'index') {
              matches = opt.index === parseInt(val, 10);
            } else if (by === 'label') {
              matches = opt.text.toLowerCase().includes(val.toLowerCase());
            } else {
              // Default: match by value
              matches = opt.value === val;
            }
            
            if (matches) {
              opt.selected = true;
              selected.push(opt.value);
              found = true;
              break;  // Found match for this value, move to next
            }
          }
          
          if (!found) notFound.push(val);
        }
        
        // Dispatch change event
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        
        if (notFound.length > 0) {
          sendResponse({ 
            selected, 
            warning: `Values not found: ${notFound.join(', ')}` 
          });
        } else {
          sendResponse({ selected });
        }
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "GET_ELEMENT_TEXT": {
      try {
        const { ref } = message;
        const elementMap = getElementMap();
        const elemRef = elementMap[ref];
        
        let element: Element | undefined;
        if (elemRef) {
          element = elemRef.element.deref();
          if (!element) delete elementMap[ref];
        }
        if (!element && window.__piRefs) {
          element = window.__piRefs[ref];
        }
        
        if (!element) {
          sendResponse({ error: `Element ${ref} not found` });
          break;
        }
        
        sendResponse({ text: element.textContent?.trim() || '' });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "SCROLL_TO_ELEMENT": {
      const result = scrollToElement(message.ref);
      sendResponse(result);
      break;
    }
    case "UPLOAD_IMAGE": {
      const result = uploadImage(message.base64, message.ref, message.coordinate, message.filename);
      sendResponse(result);
      break;
    }
    case "WAIT_FOR_ELEMENT": {
      const { selector, state = 'visible', timeout = 20000 } = message;
      const maxTimeout = Math.min(timeout, 60000);

      const isElementVisible = (el: Element | null): boolean => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               (el as HTMLElement).offsetWidth > 0 &&
               (el as HTMLElement).offsetHeight > 0;
      };

      const checkElement = (): boolean => {
        const el = document.querySelector(selector);
        switch (state) {
          case 'attached': return !!el;
          case 'detached': return !el;
          case 'hidden': return !el || !isElementVisible(el);
          case 'visible':
          default: return isElementVisible(el);
        }
      };

      const startTime = Date.now();
      
      const waitForCondition = (): Promise<{ success: boolean; waited: number; error?: string }> => {
        return new Promise((resolve) => {
          if (checkElement()) {
            resolve({ success: true, waited: Date.now() - startTime });
            return;
          }

          const observer = new MutationObserver(() => {
            if (checkElement()) {
              observer.disconnect();
              clearTimeout(timeoutId);
              resolve({ success: true, waited: Date.now() - startTime });
            }
          });

          const timeoutId = setTimeout(() => {
            observer.disconnect();
            resolve({ 
              success: false, 
              waited: Date.now() - startTime,
              error: `Timeout waiting for "${selector}" to be ${state}` 
            });
          }, maxTimeout);

          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden', 'disabled']
          });
        });
      };

      waitForCondition().then((waitResult) => {
        if (!waitResult.success) {
          sendResponse({ 
            error: waitResult.error, 
            waited: waitResult.waited,
            pageContent: "", 
            viewport: { width: window.innerWidth, height: window.innerHeight } 
          });
          return;
        }
        const treeResult = generateAccessibilityTree("interactive", 15, undefined, true);
        sendResponse({ ...treeResult, waited: waitResult.waited });
      });
      return true;
    }
    case "WAIT_FOR_URL": {
      const { pattern, timeout = 20000 } = message;
      const maxTimeout = Math.min(timeout, 60000);

      const matchesPattern = (url: string): boolean => {
        if (pattern.includes('*')) {
          const regexPattern = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<GLOBSTAR>>>/g, '.*');
          return new RegExp(`^${regexPattern}$`).test(url);
        }
        return url.includes(pattern);
      };

      const startTime = Date.now();

      const waitForUrl = (): Promise<{ success: boolean; waited: number; error?: string }> => {
        return new Promise((resolve) => {
          if (matchesPattern(window.location.href)) {
            resolve({ success: true, waited: Date.now() - startTime });
            return;
          }

          let resolved = false;
          const checkUrl = () => {
            if (resolved) return;
            if (matchesPattern(window.location.href)) {
              resolved = true;
              clearInterval(intervalId);
              clearTimeout(timeoutId);
              window.removeEventListener('popstate', checkUrl);
              window.removeEventListener('hashchange', checkUrl);
              resolve({ success: true, waited: Date.now() - startTime });
            }
          };

          const intervalId = setInterval(checkUrl, 100);
          const timeoutId = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            clearInterval(intervalId);
            window.removeEventListener('popstate', checkUrl);
            window.removeEventListener('hashchange', checkUrl);
            resolve({ 
              success: false, 
              waited: Date.now() - startTime,
              error: `Timeout waiting for URL to match "${pattern}". Current: ${window.location.href}` 
            });
          }, maxTimeout);

          window.addEventListener('popstate', checkUrl);
          window.addEventListener('hashchange', checkUrl);
        });
      };

      waitForUrl().then((waitResult) => {
        if (!waitResult.success) {
          sendResponse({ 
            error: waitResult.error, 
            waited: waitResult.waited,
            pageContent: "", 
            viewport: { width: window.innerWidth, height: window.innerHeight } 
          });
          return;
        }
        const treeResult = generateAccessibilityTree("interactive", 15, undefined, true);
        sendResponse({ ...treeResult, waited: waitResult.waited });
      });
      return true;
    }
    case "WAIT_FOR_DOM_STABLE": {
      const { stable = 100, timeout = 5000 } = message;
      const maxTimeout = Math.min(timeout, 30000);
      const startTime = Date.now();

      const waitForStability = (): Promise<{ success: boolean; waited: number; error?: string }> => {
        return new Promise((resolve) => {
          let lastMutationTime = Date.now();
          let resolved = false;

          const checkStability = () => {
            if (resolved) return;
            const timeSinceLastMutation = Date.now() - lastMutationTime;
            if (timeSinceLastMutation >= stable) {
              resolved = true;
              observer.disconnect();
              clearTimeout(timeoutId);
              clearInterval(checkInterval);
              resolve({ success: true, waited: Date.now() - startTime });
            }
          };

          const observer = new MutationObserver(() => {
            lastMutationTime = Date.now();
          });

          const timeoutId = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(checkInterval);
            resolve({
              success: false,
              waited: Date.now() - startTime,
              error: `Timeout: DOM did not stabilize within ${maxTimeout}ms`
            });
          }, maxTimeout);

          const checkInterval = setInterval(checkStability, Math.max(10, Math.min(50, stable / 2)));

          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          checkStability();
        });
      };

      waitForStability().then((waitResult) => {
        if (!waitResult.success) {
          sendResponse({
            error: waitResult.error,
            waited: waitResult.waited,
            pageContent: "",
            viewport: { width: window.innerWidth, height: window.innerHeight }
          });
          return;
        }
        const treeResult = generateAccessibilityTree("interactive", 15, undefined, true);
        sendResponse({ ...treeResult, waited: waitResult.waited });
      });
      return true;
    }
    case "FORM_FILL": {
      const { data } = message;
      if (!Array.isArray(data)) {
        sendResponse({ error: "data must be an array of {ref, value} pairs" });
        return true;
      }
      const elementMap = getElementMap();
      const results: { ref: string; success: boolean; error?: string }[] = [];
      for (const item of data) {
        const { ref, value } = item;
        if (!ref) {
          results.push({ ref: ref || "unknown", success: false, error: "Missing ref" });
          continue;
        }
        const elemRef = elementMap[ref];
        if (!elemRef) {
          results.push({ ref, success: false, error: "Element not found (run page.read first)" });
          continue;
        }
        const el = elemRef.element.deref() as HTMLElement | null;
        if (!el) {
          delete elementMap[ref];
          results.push({ ref, success: false, error: "Element no longer exists" });
          continue;
        }
        try {
          if (el instanceof HTMLInputElement) {
            const inputType = el.type.toLowerCase();
            if (inputType === "checkbox" || inputType === "radio") {
              const shouldCheck = value === true || value === "true" || value === "1" || value === "checked";
              el.checked = shouldCheck;
              el.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              el.focus();
              el.value = String(value);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            results.push({ ref, success: true });
          } else if (el instanceof HTMLTextAreaElement) {
            el.focus();
            el.value = String(value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            results.push({ ref, success: true });
          } else if (el instanceof HTMLSelectElement) {
            el.value = String(value);
            el.dispatchEvent(new Event("change", { bubbles: true }));
            results.push({ ref, success: true });
          } else if (el.isContentEditable) {
            el.focus();
            el.textContent = String(value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            results.push({ ref, success: true });
          } else {
            results.push({ ref, success: false, error: "Element is not fillable" });
          }
        } catch (e) {
          results.push({ ref, success: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const failed = results.filter(r => !r.success);
      sendResponse({
        success: failed.length === 0,
        filled: results.filter(r => r.success).length,
        failed: failed.length,
        results,
      });
      return true;
    }
    case "GET_FILE_INPUT_SELECTOR": {
      const { ref } = message;
      if (!ref) {
        sendResponse({ error: "No ref provided" });
        return true;
      }
      const elementMap = getElementMap();
      const elemRef = elementMap[ref];
      if (!elemRef) {
        sendResponse({ error: "Element not found (run page.read first)" });
        return true;
      }
      const el = elemRef.element.deref() as HTMLElement | null;
      if (!el) {
        delete elementMap[ref];
        sendResponse({ error: "Element no longer exists" });
        return true;
      }
      if (!(el instanceof HTMLInputElement) || el.type !== "file") {
        sendResponse({ error: "Element is not a file input" });
        return true;
      }
      const uniqueId = `__pi_file_${Date.now()}`;
      el.setAttribute("data-pi-file-id", uniqueId);
      sendResponse({ selector: `[data-pi-file-id="${uniqueId}"]` });
      return true;
    }
    case "WAIT_FOR_NETWORK_IDLE": {
      const { timeout = 10000 } = message;
      const maxTimeout = Math.min(timeout, 60000);

      const adPatterns = [
        "doubleclick.net", "googlesyndication.com", "googletagmanager.com",
        "google-analytics.com", "facebook.net", "connect.facebook.net",
        "analytics", "ads", "tracking", "pixel", "hotjar.com", "clarity.ms",
        "mixpanel.com", "segment.com", "newrelic.com", "nr-data.net",
        "/tracker/", "/collector/", "/beacon/", "/telemetry/", "/log/",
        "/events/", "/track.", "/metrics/"
      ];

      const nonCriticalTypes = ["img", "image", "font", "icon"];

      const isAdOrTracking = (url: string): boolean => {
        return adPatterns.some(pattern => url.includes(pattern));
      };

      const isNonCritical = (entry: PerformanceResourceTiming): boolean => {
        const type = entry.initiatorType || "unknown";
        if (nonCriticalTypes.includes(type)) return true;
        if (/\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot)(\?|$)/i.test(entry.name)) return true;
        return false;
      };

      const getPendingRequests = (): PerformanceResourceTiming[] => {
        const now = performance.now();
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        return resources.filter(entry => {
          if (entry.responseEnd !== 0) return false;
          if (entry.name.startsWith("data:")) return false;
          if (entry.name.length > 500) return false;
          if (isAdOrTracking(entry.name)) return false;
          const loadingDuration = now - entry.startTime;
          if (loadingDuration > 10000) return false;
          if (isNonCritical(entry) && loadingDuration > 3000) return false;
          return true;
        });
      };

      const startTime = Date.now();

      const waitForIdle = (): Promise<{ success: boolean; waited: number; pendingCount?: number }> => {
        return new Promise((resolve) => {
          const check = () => {
            const pending = getPendingRequests();
            const elapsed = Date.now() - startTime;
            
            if (pending.length === 0) {
              resolve({ success: true, waited: elapsed });
              return;
            }
            
            if (elapsed >= maxTimeout) {
              resolve({ success: false, waited: elapsed, pendingCount: pending.length });
              return;
            }
            
            setTimeout(check, 100);
          };
          check();
        });
      };

      waitForIdle().then((waitResult) => {
        if (!waitResult.success) {
          sendResponse({ 
            error: `Network not idle after ${waitResult.waited}ms (${waitResult.pendingCount} requests pending)`,
            waited: waitResult.waited,
            pageContent: "", 
            viewport: { width: window.innerWidth, height: window.innerHeight } 
          });
          return;
        }
        const treeResult = generateAccessibilityTree("interactive", 15, undefined, true);
        sendResponse({ ...treeResult, waited: waitResult.waited });
      });
      return true;
    }
    case "SEARCH_PAGE": {
      const { term, caseSensitive, limit } = message;
      const matches = searchPageText(term, caseSensitive || false, limit || 10);
      sendResponse({ query: term, count: matches.length, matches });
      break;
    }
    case "GET_ELEMENT_BOUNDS_FOR_ANNOTATION": {
      const elementMap = getElementMap();
      const elements: Array<{ ref: string; tag: string; bounds: { x: number; y: number; width: number; height: number } }> = [];
      
      for (const [ref, entry] of Object.entries(elementMap)) {
        const el = entry.element.deref();
        if (!el) continue;
        
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        if (rect.right < 0 || rect.left > window.innerWidth) continue;
        
        elements.push({
          ref,
          tag: el.tagName.toLowerCase(),
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      }
      
      sendResponse({ elements });
      break;
    }
    default:
      return false;
  }
  return false;
});

function searchPageText(term: string, caseSensitive: boolean, limit: number) {
  const matches: Array<{
    ref: string;
    text: string;
    context: string;
    bounds: { x: number; y: number; width: number; height: number };
    elementRef: string | null;
  }> = [];
  
  const searchTerm = caseSensitive ? term : term.toLowerCase();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const elementMap = getElementMap();
  let matchIndex = 0;
  
  while (walker.nextNode() && matches.length < limit) {
    const node = walker.currentNode;
    const textContent = node.textContent || "";
    const searchIn = caseSensitive ? textContent : textContent.toLowerCase();
    
    let pos = 0;
    while ((pos = searchIn.indexOf(searchTerm, pos)) !== -1 && matches.length < limit) {
      const parent = node.parentElement;
      if (!parent) { pos++; continue; }
      
      const range = document.createRange();
      range.setStart(node, pos);
      range.setEnd(node, Math.min(pos + term.length, textContent.length));
      const rect = range.getBoundingClientRect();
      
      if (rect.width === 0 || rect.height === 0) { pos++; continue; }
      
      const fullText = node.textContent || "";
      const contextStart = Math.max(0, pos - 30);
      const contextEnd = Math.min(fullText.length, pos + term.length + 30);
      const context = fullText.slice(contextStart, contextEnd).trim();
      
      let elementRef: string | null = null;
      for (const [ref, entry] of Object.entries(elementMap)) {
        const el = entry.element.deref();
        if (el && (el === parent || el.contains(parent))) {
          elementRef = ref;
          break;
        }
      }
      
      matches.push({
        ref: `m${++matchIndex}`,
        text: fullText.slice(pos, pos + term.length),
        context,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        elementRef,
      });
      
      pos++;
    }
  }
  
  return matches;
}
