# Network Capture Implementation Findings

Append-only log of issues, findings, and implementation details.
Search with: `rg "ISSUE:|FINDING:|FIX:|TODO:" FINDINGS.md`

---

## 2024-01-06: Initial Implementation

### FINDING: Chrome Service Worker Caching
Chrome aggressively caches extension service workers. Even after clicking "reload" in chrome://extensions, the old service worker code may continue running. 

**Symptoms:**
- Code changes in dist/ not reflected in runtime behavior
- Old message handlers still being used
- New features not working despite successful build

**Solutions:**
1. Go to `chrome://serviceworker-internals/` → find surf extension → click "Stop"
2. Or fully restart Chrome
3. Or disable/enable the extension (not just reload)

### FINDING: networkEntries Map Not Populating
The new `networkEntries` Map<tabId, Map<requestId, NetworkEntry>> was not being populated despite code appearing correct.

**Observed:**
- `networkRequests` array (old format) works: captures requests with basic data
- `networkEntries` Map (new format) returns empty
- Both populated by same `handleNetworkRequest()` function
- Compiled code shows correct Map operations

**Root cause:** TBD - likely service worker caching issue. Fallback implemented.

### FIX: Fallback to networkRequests Array
Added fallback in `getNetworkEntries()` to convert old `networkRequests` array to `NetworkEntry` format when the Map is empty:

```typescript
if (entriesMap && entriesMap.size > 0) {
  entries = Array.from(entriesMap.values());
} else {
  // Fallback to basic networkRequests
  const requests = this.networkRequests.get(tabId) || [];
  entries = requests.map((req, idx) => ({
    id: `r_${req.timestamp}_${idx}`,
    ts: req.timestamp,
    method: req.method,
    url: req.url,
    origin: this.extractOrigin(req.url),
    // ... basic fields
  } as NetworkEntry));
}
```

### FINDING: CDP Network Events Timing
Network tracking only captures requests that occur AFTER `Network.enable` is called. Requests from initial page load are missed if debugger attaches late.

**Implication:** First `surf network` call attaches debugger, but won't see requests from that page load. Need to trigger new requests or navigate to see data.

### TODO: Features Not Yet Tested
- [ ] Request body capture (POST data)
- [ ] Response body capture (inline for small, file ref for large)
- [ ] Headers capture
- [ ] Protobuf detection
- [ ] File storage in /tmp/surf/
- [ ] Auto-cleanup (24h TTL, 200MB max)
- [ ] Tiered output formats (compact, verbose, curl, raw)

---

## Architecture Notes

### Data Flow
```
CDP Events (Network.requestWillBeSent, responseReceived, loadingFinished)
    ↓
handleNetworkRequest() / handleNetworkResponse() / handleLoadingFinished()
    ↓
networkRequests (array) + networkEntries (Map)
    ↓
getNetworkEntries() / getNetworkRequests()
    ↓
Service Worker message handlers
    ↓
CLI formatters
```

### Storage Locations
- Memory: CDPController.networkEntries Map (per-tab, in service worker)
- Disk: /tmp/surf/ (planned, not yet implemented)
  - requests.jsonl - append-only log
  - bodies/<hash>.req/.res - content-addressed body storage

### Message Types
- `READ_NETWORK_REQUESTS` - old format, returns basic array (WORKS)
- `GET_NETWORK_ENTRIES` - new format, returns NetworkEntry[] (TESTING)
- `GET_NETWORK_ENTRY` - single entry by ID
- `GET_RESPONSE_BODY` - lazy load body
- `GET_NETWORK_ORIGINS` - aggregated origin stats

---

## 2024-01-06: Network Capture Working

### FIX: Use READ_NETWORK_REQUESTS Instead of GET_NETWORK_ENTRIES
The new `GET_NETWORK_ENTRIES` message wasn't populating data correctly (root cause still unclear - likely service worker singleton/Map issue). 

**Solution:** Changed `network` command in host.cjs to use proven `READ_NETWORK_REQUESTS`:
```javascript
case "network":
  return { 
    type: "READ_NETWORK_REQUESTS", 
    urlPattern: a.filter || a.url_pattern || a.origin,
    limit: a.limit || a.last,
    ...baseMsg 
  };
```

### FINDING: Native Host Caching
The native host process (`node host.cjs`) runs persistently. Changes to host.cjs require killing the process:
```bash
pkill -f "node.*host.cjs"
```
Chrome will automatically restart it on next CLI command.

### WORKING: Basic Network Capture
```bash
$ surf network --tab-id <id>
200 GET     Fetch      https://httpbin.org/uuid
200 GET     Fetch      https://httpbin.org/ip  
200 POST    Fetch      https://httpbin.org/post
```

Format: `STATUS METHOD TYPE URL` (compact, LLM-friendly)

### TODO: Still Needed
- [ ] Request/response headers capture
- [ ] Request/response body capture
- [ ] Verbose output modes (-v, -vv)
- [ ] curl format output
- [ ] Filter by method, status, type
- [ ] Persistent storage to /tmp/surf/
