// The r7 review's corpus for pb test --save's pattern check: 44 matches patterns (10 guards that
// must always save, 34 realistic ones) against 32 dummy env values. The values come from a seeded
// generator and are built from parts at run time, so the corpus is the same on every run.

export const guardPatterns = [
  "^\\d+$",
  ".*ok.*",
  "^[A-Z]{3}$",
  "(?:ok|done)",
  "^(?=\\w+$)ok$",
  "\\bok\\b",
  "[a-f0-9]{32}",
  "^\\w{1,300}$",
  "^(?!error)ok$",
  "^(?=.*ok)\\w+ok$",
];

export const realisticPatterns: [string, string][] = [
  ["iso-date", "^\\d{4}-\\d{2}-\\d{2}$"],
  ["year-date", "^2026-\\d{2}-\\d{2}$"],
  ["month-name", "^(?:January|February|March|April) \\d{1,2}, 2026$"],
  ["timestamp", "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$"],
  ["request-id", "^req_[A-Za-z0-9]{16}$"],
  ["uuid", "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"],
  ["order-id", "^ord_\\d{8}$"],
  ["product-id", "^prod_[a-z0-9]+$"],
  ["hex-digest", "^[a-f0-9]{64}$"],
  ["locale", "^(?:en-US|fr-FR|de-DE)$"],
  ["url-origin", "^https://api\\.example\\.com/v1/items(?:\\?.*)?$"],
  ["url-login", "^https://login\\.example\\.com/(?:login|callback)$"],
  ["url-cdn", "^https://cdn\\.example\\.net/assets/.+\\.js$"],
  ["url-generic", "^https?://[^/]+/api/v\\d+/items$"],
  ["url-next", "^/api/v1/users/\\d+$"],
  ["url-redirect", "^/oauth/callback\\?code=.+$"],
  ["url-checkout", "^/checkout/success$"],
  ["status-ok", "^(?:ok|done|ready)$"],
  ["status-result", "^(?:success|pending|failed)$"],
  ["status-retry", "^(?:retry|timeout|error)$"],
  ["status-created", "^created$"],
  ["status-authorized", "^authorized$"],
  ["status-auth", "^authenticated$"],
  ["status-complete", "^complete$"],
  ["http-status", "^(?:200|201|204)$"],
  ["content-type", "^application/json(?:;.*)?$"],
  ["bearer-scheme", "^Bearer [A-Za-z0-9._~-]+$"],
  ["basic-scheme", "^Basic [A-Za-z0-9+/=]+$"],
  ["stripe-prefix", "^sk_(?:test|live)_[A-Za-z0-9]+$"],
  ["test-key", "^sk_test_[A-Za-z0-9]+$"],
  ["pagination", "^has_more$"],
  ["case-status", "^(?i:ok|done)$"],
  ["wide-repetition", "^a{1,300}!$"],
  ["word-alternatives", "^(?:red|green|blue|orange){6}!$"],
];

export const corpusPatterns: [string, string][] = [
  ...guardPatterns.map((pattern, index): [string, string] => [`guard-${index}`, pattern]),
  ...realisticPatterns,
];

/** The 32 dummy values, in the review's order: 24 generated, then 8 short ones. */
export function corpusValues(): [string, string][] {
  let seed = 0x5ec7;
  const rand = (alphabet: string, length: number) => {
    let out = "";
    for (let index = 0; index < length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      out += alphabet[seed % alphabet.length];
    }
    return out;
  };
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const alpha = `${letters}${letters.toUpperCase()}0123456789`;
  const hex = "0123456789abcdef";
  const join = (parts: string[], by = "_") => parts.join(by);
  // The values are ASCII, so btoa reads them as they are.
  const base64url = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const header = base64url({ alg: ["HS", "256"].join(""), typ: ["J", "WT"].join("") });
  // Its parts in order, as the generator draws them; `marks` leads the third and fourth.
  const uuid = (marks = ["", ""]) => {
    const head = [rand(hex, 8), rand(hex, 4)];
    const middle = marks.map((mark) => mark + rand(hex, 4 - mark.length));
    return join([...head, ...middle, rand(hex, 12)], "-");
  };
  const generated: [string, string][] = [
    ["random-api", rand(alpha, 40)],
    ["hex-token", rand(hex, 64)],
    ["uuid-token", uuid(["4", "a"])],
    ["stripe-live", join(["sk", "live", rand(alpha, 32)])],
    ["stripe-test", join(["sk", "test", rand(alpha, 32)])],
    ["github", join(["ghp", rand(alpha, 36)])],
    ["openai", join(["sk", "proj", rand(alpha, 48)], "-")],
    ["slack", join(["xoxb", "123456789012", "987654321098", rand(alpha, 24)], "-")],
    ["aws", ["AK", "IA", rand("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16)].join("")],
    ["aws-secret", rand(`${alpha}+/=`, 40)],
    ["bearer", `Bearer ${rand(`${alpha}._-`, 80)}`],
    ["basic", `Basic ${btoa(`service:${rand(alpha, 24)}`)}`],
    ["jwt", join([header, base64url({ sub: "1234567890" }), rand(`${alpha}_-`, 43)], ".")],
    ["session-cookie", `session=${rand(alpha, 48)}`],
    [
      "cookies",
      `session=${rand(alpha, 48)}; csrftoken=${rand(alpha, 32)}; locale=en-US; theme=dark`,
    ],
    ["encoded-cookie", `session=s%3A${rand(alpha, 40)}.${rand(alpha, 24)}`],
    ["xsrf", rand(alpha, 32)],
    ["uuid-csrf", uuid()],
    ["composite-status", `tenant=acme; session=${rand(alpha, 32)}; status=authenticated`],
    ["composite-date", `issued=2026-06-07; session=${rand(alpha, 32)}`],
    ["composite-origin", `origin=https://api.example.com; session=${rand(alpha, 32)}`],
    ["signed-query", `uid=987654&expires=1780790400&signature=${rand(hex, 64)}`],
    ["api-parts", join(["prod", "us-east-1", "acme", rand(alpha, 32)])],
    ["opaque-password", rand(`${alpha}!@_-`, 18)],
  ];
  const short: [string, string][] = [
    ["short-token8", ["J7kQ", "9m2X"].join("")],
    ["short-token12", ["4gN8", "xW2pQ9vR"].join("")],
    ["short-key12", join(["api", "2026", "q7Z"])],
    ["short-stripe", join(["sk", "live", "4J7p2N9q"])],
    ["short-password", ["f4st", "H0rs3!"].join("")],
    ["legacy-key", ["a1b2", "c3d4"].join("")],
    ["short-hex", ["b3e5", "82f14c90"].join("")],
    ["short-parts", join(["prod", "OK", "4hQ8"])],
  ];
  return [...generated, ...short];
}
