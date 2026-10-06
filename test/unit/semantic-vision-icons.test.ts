import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { semanticVisionIconSource } from "../../src/content/semantic-vision-icons";

type Fake = {
  localName: string;
  namespaceURI: string;
  type?: string;
  childNodes: Array<{ nodeType: number; textContent: string }>;
  styles: Record<string, Record<string, string>>;
  size: number;
  children: Fake[];
};

function element(
  localName: string,
  options: {
    text?: string;
    styles?: Fake["styles"];
    children?: Fake[];
    type?: string;
    size?: number;
    svg?: boolean;
  } = {},
): Fake {
  return {
    localName,
    namespaceURI: options.svg ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
    type: options.type,
    childNodes: options.text ? [{ nodeType: 3, textContent: options.text }] : [],
    styles: options.styles ?? {},
    size: options.size ?? 24,
    children: options.children ?? [],
  };
}

const descendants = (node: Fake): Fake[] =>
  node.children.flatMap((child) => [child, ...descendants(child)]);

function control(...children: Fake[]): Element {
  return asElement(element("button", { children }));
}

function asElement(node: Fake): Element {
  return {
    ...node,
    __fake: node,
    querySelectorAll: () => descendants(node).map(asElement),
    getBoundingClientRect: () => ({ width: node.size, height: node.size }),
    checkVisibility: () => true,
  } as unknown as Element;
}

const fakeOf = (value: Element | undefined) =>
  (value as unknown as { __fake: Fake } | undefined)?.__fake;

beforeEach(() => {
  vi.stubGlobal("getComputedStyle", (target: Element, pseudo?: string | null) => {
    const values = fakeOf(target)?.styles[pseudo ?? ""] ?? {};
    const style = { content: "none", backgroundImage: "none", ...values };
    return {
      ...style,
      getPropertyValue: (name: string) => (style as Record<string, string>)[name] ?? "",
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("semantic vision icon source", () => {
  const svg = element("svg", { svg: true });
  const img = element("img");
  const glyph = element("span", { text: "home" });
  const mask = element("span", {
    styles: { "": { "mask-image": 'url("https://example.test/m.svg")' } },
  });
  const background = element("span", {
    styles: { "": { backgroundImage: 'url("https://example.test/b.png")' } },
  });

  it("takes the first kind that applies: svg, image, glyph, mask, then background", () => {
    const ordered = [svg, img, glyph, mask, background];
    for (let index = 0; index < ordered.length; index++) {
      // Later-priority sources come first in the DOM, so document order can't decide.
      const source = semanticVisionIconSource(control(...ordered.slice(index).reverse()));
      expect(fakeOf(source?.element)).toBe(ordered[index]);
      expect(source?.kind).toBe(["svg", "image", "glyph", "mask", "background"][index]);
    }
  });

  it("treats picture and image inputs as images, and reads glyphs from own text, ::before or ::after", () => {
    const picture = element("picture", { children: [img] });
    expect(fakeOf(semanticVisionIconSource(control(picture))?.element)).toBe(img);
    const input = element("input", { type: "image" });
    expect(semanticVisionIconSource(asElement(input))).toMatchObject({ kind: "image" });

    expect(semanticVisionIconSource(control(glyph))).toMatchObject({
      kind: "glyph",
      pseudo: null,
      text: "home",
    });
    const icon = String.fromCodePoint(0xf007);
    const before = element("i", { styles: { "::before": { content: `"${icon}"` } } });
    expect(semanticVisionIconSource(control(before))).toMatchObject({
      kind: "glyph",
      pseudo: "::before",
      text: icon,
    });
    const after = element("i", {
      styles: { "::before": { content: '""' }, "::after": { content: '"\\"x"' } },
    });
    expect(semanticVisionIconSource(control(after))).toMatchObject({
      kind: "glyph",
      pseudo: "::after",
      text: '"x',
    });
  });

  it("ignores elements that aren't rendered and returns null when nothing applies", () => {
    expect(
      semanticVisionIconSource(control(element("svg", { svg: true, size: 0 }), img)),
    ).toMatchObject({ kind: "image" });
    expect(semanticVisionIconSource(control(element("svg")))).toBeNull();
    const contentUrl = element("i", {
      styles: { "::before": { content: 'url("https://example.test/a.png")' } },
    });
    expect(semanticVisionIconSource(control(element("canvas"), contentUrl))).toBeNull();
  });
});
