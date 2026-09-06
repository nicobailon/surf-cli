import { describe, expect, it } from "vitest";
import {
  collectReadinessSnapshot,
  probePageReadiness,
  type ReadinessProbeDom,
} from "../../src/content/page-readiness-probe";
import { classifyReadiness, type ReadinessSnapshot } from "../../src/utils/page-readiness";
import { parseAcceptStates, readinessErrorCode } from "../../src/utils/readiness-poll";

function snapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  const body =
    overrides.bodyTextSample ??
    "Welcome to the dashboard. Here are your projects and recent activity across the workspace.";
  return {
    href: "https://app.example.com/projects",
    title: "Projects - Example",
    readyState: "complete",
    bodyTextSample: body,
    bodyTextLength: body.length,
    headings: ["Projects"],
    visiblePasswordInputs: 0,
    visibleTextInputs: 1,
    challengeMarkers: [],
    captchaFrames: 0,
    ...overrides,
  };
}

describe("classifyReadiness", () => {
  it("reports ready for a loaded page without expectations", () => {
    const verdict = classifyReadiness(snapshot());
    expect(verdict.state).toBe("ready");
    expect(verdict.evidence).toEqual(["document.readyState is complete"]);
  });

  it("reports loading while the document is still parsing", () => {
    const verdict = classifyReadiness(
      snapshot({ readyState: "interactive", tabStatus: "loading" }),
    );
    expect(verdict.state).toBe("loading");
    expect(verdict.evidence).toEqual([
      "document.readyState is interactive",
      "tab status is loading",
    ]);
  });

  it("treats a blank URL as loading", () => {
    expect(classifyReadiness(snapshot({ href: "about:blank" })).state).toBe("loading");
    expect(classifyReadiness(snapshot({ href: "" })).state).toBe("loading");
  });

  it("accepts about:blank when that is the expected prefix", () => {
    const verdict = classifyReadiness(
      snapshot({ href: "about:blank", urlPrefix: { expected: "about:blank", matched: true } }),
    );
    expect(verdict.state).toBe("ready");
  });

  it("detects an anti-bot interstitial by title", () => {
    const verdict = classifyReadiness(
      snapshot({
        title: "Just a moment...",
        bodyTextSample: "Checking your browser before accessing the site.",
      }),
    );
    expect(verdict.state).toBe("challenge");
    expect(verdict.evidence[0]).toContain("Just a moment");
  });

  it("detects an anti-bot interstitial by vendor markup", () => {
    const verdict = classifyReadiness(snapshot({ challengeMarkers: ["#challenge-running"] }));
    expect(verdict.state).toBe("challenge");
    expect(verdict.evidence).toEqual(["challenge markup present: #challenge-running"]);
  });

  it("does not flag an article that merely mentions captchas", () => {
    const body = `${"How captcha systems verify you are human. ".repeat(40)}`;
    const verdict = classifyReadiness(
      snapshot({
        title: "Blog - Example",
        bodyTextSample: body,
        bodyTextLength: body.length,
        captchaFrames: 1,
      }),
    );
    expect(verdict.state).toBe("ready");
  });

  it("does not treat a lone captcha badge on a short page as a challenge", () => {
    const body = "Subscribe to our newsletter. Email address. Subscribe.";
    const verdict = classifyReadiness(
      snapshot({ bodyTextSample: body, bodyTextLength: body.length, captchaFrames: 1 }),
    );
    expect(verdict.state).toBe("ready");
  });

  it("detects not-found pages by title or heading", () => {
    expect(classifyReadiness(snapshot({ title: "404 Not Found" })).state).toBe("not-found");
    expect(classifyReadiness(snapshot({ headings: ["This page doesn't exist"] })).state).toBe(
      "not-found",
    );
  });

  it("detects a login bounce: password field plus URL prefix mismatch", () => {
    const verdict = classifyReadiness(
      snapshot({
        href: "https://accounts.example.com/session?next=%2Fprojects",
        title: "Example",
        visiblePasswordInputs: 1,
        urlPrefix: { expected: "https://app.example.com/", matched: false },
      }),
    );
    expect(verdict.state).toBe("login");
    expect(verdict.evidence).toContain("1 visible password field(s)");
    expect(verdict.evidence.some((line) => line.includes("left the expected prefix"))).toBe(true);
  });

  it("detects a login page by route and title without a password field", () => {
    const verdict = classifyReadiness(
      snapshot({
        href: "https://app.example.com/login",
        title: "Sign in - Example",
        visiblePasswordInputs: 0,
      }),
    );
    expect(verdict.state).toBe("login");
  });

  it("keeps a page with a visible password field ready when nothing else points at login", () => {
    const verdict = classifyReadiness(snapshot({ visiblePasswordInputs: 1 }));
    expect(verdict.state).toBe("ready");
    expect(verdict.evidence.some((line) => line.includes("password field"))).toBe(true);
  });

  it("detects browser error pages", () => {
    expect(classifyReadiness(snapshot({ href: "chrome-error://chromewebdata/" })).state).toBe(
      "error",
    );
    const body = "This site can't be reached. ERR_CONNECTION_REFUSED";
    expect(
      classifyReadiness(snapshot({ bodyTextSample: body, bodyTextLength: body.length })).state,
    ).toBe("error");
  });

  it("reports loading until an expected selector or text appears", () => {
    const missingSelector = classifyReadiness(
      snapshot({ selector: { expected: ".results", matched: false } }),
    );
    expect(missingSelector.state).toBe("loading");
    expect(missingSelector.evidence).toEqual(['selector ".results" not found']);

    const found = classifyReadiness(
      snapshot({ selector: { expected: ".results", matched: true } }),
    );
    expect(found.state).toBe("ready");
    expect(found.evidence).toEqual(['selector ".results" found']);
  });

  it("lets present content override a non-complete readyState", () => {
    const verdict = classifyReadiness(
      snapshot({ readyState: "interactive", text: { expected: "Projects", matched: true } }),
    );
    expect(verdict.state).toBe("ready");
  });

  it("reports empty for an explicit no-results render even when the content selector is missing", () => {
    const verdict = classifyReadiness(
      snapshot({
        selector: { expected: ".result-card", matched: false },
        emptyText: { expected: "No results found", matched: true },
      }),
    );
    expect(verdict.state).toBe("empty");
  });

  it("reports loading while the URL is outside the expected prefix and no login signal exists", () => {
    const verdict = classifyReadiness(
      snapshot({
        href: "https://app.example.com/redirecting",
        urlPrefix: { expected: "https://app.example.com/projects", matched: false },
      }),
    );
    expect(verdict.state).toBe("loading");
  });

  it("prefers a negative state over loading", () => {
    const verdict = classifyReadiness(
      snapshot({
        readyState: "loading",
        title: "Attention Required!",
        challengeMarkers: ["#challenge-form"],
      }),
    );
    expect(verdict.state).toBe("challenge");
  });
});

