import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALUE_EVENTS,
  findNativeValueSetter,
  setNativeValue,
} from "../../src/content/native-value";

/** Stand-in for HTMLInputElement.prototype: the native accessor pair. */
class FakeNativeInput {
  nativeValue = "";
  nativeSets: string[] = [];
  dispatched: Array<{ type: string; bubbles: boolean }> = [];

  get value(): string {
    return this.nativeValue;
  }

  set value(next: string) {
    this.nativeValue = next;
    this.nativeSets.push(next);
  }

  dispatchEvent(event: Event): boolean {
    this.dispatched.push({ type: event.type, bubbles: event.bubbles });
    return true;
  }
}

/**
 * Emulates a framework value tracker: an own `value` property on the
 * instance that shadows the prototype accessor and records what it saw.
 */
function installTracker(element: FakeNativeInput): { seen: string[] } {
  const tracker = { seen: [] as string[] };
  let current = element.value;
  Object.defineProperty(element, "value", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: string) => {
      tracker.seen.push(next);
      current = next;
    },
  });
  return tracker;
}

describe("findNativeValueSetter", () => {
  it("returns the prototype setter and ignores instance-level trackers", () => {
    const element = new FakeNativeInput();
    installTracker(element);
    const setter = findNativeValueSetter(element);
    expect(setter).toBe(Object.getOwnPropertyDescriptor(FakeNativeInput.prototype, "value")?.set);
  });

  it("walks up subclass prototypes", () => {
    class CustomInput extends FakeNativeInput {}
    const element = new CustomInput();
    expect(findNativeValueSetter(element)).toBe(
      Object.getOwnPropertyDescriptor(FakeNativeInput.prototype, "value")?.set,
    );
  });

  it("returns null when no prototype defines a value setter", () => {
    expect(findNativeValueSetter({ value: "x" })).toBeNull();
  });
});

describe("setNativeValue", () => {
  it("writes through the native setter so the tracker does not swallow the change", () => {
    const element = new FakeNativeInput();
    const tracker = installTracker(element);

    const result = setNativeValue(element, "hello");

    expect(result).toEqual({ method: "native-setter", events: ["input", "change"] });
    expect(element.nativeSets).toEqual(["hello"]);
    expect(tracker.seen).toEqual([]);
  });

  it("dispatches input then change as bubbling events by default", () => {
    const element = new FakeNativeInput();
    setNativeValue(element, "a");
    expect(element.dispatched).toEqual([
      { type: "input", bubbles: true },
      { type: "change", bubbles: true },
    ]);
    expect(DEFAULT_VALUE_EVENTS).toEqual(["input", "change"]);
  });

  it("dispatches blur without bubbling when requested", () => {
    const element = new FakeNativeInput();
    setNativeValue(element, "a", ["input", "blur"]);
    expect(element.dispatched).toEqual([
      { type: "input", bubbles: true },
      { type: "blur", bubbles: false },
    ]);
  });

  it("falls back to plain assignment for objects without a native setter", () => {
    const dispatched: string[] = [];
    const element = {
      value: "old",
      dispatchEvent(event: Event) {
        dispatched.push(event.type);
        return true;
      },
    };

    const result = setNativeValue(element, "new", ["change"]);

    expect(result.method).toBe("assignment");
    expect(element.value).toBe("new");
    expect(dispatched).toEqual(["change"]);
  });

  it("does not mutate the caller's event list", () => {
    const events = ["input"] as const;
    const element = new FakeNativeInput();
    const result = setNativeValue(element, "v", events);
    expect(result.events).toEqual(["input"]);
    expect(result.events).not.toBe(events);
  });
});
