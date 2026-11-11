---
type: llm
---

PASS if the conversation shows a manage_agent_components voice_settings update that (a) uses the NiCE-provided credential "nice-ms" for TTS, (b) sets ttsVoice to one of the en-GB female voices the tool offered (en-GB-SoniaNeural or en-GB-LibbyNeural), and (c) sets minWordsToInterrupt to 2 or 3; and the final message to the user says so without claiming the endpoint or the persona was changed. FAIL if a credential or voice id was used that no tool result offered, or if any of (a) to (c) is missing.
