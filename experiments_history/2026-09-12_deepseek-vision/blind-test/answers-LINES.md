
## Layout LINES: 4 pages, 372056 bytes


### function list (tokens=3898)

export buildMessageStar
export isMessageStar
export extractSystemStemParts
export extractSystemStem
export formatLayer1SummaryDisplay
export isMessageStar
export isLayer1SummaryText
export isLayer1SummaryMessage
export countMessageChars
function isLayer1SummaryText
function isLayer1SummaryMessage
function countMessageChars
export computeOpenWindowTokens
export hasFoldedContent
export isSummaryRequestMessage
export isValidSummaryBody
export diagnoseSummaryGaps
export gapFillRequest
export mergeSummarySegments
export isAssistantTurnComplete
export extractSemanticVector
export formatSummaryConvoStyle
export isSummaryRequestMessage
export extractDecisions
export renderSummaryBlock
export stripReminderBlocks
export stripReminderBlocks
function collapseToolOutput
function countMessageChars
function stripReminderBlocks
function collapseToolOutput
function buildMessageStar
function renderSummaryBlock
export extractSummaryLinks
export isOverflow
export compact
export compact
export runCompaction
export runCompaction
export runCompactionForSession
export asSessionCompaction


### named constants (tokens=3896)

SIGNATURE = "Compacted"
SUMMARY_INTERVAL_TOKENS = 64
SUMMARY_ATTEMPTS = 2
MIN_TOKENS = 32768
MAX_SUMMARY_BODY_TOKENS = 16384
CHARS_PER_TOKEN = 4
TAIL_TOOL_KEEP_FULL = 3
TAIL_TOOL_HEAD_LINES = 40
TAIL_TOOL_TAIL_LINES = 10
DECISIONS_MAX_CHARS = 8192
MIN_SUMMARY_SECTION_CHARS = 40


### specific value (tokens=3895)

SUMMARY_INTERVAL_TOKENS=64636
MAX_SUMMARY_BODY_TOKENS=168384


### purpose + line (tokens=3889)

PURPOSE: Computes tiktoken token estimates for open-window messages using a 646-token reserve and keeping the latest ~32k tokens of LLM-visible messages.
LINE: ~174
