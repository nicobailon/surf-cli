export {};

declare global {
  interface Window {
    __piElementMap?: Record<string, { element: WeakRef<Element>; role: string; name: string }>;
    __piRefCounter?: number;
    __piSnapshotCounter?: number;
    __piLastSnapshot?: { content: string; timestamp: number };
  }
}

interface ModalState {
  type: 'dialog' | 'alertdialog';
  description: string;
  clearedBy: string;
}

if (!window.__piElementMap) window.__piElementMap = {};
if (!window.__piRefCounter) window.__piRefCounter = 0;
if (!window.__piSnapshotCounter) window.__piSnapshotCounter = 0;

function getElementMap() {
  return window.__piElementMap!;
}

function getNextRefId(): string {
  const snapshot = window.__piSnapshotCounter || 0;
  return `s${snapshot}_ref_${++window.__piRefCounter!}`;
}

function generateAccessibilityTree(
  filter: "all" | "interactive" = "interactive",
  maxDepth = 15,
  refId?: string,
  forceFullSnapshot = false
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
    window.__piSnapshotCounter = (window.__piSnapshotCounter || 0) + 1;

    function getRole(element: Element): string {
      const role = element.getAttribute("role");
      if (role) return role;

      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute("type");

      const tagRoles: Record<string, string> = {
        a: "link",
        button: "button",
        select: "combobox",
        textarea: "textbox",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        h4: "heading",
        h5: "heading",
        h6: "heading",
        img: "image",
        nav: "navigation",
        main: "main",
        header: "banner",
        footer: "contentinfo",
        section: "region",
        article: "article",
        aside: "complementary",
        form: "form",
        table: "table",
        ul: "list",
        ol: "list",
        li: "listitem",
        label: "label",
      };

      if (tag === "input") {
        const inputRoles: Record<string, string> = {
          submit: "button",
          button: "button",
          checkbox: "checkbox",
          radio: "radio",
          file: "button",
        };
        return inputRoles[type || ""] || "textbox";
      }

      return tagRoles[tag] || "generic";
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
        let textContent = "";
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            textContent += node.textContent;
          }
        }
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

    function shouldInclude(element: Element, options: { filter: string; refId: string | null }): boolean {
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
      return role !== "generic" && role !== "image";
    }

    function traverse(element: Element, depth: number): string[] {
      const lines: string[] = [];
      const options = { filter, refId: refId || null };
      const elementMap = getElementMap();

      const include = shouldInclude(element, options) || (refId && depth === 0);

      if (include) {
        const role = getRole(element);
        const name = getName(element);
        const ariaProps = getAriaProps(element);

        let elemRefId: string | null = null;
        for (const id of Object.keys(elementMap)) {
          if (elementMap[id].element.deref() === element) {
            elemRefId = id;
            break;
          }
        }
        if (!elemRefId) {
          elemRefId = getNextRefId();
          elementMap[elemRefId] = {
            element: new WeakRef(element),
            role,
            name,
          };
        }

        const indent = "  ".repeat(depth);
        let line = `${indent}${role}`;
        if (name) {
          const escapedName = name.replace(/\s+/g, " ").replace(/"/g, '\\"');
          line += ` "${escapedName}"`;
        }
        line += ` [${elemRefId}]`;

        const propsStr = formatAriaProps(ariaProps);
        if (propsStr) line += ` ${propsStr}`;

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
      return line.replace(/\[(s\d+_)?ref_\d+\]/g, '[REF]');
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

    function detectModalStates(): ModalState[] {
      const modals: ModalState[] = [];
      
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
      dialogs.forEach(dialog => {
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

function getElementCoordinates(ref: string): { x: number; y: number; error?: string } {
  const elementMap = getElementMap();
  const elemRef = elementMap[ref];
  if (!elemRef) {
    return { x: 0, y: 0, error: `Element ${ref} not found. Use read_page to get current elements.` };
  }

  const element = elemRef.element.deref();
  if (!element) {
    delete elementMap[ref];
    return { x: 0, y: 0, error: `Element ${ref} no longer exists. Use read_page to get current elements.` };
  }

  const rect = element.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);

  return { x, y };
}

function setFormValue(ref: string, value: string | boolean | number): { success: boolean; error?: string } {
  const elementMap = getElementMap();
  const elemRef = elementMap[ref];
  if (!elemRef) {
    return { success: false, error: `Element ${ref} not found. Use read_page to get current elements.` };
  }

  const element = elemRef.element.deref();
  if (!element) {
    delete elementMap[ref];
    return { success: false, error: `Element ${ref} no longer exists. Use read_page to get current elements.` };
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
  if (!elemRef) {
    return { success: false, error: `Element ${ref} not found` };
  }

  const element = elemRef.element.deref();
  if (!element) {
    delete elementMap[ref];
    return { success: false, error: `Element ${ref} no longer exists` };
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
      if (!elemRef) {
        return { success: false, error: `Element ${ref} not found` };
      }
      targetElement = elemRef.element.deref() as HTMLElement | null;
      if (!targetElement) {
        return { success: false, error: `Element ${ref} no longer exists` };
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
      const result = generateAccessibilityTree(
        options.filter || "interactive",
        options.depth ?? 15,
        options.refId,
        options.forceFullSnapshot ?? false
      );
      sendResponse(result);
      break;
    }
    case "GET_ELEMENT_COORDINATES": {
      const result = getElementCoordinates(message.ref);
      sendResponse(result);
      break;
    }
    case "FORM_INPUT": {
      const result = setFormValue(message.ref, message.value);
      sendResponse(result);
      break;
    }
    case "GET_PAGE_TEXT": {
      const result = getPageText();
      sendResponse(result);
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
    default:
      return false;
  }
  return false;
});
