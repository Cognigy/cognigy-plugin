# Google Gemini CLI — support dropped

The Gemini CLI extension is **no longer shipped or supported**. Google [transitioned Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) — on **18 June 2026** it stopped serving requests for all consumer tiers — so use the **[Antigravity install guide](antigravity.md)** instead (`cognigy-setup --client antigravity` covers the IDE, the `agy` CLI, and the SDK in one install).

Releases no longer carry the `cognigy-gemini-extension.zip` asset, and `cognigy-setup` no longer accepts `--client gemini`.

## If you still have the extension installed

It keeps working at the engine version its manifest pins, but receives no further updates. To remove it:

```
gemini extensions uninstall cognigy
```

Antigravity users who migrated with `agy plugin import gemini` should also remove the imported copy (`agy plugin list` shows it), or two engines will boot — see the [Antigravity guide's troubleshooting notes](antigravity.md).
