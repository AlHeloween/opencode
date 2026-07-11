/**
 * JSON parse error diagnosis for LLM-generated tool call arguments.
 *
 * When the AI SDK's `JSON.parse()` fails on an LLM-generated tool call,
 * the raw error (e.g. "JSON Parse error: Unterminated string") tells
 * the model what went wrong but not how to fix it. This module augments
 * the error with a targeted hint based on the error pattern.
 */
export function diagnoseParseError(rawError: string): string {
  const hint = pickHint(rawError)
  return `${rawError}\n\nHint: ${hint}`
}

function pickHint(msg: string): string {
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
  return 'Your JSON tool arguments are malformed. Double-check that all strings are quoted with plain ASCII double-quotes (not curly/smart quotes \u201C\u201D), objects closed with }, arrays closed with ], and there are no trailing commas.'
}
