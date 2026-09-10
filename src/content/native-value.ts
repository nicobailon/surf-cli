/**
 * Value assignment for framework-controlled form fields.
 *
 * React, Angular, Vue and similar frameworks watch the `value` of an input
 * through their own tracker (React installs an instance property that
 * shadows the prototype accessor). Writing `element.value = text` updates
 * that tracker first, so the `input` event dispatched afterwards looks like a
 * no-op and the framework state never changes. Writing through the native
 * prototype setter leaves the tracker untouched, and the events that follow
 * report a real change.
 */

export type ValueEventName = "input" | "change" | "blur";

export interface NativeValueTarget {
  value: string;
  dispatchEvent(event: Event): boolean;
}

export interface SetNativeValueResult {
  method: "native-setter" | "assignment";
  events: ValueEventName[];
}

export const DEFAULT_VALUE_EVENTS: readonly ValueEventName[] = ["input", "change"];

/**
 * Walk the prototype chain of `element` and return the first `value` setter
 * defined on a prototype. Own properties on the instance are skipped on
 * purpose: they are the framework trackers this helper must bypass.
 */
export function findNativeValueSetter(element: object): ((value: string) => void) | null {
  let proto: object | null = Object.getPrototypeOf(element);
  while (proto && proto !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      return descriptor.set as (value: string) => void;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

/**
 * Set `value` on a text-like input or textarea so both plain pages and
 * framework-controlled forms observe the change, then dispatch `events` in
 * order (default: `input`, then `change`).
 */
export function setNativeValue(
  element: NativeValueTarget,
  value: string,
  events: readonly ValueEventName[] = DEFAULT_VALUE_EVENTS,
): SetNativeValueResult {
  const setter = findNativeValueSetter(element);
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  for (const name of events) {
    element.dispatchEvent(new Event(name, { bubbles: name !== "blur" }));
  }
  return { method: setter ? "native-setter" : "assignment", events: [...events] };
}
