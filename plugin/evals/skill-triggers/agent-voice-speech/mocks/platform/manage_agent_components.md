---
type: agent
abort_when: Never abort the run.
---

You answer manage_agent_components for the AI Agent "Clinic Desk" (agentId "60d5ec49f1a2c8b1a4e0f101", projectId "proj-demo"). Reply with compact JSON only, and stay consistent with earlier calls.

For component "voice_settings" the agent starts with no settings. The settings object always has these keys, defaults in brackets: ttsVendor (""), ttsVoice (""), ttsLanguage (""), ttsLabel (""), ttsCredentialReferenceId (""), maxUtteranceChars (240), sttVendor (""), sttLanguage (""), sttLabel (""), sttCredentialReferenceId (""), greetingMode ("agent"), greetingText (""), bargeInOnSpeech (true), minWordsToInterrupt (1), bargeInOnDtmf (false), promptOnSilence (true), silenceTimeoutSeconds (8), silenceRetries (2), captureDtmf (false), continuousAsr (false), backgroundSound ("none"), thinkingSound ("typing_loop"), sessionParameters ({}).

- get: { agentId, toolId (null until first saved, then "60d5ec49f1a2c8b1a4e0f404"), usingDefaults, speech: { tts, stt }, settings }.
- create or update: merge config into the stored settings. ttsCredentialReferenceId "nice-ms" also sets ttsVendor "microsoft" and ttsLabel "Included Speech Provider"; sttCredentialReferenceId "nice-stt" sets sttVendor "nice", "nice-ms" sets sttVendor "microsoft", both with sttLabel "Included Speech Provider". Any other credential referenceId than nice-ms, nice-stt or acme-dg: return { "error": "unknown_speech_provider", "changed": false } and store nothing.
  - TTS is "complete" when ttsVendor, ttsVoice and ttsLanguage are all set, "empty" when none is, else "incomplete"; STT likewise with sttVendor and sttLanguage.
  - The microsoft voices for en-GB are en-GB-SoniaNeural (female), en-GB-LibbyNeural (female), en-GB-RyanNeural (male), en-GB-ThomasNeural (male); for en-US en-US-AvaNeural, en-US-JennyNeural, en-US-AndrewNeural. A ttsVoice not in the list for the stored language: return { "error": "unknown_voice", "changed": false, "ttsVoice": <it>, "voices": [that list] } and store nothing.
  - When TTS is incomplete and ttsVoice is empty, add "voices" with the list for ttsLanguage and _hints.warning "TTS is incomplete (it needs ttsVendor, ttsVoice and ttsLanguage), so calls ignore it and use the endpoint's speech, the project default, then NiCE-provided speech.".
  - Return { agentId, toolId: "60d5ec49f1a2c8b1a4e0f404", usingDefaults: false, speech, settings }.
- delete: { reset: true, agentId, removed: true }; later gets show the defaults again.
- Other components: plausible results for an empty project.

Never answer with a tool error (never start with "ERROR:"): when required arguments are missing or invalid, reply with a normal JSON result such as {"error":"missing_arguments","required":["operation","projectId"]} naming what the tool needs.
