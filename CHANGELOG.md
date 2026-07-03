## [1.2.0](https://github.com/Cognigy/cognigy-plugin/compare/v1.1.0...v1.2.0) (2026-07-03)

### Features

* **flow-nodes:** add get operation for reading node config ([#3](https://github.com/Cognigy/cognigy-plugin/issues/3)) ([bf68cae](https://github.com/Cognigy/cognigy-plugin/commit/bf68cae1f5fc15843d31d67eda29f84d2dbc346f))
* **setup:** cognigy-setup CLI for GUI credential config ([#4](https://github.com/Cognigy/cognigy-plugin/issues/4)) [skip ci] ([cc66424](https://github.com/Cognigy/cognigy-plugin/commit/cc66424a0d1d9526a18310dfb3ee815536b08b05))

## [1.1.0](https://github.com/Cognigy/cognigy-plugin/compare/v1.0.2...v1.1.0) (2026-06-26)

### Features

* add Claude Code plugin/marketplace + voice go-live checklist ([#1](https://github.com/Cognigy/cognigy-plugin/issues/1)) ([72ea654](https://github.com/Cognigy/cognigy-plugin/commit/72ea6542e220780dd1ba175b46a72cc905537c64))

### Bug Fixes

* **build:** add repository field for npm provenance ([#2](https://github.com/Cognigy/cognigy-plugin/issues/2)) ([f2a2e0b](https://github.com/Cognigy/cognigy-plugin/commit/f2a2e0bdfdab215e8804dbfed00fca4abdced75f))

## [1.0.3](https://github.com/Cognigy/cognigy-mcp/compare/v1.0.2...v1.0.3) (2026-06-03)

### Miscellaneous

- change MCP name to NiCE Cognigy MCP ([#31](https://github.com/Cognigy/cognigy-mcp/pull/31)) ([265c0a6](https://github.com/Cognigy/cognigy-mcp/commit/265c0a6))

## [1.0.2](https://github.com/Cognigy/cognigy-mcp/compare/v1.0.1...v1.0.2) (2026-04-30)

### Features

- **tools:** provision HTTP tool code nodes on update ([b3aa229](https://github.com/Cognigy/cognigy-mcp/commit/b3aa2295d5634647e56a85c8563a2302db5a5be7))

### Bug Fixes

- disable husky in CI [skip ci] ([b2d219f](https://github.com/Cognigy/cognigy-mcp/commit/b2d219f07c367cbeb57c1cfd563bbb7f62e98a8c))
- **tools:** derive projectId from agent and flow references ([1da91fd](https://github.com/Cognigy/cognigy-mcp/commit/1da91fd86dd4d17b72143369d29df09acb087893))
- **tools:** resolve HTTP tool child nodes for updates ([f6d343d](https://github.com/Cognigy/cognigy-mcp/commit/f6d343d7c58a42af82520cbd484d78c431aee3bc))

## [1.0.1](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.17...v1.0.1) (2026-04-24)

### ⚠ BREAKING CHANGES

- read_guide tool for hard-coup. of resources with tools | fixes in handlers

### Features

- **tool:** create voice gateway to establish webRTC through tool ([2ee961b](https://github.com/Cognigy/cognigy-mcp/commit/2ee961b1bcabff47ac8f8bf9e205da2281be2b31))
- **tool:** manage_settings supports knowledge store models, coupled with manage_knowledge ([044447f](https://github.com/Cognigy/cognigy-mcp/commit/044447fe77e3a2c2c6fec67a5f1a2ea239dd2c52))
- **tool:** manage_settings to manage speech providers ([7cb6427](https://github.com/Cognigy/cognigy-mcp/commit/7cb64272c2edbd3bc75681cdcdff4b1b6703e077))

### Bug Fixes

- **avatar:** re-fixed avatar image blank bug in flow ([c1ef5e5](https://github.com/Cognigy/cognigy-mcp/commit/c1ef5e5b776f4546d8474a7ebb55f58301066a51))
- fixed handling auto child-node creation | resource reuse on new projects with pkgs fixed ([b1b8e46](https://github.com/Cognigy/cognigy-mcp/commit/b1b8e464dd51f1165b8d95ab0778952a789cbd14))
- improve agent avatar preview and knowledge model guidance ([5682e5c](https://github.com/Cognigy/cognigy-mcp/commit/5682e5c49b03a6cf007bc7abdb262c2be48bc410))
- include LLM connection dependencies by referenceId ([ec8f94b](https://github.com/Cognigy/cognigy-mcp/commit/ec8f94b059d457e35a9011e43ea17a5d3e70fea6))
- **llm:** llm and connection coupling | create_ai_agent tune | pkg over setup for llm ([7598537](https://github.com/Cognigy/cognigy-mcp/commit/7598537d2b98b39d3af3d0cf88f524a0e8a16f5e))
- read_guide tool for hard-coup. of resources with tools | fixes in handlers ([eb61841](https://github.com/Cognigy/cognigy-mcp/commit/eb618411602b7a245d91966cd2e43d17fb69ff89))

## [0.2.17](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.16...v0.2.17) (2026-04-09)

### Features

- **tool:** auto-resolve or create REST endpoint by agent ID ([0e4cacc](https://github.com/Cognigy/cognigy-mcp/commit/0e4caccc0d2988eceeaf067ae6f4ddad43a8ddf2))

## [0.2.16](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.15...v0.2.16) (2026-04-08)

### Bug Fixes

- rebranded the official name of the product ([928c941](https://github.com/Cognigy/cognigy-mcp/commit/928c9412da6318f430fc877f7e09049e8c0ff91f))

## [0.2.15](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.14...v0.2.15) (2026-04-07)

### Features

- **packages:** expand manage_packages import and export workflow ([8092cd0](https://github.com/Cognigy/cognigy-mcp/commit/8092cd0913e0821e818ce85f4613ed252943e3f8))

## [0.2.14](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.13...v0.2.14) (2026-03-31)

### Bug Fixes

- **ci:** fetch full git history for changelog generation ([e6e0e88](https://github.com/Cognigy/cognigy-mcp/commit/e6e0e8805d59e864ec1a4746b7fc26a1eba37120))

## [0.2.13](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.12...v0.2.13) (2026-03-31)

### Features

- added claude code rules and add_tool skill ([ef08b21](https://github.com/Cognigy/cognigy-mcp/commit/ef08b2157bd078359825a2a2b2e17de91782b9b1))
- **ci:** add automated semantic changelog and commit message enforcement ([9446147](https://github.com/Cognigy/cognigy-mcp/commit/9446147d7809865b8852cb8861d803e4f4720a55))
- **mcp:** add manage_packages tool for package upload and import ([15a5593](https://github.com/Cognigy/cognigy-mcp/commit/15a5593735a2d721457455fe6ff9568cfda86ee9))
- modified manifest.json for claude marketplace ([a6e2ba4](https://github.com/Cognigy/cognigy-mcp/commit/a6e2ba40ab5b51dcecf95b87433e522fc062d21a))

## [0.2.12](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.11...v0.2.12) (2026-03-24)

### Bug Fixes

- linking to documents in README ([0920cab](https://github.com/Cognigy/cognigy-mcp/commit/0920cab006d121ad62b38405f1dfa94ae7ed0032))

## [0.2.11](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.10...v0.2.11) (2026-03-24)

## [0.2.10](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.9...v0.2.10) (2026-03-23)

## [0.2.9](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.8...v0.2.9) (2026-03-18)

## [0.2.8](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.7...v0.2.8) (2026-03-18)

## [0.2.7](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.6...v0.2.7) (2026-03-17)

## [0.2.6](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.5...v0.2.6) (2026-03-09)

## [0.2.5](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.4...v0.2.5) (2026-03-06)

### Features

- CLI design | pipeline summary Adjustment ([#12](https://github.com/Cognigy/cognigy-mcp/issues/12)) ([48146df](https://github.com/Cognigy/cognigy-mcp/commit/48146df6faafcdbf73bf96a5aaaa2e776f403695))

## [0.2.4](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.3...v0.2.4) (2026-03-05)

## [0.2.3](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.2...v0.2.3) (2026-03-05)

## [0.2.2](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.1...v0.2.2) (2026-03-05)

## [0.2.1](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.0...v0.2.1) (2026-03-05)

## [0.2.0](https://github.com/Cognigy/cognigy-mcp/compare/v0.1.4...v0.2.0) (2026-03-05)

## [0.1.4](https://github.com/Cognigy/cognigy-mcp/compare/v0.1.3...v0.1.4) (2026-03-05)

## [0.1.3](https://github.com/Cognigy/cognigy-mcp/compare/v0.1.2...v0.1.3) (2026-03-04)

## [0.1.2](https://github.com/Cognigy/cognigy-mcp/compare/v0.1.1...v0.1.2) (2026-03-04)

## 0.1.1 (2026-03-04)
