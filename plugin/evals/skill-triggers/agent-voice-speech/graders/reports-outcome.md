---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:\bcould not|\bcouldn''t|\bunable to|\bfailed to|\bwas(?:n''t| not) able to)\b)(?=[\s\S]*\b(?:British|en-GB)\b)(?=[\s\S]*\b(?:female\b|woman\b|Sonia|Libby))(?=[\s\S]*\bNiCE\b)(?=[\s\S]*\b(?:two|2)\b[^.\n]{0,40}\bwords?\b)'
flags: i
---
