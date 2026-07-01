// @ts-expect-error - CommonJS module without type definitions
import * as grokClient from "../../native/grok-client.cjs";

const { extractGrokResponse, normalizeGrokModelLabel } = grokClient;

describe("grok-client", () => {
  describe("extractGrokResponse", () => {
    it("extracts simple numeric answer", () => {
      const bodyText = `Home
Explore
Notifications
Grok
What is 2+2? Reply with just the number.
4
Explain basic arithmetic
Think Harder`;

      const result = extractGrokResponse(bodyText, "What is 2+2? Reply with just the number.");
      expect(result).toBe("4");
    });

    it("extracts multi-line response", () => {
      const bodyText = `Home
Grok
Name 3 colors
Here are 3 colors:
Blue
Red
Green
Tell me more
Think Harder`;

      const result = extractGrokResponse(bodyText, "Name 3 colors");
      expect(result).toBe("Here are 3 colors:\nBlue\nRed\nGreen");
    });

    it("handles expanded math response", () => {
      const bodyText = `Home
Grok
What is 7*8?
7 × 8 = 56
Explain multiplication
Think Harder`;

      const result = extractGrokResponse(bodyText, "What is 7*8?");
      expect(result).toBe("7 × 8 = 56");
    });

    it("finds most recent conversation when multiple exist", () => {
      const bodyText = `Home
Grok
What is 2+2?
4
Explain basic arithmetic
What is 5*5?
25
Explain multiplication
Think Harder`;

      const result = extractGrokResponse(bodyText, "What is 5*5?");
      expect(result).toBe("25");
    });

    it("filters out UI elements", () => {
      const bodyText = `Home
Explore
Notifications
Messages
Chat
Grok
Premium
Bookmarks
Communities
Profile
More
Post
Grok 4.20 Beta
History
Private
What is 10/2?
5
Think Harder`;

      const result = extractGrokResponse(bodyText, "What is 10/2?");
      expect(result).toBe("5");
    });

    it("trims trailing follow-up suggestion chips", () => {
      const bodyText = `Grok
say hello in 3 words
Hello there, friend!
Share greetings in other languages
Fun icebreaker questions
Make it more playful`;

      const result = extractGrokResponse(bodyText, "say hello in 3 words");
      expect(result).toBe("Hello there, friend!");
    });

    it("trims suggested follow-ups without depending on fixed prefixes", () => {
      const bodyText = `Grok
What is pi?
Pi is approximately 3.14159
It's the ratio of a circle's circumference to its diameter
Compare circle constants
Derive it geometrically`;

      const result = extractGrokResponse(bodyText, "What is pi?");
      expect(result).toBe(
        "Pi is approximately 3.14159\nIt's the ratio of a circle's circumference to its diameter",
      );
    });

    it("keeps a short punctuation-free one-line answer", () => {
      const bodyText = `Grok
say hello in 2 words
Hello there`;

      const result = extractGrokResponse(bodyText, "say hello in 2 words");
      expect(result).toBe("Hello there");
    });

    it("keeps a short punctuation-free prose ending after prior response content", () => {
      const bodyText = `Grok
Give a two-line casual answer
Sure thing.
Hello there`;

      const result = extractGrokResponse(bodyText, "Give a two-line casual answer");
      expect(result).toBe("Sure thing.\nHello there");
    });

    it("returns null for empty body", () => {
      expect(extractGrokResponse("", "test")).toBeNull();
      expect(extractGrokResponse(null as unknown as string, "test")).toBeNull();
    });

    it("returns all content when question not found (no filtering)", () => {
      const bodyText = `Home
Grok
Some random content
42
More content
7`;

      // When question isn't found, startIndex is 0, so all non-UI content is returned
      const result = extractGrokResponse(bodyText, "nonexistent question");
      expect(result).toBe("Some random content\n42\nMore content\n7");
    });

    it("handles question with special characters", () => {
      const bodyText = `Grok
What's 2+2?
4
Explain`;

      const result = extractGrokResponse(bodyText, "What's 2+2?");
      expect(result).toBe("4");
    });

    it("filters sidebar promo text", () => {
      const bodyText = `See new posts
Talk to Grok
Get access to more features
Grok
Hello
Hi there!
Think Harder`;

      const result = extractGrokResponse(bodyText, "Hello");
      expect(result).toBe("Hi there!");
    });
  });

  describe("hasRequiredCookies", () => {
    it("returns true when auth_token cookie exists", () => {
      const cookies = [
        { name: "other", value: "xyz" },
        { name: "auth_token", value: "abc123" },
      ];
      expect(grokClient.hasRequiredCookies(cookies)).toBe(true);
    });

    it("returns false when auth_token is missing", () => {
      const cookies = [{ name: "other", value: "xyz" }];
      expect(grokClient.hasRequiredCookies(cookies)).toBe(false);
    });

    it("returns false when auth_token is empty", () => {
      const cookies = [{ name: "auth_token", value: "" }];
      expect(grokClient.hasRequiredCookies(cookies)).toBe(false);
    });

    it("returns false for null/undefined cookies", () => {
      expect(grokClient.hasRequiredCookies(null)).toBe(false);
      expect(grokClient.hasRequiredCookies(undefined)).toBe(false);
    });

    it("returns false for non-array", () => {
      expect(grokClient.hasRequiredCookies({} as unknown as [])).toBe(false);
    });
  });

  describe("getGrokModels", () => {
    it("returns default models when no settings file exists", () => {
      const models = grokClient.getGrokModels();
      expect(models).toHaveProperty("auto");
      expect(models).toHaveProperty("fast");
      expect(models).toHaveProperty("expert");
      expect(models).toHaveProperty("grok-4.20-beta");
      expect(models).not.toHaveProperty("thinking");
      expect(grokClient.DEFAULT_MODEL).toBe("fast");
    });
  });

  describe("normalizeGrokModelLabel", () => {
    it("matches compact Grok model labels scraped from the UI", () => {
      expect(normalizeGrokModelLabel("Grok 4.20Beta4 Agents")).toContain(
        normalizeGrokModelLabel("Grok 4.20 Beta"),
      );
    });

    it("matches saved hyphenated IDs with dotted scraped labels", () => {
      expect(normalizeGrokModelLabel("grok-4-20beta4-agents")).toBe(
        normalizeGrokModelLabel("Grok 4.20Beta4 Agents"),
      );
    });
  });

  describe("grokModelLabelsMatch", () => {
    it("selects configured grok-4.20-beta from compact scraped UI labels", () => {
      const requestedLabels = grokClient.getGrokModelMatchLabels("grok-4.20-beta");
      expect(grokClient.grokModelLabelsMatch("Grok 4.20Beta4 Agents", requestedLabels)).toBe(true);
    });
  });

  describe("exports", () => {
    it("exports required functions and constants", () => {
      expect(grokClient.query).toBeInstanceOf(Function);
      expect(grokClient.validate).toBeInstanceOf(Function);
      expect(grokClient.hasRequiredCookies).toBeInstanceOf(Function);
      expect(grokClient.getGrokModels).toBeInstanceOf(Function);
      expect(grokClient.saveModels).toBeInstanceOf(Function);
      expect(grokClient.GROK_URL).toBe("https://x.com/i/grok");
    });
  });
});