describe("readinessErrorCode", () => {
  it("maps negative states to error codes and others to null", () => {
    expect(readinessErrorCode("challenge")).toBe("page_challenge");
    expect(readinessErrorCode("login")).toBe("page_login");
    expect(readinessErrorCode("not-found")).toBe("page_not_found");
    expect(readinessErrorCode("error")).toBe("page_error");
    expect(readinessErrorCode("ready")).toBeNull();
    expect(readinessErrorCode("loading")).toBeNull();
  });
});

describe("parseAcceptStates", () => {
  it("parses comma lists and arrays, de-duplicating", () => {
    expect(parseAcceptStates("login, challenge,login")).toEqual(["login", "challenge"]);
    expect(parseAcceptStates(["not-found"])).toEqual(["not-found"]);
    expect(parseAcceptStates(undefined)).toEqual([]);
  });

  it("rejects unknown states", () => {
    expect(() => parseAcceptStates("blocked")).toThrow(/Unknown readiness state "blocked"/);
  });
});

function fakeDom(
  overrides: Partial<ReadinessProbeDom> & { counts?: Record<string, number> } = {},
): ReadinessProbeDom {
  const counts = overrides.counts ?? {};
  return {
    href: "https://app.example.com/projects",
    title: "  Projects   -  Example ",
    readyState: "complete",
    bodyText: () => "Projects Alpha Beta No results found",
    countVisible: (selector) => counts[selector] ?? 0,
    visibleHeadings: () => [" Projects "],
    ...overrides,
  };
}

describe("collectReadinessSnapshot", () => {
  it("counts visible fields, markers and captcha frames", () => {
    const dom = fakeDom({
      counts: {
        "input[type='password']": 1,
        "#challenge-running": 1,
        "iframe[src*='captcha' i]": 2,
        "iframe[title*='captcha' i]": 1,
      },
    });
    const result = collectReadinessSnapshot(dom);
    expect(result.title).toBe("Projects - Example");
    expect(result.headings).toEqual(["Projects"]);
    expect(result.visiblePasswordInputs).toBe(1);
    expect(result.challengeMarkers).toEqual(["#challenge-running"]);
    expect(result.captchaFrames).toBe(3);
    expect(result.bodyTextLength).toBe("Projects Alpha Beta No results found".length);
  });

  it("evaluates expectations case-insensitively and never throws on bad selectors", () => {
    const dom = fakeDom({
      counts: { ".card": 2 },
      countVisible: (selector) => {
        if (selector === "!!bad") {
          throw new Error("invalid selector");
        }
        return selector === ".card" ? 2 : 0;
      },
    });
    const result = collectReadinessSnapshot(dom, {
      selector: ".card",
      text: "no RESULTS found",
      urlPrefix: "https://app.example.com/",
      emptyText: "  no results  ",
    });
    expect(result.selector).toEqual({ expected: ".card", matched: true });
    expect(result.text).toEqual({ expected: "no RESULTS found", matched: true });
    expect(result.urlPrefix).toEqual({ expected: "https://app.example.com/", matched: true });
    expect(result.emptyText).toEqual({ expected: "  no results  ", matched: true });
    expect(collectReadinessSnapshot(dom, { selector: "!!bad" }).selector).toEqual({
      expected: "!!bad",
      matched: false,
    });
  });

  it("omits expectation fields that were not requested", () => {
    const result = collectReadinessSnapshot(fakeDom());
    expect(result.selector).toBeUndefined();
    expect(result.text).toBeUndefined();
    expect(result.urlPrefix).toBeUndefined();
    expect(result.emptyText).toBeUndefined();
  });
});

describe("probePageReadiness", () => {
  it("returns a verdict with page identity and a snapshot without the text sample", () => {
    const report = probePageReadiness(fakeDom(), { selector: ".card" });
    expect(report.state).toBe("loading");
    expect(report.href).toBe("https://app.example.com/projects");
    expect(report.title).toBe("Projects - Example");
    expect(report.readyState).toBe("complete");
    expect("bodyTextSample" in report.snapshot).toBe(false);
    expect(report.snapshot.selector).toEqual({ expected: ".card", matched: false });
  });
});
