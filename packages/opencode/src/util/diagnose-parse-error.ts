/**
 * JSON/XML parse error diagnosis for LLM-generated tool call arguments.
 *
 * When the AI SDK's `JSON.parse()` fails on an LLM-generated tool call,
 * the raw error (e.g. "JSON Parse error: Unterminated string") tells
 * the model what went wrong but not how to fix it. This module augments
 * the error with a targeted hint based on the error pattern.
 *
 * Supports both JSON and XML error patterns.
 */
export function diagnoseParseError(rawError: string): string {
  const hint = pickHint(rawError)
  return `${rawError}\n\nHint: ${hint}`
}

function pickHint(msg: string): string {
  // ── JSON errors ──────────────────────────────────────────────────────
  if (msg.includes("Unterminated string")) {
    return 'Your JSON has an open string value that wasn\'t closed. Every string must end with a double-quote character ("). If your prompt parameter text is very long, ensure you add the closing " immediately after the final text character.'
  }
  if (msg.includes("Unrecognized token")) {
    return 'Your JSON contains characters that are not valid JSON tokens. This is often caused by using Unicode smart/curly quotes (\u201C, \u201D, \u2018, \u2019) or ASCII single quotes (\') instead of plain ASCII double quotes ("). Valid JSON requires double quotes for ALL strings (keys and values). Replace any single or smart quotes with straight double quotes.'
  }
  if (msg.includes("Unexpected token") || msg.includes("Expected")) {
    return "Your JSON has a syntax error. Check for missing commas between fields, trailing commas (not allowed in JSON), or unquoted property names."
  }
  if (msg.includes("Unexpected end")) {
    return "Your JSON appears to be truncated. Ensure all objects are closed with } and all arrays with ]."
  }

  // ── XML errors ───────────────────────────────────────────────────────
  if (msg.includes("XML") || msg.includes("xml") || msg.includes("tag")) {
    if (msg.includes("unclosed") || msg.includes("Unclosed") || msg.includes("mismatched")) {
      return "Your XML has unclosed or mismatched tags. Every opening tag like <tag> must have a matching closing tag </tag>. Check that all tags are properly closed and nested correctly."
    }
    if (msg.includes("attribute") || msg.includes("malformed")) {
      return "Your XML has malformed attributes. Ensure attributes use the format name=\"value\" with straight ASCII double quotes. No single quotes or smart/curly quotes."
    }
    return "Your XML is malformed. Double-check that all tags are properly opened and closed, attributes use name=\"value\" syntax with straight double quotes, and tags are correctly nested."
  }

  return 'Your tool arguments are malformed. Double-check that all strings are quoted with plain ASCII double-quotes (not curly/smart quotes \u201C\u201D), objects closed with }, arrays closed with ], and there are no trailing commas. For XML: ensure all tags are closed, attributes use name="value" syntax, and tags are properly nested.'
}


