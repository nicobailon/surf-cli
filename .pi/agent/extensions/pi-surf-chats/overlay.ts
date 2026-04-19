/**
 * overlay.ts — Two-pane TUI overlay for browsing ChatGPT conversations
 *
 * Left pane: conversation list with search
 * Right pane: conversation detail / status
 * Follows pi-tui Component + Focusable pattern (à la pi-side-chat, pi-messenger)
 *
 * Consumes lane-based ControllerState — no single `phase` field.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type TUI, type Component, type Focusable } from "@mariozechner/pi-tui";
import type { ControllerState } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toEpochMs(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? (value > 1e12 ? value : value * 1000) : 0;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatRelativeTime(value: unknown): string {
  const ms = toEpochMs(value);
  if (!ms) return "-";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return `${Math.floor(day / 7)}w`;
}

function padEndVisible(text: string, width: number): string {
  const w = visibleWidth(text);
  return w >= width ? truncateToWidth(text, width) : text + " ".repeat(width - w);
}

function padStartVisible(text: string, width: number): string {
  const w = visibleWidth(text);
  return w >= width ? truncateToWidth(text, width) : " ".repeat(width - w) + text;
}

function truncateVisible(text: string, max: number): string {
  return max <= 0 ? "" : truncateToWidth(text, max);
}

function compactPath(value: string | null, max: number): string {
  if (!value) return "not found";
  if (visibleWidth(value) <= max) return value;
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= 2) return truncateToWidth(value, max);
  const compact = `…/${parts.slice(-2).join("/")}`;
  return truncateToWidth(compact, max);
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""];
  if (!text) return [""];

  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      out.push("");
      continue;
    }

    let line = "";
    for (const ch of Array.from(rawLine)) {
      const candidate = line + ch;
      if (visibleWidth(candidate) <= width) {
        line = candidate;
      } else {
        out.push(line);
        line = ch;
      }
    }
    out.push(line);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay actions (returned to extension entry)
// ─────────────────────────────────────────────────────────────────────────────

export type OverlayAction =
  | { action: "inject"; conversationId: string; markdown: string; title: string }
  | { action: "export"; conversationId: string; title: string }
  | { action: "delete"; conversationIds: string[]; titles: string[] }
  | { action: "confirm_delete"; conversationIds: string[]; titles: string[] }
  | { action: "cancel_delete" }
  | { action: "toggle_mark"; conversationId: string }
  | { action: "load_list" }
  | { action: "load_more" }
  | { action: "search"; query: string }
  | { action: "load_detail"; conversationId: string };

export interface OverlayCallbacks {
  onAction: (action: OverlayAction) => void;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay Component
// ─────────────────────────────────────────────────────────────────────────────

export class SurfChatsOverlay implements Component, Focusable {
  private theme: Theme;
  private tui: TUI;
  private callbacks: OverlayCallbacks;
  private done: (result?: string) => void;
  private state: ControllerState;

  // Scroll state for detail pane
  private detailScrollOffset = 0;
  private detailTotalLines = 0;
  /** Line offsets where each message starts (for n/p jumping) */
  private messageLineOffsets: number[] = [];
  /** Total message count in current detail view */
  private messageCount = 0;

  focused = true;

  constructor(opts: {
    tui: TUI;
    theme: Theme;
    state: ControllerState;
    done: (result?: string) => void;
    callbacks: OverlayCallbacks;
  }) {
    this.tui = opts.tui;
    this.theme = opts.theme;
    this.state = opts.state;
    this.done = opts.done;
    this.callbacks = opts.callbacks;
  }

  /** Called by controller to update state and re-render */
  updateState(state: ControllerState): void {
    this.state = state;
    // Reset detail scroll when switching conversations
    if (state.loadedConversationId !== this.lastDetailId) {
      this.detailScrollOffset = 0;
      this.lastDetailId = state.loadedConversationId;
    }
    this.tui.requestRender();
  }
  private lastDetailId: string | null = null;

  // ─── Input handling ───────────────────────────────────────────────────────

  handleInput(data: string): void {
    const s = this.state;

    // ── Delete confirmation mode ──
    if (s.deletePrompt) {
      if (data === "y" || data === "Y") {
        this.callbacks.onAction({
          action: "confirm_delete",
          conversationIds: s.deletePrompt.conversationIds,
          titles: s.deletePrompt.titles,
        });
        return;
      }
      // Any other key cancels
      this.callbacks.onAction({ action: "cancel_delete" });
      return;
    }

    // Escape: search → detail → close (three-tier)
    if (matchesKey(data, "escape")) {
      if (s.searchEditActive) {
        this.callbacks.onAction({ action: "load_list" });
        return;
      }
      // If viewing a conversation detail, go back to list
      if (s.loadedConversationId) {
        s.loadedConversationId = null;
        this.detailScrollOffset = 0;
        this.tui.requestRender();
        return;
      }
      this.callbacks.onClose();
      this.done();
      return;
    }

    // Search edit mode: handle text input
    if (s.searchEditActive) {
      if (matchesKey(data, "return")) {
        const q = s.searchDraft.trim();
        if (q) {
          this.callbacks.onAction({ action: "search", query: q });
        } else {
          this.callbacks.onAction({ action: "load_list" });
        }
        return;
      }
      if (matchesKey(data, "backspace")) {
        s.searchDraft = s.searchDraft.slice(0, -1);
        this.tui.requestRender();
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        s.searchDraft += data;
        this.tui.requestRender();
        return;
      }
      return;
    }

    // ── Normal mode keybindings ──

    // / → enter search mode
    if (data === "/") {
      s.searchEditActive = true;
      s.searchDraft = s.activeQuery;
      this.tui.requestRender();
      return;
    }

    // j / k → always navigate list; trigger load_more at end
    if (data === "j") {
      if (s.items.length === 0) return;
      if (s.selectedIndex === s.items.length - 1 && s.hasMore && !s.listLane.isRunning) {
        this.callbacks.onAction({ action: "load_more" });
        return;
      }
      s.selectedIndex = Math.min(s.selectedIndex + 1, s.items.length - 1);
      this.detailScrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "k") {
      if (s.items.length === 0) return;
      s.selectedIndex = Math.max(0, s.selectedIndex - 1);
      this.detailScrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    // ↓ / ↑ arrows → scroll detail when loaded, otherwise navigate list
    if (matchesKey(data, "down")) {
      const sel = s.items[s.selectedIndex];
      if (sel && s.loadedConversationId === sel.id && s.detailCache.has(sel.id)) {
        const maxScroll = Math.max(0, this.detailTotalLines - this.detailViewHeight());
        this.detailScrollOffset = Math.min(this.detailScrollOffset + 3, maxScroll);
        this.tui.requestRender();
        return;
      }
      if (s.items.length === 0) return;
      if (s.selectedIndex === s.items.length - 1 && s.hasMore && !s.listLane.isRunning) {
        this.callbacks.onAction({ action: "load_more" });
        return;
      }
      s.selectedIndex = Math.min(s.selectedIndex + 1, s.items.length - 1);
      this.detailScrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "up")) {
      const sel = s.items[s.selectedIndex];
      if (sel && s.loadedConversationId === sel.id && s.detailCache.has(sel.id)) {
        this.detailScrollOffset = Math.max(this.detailScrollOffset - 3, 0);
        this.tui.requestRender();
        return;
      }
      if (s.items.length === 0) return;
      s.selectedIndex = Math.max(0, s.selectedIndex - 1);
      this.detailScrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    // PgUp/PgDn / J/K → scroll detail pane (larger jumps)
    if (matchesKey(data, "pageDown") || data === "J") {
      const maxScroll = Math.max(0, this.detailTotalLines - this.detailViewHeight());
      this.detailScrollOffset = Math.min(this.detailScrollOffset + 10, maxScroll);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "pageUp") || data === "K") {
      this.detailScrollOffset = Math.max(this.detailScrollOffset - 10, 0);
      this.tui.requestRender();
      return;
    }

    // n / p → jump to next/prev message in detail pane
    if (data === "n" && this.messageLineOffsets.length > 0) {
      const next = this.messageLineOffsets.find(off => off > this.detailScrollOffset + 1);
      if (next !== undefined) {
        const maxScroll = Math.max(0, this.detailTotalLines - this.detailViewHeight());
        this.detailScrollOffset = Math.min(next, maxScroll);
        this.tui.requestRender();
      }
      return;
    }
    if (data === "p" && this.messageLineOffsets.length > 0) {
      // Find the last offset before current scroll position
      let prev = 0;
      for (const off of this.messageLineOffsets) {
        if (off >= this.detailScrollOffset) break;
        prev = off;
      }
      this.detailScrollOffset = Math.max(prev, 0);
      this.tui.requestRender();
      return;
    }

    // Enter → load detail or inject if already cached
    if (matchesKey(data, "return")) {
      const selected = s.items[s.selectedIndex];
      if (!selected) return;

      const cached = s.detailCache.get(selected.id);
      if (cached) {
        if (s.loadedConversationId === selected.id) {
          // Already viewing detail → inject into context
          this.callbacks.onAction({
            action: "inject",
            conversationId: selected.id,
            markdown: cached.markdown,
            title: cached.summary.title,
          });
        } else {
          // Cached but not viewing → show detail (instant)
          s.loadedConversationId = selected.id;
          this.detailScrollOffset = 0;
          this.tui.requestRender();
        }
      } else {
        // Not cached → load
        this.callbacks.onAction({ action: "load_detail", conversationId: selected.id });
      }
      return;
    }

    // e → export
    if (data === "e") {
      const selected = s.items[s.selectedIndex];
      if (!selected) return;
      this.callbacks.onAction({
        action: "export",
        conversationId: selected.id,
        title: selected.title,
      });
      return;
    }

    // r → refresh list
    if (data === "r") {
      this.callbacks.onAction({ action: "load_list" });
      return;
    }

    // Space → toggle mark for batch operations
    if (data === " ") {
      const selected = s.items[s.selectedIndex];
      if (!selected) return;
      this.callbacks.onAction({ action: "toggle_mark", conversationId: selected.id });
      if (s.selectedIndex < s.items.length - 1) {
        s.selectedIndex++;
        this.detailScrollOffset = 0;
      }
      this.tui.requestRender();
      return;
    }

    // Delete / d → delete marked conversations (or current if none marked)
    if (matchesKey(data, "delete") || data === "d") {
      if (s.markedIds.size > 0) {
        const ids = Array.from(s.markedIds);
        const titles = ids.map(id => s.items.find(it => it.id === id)?.title ?? "(untitled)");
        this.callbacks.onAction({ action: "delete", conversationIds: ids, titles });
      } else {
        const selected = s.items[s.selectedIndex];
        if (!selected) return;
        this.callbacks.onAction({ action: "delete", conversationIds: [selected.id], titles: [selected.title] });
      }
      return;
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  render(width: number): string[] {
    const th = this.theme;
    if (width <= 0) return [];
    if (width < 8) return [truncateToWidth("surf", width)];

    const innerW = Math.max(1, width - 2);
    const border = (s: string) => th.fg("borderMuted", s);

    const lines: string[] = [];

    // ── Title bar ──
    const titleText = th.fg("accent", " 🏄 Surf Chats ");
    const modeText = this.state.mode === "search"
      ? th.fg("warning", ` Search: "${this.state.activeQuery}" `)
      : th.fg("dim", " Recent ");
    // Scroll position indicator (shown when viewing a detail with messages)
    let scrollIndicator = "";
    if (this.state.loadedConversationId && this.messageCount > 0) {
      // Find which message is currently visible
      let currentMsg = 0;
      for (let i = 0; i < this.messageLineOffsets.length; i++) {
        if (this.messageLineOffsets[i]! <= this.detailScrollOffset + 2) currentMsg = i;
      }
      const pct = this.detailTotalLines > 0
        ? Math.round((this.detailScrollOffset / Math.max(1, this.detailTotalLines - this.detailViewHeight())) * 100)
        : 0;
      const clampedPct = Math.min(100, Math.max(0, pct));
      scrollIndicator = th.fg("dim", ` msg ${currentMsg + 1}/${this.messageCount} · ${clampedPct}% `);
    }
    lines.push(
      border("┌") +
      truncateToWidth(padEndVisible(titleText + modeText + scrollIndicator, innerW), innerW) +
      border("┐")
    );

    // ── Search bar ──
    if (this.state.searchEditActive) {
      const prompt = th.fg("accent", " Search: ");
      const draft = th.fg("text", this.state.searchDraft + "▌");
      lines.push(this.frameLine(prompt + draft, innerW, border));
    }

    // ── Delete confirmation banner ──
    if (this.state.deletePrompt) {
      const count = this.state.deletePrompt.conversationIds.length;
      const label = count > 1
        ? `${count} conversations`
        : `"${truncateVisible(this.state.deletePrompt.titles[0] ?? "(untitled)", Math.max(1, innerW - 24))}"`;
      const confirmMsg = th.fg("error", ` ⚠ Delete ${label}? `) +
        th.fg("warning", "y") + th.fg("dim", "/") + th.fg("text", "n");
      lines.push(this.frameLine(confirmMsg, innerW, border));
    }

    // ── Status bar (derived from lane states) ──
    if (this.state.statusBar) {
      const sb = this.state.statusBar;
      const icon = sb.level === "error" ? "✗" : sb.level === "progress" ? "⟳" : "ℹ";
      const color = sb.level === "error" ? "error" : sb.level === "progress" ? "warning" : "dim";
      const statusLine = th.fg(color, ` ${icon} ${sb.message}`);
      lines.push(this.frameLine(statusLine, innerW, border));
    }

    // ── Split area: list (left 42%) + detail (right 58%) ──
    const availableRows = this.availableRows(lines.length);
    const leftW = Math.floor(innerW * 0.42);
    const rightW = innerW - leftW - 1;
    const sep = th.fg("borderMuted", "│");

    const leftLines = this.renderList(leftW);
    const rightLines = this.renderDetail(rightW);

    this.detailTotalLines = rightLines.length;

    const detailViewH = availableRows;
    const visibleRight = rightLines.slice(this.detailScrollOffset, this.detailScrollOffset + detailViewH);

    const maxRows = Math.max(leftLines.length, visibleRight.length, availableRows);
    for (let i = 0; i < Math.min(maxRows, availableRows); i++) {
      const left = padEndVisible(leftLines[i] ?? "", leftW);
      const right = visibleRight[i] ?? "";
      lines.push(
        border("│") +
        truncateToWidth(left, leftW) +
        sep +
        truncateToWidth(padEndVisible(right, rightW), rightW) +
        border("│")
      );
    }

    // ── Footer hints + debug ──
    const moreHint = !this.state.searchEditActive && this.state.hasMore && this.state.mode === "recent" ? " • j/↓ more" : "";
    const viewingDetail = this.state.loadedConversationId && this.messageCount > 0;
    const hints = this.state.searchEditActive
      ? "Enter submit • Esc cancel"
      : this.state.deletePrompt
        ? "y confirm delete • any other key cancel"
        : viewingDetail
          ? `↑↓ scroll • n/p next/prev msg • J/K page • Enter inject • Esc back${moreHint}`
          : `j/k list • ↑↓ scroll • Space mark • Enter load • / search • e export • d del • r refresh • Esc${moreHint}`;
    const debugCli = ` CLI: ${compactPath(this.state.resolvedCliPath, Math.max(8, innerW - 6))}`;
    const debugFmt = ` Formatter: ${compactPath(this.state.resolvedFormatterPath, Math.max(8, innerW - 12))}`;
    const debugProfile = ` Profile: ${this.state.resolvedProfile ?? "none"}`;
    lines.push(border("├") + border("─".repeat(innerW)) + border("┤"));
    lines.push(this.frameLine(th.fg("dim", ` ${hints}`), innerW, border));
    lines.push(this.frameLine(th.fg("muted", debugCli), innerW, border));
    lines.push(this.frameLine(th.fg("muted", debugFmt), innerW, border));
    lines.push(this.frameLine(th.fg("muted", debugProfile), innerW, border));

    // ── Export notification ──
    if (this.state.exportLane.lastExportPath) {
      lines.push(this.frameLine(th.fg("success", ` ✓ Exported: ${this.state.exportLane.lastExportPath}`), innerW, border));
    }

    lines.push(border("└") + border("─".repeat(innerW)) + border("┘"));

    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.focused = false;
  }

  // ─── Private renderers ────────────────────────────────────────────────────

  private frameLine(content: string, innerW: number, border: (s: string) => string): string {
    return border("│") + truncateToWidth(padEndVisible(content, innerW), innerW) + border("│");
  }

  private availableRows(headerLines: number): number {
    const termRows = this.tui.terminal.rows || 24;
    const maxOverlay = Math.floor(termRows * 0.7);
    return Math.max(5, maxOverlay - headerLines - 7);
  }

  private detailViewHeight(): number {
    return this.availableRows(3);
  }

  private renderList(width: number): string[] {
    const th = this.theme;
    const s = this.state;
    const lines: string[] = [];

    if (s.items.length === 0 && !s.listLane.isRunning) {
      lines.push(th.fg("muted", " No conversations"));
      return lines;
    }
    if (s.items.length === 0) return lines;

    const listViewH = this.availableRows(3);
    const listScrollOffset = Math.max(0, s.selectedIndex - listViewH + 3);
    const visibleItems = s.items.slice(listScrollOffset, listScrollOffset + listViewH);

    const timeW = Math.min(5, Math.max(3, Math.floor(width * 0.22)));
    const titleW = Math.max(1, width - timeW - 2);

    for (let vi = 0; vi < visibleItems.length; vi++) {
      const i = listScrollOffset + vi;
      const item = visibleItems[vi]!;
      const isSelected = i === s.selectedIndex;
      const isCached = s.detailCache.has(item.id);
      const isMarked = s.markedIds.has(item.id);
      const prefix = isSelected ? th.fg("accent", "→") : " ";
      const time = formatRelativeTime(item.update_time);
      const title = truncateVisible(item.title, titleW);
      const cachedMark = isMarked ? th.fg("warning", "●") : isCached ? th.fg("success", "•") : " ";

      const line = `${prefix}${cachedMark}` +
        th.fg(isSelected ? "accent" : "text", padEndVisible(title, titleW)) +
        th.fg("dim", padStartVisible(time, timeW));

      lines.push(truncateToWidth(line, width));
    }

    // Footer
    if (s.hasMore && !s.listLane.isRunning && s.mode === "recent") {
      lines.push(th.fg("dim", truncateToWidth(" ↓ more (press j)", width)));
    } else if (s.listLane.isRunning) {
      lines.push(th.fg("warning", truncateToWidth(" ⟳ loading…", width)));
    }

    return lines;
  }

  private renderDetail(width: number): string[] {
    const th = this.theme;
    const s = this.state;
    const lines: string[] = [];

    // Clear message tracking — only re-populated when actively showing detail
    this.messageLineOffsets = [];
    this.messageCount = 0;

    const selected = s.items[s.selectedIndex];
    if (!selected) {
      lines.push(th.fg("muted", " Select a conversation"));
      return lines;
    }

    // Per-conversation error from detail lane
    const detailError = s.detailLane.errorsByConversationId.get(selected.id);
    if (detailError) {
      lines.push(th.fg("error", ` Error: ${detailError.message}`));
      if (detailError.stderr) {
        for (const l of detailError.stderr.split("\n").slice(0, 5)) {
          lines.push(th.fg("dim", ` ${l}`));
        }
      }
      lines.push("");
      lines.push(th.fg("muted", " Press Enter to retry"));
      return lines;
    }

    // Loading detail (active or queued)
    if (s.detailLane.activeConversationId === selected.id) {
      lines.push(th.fg("warning", " ⟳ Loading conversation..."));
      lines.push(th.fg("dim", " (CloakBrowser may take 10-30s)"));
      return lines;
    }
    if (s.detailLane.queuedConversationIds.includes(selected.id)) {
      lines.push(th.fg("warning", " ⟳ Queued…"));
      return lines;
    }

    // Cached detail available — only show when actively viewing (loadedConversationId)
    const cached = s.loadedConversationId === selected.id ? s.detailCache.get(selected.id) : null;
    if (cached) {
      lines.push(th.fg("accent", ` ${truncateVisible(cached.summary.title, Math.max(1, width - 1))}`));
      const meta = [
        cached.summary.model,
        `${cached.summary.totalMessages} msgs`,
      ].filter(Boolean).join(" · ");
      lines.push(th.fg("dim", ` ${truncateVisible(meta, Math.max(1, width - 1))}`));
      lines.push(th.fg("borderMuted", " " + "─".repeat(Math.max(0, width - 2))));

      if (cached.summary.messages.length === 0) {
        const maxTextW = Math.max(1, width - 2);
        lines.push("");
        lines.push(th.fg("dim", " Markdown preview"));
        for (const tl of wrapText(cached.markdown, maxTextW).slice(0, 80)) {
          lines.push(th.fg("dim", ` ${truncateToWidth(tl, maxTextW)}`));
        }
      } else {
        this.messageCount = cached.summary.messages.length;
        for (let mi = 0; mi < cached.summary.messages.length; mi++) {
          const msg = cached.summary.messages[mi]!;
          const who = msg.role === "user" ? th.fg("accent", "You") : th.fg("text", "ChatGPT");
          // Record line offset for this message (the blank line before it)
          this.messageLineOffsets.push(lines.length);
          lines.push("");
          lines.push(` ${who}`);

          const maxTextW = Math.max(1, width - 2);
          for (const tl of wrapText(msg.text, maxTextW)) {
            lines.push(th.fg("dim", ` ${truncateToWidth(tl, maxTextW)}`));
          }
        }
      }

      lines.push("");
      lines.push(th.fg("success", " Enter → inject into context"));
      return lines;
    }

    // Not loaded yet
    lines.push(th.fg("text", ` ${truncateVisible(selected.title, Math.max(1, width - 1))}`));
    lines.push(th.fg("dim", ` ID: ${selected.id}`));
    lines.push(th.fg("dim", ` Updated: ${formatRelativeTime(selected.update_time)}`));
    lines.push("");
    lines.push(th.fg("muted", " Press Enter to load conversation"));

    return lines;
  }
}
