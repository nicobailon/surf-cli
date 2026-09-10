import { describe, expect, it } from "vitest";
import {
  buildFrameDiagnosis,
  type CdpFrameEntry,
  type DomIframeEntry,
  type ExtensionFrameEntry,
  isBlankFrameUrl,
  originOf,
  sandboxBlocksScripts,
} from "../../src/utils/frame-diagnose";

const MAIN = "https://app.example.com/page";

function iframe(overrides: Partial<DomIframeEntry> = {}): DomIframeEntry {
  return {
    domIndex: 0,
    src: "https://widgets.example.net/embed",
    srcdoc: false,
    title: "",
    name: "",
    id: "",
    sandbox: null,
    allow: "",
    rect: { x: 0, y: 0, width: 300, height: 200 },
    ...overrides,
  };
}

function extFrame(overrides: Partial<ExtensionFrameEntry> = {}): ExtensionFrameEntry {
  return {
    frameId: 7,
    parentFrameId: 0,
    url: "https://widgets.example.net/embed",
    errorOccurred: false,
    contentScriptReachable: true,
    contentScript: { href: "https://widgets.example.net/embed", readyState: "complete" },
    ...overrides,
  };
}

const mainExt: ExtensionFrameEntry = {
  frameId: 0,
  parentFrameId: -1,
  url: MAIN,
  errorOccurred: false,
  contentScriptReachable: true,
};

function cdpFrame(overrides: Partial<CdpFrameEntry> = {}): CdpFrameEntry {
  return {
    frameId: "F2",
    parentId: "F1",
    url: "https://widgets.example.net/embed",
    name: "",
    ...overrides,
  };
}

const mainCdp: CdpFrameEntry = { frameId: "F1", url: MAIN, name: "" };

describe("helpers", () => {
  it("computes origins and blank URLs", () => {
    expect(originOf("https://a.example.com/x?y")).toBe("https://a.example.com");
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(isBlankFrameUrl("")).toBe(true);
    expect(isBlankFrameUrl("about:blank?x")).toBe(true);
    expect(isBlankFrameUrl("about:srcdoc")).toBe(true);
    expect(isBlankFrameUrl("https://a/")).toBe(false);
  });

  it("knows when a sandbox blocks scripts", () => {
    expect(sandboxBlocksScripts(null)).toBe(false);
    expect(sandboxBlocksScripts("")).toBe(true);
    expect(sandboxBlocksScripts("allow-forms")).toBe(true);
    expect(sandboxBlocksScripts("allow-forms allow-scripts")).toBe(false);
  });
});

