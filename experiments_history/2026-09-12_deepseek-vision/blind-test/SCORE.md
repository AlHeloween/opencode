# Blind test score: reading code from pixels

source: 1181 lines, 51705 chars, 33 functions, 16 consts

## Layout LINES

### function names
- listed: 28, of which real: 17 (**recall 51.5%**)
- invented (not in file): 11 (**precision 60.7%**)
- examples invented: extractSystemStemParts, extractSystemStem, countMessageChars, hasFoldedContent, mergeSummarySegments, formatSummaryConvoStyle, isOverflow, compact, runCompaction, runCompactionForSession, asSessionCompaction
- examples missed: formatExactSystemStamp, messageText, contentChars, isSummaryAssistant, selectRecentTail, computeOutputSinceLastSummary, isTerminalSummaryRequestMessage, summaryTerminalMarker, summaryAttemptCount, layer1SummaryThreshold, hasFoldableContent, hasPendingSummaryRequest

### constant names
- listed: 11, of which real: 7 (**recall 43.8%**)
- invented: 4 (**precision 63.6%**)

### asked values
- truth: SUMMARY_INTERVAL_TOKENS=65_536, MAX_SUMMARY_BODY_TOKENS=16_384
- SUMMARY_INTERVAL_TOKENS: answered 64636 -> **wrong**
- MAX_SUMMARY_BODY_TOKENS: answered 168384 -> **wrong**

## Layout FLOW

### function names
- listed: 27, of which real: 4 (**recall 12.1%**)
- invented (not in file): 23 (**precision 14.8%**)
- examples invented: renderSummary, isSummaryText, isSummaryAssistantMessage, isSummaryUserMessage, isSummaryMessage, buildSummaryBlock, countContentChars, renderMessageText, summarisePrompt, messageStarTokens, isRenderableStar, isFoldable
- examples missed: isLayer1SummaryText, isLayer1SummaryMessage, formatExactSystemStamp, formatLayer1SummaryDisplay, isMessageStar, messageText, contentChars, isSummaryAssistant, computeOutputSinceLastSummary, isSummaryRequestMessage, isTerminalSummaryRequestMessage, summaryTerminalMarker

### constant names
- listed: 7, of which real: 7 (**recall 43.8%**)
- invented: 0 (**precision 100%**)

### asked values
- truth: SUMMARY_INTERVAL_TOKENS=65_536, MAX_SUMMARY_BODY_TOKENS=16_384
- SUMMARY_INTERVAL_TOKENS: answered 40000 -> **wrong**
- MAX_SUMMARY_BODY_TOKENS: answered 20480 -> **wrong**

## Cost

- pages: 4 per layout
- tokens as images: 4 x 963 = 3852 (measured 3,895-3,898 per question)
- the same file as text: 51705 chars / 3.33 ~= 15527 tokens
- text/images ~= 4.03x
