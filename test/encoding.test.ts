import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../src/encoding.js";

describe("encoding helpers", () => {
  it("round trips base64 and array buffers", () => {
    const buffer = base64ToArrayBuffer("aGk=");
    expect(new TextDecoder().decode(buffer)).toBe("hi");
    expect(arrayBufferToBase64(buffer)).toBe("aGk=");
  });
});
