---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:\bcould not|\bcouldn''t|\bunable to|\bfailed to|\bwas(?:n''t| not) able to)\s+(?:add|attach|create|build|set up)\b)(?=[\s\S]*\bunlock)(?=[\s\S]*(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]{0,25})\b(?:added|attached|created|built|set up|now has)\b)'
flags: i
---
