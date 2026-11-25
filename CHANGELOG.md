# Changelog

## [0.1.0](https://github.com/Tctcl/tlabs-platform/compare/v0.0.1...v0.1.0) (2026-11-25)


### Features

* authentication, container workspaces, terminals and providers ([#13](https://github.com/Tctcl/tlabs-platform/issues/13)) ([18194e1](https://github.com/Tctcl/tlabs-platform/commit/18194e128589bb5ae16250198db2f4ce7ef3dee6))
* **backend:** first durable round trip over Postgres-backed storage ([#9](https://github.com/Tctcl/tlabs-platform/issues/9)) ([21d9087](https://github.com/Tctcl/tlabs-platform/commit/21d9087bee2318ae5a65e77d5df662dae84180c3))
* **backend:** give default agents a starter system prompt ([#42](https://github.com/Tctcl/tlabs-platform/issues/42)) ([c417020](https://github.com/Tctcl/tlabs-platform/commit/c41702098fdc6ca8897d44dc8581a0bca02cc8ac))
* **backend:** give every agent its own key, model and thinking level ([#36](https://github.com/Tctcl/tlabs-platform/issues/36)) ([94e0015](https://github.com/Tctcl/tlabs-platform/commit/94e0015e9f678697d0a6009b3a832db00ff8d336))
* **backend:** sign in as a bootstrapped admin behind the proxy ([#27](https://github.com/Tctcl/tlabs-platform/issues/27)) ([f848333](https://github.com/Tctcl/tlabs-platform/commit/f8483333562520e01a362edf8d47c957e9ee9bf6))
* durable chat over Postgres with workspaces, agents and capability grants ([#11](https://github.com/Tctcl/tlabs-platform/issues/11)) ([2231880](https://github.com/Tctcl/tlabs-platform/commit/2231880a6aad640751e88422f97bc25b6a9ea35b))
* **frontend:** agents tab, keys linked from Settings ([#38](https://github.com/Tctcl/tlabs-platform/issues/38)) ([2235bad](https://github.com/Tctcl/tlabs-platform/commit/2235badf0d96a690db2a72b1b423cdbbc3004acd))
* **frontend:** open settings and workspaces as windows over the chat ([#41](https://github.com/Tctcl/tlabs-platform/issues/41)) ([d75a80d](https://github.com/Tctcl/tlabs-platform/commit/d75a80ddd1d5116be3e81e09b64c3ffd1b0b2d1c))
* **frontend:** phone layout, live answers, account page, agent picker ([#39](https://github.com/Tctcl/tlabs-platform/issues/39)) ([d8f0dab](https://github.com/Tctcl/tlabs-platform/commit/d8f0dab513ae5066f0f0171ec18c95042247cef4))
* **frontend:** sign in before the app renders ([#28](https://github.com/Tctcl/tlabs-platform/issues/28)) ([376acf9](https://github.com/Tctcl/tlabs-platform/commit/376acf9ebaf9ca3dced1d78b5ae7215f5502ddce))
* override model, thinking and key per conversation ([#44](https://github.com/Tctcl/tlabs-platform/issues/44)) ([b78299c](https://github.com/Tctcl/tlabs-platform/commit/b78299ccac92e6e62d3480c5d1070f355d05f8a9))
* run agent tools in the workspace container ([#45](https://github.com/Tctcl/tlabs-platform/issues/45)) ([810fe03](https://github.com/Tctcl/tlabs-platform/commit/810fe03a542d743e922627e1ede6a34cc076fc86))
* run agent tools in the workspace container ([#45](https://github.com/Tctcl/tlabs-platform/issues/45)) ([8b378b0](https://github.com/Tctcl/tlabs-platform/commit/8b378b0bf2db5fdeb82cca5d50988ec13a81bddd))
* show thinking, tool calls and context boundaries in the transcript ([#43](https://github.com/Tctcl/tlabs-platform/issues/43)) ([c73bc1d](https://github.com/Tctcl/tlabs-platform/commit/c73bc1d5e4fa17f00a0b413203964482b32b7e77))


### Bug Fixes

* **agent:** build the workspace image on the pinned Node 26 ([#21](https://github.com/Tctcl/tlabs-platform/issues/21)) ([9851c84](https://github.com/Tctcl/tlabs-platform/commit/9851c84a2c2701732e223c226848dac0b1c32045))
* **backend:** fence a second Postgres writer and stop replaying timed-out commits ([#12](https://github.com/Tctcl/tlabs-platform/issues/12)) ([0135000](https://github.com/Tctcl/tlabs-platform/commit/01350004d8279e7cadc91826c7b4a565a477dd32))
* **backend:** keep an already-running environment container ([#24](https://github.com/Tctcl/tlabs-platform/issues/24)) ([cbfc3c7](https://github.com/Tctcl/tlabs-platform/commit/cbfc3c756e7051e705333b0e79ae8215c84829ac))
* **backend:** log refused requests as one line without a stack ([#34](https://github.com/Tctcl/tlabs-platform/issues/34)) ([712c921](https://github.com/Tctcl/tlabs-platform/commit/712c921afc68e638fe05a5b0bfb341782e7bee56))
* **backend:** run chats with the provider key stored in the app ([#26](https://github.com/Tctcl/tlabs-platform/issues/26)) ([ff6afcf](https://github.com/Tctcl/tlabs-platform/commit/ff6afcf54175f0fd660110a13167a98105f7cd83))
* **backend:** seal keys saved on the credentials page ([#33](https://github.com/Tctcl/tlabs-platform/issues/33)) ([9e35c86](https://github.com/Tctcl/tlabs-platform/commit/9e35c869a4f4780c22fc426fff830d10ce6f1b08))
* **backend:** serve the app and /health to a signed-out browser ([#31](https://github.com/Tctcl/tlabs-platform/issues/31)) ([b18edd6](https://github.com/Tctcl/tlabs-platform/commit/b18edd6f39cd7ca2af4bb53e88621497611e6f12))
* make a staging install boot, route and sign in ([#29](https://github.com/Tctcl/tlabs-platform/issues/29)) ([1c100d6](https://github.com/Tctcl/tlabs-platform/commit/1c100d635e4cef4de618e023f2ce6b6a4a97a732))
* staging feedback on chat, usage panel and workspaces ([#40](https://github.com/Tctcl/tlabs-platform/issues/40)) ([61fe5c3](https://github.com/Tctcl/tlabs-platform/commit/61fe5c310e0189302d5a858061c00229d47c6c14))


### Refactors

* **backend:** fail loudly at startup and drop dead exports ([#25](https://github.com/Tctcl/tlabs-platform/issues/25)) ([8c35c10](https://github.com/Tctcl/tlabs-platform/commit/8c35c10a40bb763981b2d734fd15c546736d8b58))
* **frontend:** drop unused components and duplicate API clients ([#30](https://github.com/Tctcl/tlabs-platform/issues/30)) ([8ec1887](https://github.com/Tctcl/tlabs-platform/commit/8ec1887840a417a02b736780fbcf28dc0d7e153e))


### Documentation

* describe the repository as it stands after the staging work ([#32](https://github.com/Tctcl/tlabs-platform/issues/32)) ([02c7d28](https://github.com/Tctcl/tlabs-platform/commit/02c7d283d595631da0270817c359a21404b9dbb6))

## 0.0.1 (2026-11-22)


### Features

* initial scaffold with CI, release automation and community docs ([0709b86](https://github.com/Tctcl/tlabs-platform/commit/0709b86ba2a9f8aef58e2920fedf627b557af4a1))
