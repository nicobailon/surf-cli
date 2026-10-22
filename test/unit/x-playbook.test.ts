import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const { createRecordSet, readCursor } = require("../../native/records.cjs");
const { formatRecords } = require("../../native/record-format.cjs");

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Invented content in the shape of a TweetDetail response.
const user = (screenName: string, name: string) => ({
  user_results: {
    result: {
      __typename: "User",
      rest_id: `u-${screenName}`,
      core: { screen_name: screenName, name },
    },
  },
});
const post = (
  id: string,
  author: [string, string],
  text: string,
  extra: Record<string, unknown> = {},
) => ({
  __typename: "Tweet",
  rest_id: id,
  core: user(...author),
  legacy: {
    created_at: `Mon Jan 0${id.slice(-1)} 10:00:00 +0000 2024`,
    full_text: text,
    ...(extra.legacy as object),
  },
  ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "legacy")),
});
const item = (result: unknown) => ({
  item: { itemContent: { itemType: "TimelineTweet", tweet_results: { result } } },
});
const A: [string, string] = ["ann", "Ann A"];
const B: [string, string] = ["bob", "Bob B"];
const photo = (url: string) => ({
  extended_entities: { media: [{ type: "photo", media_url_https: url }] },
});

const tweetDetail = {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          type: "TimelineAddEntries",
          entries: [
            {
              entryId: "tweet-1",
              content: {
                entryType: "TimelineTimelineItem",
                itemContent: {
                  itemType: "TimelineTweet",
                  tweet_results: {
                    result: post("1", A, "A long post, cut…", {
                      note_tweet: {
                        note_tweet_results: { result: { text: "A long post, in full." } },
                      },
                    }),
                  },
                },
              },
            },
            {
              entryId: "conversationthread-2",
              content: {
                entryType: "TimelineTimelineModule",
                items: [
                  item(
                    post("2", A, "Quoting Bob", {
                      legacy: { in_reply_to_status_id_str: "1" },
                      quoted_status_result: {
                        result: post("8", B, "Bob's chart", {
                          legacy: photo("https://img.test/chart.png"),
                        }),
                      },
                    }),
                  ),
                  item({
                    __typename: "TweetWithVisibilityResults",
                    tweet: post("3", A, "Last one", {
                      legacy: {
                        in_reply_to_status_id_str: "2",
                        ...photo("https://img.test/3.jpg"),
                      },
                    }),
                  }),
                ],
              },
            },
            {
              entryId: "conversationthread-4",
              content: {
                entryType: "TimelineTimelineModule",
                items: [
                  item(post("4", B, "Nice thread", { legacy: { in_reply_to_status_id_str: "1" } })),
                ],
              },
            },
            {
              entryId: "cursor-bottom-9",
              content: {
                entryType: "TimelineTimelineCursor",
                __typename: "TimelineTimelineCursor",
                value: "BOTTOM-9",
                cursorType: "Bottom",
              },
            },
          ],
        },
      ],
    },
  },
};

describe("x playbook thread op", () => {
  it("maps a TweetDetail response to the author's posts and renders them as markdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-x-playbook-"));
    tempDirs.push(dir);
    const op = playbooks.resolveOp("x", "thread", { cwd: dir, home: dir, pinBuiltIn: true }).op;
    const api = op.run.find((strategy: { using: string }) => strategy.using === "api");

    const set = createRecordSet(api.records);
    set.add(tweetDetail);
    const records = set.records();
    expect(records).toEqual([
      {
        id: "1",
        author: "ann",
        name: "Ann A",
        time: "Mon Jan 01 10:00:00 +0000 2024",
        text: "A long post, in full.",
        url: "https://x.com/ann/status/1",
      },
      {
        id: "2",
        author: "ann",
        name: "Ann A",
        time: "Mon Jan 02 10:00:00 +0000 2024",
        text: "Quoting Bob",
        replyTo: "1",
        quoted: {
          id: "8",
          author: "bob",
          name: "Bob B",
          time: "Mon Jan 08 10:00:00 +0000 2024",
          text: "Bob's chart",
          media: ["https://img.test/chart.png"],
        },
        url: "https://x.com/ann/status/2",
      },
      {
        id: "3",
        author: "ann",
        name: "Ann A",
        time: "Mon Jan 03 10:00:00 +0000 2024",
        text: "Last one",
        replyTo: "2",
        media: ["https://img.test/3.jpg"],
        url: "https://x.com/ann/status/3",
      },
    ]);
    expect(readCursor(tweetDetail, api.cursor)).toBe("BOTTOM-9");

    expect(
      formatRecords(records, "md", {
        markdown: op.markdown,
        args: { url: "https://x.com/ann/status/1" },
      }),
    ).toBe(
      [
        "# Thread by @ann",
        "",
        "## 1/3 · Ann A (@ann) · Mon Jan 01 10:00:00 +0000 2024",
        "",
        "https://x.com/ann/status/1",
        "",
        "A long post, in full.",
        "",
        "## 2/3 · Ann A (@ann) · Mon Jan 02 10:00:00 +0000 2024",
        "",
        "https://x.com/ann/status/2",
        "",
        "Quoting Bob",
        "",
        "> **Bob B (@bob) · Mon Jan 08 10:00:00 +0000 2024**",
        ">",
        "> Bob's chart",
        ">",
        "> ![image](https://img.test/chart.png)",
        "",
        "## 3/3 · Ann A (@ann) · Mon Jan 03 10:00:00 +0000 2024",
        "",
        "https://x.com/ann/status/3",
        "",
        "Last one",
        "",
        "![image](https://img.test/3.jpg)",
      ].join("\n"),
    );
  });
});
