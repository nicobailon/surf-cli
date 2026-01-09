describe("Test Setup", () => {
  it("vitest is configured correctly", () => {
    expect(true).toBe(true);
  });

  it("can use common matchers", () => {
    expect(1 + 1).toBe(2);
    expect([1, 2, 3]).toContain(2);
    expect({ a: 1 }).toHaveProperty("a");
  });
});
