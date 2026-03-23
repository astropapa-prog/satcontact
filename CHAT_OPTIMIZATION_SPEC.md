# Chat Optimization Specification

All changes target a single file: `news.js` (1297 lines). HTML and CSS changes are minimal.

## Change 1: Constants (lines 19-26)

| Constant | Was | Now | Reason |
|---|---|---|---|
| MAX_VIDEO_SIZE | 10 * 1024 * 1024 (10 MB) | 25 * 1024 * 1024 (25 MB) | Allows uploading 20-40s 720p video; B2 economics allow it |
| LISTING_CACHE_TTL | 90000 (90 sec) | 30000 (30 sec) | Sync with new polling interval |
| POLL_INTERVAL | 90000 (90 sec) | 30000 (30 sec) | Faster chat updates |

Add new constant after POLL_INTERVAL:
```js
const INACTIVITY_TIMEOUT = 300000;  // 5 min — auto-collapse chat
```

## Change 2: New state variables (after line 58)

```js
let inactivityTimer = null;
let lastListedKey = '';
```

## Change 3: Reset new variables in cleanupNews (lines 151-170)

- Add `stopInactivityTimer();` after `stopPolling();`
- Add `lastListedKey = '';` after `pendingReply = null;`

## Change 4: fetchFileList — full and incremental modes (lines 386-416)

Full replacement with support for:
- `incremental` parameter (boolean)
- Full mode: pagination via continuation-token (up to 10 requests x 1000, total up to 10,000 files)
- Incremental mode: start-after=lastListedKey, max-keys=100

## Change 5: New helper function parseS3ListXmlMeta (after line 1291)

Extracts IsTruncated and NextContinuationToken from S3 XML response.

## Change 6: toggleChat and re-open (lines 211-230)

- Re-open calls checkForNewMessagesFull() instead of checkForNewMessages()
- Add resetInactivityTimer() when expanding
- Add stopInactivityTimer() when collapsing

## Change 7a: checkForNewMessages() — incremental (replaces lines 978-1037)

Called by polling every 30 sec. Uses fetchFileList(false, true).

## Change 7b: checkForNewMessagesFull() — full (new function after checkForNewMessages)

Called on re-open and manual refresh. Uses fetchFileList(false, false). Detects deletions.

## Change 8: Auto-collapse by inactivity (new functions in POLLING section)

- resetInactivityTimer()
- stopInactivityTimer()
- collapseByInactivity()

## Change 9: Activity tracking in bindEvents()

Listen for scroll, click, touchstart, keydown on chat container + input on textInput.

## Change 10: startPolling() — no changes needed

checkForNewMessages() is now the incremental version.

## Change 11: onVisibilityChange (lines 972-976)

Call checkForNewMessagesFull() + resetInactivityTimer().

## Change 12: Refresh button handler

Add lastListedKey = '' and reset flags.

## Change 13: Video size alert — automatic

Uses MAX_VIDEO_SIZE dynamically, auto-updates after constant change.

## Testing

1. Open chat -> full listing (Network: requests with prefix=messages/, no start-after)
2. Wait 30 sec -> incremental request (Network: request with start-after=..., max-keys=100)
3. Send message from another browser -> appears within 30 sec
4. Don't touch chat for 5 minutes -> chat collapses, polling stops
5. Expand chat -> full listing (no start-after)
6. Switch to "Personal" tab -> DMs work
7. Switch to "Replies to me" -> filter works
8. Upload 20 MB video -> should succeed (was limited to 10 MB)
