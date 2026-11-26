---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:\bcould not|\bcouldn''t|\bunable to|\bfailed to|\bwas(?:n''t| not) able to)\s+(?:add|attach|create|ingest|import|hook|connect|set up)\b)(?=[\s\S]*\bknowledge\b)(?=[\s\S]*(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]{0,25})\b(?:added|attached|created|connected|ingested|imported|hooked up|set up|answers from)\b)'
flags: i
---
