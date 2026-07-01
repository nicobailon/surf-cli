/**
 * Parser for surf `do` workflow commands
 * 
 * Parses newline-separated commands into structured step arrays:
 * 
 * Input:
 *   'go "https://example.com"
 *    click e5
 *    screenshot'
 * 
 * Output:
 *   [
 *     { cmd: 'navigate', args: { url: 'https://example.com' } },
 *     { cmd: 'click', args: { ref: 'e5' } },
 *     { cmd: 'screenshot', args: {} }
 *   ]
 */

// Aliases mapping (matches cli.cjs)
const ALIASES = {
  snap: "screenshot",
  read: "page.read",
  find: "search",
  go: "navigate",
  net: "network",
  "network.dump": "network.get",
};

// Primary argument mapping for positional args (matches cli.cjs)
const PRIMARY_ARG_MAP = {
  ai: "query",
  gemini: "query",
  chatgpt: "query",
  perplexity: "query",
  grok: "query",
  navigate: "url",
  go: "url",
  js: "code",
  javascript_tool: "code",
  key: "key",
  wait: "duration",
  health: "url",
  new_tab: "url",
  "tab.new": "url",
  switch_tab: "tab_id",
  "tab.switch": "id",
  close_tab: "tab_id",
  "tab.close": "id",
  "tab.name": "name",
  "tab.unname": "name",
  scroll_to_position: "position",
  type: "text",
  smart_type: "text",
  "emulate.network": "preset",
  "emulate.cpu": "rate",
  search: "term",
  find: "term",
  "wait.element": "selector",
  "wait.url": "pattern",
  zoom: "level",
  "history.search": "query",
  "network.get": "id",
  "network.body": "id",
  "network.curl": "id",
  "network.path": "id",
  "window.new": "url",
  "window.focus": "id",
  "window.close": "id",
  "locate.role": "role",
  "locate.text": "text",
  "locate.label": "label",
  "emulate.device": "device",
  "frame.js": "code",
  "element.styles": "selector",
  "select": "selector",
};

/**
 * Tokenize a command line, respecting single and double quotes
 * @param {string} line - Single line to tokenize
 * @returns {string[]} - Array of tokens
 */
function tokenize(line) {
  const tokens = [];
  let current = '';
  let inQuote = null;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    
    if (inQuote) {
      if (ch === inQuote) {
        // End of quoted string
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      // Start of quoted string
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      // Whitespace separator
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  
  // Don't forget last token
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

/**
 * Parse a single command line into a step object
 * @param {string} line - Single command line
 * @returns {{ cmd: string, args: object } | null}
 */
function parseCommandLine(line) {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;
  
  // Get command and apply alias
  let cmd = tokens[0];
  cmd = ALIASES[cmd] || cmd;
  
  const args = {};
  let i = 1;
  
  // Handle first positional argument based on command type
  if (i < tokens.length && !tokens[i].startsWith('--')) {
    const firstArg = tokens[i];
    
    // Special handling for click command
    if (cmd === 'click') {
      if (/^e\d+$/.test(firstArg)) {
        // Element reference: e5 -> ref
        args.ref = firstArg;
        i++;
      } else if (/^\d+$/.test(firstArg) && tokens[i + 1] && /^\d+$/.test(tokens[i + 1])) {
        // Coordinates: 100 200 -> x, y
        args.x = parseInt(firstArg, 10);
        args.y = parseInt(tokens[i + 1], 10);
        i += 2;
      }
    } else if (cmd === 'select') {
      // Select takes selector + one or more values: select e5 "US" or select e5 "opt1" "opt2"
      args.selector = firstArg;
      i++;
      // Collect remaining positional args as values
      const values = [];
      while (i < tokens.length && !tokens[i].startsWith('--')) {
        values.push(tokens[i]);
        i++;
      }
      // Host expects 'values' (always), matching CLI behavior
      if (values.length === 1) {
        args.values = values[0];  // Single value as string (host will wrap in array)
      } else if (values.length > 1) {
        args.values = values;     // Multiple values as array
      }
    } else if (cmd === 'scroll') {
      if (firstArg === 'top' || firstArg === 'bottom') {
        cmd = `scroll.${firstArg}`;
        i++;
      } else if (['up', 'down', 'left', 'right'].includes(firstArg)) {
        args.direction = firstArg;
        i++;
        if (i < tokens.length && /^-?\d+$/.test(tokens[i])) {
          args.scroll_pixels = parseInt(tokens[i], 10);
          i++;
        }
      }
    } else {
      // Use PRIMARY_ARG_MAP for other commands
      const primaryKey = PRIMARY_ARG_MAP[cmd];
      if (primaryKey) {
        args[primaryKey] = firstArg;
        i++;
      }
    }
  }
  
  // Parse --flag value pairs
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        // Flag with value
        let val = next;
        // Type coercion
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
        else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
        args[key] = val;
        i += 2;
      } else {
        // Boolean flag
        args[key] = true;
        i++;
      }
    } else {
      // Skip unrecognized positional (shouldn't happen normally)
      i++;
    }
  }
  
  return { cmd, args };
}

/**
 * Parse a workflow string into step array
 * Supports pipe-separated (inline) or newline-separated (file) commands
 * @param {string} input - Workflow string
 * @returns {Array<{ cmd: string, args: object }>}
 */
function parseDoCommands(input) {
  // Determine separator: use pipe if present, otherwise newlines
  // Pipe is preferred for inline: 'go "url" | click e5 | screenshot'
  // Newlines for files or heredocs
  const hasPipe = input.includes('|');
  const separator = hasPipe ? '|' : '\n';
  
  // Also handle literal \n for backwards compatibility
  const normalized = hasPipe ? input : input.replace(/\\n/g, '\n');
  
  return normalized
    .split(separator)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => parseCommandLine(line))
    .filter(step => step !== null);
}

module.exports = { 
  parseDoCommands, 
  parseCommandLine, 
  tokenize,
  ALIASES,
  PRIMARY_ARG_MAP
};
