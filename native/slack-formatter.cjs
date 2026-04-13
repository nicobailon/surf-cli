/**
 * Slack message formatter.
 *
 * Converts raw Slack API responses into structured markdown or JSON output.
 */

// ============================================================================
// Text cleaning
// ============================================================================

function cleanSlackText(text, userMap) {
  if (!text) return "";
  let out = text;
  // Replace user mentions: <@U123ABC> → @DisplayName
  out = out.replace(/<@([A-Z0-9]+)>/g, (_, id) => {
    const u = userMap?.[id];
    return "@" + (u?.displayName || u?.name || id);
  });
  // Replace channel mentions: <#C123|general> → #general
  out = out.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1");
  out = out.replace(/<#([A-Z0-9]+)>/g, "#$1");
  // Replace URLs: <https://example.com|label> → [label](url)
  out = out.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)");
  out = out.replace(/<(https?:\/\/[^>]+)>/g, "$1");
  // Special mentions
  out = out.replace(/<!here>/g, "@here");
  out = out.replace(/<!channel>/g, "@channel");
  out = out.replace(/<!everyone>/g, "@everyone");
  // HTML entities
  out = out.replace(/&amp;/g, "&");
  out = out.replace(/&lt;/g, "<");
  out = out.replace(/&gt;/g, ">");
  return out.trim();
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const ms = parseFloat(ts) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return ts;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h12}:${min} ${ampm}`;
}

// ============================================================================
// Markdown formatter
// ============================================================================

function formatHistoryMarkdown(result) {
  const { messages, threads, users, channel, messageCount, threadCount } = result;
  const lines = [];

  lines.push(`# Slack Channel: ${channel}`);
  lines.push(`*${messageCount} messages, ${threadCount} threads*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const sender = users[msg.user]?.displayName || users[msg.user]?.name || msg.user || "Unknown";
    const time = formatTimestamp(msg.ts);
    const text = cleanSlackText(msg.text, users);

    lines.push(`**${sender}** (${time}):`);
    if (text) lines.push(text);

    // Attachments summary
    if (msg.files?.length) {
      for (const f of msg.files) {
        lines.push(`📎 *${f.name || "file"}* (${f.mimetype || "unknown"})`);
      }
    }

    // Thread replies
    const replies = threads?.[msg.ts];
    if (replies?.length) {
      lines.push("");
      lines.push(`> **Thread** (${replies.length} replies):`);
      for (const reply of replies) {
        const rSender = users[reply.user]?.displayName || users[reply.user]?.name || reply.user || "Unknown";
        const rTime = formatTimestamp(reply.ts);
        const rText = cleanSlackText(reply.text, users);
        lines.push(`> **${rSender}** (${rTime}): ${rText}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatRepliesMarkdown(result) {
  const { messages, users, channel, threadTs } = result;
  const lines = [];

  lines.push(`# Thread in ${channel}`);
  lines.push(`*Thread: ${threadTs} — ${messages.length} messages*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const sender = users[msg.user]?.displayName || users[msg.user]?.name || msg.user || "Unknown";
    const time = formatTimestamp(msg.ts);
    const text = cleanSlackText(msg.text, users);

    const isParent = msg.ts === threadTs;
    const prefix = isParent ? "**[OP]** " : "";

    lines.push(`${prefix}**${sender}** (${time}):`);
    if (text) lines.push(text);
    lines.push("");
  }

  return lines.join("\n");
}

function formatChannelsMarkdown(result) {
  const { channels, channelCount } = result;
  const lines = [];

  lines.push(`# Slack Channels`);
  lines.push(`*${channelCount} channels*`);
  lines.push("");
  lines.push("| ID | Name | Members | Type | Topic |");
  lines.push("|---|---|---|---|---|");

  for (const ch of channels) {
    const type = ch.isIm ? "DM" : ch.isMpim ? "Group DM" : ch.isPrivate ? "Private" : "Public";
    const topic = (ch.topic || "").replace(/\|/g, "\\|").slice(0, 60);
    lines.push(`| ${ch.id} | #${ch.name} | ${ch.memberCount} | ${type} | ${topic} |`);
  }

  return lines.join("\n");
}

// ============================================================================
// JSON formatter
// ============================================================================

function formatHistoryJson(result) {
  const { messages, threads, users, channel } = result;
  return messages.map(msg => {
    const entry = {
      ts: msg.ts,
      user: msg.user,
      userName: users[msg.user]?.displayName || users[msg.user]?.name || msg.user,
      text: cleanSlackText(msg.text, users),
      rawText: msg.text,
      time: formatTimestamp(msg.ts),
    };
    if (msg.files?.length) {
      entry.files = msg.files.map(f => ({ name: f.name, type: f.mimetype, url: f.url_private }));
    }
    const replies = threads?.[msg.ts];
    if (replies?.length) {
      entry.thread = replies.map(r => ({
        ts: r.ts,
        user: r.user,
        userName: users[r.user]?.displayName || users[r.user]?.name || r.user,
        text: cleanSlackText(r.text, users),
        time: formatTimestamp(r.ts),
      }));
    }
    return entry;
  });
}

// ============================================================================
// Public API
// ============================================================================

function formatRepliesJson(result) {
  const { messages, users, threadTs } = result;
  return messages.map(msg => {
    const entry = {
      ts: msg.ts,
      user: msg.user,
      userName: users[msg.user]?.displayName || users[msg.user]?.name || msg.user,
      text: cleanSlackText(msg.text, users),
      rawText: msg.text,
      time: formatTimestamp(msg.ts),
      isParent: msg.ts === threadTs,
    };
    if (msg.files?.length) {
      entry.files = msg.files.map(f => ({ name: f.name, type: f.mimetype, url: f.url_private }));
    }
    return entry;
  });
}

function formatSlackResult(result, action, format) {
  if (format === "json") {
    switch (action) {
      case "history": return JSON.stringify(formatHistoryJson(result), null, 2);
      case "replies": return JSON.stringify(formatRepliesJson(result), null, 2);
      case "channels": return JSON.stringify(result, null, 2);
      default: return JSON.stringify(result, null, 2);
    }
  }

  // Default: markdown
  switch (action) {
    case "history": return formatHistoryMarkdown(result);
    case "replies": return formatRepliesMarkdown(result);
    case "channels": return formatChannelsMarkdown(result);
    default: return JSON.stringify(result, null, 2);
  }
}

module.exports = {
  formatSlackResult,
  cleanSlackText,
  formatTimestamp,
};
