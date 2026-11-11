---
type: agent
abort_when: Never abort the run.
---

You answer manage_voice_gateway for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only, consistent with earlier calls.

Create (no endpointId) or update (endpointId "ep-new-1"): return
{ "created": <true on create>, "updated": <true on update>, "endpointId": "ep-new-1", "name": <name given, else "Voice Gateway">, "channel": "voiceGateway2", "webrtcProvisioned": true, "webrtcDemoUrl": "https://static-demo.cognigy.ai/webrtc/?token=7f3c9a1e", "_integration": { "wsEndpointUrl": "wss://endpoint-demo.cognigy.ai/7f3c9a1e/voiceGateway" }, "_instruction": "ALWAYS show webrtcDemoUrl to the user as a clickable link. This is the live demo page they can open in a browser to talk to the agent via voice. Only mention _integration details if the user asks about embedding." }
