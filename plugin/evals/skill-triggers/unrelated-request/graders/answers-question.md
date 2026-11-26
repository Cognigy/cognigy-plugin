---
type: regex
target: last_message
pattern: '^(?![\s\S]*(?:\bcannot|\bcan''t|\bunable to|\bcould not|\bcouldn''t)\s+(?:explain|answer|help)\b)(?=[\s\S]*\bTCP\b)(?=[\s\S]*\bUDP\b)(?=[\s\S]*\b(?:connection|reliab|order|handshake|datagram|guarantee|deliver|retransmi|acknowledg|overhead|faster|latency))'
flags: i
---
