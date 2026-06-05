import re

with open('D:/zPython/opencode/packages/opencode/test/server/httpapi-provider.test.ts', 'r', encoding='utf-8') as f:
 content = f.read()

old = '''function requestAuthorize(input: {
