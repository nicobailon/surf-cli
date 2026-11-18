// Network request formatters for surf-cli

/**
 * Format bytes to human readable size
 */
function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * Format milliseconds to human readable duration
 */
function formatDuration(ms) {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format timestamp to readable time
 */
function formatTimestamp(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

/**
 * Get content type shorthand
 */
function getContentTypeShort(contentType) {
  if (!contentType) return '-';
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('javascript')) return 'js';
  if (ct.includes('css')) return 'css';
  if (ct.includes('image/')) return 'img';
  if (ct.includes('font')) return 'font';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('text/plain')) return 'text';
  if (ct.includes('protobuf') || ct.includes('proto')) return 'proto';
  if (ct.includes('octet-stream')) return 'bin';
  if (ct.includes('form')) return 'form';
  return ct.split('/').pop()?.split(';')[0]?.slice(0, 6) || '-';
}

/**
 * Get status code style indicator
 */
function getStatusIndicator(status) {
  if (!status) return '...';
  if (status >= 200 && status < 300) return String(status);
  if (status >= 300 && status < 400) return `${status}→`;
  if (status >= 400 && status < 500) return `${status}!`;
  if (status >= 500) return `${status}!!`;
  return String(status);
}

/**
 * Compact table format (default)
 * Groups by origin with time gaps
 */
function formatCompact(entries, options = {}) {
  if (!entries || entries.length === 0) {
    return 'No network requests captured';
  }

  const lines = [];
  const { verbose } = options;
  
  // Header
  const header = 'ID       │ Method │ Status │ Type  │ Size   │ Time   │ URL';
  const separator = '─────────┼────────┼────────┼───────┼────────┼────────┼' + '─'.repeat(50);
  lines.push(header);
  lines.push(separator);
  
  let lastOrigin = null;
  let lastTime = null;
  
  for (const e of entries) {
    const origin = e.origin || new URL(e.url).origin;
    const timestamp = e.timestamp || e.startTime;
    
    // Add origin separator if changed
    if (lastOrigin && origin !== lastOrigin) {
      lines.push('─────────┼────────┼────────┼───────┼────────┼────────┼' + '─'.repeat(50));
    }
    
    // Add time gap indicator (> 5 seconds)
    if (lastTime && timestamp && (timestamp - lastTime) > 5000) {
      const gap = formatDuration(timestamp - lastTime);
      lines.push(`         │        │        │       │        │ +${gap.padEnd(5)} │`);
    }
    
    const id = (e.requestId || e.id || '-').slice(0, 8).padEnd(8);
    const method = (e.method || 'GET').padEnd(6);
    const status = getStatusIndicator(e.status).padEnd(6);
    const type = getContentTypeShort(e.contentType || e.responseHeaders?.['content-type']).padEnd(5);
    const size = formatSize(e.responseSize || e.encodedDataLength).padEnd(6);
    const time = formatDuration(e.duration || e.time).padEnd(6);
    const url = truncateUrl(e.url, 60);
    
    lines.push(`${id} │ ${method} │ ${status} │ ${type} │ ${size} │ ${time} │ ${url}`);
    
    lastOrigin = origin;
    lastTime = timestamp;
  }
  
  // Summary
  lines.push('');
  const totalSize = entries.reduce((acc, e) => acc + (e.responseSize || e.encodedDataLength || 0), 0);
  lines.push(`Total: ${entries.length} requests, ${formatSize(totalSize)}`);
  
  return lines.join('\n');
}

/**
 * Just URLs with method
 */
function formatUrls(entries) {
  if (!entries || entries.length === 0) {
    return '';
  }
  return entries.map(e => `${(e.method || 'GET').padEnd(6)} ${e.url}`).join('\n');
}

/**
 * Generate curl command for a single request
 */
function formatCurl(entry) {
  if (!entry) return '';
  
  let cmd = `curl -X ${entry.method || 'GET'} '${entry.url}'`;
  
  const headers = entry.requestHeaders || {};
  const skipHeaders = ['host', 'content-length', 'connection', 'accept-encoding'];
  
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      const escapedValue = String(value).replace(/'/g, "'\\''");
      cmd += ` \\\n  -H '${key}: ${escapedValue}'`;
    }
  }
  
  if (entry.requestBody) {
    const escapedBody = entry.requestBody.replace(/'/g, "'\\''");
    cmd += ` \\\n  -d '${escapedBody}'`;
  }
  
  return cmd;
}

/**
 * Generate curl commands for multiple entries
 */
function formatCurlBatch(entries) {
  if (!entries || entries.length === 0) {
    return '';
  }
  return entries.map(e => formatCurl(e)).join('\n\n');
}

/**
 * Full JSON output
 */
function formatRaw(entries) {
  // Return as object with entries key so CLI can detect it
  return JSON.stringify({ entries, _format: 'raw' }, null, 2);
}

/**
 * Verbose format with headers and body preview
 */
