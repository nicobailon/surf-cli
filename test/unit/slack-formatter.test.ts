import { describe, expect, it } from "vitest";

const { formatSlackResult, cleanSlackText, formatTimestamp } =
  require("../../native/slack-formatter.cjs") as {
    formatSlackResult: (...args: any[]) => string;
    cleanSlackText: (text: string | null | undefined, userMap?: Record<string, unknown>) => string;
    formatTimestamp: (timestamp: string | number | undefined | null) => string;
  };

describe("slack-formatter", () => {
  describe("cleanSlackText", () => {
    it("replaces user mentions with display names", () => {
      const userMap = { U123: { displayName: "Alice", name: "alice" } };
      expect(cleanSlackText("<@U123> said hello", userMap)).toBe("@Alice said hello");
    });

    it("replaces channel mentions", () => {
      expect(cleanSlackText("See <#C456|general> for details")).toBe("See #general for details");
    });

    it("replaces bare channel mentions", () => {
      expect(cleanSlackText("See <#C456> for details")).toBe("See #C456 for details");
    });

    it("replaces URL mentions with markdown links", () => {
      expect(cleanSlackText("Visit <https://example.com|Example>")).toBe(
        "Visit [Example](https://example.com)",
      );
    });

    it("replaces bare URLs", () => {
      expect(cleanSlackText("Visit <https://example.com>")).toBe("Visit https://example.com");
    });

    it("replaces special mentions", () => {
      expect(cleanSlackText("<!here> <!channel> <!everyone>")).toBe("@here @channel @everyone");
    });

    it("decodes HTML entities", () => {
      expect(cleanSlackText("a &amp; b &lt; c &gt; d")).toBe("a & b < c > d");
    });

    it("handles empty/null input", () => {
      expect(cleanSlackText("")).toBe("");
      expect(cleanSlackText(null)).toBe("");
      expect(cleanSlackText(undefined)).toBe("");
    });
  });

  describe("formatTimestamp", () => {
    it("formats Unix timestamp to human readable", () => {
      const ts = "1700000000.123400";
      const result = formatTimestamp(ts);
      expect(result).toContain("2023");
      expect(result).toMatch(/\d+:\d+ [AP]M/);
    });

    it("handles empty input", () => {
      expect(formatTimestamp("")).toBe("");
      expect(formatTimestamp(null)).toBe("");
    });
  });

  describe("formatSlackResult", () => {
    const historyResult = {
      messages: [
        { ts: "1700000000.000000", user: "U1", text: "Hello world" },
        { ts: "1700000060.000000", user: "U2", text: "Hi <@U1>!" },
      ],
      threads: {},
      users: {
        U1: { id: "U1", name: "Alice", displayName: "Alice", avatar: null },
        U2: { id: "U2", name: "Bob", displayName: "Bob", avatar: null },
      },
      channel: "C123",
      messageCount: 2,
      threadCount: 0,
    };

    it("formats history as markdown", () => {
      const md = formatSlackResult(historyResult, "history", "markdown");
      expect(md).toContain("# Slack Channel: C123");
      expect(md).toContain("**Alice**");
      expect(md).toContain("**Bob**");
      expect(md).toContain("Hello world");
      expect(md).toContain("Hi @Alice!");
    });

    it("formats history as JSON", () => {
      const json = formatSlackResult(historyResult, "history", "json");
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].userName).toBe("Alice");
      expect(parsed[0].text).toBe("Hello world");
      expect(parsed[1].text).toBe("Hi @Alice!");
    });

    it("formats channels as markdown table", () => {
      const channelResult = {
        channels: [
          {
            id: "C1",
            name: "general",
            topic: "General chat",
            purpose: "",
            memberCount: 50,
            isPrivate: false,
            isIm: false,
            isMpim: false,
          },
          {
            id: "C2",
            name: "random",
            topic: "",
            purpose: "",
            memberCount: 30,
            isPrivate: true,
            isIm: false,
            isMpim: false,
          },
        ],
        channelCount: 2,
      };
      const md = formatSlackResult(channelResult, "channels", "markdown");
      expect(md).toContain("# Slack Channels");
      expect(md).toContain("| C1 | #general |");
      expect(md).toContain("| C2 | #random |");
      expect(md).toContain("Public");
      expect(md).toContain("Private");
    });

    it("formats history with thread replies", () => {
      const withThreads = {
        ...historyResult,
        threads: {
          "1700000000.000000": [{ ts: "1700000120.000000", user: "U2", text: "Thread reply" }],
        },
        threadCount: 1,
      };
      const md = formatSlackResult(withThreads, "history", "markdown");
      expect(md).toContain("**Thread**");
      expect(md).toContain("Thread reply");
    });

    it("formats replies as markdown", () => {
      const repliesResult = {
        messages: [
          { ts: "1700000000.000000", user: "U1", text: "Original message" },
          { ts: "1700000120.000000", user: "U2", text: "Reply one" },
        ],
        users: {
          U1: { id: "U1", name: "Alice", displayName: "Alice", avatar: null },
          U2: { id: "U2", name: "Bob", displayName: "Bob", avatar: null },
        },
        channel: "C123",
        threadTs: "1700000000.000000",
        messageCount: 2,
      };
      const md = formatSlackResult(repliesResult, "replies", "markdown");
      expect(md).toContain("# Thread in C123");
      expect(md).toContain("[OP]");
      expect(md).toContain("Original message");
      expect(md).toContain("Reply one");
    });

    it("formats replies as normalized JSON", () => {
      const repliesResult = {
        messages: [
          {
            ts: "1700000000.000000",
            user: "U1",
            text: "Original <@U2>",
            files: [{ name: "a.txt", mimetype: "text/plain", url_private: "https://x" }],
          },
          { ts: "1700000120.000000", user: "U2", text: "Reply one" },
        ],
        users: {
          U1: { id: "U1", name: "Alice", displayName: "Alice", avatar: null },
          U2: { id: "U2", name: "Bob", displayName: "Bob", avatar: null },
        },
        channel: "C123",
        threadTs: "1700000000.000000",
        messageCount: 2,
      };
      const json = formatSlackResult(repliesResult, "replies", "json");
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].userName).toBe("Alice");
      expect(parsed[0].text).toBe("Original @Bob");
      expect(parsed[0].rawText).toBe("Original <@U2>");
      expect(parsed[0].isParent).toBe(true);
      expect(parsed[0].files).toEqual([{ name: "a.txt", type: "text/plain", url: "https://x" }]);
      expect(parsed[1].isParent).toBe(false);
    });
  });

  describe("mention resolution in replies", () => {
    it("resolves mentions from reply text, not just author IDs", () => {
      const users = {
        U1: { displayName: "Alice", name: "alice" },
        U2: { displayName: "Bob", name: "bob" },
        U3: { displayName: "Charlie", name: "charlie" },
      };
      // U3 is mentioned but never authored a message
      const result = {
        messages: [
          { ts: "1.0", user: "U1", text: "Hey <@U3> check this" },
          { ts: "1.1", user: "U2", text: "<@U3> agreed" },
        ],
        users,
        channel: "C1",
        threadTs: "1.0",
        messageCount: 2,
      };
      const md = formatSlackResult(result, "replies", "markdown");
      expect(md).toContain("@Charlie");
      expect(md).not.toContain("<@U3>");
    });
  });
});
