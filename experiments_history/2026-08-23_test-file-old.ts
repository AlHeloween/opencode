/**
 * Test file for experiments
 * Created: 2026-08-23
 * 
 * Demonstrates basic TypeScript function with optional parameters.
 */

function hello(name: string = "World") {
  return `Hello, ${name}!`;
}

console.log(hello("OpenCode"));
console.log(hello("User"));