function formatVerbose(entries, level = 1) {
  if (!entries || entries.length === 0) {
    return 'No network requests captured';
  }
  
  const lines = [];
  const bodyLimit = level >= 2 ? Infinity : 2048;
  
  for (const e of entries) {
    lines.push('═'.repeat(80));
    lines.push(`${e.method || 'GET'} ${e.url}`);
    lines.push(`ID: ${e.requestId || e.id || '-'}  Status: ${e.status || 'pending'}  Time: ${formatDuration(e.duration || e.time)}`);
    lines.push('');
    
    // Request headers
    if (e.requestHeaders && Object.keys(e.requestHeaders).length > 0) {
      lines.push('▶ Request Headers:');
      const reqHeaders = level >= 2 
        ? e.requestHeaders 
        : pickHeaders(e.requestHeaders, ['content-type', 'authorization', 'cookie', 'user-agent', 'accept']);
      for (const [k, v] of Object.entries(reqHeaders)) {
        lines.push(`  ${k}: ${truncateValue(v, 100)}`);
      }
      lines.push('');
    }
    
    // Request body
    if (e.requestBody) {
      lines.push('▶ Request Body:');
      lines.push(formatBody(e.requestBody, bodyLimit));
      lines.push('');
    }
    
    // Response headers
    if (e.responseHeaders && Object.keys(e.responseHeaders).length > 0) {
      lines.push('◀ Response Headers:');
      const resHeaders = level >= 2 
        ? e.responseHeaders 
        : pickHeaders(e.responseHeaders, ['content-type', 'content-length', 'set-cookie', 'location', 'cache-control']);
      for (const [k, v] of Object.entries(resHeaders)) {
        lines.push(`  ${k}: ${truncateValue(v, 100)}`);
      }
      lines.push('');
    }
    
    // Response body preview
    if (e.responseBody) {
      lines.push('◀ Response Body:');
      lines.push(formatBody(e.responseBody, bodyLimit));
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Format a single entry in detail
 */
function formatEntry(entry) {
  if (!entry) return 'Request not found';
  return formatVerbose([entry], 2);
}

/**
 * Origins summary table
 * Accepts either array of {origin, count, totalSize, lastSeen} or 
 * object map of {origin: {count, size, lastSeen}}
 */
function formatOrigins(origins) {
  if (!origins) {
    return 'No origins captured';
  }
  
  // Convert object map to array if needed
  let originsArray;
  if (Array.isArray(origins)) {
    originsArray = origins;
  } else if (typeof origins === 'object') {
    originsArray = Object.entries(origins).map(([origin, data]) => ({
      origin,
      count: data.count || 0,
      totalSize: data.size || data.totalSize || 0,
      lastSeen: data.lastSeen || 0
    }));
  } else {
    return 'No origins captured';
  }
  
  if (originsArray.length === 0) {
    return 'No origins captured';
  }
  
  const lines = [];
  const header = 'Origin'.padEnd(40) + ' │ Requests │ Size    │ Last Seen';
  const separator = '─'.repeat(40) + '─┼──────────┼─────────┼' + '─'.repeat(20);
  lines.push(header);
  lines.push(separator);
  
  for (const o of originsArray) {
    const origin = truncateUrl(o.origin, 38).padEnd(40);
    const count = String(o.count || 0).padEnd(8);
    const size = formatSize(o.totalSize || 0).padEnd(7);
    const lastSeen = formatTimestamp(o.lastSeen);
    
    lines.push(`${origin} │ ${count} │ ${size} │ ${lastSeen}`);
  }
  
  return lines.join('\n');
}

/**
 * Format network stats
 */
function formatStats(stats) {
  if (!stats) return 'No stats available';
  
  const lines = [];
  lines.push('Network Capture Statistics');
  lines.push('═'.repeat(40));
  lines.push(`Total Requests:    ${stats.totalRequests || 0}`);
  lines.push(`Total Size:        ${formatSize(stats.totalSize || 0)}`);
  lines.push(`Unique Origins:    ${stats.uniqueOrigins || 0}`);
  lines.push(`Capture Start:     ${formatTimestamp(stats.startTime)}`);
  lines.push(`Duration:          ${formatDuration(stats.duration)}`);
  lines.push('');
  
  if (stats.byMethod) {
    lines.push('By Method:');
    for (const [method, count] of Object.entries(stats.byMethod)) {
      lines.push(`  ${method.padEnd(8)} ${count}`);
    }
    lines.push('');
  }
  
  if (stats.byStatus) {
    lines.push('By Status:');
    for (const [status, count] of Object.entries(stats.byStatus)) {
      lines.push(`  ${status.padEnd(8)} ${count}`);
    }
  }
  
  return lines.join('\n');
}

// Helper functions

function truncateUrl(url, maxLen = 60) {
  if (!url) return '-';
  if (url.length <= maxLen) return url;
  
  try {
    const u = new URL(url);
    const pathLen = maxLen - u.origin.length - 3;
    if (pathLen > 10) {
      return u.origin + u.pathname.slice(0, pathLen) + '...';
    }
  } catch {}
  
  return url.slice(0, maxLen - 3) + '...';
}

function truncateValue(value, maxLen = 100) {
  const str = String(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function pickHeaders(headers, keys) {
  const result = {};
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lowerKey) {
        result[k] = v;
        break;
      }
    }
  }
  return result;
}

function formatBody(body, maxLen = 2048) {
  if (!body) return '  (empty)';
  
  let str = typeof body === 'string' ? body : JSON.stringify(body);
  
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(str);
    str = JSON.stringify(parsed, null, 2);
  } catch {}
  
  // Indent and truncate
  const lines = str.split('\n');
  const truncated = lines.slice(0, 50).map(l => '  ' + l);
  
  if (str.length > maxLen) {
    truncated.push(`  ... (${formatSize(str.length)} total, truncated)`);
  } else if (lines.length > 50) {
    truncated.push(`  ... (${lines.length - 50} more lines)`);
  }
  
  return truncated.join('\n');
}

module.exports = { 
  formatCompact, 
  formatUrls, 
  formatCurl, 
  formatCurlBatch,
  formatRaw, 
  formatVerbose,
  formatEntry,
  formatOrigins,
  formatStats,
  formatSize,
  formatDuration,
  formatTimestamp,
  getContentTypeShort
};
