/**
 * The install card's version pick (D-058, D-059, D-171): the stored level, the
 * options an alias chain offers, and the option nearest a preference.
 */
import { describe, expect, it } from "vitest";
import {
  browserStorage,
  installTarget,
  isPinLevel,
  pickPinned,
  pinOptions,
  PIN_KEY,
  readPin,
  tagLevel,
  writePin,
  type PinStorage,
} from "../../../src/site/lib/installPin.js";

const chain = (...tags: string[]) => tags.map((tag) => ({ tag }));

describe("tagLevel / isPinLevel", () => {
  it.each([
    ["latest", "latest"],
    ["nightly", "rolling"],
    ["slim", "rolling"],
    ["3", "major"],
    ["3.31", "minor"],
    ["3.31.2", "patch"],
    ["3.31.2-rc1", "pinned"],
    ["3.31.2_b5", "pinned"],
    ["slim-3.31", "minor"],
  ])("%s is %s", (tag, level) => {
    expect(tagLevel(tag)).toBe(level);
  });

  it("accepts the six levels and nothing else, not even inherited names", () => {
    for (const level of ["latest", "rolling", "major", "minor", "patch", "pinned"]) expect(isPinLevel(level)).toBe(true);
    for (const bad of ["", "toString", "__proto__", "MAJOR", 3, null, undefined]) expect(isPinLevel(bad)).toBe(false);
  });
});

describe("pinOptions", () => {
  it("D-058: labels each tag by level and relabels the deepest one 'pinned'", () => {
    expect(pinOptions(chain("latest", "3", "3.31", "3.31.2"))).toEqual([
      { tag: "latest", rank: 0, label: "latest" },
      { tag: "3", rank: 1, label: "major" },
      { tag: "3.31", rank: 2, label: "minor" },
      { tag: "3.31.2", rank: 3, label: "pinned" },
    ]);
  });

  it("the deepest of equals is the last one", () => {
    expect(pinOptions(chain("1.2.3", "1.2.4")).map((o) => o.label)).toEqual(["patch", "pinned"]);
  });

  it("the deepest tag is pinned wherever it sits in the chain", () => {
    expect(pinOptions(chain("1.2.3", "1")).map((o) => o.label)).toEqual(["pinned", "major"]);
  });

  it("a lone tag is pinned; an empty chain has no options", () => {
    expect(pinOptions(chain("latest"))).toEqual([{ tag: "latest", rank: 0, label: "pinned" }]);
    expect(pinOptions([])).toEqual([]);
  });
});

describe("pickPinned", () => {
  const options = pinOptions(chain("latest", "3", "3.31", "3.31.2"));

  it("D-171: takes the option at the preferred level", () => {
    expect(pickPinned(options, "major")?.tag).toBe("3");
    expect(pickPinned(options, "minor")?.tag).toBe("3.31");
    expect(pickPinned(options, "latest")?.tag).toBe("latest");
  });

  it("D-171: a level this chain lacks lands on the nearest, a tie on the deeper one", () => {
    expect(pickPinned(pinOptions(chain("latest", "3.31.2")), "minor")?.tag).toBe("3.31.2");
    expect(pickPinned(pinOptions(chain("3", "3.31.2")), "minor")?.tag).toBe("3.31.2");
    expect(pickPinned(options, "pinned")?.tag).toBe("3.31.2");
  });

  it("is null for an empty chain", () => {
    expect(pickPinned([], "latest")).toBeNull();
  });
});

describe("installTarget", () => {
  it("names the bare package for latest, name:tag otherwise, nothing without a tag", () => {
    expect(installTarget("idx/acme/tool", "latest")).toBe("idx/acme/tool");
    expect(installTarget("idx/acme/tool", "3.1")).toBe("idx/acme/tool:3.1");
    expect(installTarget("idx/acme/tool", null)).toBeNull();
  });
});

describe("pin storage (D-171)", () => {
  const memory = (initial?: string): PinStorage & { value: string | undefined } => {
    const store = { value: initial, getItem: () => store.value ?? null, setItem: (_key: string, value: string) => void (store.value = value) };
    return store;
  };
  const throwing: PinStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };

  it("reads the stored level, latest for none, an unknown value, no storage or storage that throws", () => {
    expect(readPin(memory("minor"))).toBe("minor");
    expect(readPin(memory())).toBe("latest");
    expect(readPin(memory("sideways"))).toBe("latest");
    expect(readPin(null)).toBe("latest");
    expect(readPin(throwing)).toBe("latest");
  });

  it("stores under ocx-install-pin, and a throwing or absent storage is a no-op", () => {
    const store = memory();
    writePin(store, "major");
    expect(store.value).toBe("major");
    expect(PIN_KEY).toBe("ocx-install-pin");
    expect(() => writePin(throwing, "major")).not.toThrow();
    expect(() => writePin(null, "major")).not.toThrow();
  });

  it("browserStorage is the global localStorage, and null where reading it throws", () => {
    const fake = memory();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
      expect(browserStorage()).toBe(fake);
      Object.defineProperty(globalThis, "localStorage", {
        get() {
          throw new Error("SecurityError");
        },
        configurable: true,
      });
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
