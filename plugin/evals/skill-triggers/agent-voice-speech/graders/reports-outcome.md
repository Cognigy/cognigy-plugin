---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:(?:\bcould not|\bcouldn''t|\bunable to|\bfailed to|\bwas(?:n''t| not) able to)\s+(?:set|switch|change|apply|update|save|configure|use)\b|\bnot (?:been )?(?:applied|saved)\b))(?=[\s\S]*(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]*)\b(?:British|en-GB)\b)(?=[\s\S]*\b(?:female\b|woman\b|Sonia|Libby))(?=[\s\S]*\bNiCE\b)(?=[\s\S]*(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]*)\b(?:two|2)\b[^.\n]{0,40}\bwords?\b)'
flags: i
---
