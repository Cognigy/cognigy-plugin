---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:\bcould not|\bcouldn''t|\bunable to|\bfailed to|\bwas(?:n''t| not) able to)\s+(?:deploy|create|generate|set up|publish)\b)(?=[\s\S]*<script\b[^>]*\bsrc\s*=)'
flags: i
---
