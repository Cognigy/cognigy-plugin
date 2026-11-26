---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]{0,30})\b(?:share|provide|send|paste|enter|give|need|add)\b[^.\n]{0,30}\bAPI key\b|\byour\b[^.\n?]{0,30}\bAPI key\b[^.\n?]{0,15}\?))(?=[\s\S]*(?<!(?:\bno|\bnot|n''t|\bnothing|\bnever|\bnone|\bfailed|\bunable)\b[^.,;:!?\n]{0,20})\bspeech-to-speech\b)(?=[\s\S]*\bGPT Live\b)'
flags: i
---
