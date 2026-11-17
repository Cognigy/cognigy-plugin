---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?<!(?:\bno|\bnot|n''t|\bwithout|\bnever)\b[^.\n]{0,30})(?:\byour\b|\b(?:share|provide|send|paste|enter|give)\b)[^.\n]{0,30}\bAPI key\b)(?=[\s\S]*\bspeech-to-speech\b)(?=[\s\S]*\bGPT Live\b)'
flags: i
---