describe("buildFrameDiagnosis", () => {
  it("correlates a healthy cross-origin iframe across all three inventories", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe()],
      extensionFrames: [mainExt, extFrame()],
      cdpFrames: [mainCdp, cdpFrame()],
    });

    expect(result.mainPage.origin).toBe("https://app.example.com");
    expect(result.counts).toEqual({ domIframes: 1, extensionFrames: 2, cdpFrames: 2 });
    expect(result.domIframes[0]).toMatchObject({
      crossOrigin: true,
      blank: false,
      zeroSize: false,
      scriptsBlocked: false,
      extensionFrameIds: [7],
      cdpFrameIds: ["F2"],
    });
    expect(result.extensionFrames[0].isMain).toBe(true);
    expect(result.extensionFrames[0].switchIndex).toBeNull();
    expect(result.extensionFrames[1].switchIndex).toBe(0);
    expect(result.extensionFrames[1].crossOrigin).toBe(true);
    expect(result.cdpFrames[1].extensionFrameIds).toEqual([7]);
    expect(result.warnings).toEqual([
      "1 cross-origin iframe(s): selectors from the main page do not reach them; switch with frame.switch first.",
    ]);
  });

  it("returns no warnings for a page without frames", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [],
      extensionFrames: [mainExt],
      cdpFrames: [mainCdp],
    });
    expect(result.warnings).toEqual([]);
  });

  it("explains blank and srcdoc iframes and points at the CDP ids", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe({ src: "", srcdoc: true }), iframe({ domIndex: 1, src: "about:blank" })],
      extensionFrames: [
        mainExt,
        extFrame({ frameId: 3, url: "about:blank" }),
        extFrame({ frameId: 4, url: "about:srcdoc" }),
      ],
      cdpFrames: [mainCdp, cdpFrame({ frameId: "F3", url: "about:blank" })],
    });

    expect(result.domIframes.map((entry) => entry.blank)).toEqual([true, true]);
    expect(result.domIframes[0].extensionFrameIds).toEqual([]);
    expect(result.warnings[0]).toContain(
      "2 iframe(s) have no URL (about:blank or srcdoc): DOM indexes 0, 1",
    );
    expect(result.warnings.some((line) => line.includes("has no matching extension frame"))).toBe(
      false,
    );
  });

  it("flags unreachable content scripts, navigation errors and CDP-only frames", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe({ src: "https://app.example.com/inner" })],
      extensionFrames: [
        mainExt,
        extFrame({
          frameId: 5,
          url: "https://app.example.com/inner",
          contentScriptReachable: false,
          contentScriptError: "Could not establish connection",
          errorOccurred: true,
        }),
      ],
      cdpFrames: [
        mainCdp,
        cdpFrame({ frameId: "F5", url: "https://app.example.com/inner" }),
        cdpFrame({ frameId: "F9", url: "https://oop.example.org/" }),
      ],
    });

    expect(result.domIframes[0].crossOrigin).toBe(false);
    expect(result.warnings).toEqual([
      "extension frame 5 (https://app.example.com/inner) has no reachable content script (Could not establish connection): page.read, click by ref and frame.switch will not work inside it; frame.js with its CDP frame id may.",
      "extension frame 5 (https://app.example.com/inner) reported a navigation error.",
      "CDP frame F9 (https://oop.example.org/) is not reported by chrome.webNavigation: likely out-of-process or detached; only frame.js can reach it.",
    ]);
  });

  it("flags sandboxes without allow-scripts, zero-size frames and ambiguous URL matches", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [
        iframe({ sandbox: "allow-forms", rect: { x: 0, y: 0, width: 0, height: 0 } }),
        iframe({ domIndex: 1 }),
      ],
      extensionFrames: [mainExt, extFrame({ frameId: 7 }), extFrame({ frameId: 8 })],
      cdpFrames: [mainCdp],
    });

    expect(result.domIframes[0]).toMatchObject({
      scriptsBlocked: true,
      zeroSize: true,
      extensionFrameIds: [7, 8],
    });
    expect(result.warnings.some((line) => line.includes("sandboxed without allow-scripts"))).toBe(
      true,
    );
    expect(result.warnings.some((line) => line.includes("rendered at 0x0"))).toBe(true);
    expect(
      result.warnings.filter((line) => line.includes("matches 2 extension frames by URL (7, 8)")),
    ).toHaveLength(2);
  });

  it("reports repeated CDP URLs as ambiguous", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe()],
      extensionFrames: [mainExt, extFrame()],
      cdpFrames: [mainCdp, cdpFrame({ frameId: "F2" }), cdpFrame({ frameId: "F3" })],
    });

    expect(result.domIframes[0].cdpFrameIds).toEqual(["F2", "F3"]);
    expect(result.warnings).toContain(
      "iframe 0 (https://widgets.example.net/embed) matches 2 CDP frames (F2, F3); correlation is ambiguous, so frame.js requires an explicit CDP frame id.",
    );
  });

  it("correlates by URL when DOM and webNavigation ordering differ", () => {
    const firstUrl = "https://app.example.com/first";
    const secondUrl = "https://app.example.com/second";
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe({ src: firstUrl }), iframe({ domIndex: 1, src: secondUrl })],
      extensionFrames: [
        mainExt,
        extFrame({ frameId: 8, url: secondUrl }),
        extFrame({ frameId: 7, url: firstUrl }),
      ],
      cdpFrames: [
        mainCdp,
        cdpFrame({ frameId: "F2", url: firstUrl }),
        cdpFrame({ frameId: "F3", url: secondUrl }),
      ],
    });

    expect(result.domIframes.map((entry) => entry.extensionFrameIds)).toEqual([[7], [8]]);
    expect(result.extensionFrames.map((entry) => entry.switchIndex)).toEqual([null, 0, 1]);
  });

  it("reports DOM iframes the extension does not list and count mismatches", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [iframe({ src: "https://late.example.com/" })],
      extensionFrames: [mainExt],
      cdpFrames: [mainCdp],
    });
    expect(result.warnings).toEqual([
      "iframe 0 (https://late.example.com/) has no matching extension frame: it may still be loading, be blocked, or have navigated elsewhere.",
      "1 cross-origin iframe(s): selectors from the main page do not reach them; switch with frame.switch first.",
      "DOM lists 1 iframe(s) but the extension sees 0 child frame(s); the rest live in closed shadow roots, were created after the snapshot, or are detached.",
    ]);
  });

  it("matches srcdoc and about:blank iframes to CDP frames by name or id", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [
        iframe({ src: "", srcdoc: true, id: "inline" }),
        iframe({ domIndex: 1, src: "about:blank", name: "hidden" }),
        iframe({ domIndex: 2, src: "about:blank" }),
      ],
      extensionFrames: [
        mainExt,
        extFrame({ frameId: 3, url: "about:srcdoc" }),
        extFrame({ frameId: 4, url: "about:blank" }),
      ],
      cdpFrames: [
        mainCdp,
        cdpFrame({ frameId: "F3", url: "about:srcdoc", name: "inline" }),
        cdpFrame({ frameId: "F4", url: "about:blank", name: "hidden" }),
      ],
    });
    expect(result.domIframes.map((entry) => entry.cdpFrameIds)).toEqual([["F3"], ["F4"], []]);
    expect(result.warnings[0]).toBe(
      "1 iframe(s) have no URL (about:blank or srcdoc): DOM indexes 2. No CDP frame carries their name or id, so their content cannot be matched; give them a name or id attribute. To try frame.switch --index, use the switch index shown in the extension inventory, not these DOM indexes.",
    );
  });

  it("explains out-of-process iframes that the CDP frame tree does not list", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [
        iframe({ src: "https://www.youtube.com/embed/x" }),
        iframe({ domIndex: 1, src: "https://example.org/", sandbox: "" }),
      ],
      extensionFrames: [
        mainExt,
        extFrame({ frameId: 54, url: "https://www.youtube.com/embed/x" }),
        extFrame({
          frameId: 57,
          url: "https://example.org/",
          contentScriptReachable: false,
          contentScriptError: "Receiving end does not exist.",
        }),
      ],
      cdpFrames: [mainCdp],
    });
    expect(result.domIframes.map((entry) => entry.cdpFrameIds)).toEqual([[], []]);
    expect(result.warnings).toContain(
      "iframe 0 (https://www.youtube.com/embed/x) is out-of-process: it is missing from this tab's CDP frame tree, so frame.js cannot reach it; its content script answers, so frame.switch, page.read and click by ref work there.",
    );
    expect(result.warnings).toContain(
      "iframe 1 (https://example.org/) is out-of-process: it is missing from this tab's CDP frame tree, so frame.js cannot reach it; its content script is unreachable too, so nothing in this tab can drive it.",
    );
    expect(result.warnings.some((line) => line.includes("DOM lists"))).toBe(false);
  });

  it("reports shadow-hosted iframes and nested frames in the count mismatch", () => {
    const result = buildFrameDiagnosis({
      mainPage: { href: MAIN, title: "Page" },
      domIframes: [
        iframe({ src: "https://app.example.com/inner", shadowHost: "div#host > x-widget" }),
      ],
      extensionFrames: [
        mainExt,
        extFrame({ frameId: 5, url: "https://app.example.com/inner" }),
        extFrame({ frameId: 6, parentFrameId: 5, url: "https://app.example.com/inner/nested" }),
      ],
      cdpFrames: [
        mainCdp,
        cdpFrame({ frameId: "F5", url: "https://app.example.com/inner" }),
        cdpFrame({ frameId: "F6", parentId: "F5", url: "https://app.example.com/inner/nested" }),
      ],
    });
    expect(result.domIframes[0].shadowHost).toBe("div#host > x-widget");
    expect(result.warnings).toEqual([
      "DOM lists 1 iframe(s) (1 inside open shadow roots) but the extension sees 2 child frame(s), 1 of them nested below another frame; the nested frames account for the difference.",
    ]);
  });
});
