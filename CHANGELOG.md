# Changelog

## [0.1.0](https://github.com/Tctcl/cake-harness/compare/v0.0.1...v0.1.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* every TCTCL_* variable is now CAKE_*, install paths moved to /opt/cake-harness and /var/lib/cake-harness, and images moved to ghcr.io/tctcl/cake-harness. There are no installs to migrate.

### Features

* app-owned base system prompt, visible context, full tool output ([#51](https://github.com/Tctcl/cake-harness/issues/51)) ([3029f9a](https://github.com/Tctcl/cake-harness/commit/3029f9a48cc258130e27c4243ce93edf13b3ba95))
* ask_user pauses a run until the user answers in the chat ([#52](https://github.com/Tctcl/cake-harness/issues/52)) ([d65694a](https://github.com/Tctcl/cake-harness/commit/d65694aa9ed10b40a744eec72fd4103d41d097db))
* authentication, container workspaces, terminals and providers ([#13](https://github.com/Tctcl/cake-harness/issues/13)) ([18194e1](https://github.com/Tctcl/cake-harness/commit/18194e128589bb5ae16250198db2f4ce7ef3dee6))
* automatic conversation titles from a background model chain ([#62](https://github.com/Tctcl/cake-harness/issues/62)) ([8e59845](https://github.com/Tctcl/cake-harness/commit/8e598456d4592c3a7e082fc10f6f5f0711c7634d))
* **backend:** first durable round trip over Postgres-backed storage ([#9](https://github.com/Tctcl/cake-harness/issues/9)) ([21d9087](https://github.com/Tctcl/cake-harness/commit/21d9087bee2318ae5a65e77d5df662dae84180c3))
* **backend:** give default agents a starter system prompt ([#42](https://github.com/Tctcl/cake-harness/issues/42)) ([c417020](https://github.com/Tctcl/cake-harness/commit/c41702098fdc6ca8897d44dc8581a0bca02cc8ac))
* **backend:** give every agent its own key, model and thinking level ([#36](https://github.com/Tctcl/cake-harness/issues/36)) ([94e0015](https://github.com/Tctcl/cake-harness/commit/94e0015e9f678697d0a6009b3a832db00ff8d336))
* **backend:** sign in as a bootstrapped admin behind the proxy ([#27](https://github.com/Tctcl/cake-harness/issues/27)) ([f848333](https://github.com/Tctcl/cake-harness/commit/f8483333562520e01a362edf8d47c957e9ee9bf6))
* durable chat over Postgres with workspaces, agents and capability grants ([#11](https://github.com/Tctcl/cake-harness/issues/11)) ([2231880](https://github.com/Tctcl/cake-harness/commit/2231880a6aad640751e88422f97bc25b6a9ea35b))
* **frontend:** agents tab, keys linked from Settings ([#38](https://github.com/Tctcl/cake-harness/issues/38)) ([2235bad](https://github.com/Tctcl/cake-harness/commit/2235badf0d96a690db2a72b1b423cdbbc3004acd))
* **frontend:** open settings and workspaces as windows over the chat ([#41](https://github.com/Tctcl/cake-harness/issues/41)) ([d75a80d](https://github.com/Tctcl/cake-harness/commit/d75a80ddd1d5116be3e81e09b64c3ffd1b0b2d1c))
* **frontend:** phone layout, live answers, account page, agent picker ([#39](https://github.com/Tctcl/cake-harness/issues/39)) ([d8f0dab](https://github.com/Tctcl/cake-harness/commit/d8f0dab513ae5066f0f0171ec18c95042247cef4))
* **frontend:** sign in before the app renders ([#28](https://github.com/Tctcl/cake-harness/issues/28)) ([376acf9](https://github.com/Tctcl/cake-harness/commit/376acf9ebaf9ca3dced1d78b5ae7215f5502ddce))
* give the default workspace a container and a real Environment tab ([#54](https://github.com/Tctcl/cake-harness/issues/54)) ([af3a01b](https://github.com/Tctcl/cake-harness/commit/af3a01b1ea2acb3d1cade0d08f2b220f2cdc94e6))
* override model, thinking and key per conversation ([#44](https://github.com/Tctcl/cake-harness/issues/44)) ([b78299c](https://github.com/Tctcl/cake-harness/commit/b78299ccac92e6e62d3480c5d1070f355d05f8a9))
* read-only grep, find, ls and git tools, and pi's code mode ([#53](https://github.com/Tctcl/cake-harness/issues/53)) ([c7ea8fe](https://github.com/Tctcl/cake-harness/commit/c7ea8fe16324781b43843a165fd7ac1e0dc81fae))
* run agent tools in the workspace container ([#45](https://github.com/Tctcl/cake-harness/issues/45)) ([810fe03](https://github.com/Tctcl/cake-harness/commit/810fe03a542d743e922627e1ede6a34cc076fc86))
* run agent tools in the workspace container ([#45](https://github.com/Tctcl/cake-harness/issues/45)) ([8b378b0](https://github.com/Tctcl/cake-harness/commit/8b378b0bf2db5fdeb82cca5d50988ec13a81bddd))
* show thinking, tool calls and context boundaries in the transcript ([#43](https://github.com/Tctcl/cake-harness/issues/43)) ([c73bc1d](https://github.com/Tctcl/cake-harness/commit/c73bc1d5e4fa17f00a0b413203964482b32b7e77))
* ssh into workspace containers, ready for VS Code Remote-SSH ([#55](https://github.com/Tctcl/cake-harness/issues/55)) ([9d8e695](https://github.com/Tctcl/cake-harness/commit/9d8e695dfde539b02e5d8f37470d8b14a984abd9))
* sub agents that agents delegate to, in parallel and in worktrees ([#61](https://github.com/Tctcl/cake-harness/issues/61)) ([bae0b2a](https://github.com/Tctcl/cake-harness/commit/bae0b2a98278538f5aec88417d8ed6bf10e7279f))
* tools you add to a workspace stay installed ([#60](https://github.com/Tctcl/cake-harness/issues/60)) ([813526c](https://github.com/Tctcl/cake-harness/commit/813526c298efab4970edfc0b61f4e13a34209f28))
* **website:** add the Cake marketing and documentation site ([#48](https://github.com/Tctcl/cake-harness/issues/48)) ([4dddd7f](https://github.com/Tctcl/cake-harness/commit/4dddd7f84afd849874c773d1c2c6abc3aefc04a5))
* wider list/detail windows, tools per agent, Build and Plan agents ([#50](https://github.com/Tctcl/cake-harness/issues/50)) ([78faa66](https://github.com/Tctcl/cake-harness/commit/78faa664846b20fb18bca450743b60d65967f49a))


### Bug Fixes

* **agent:** build the workspace image on the pinned Node 26 ([#21](https://github.com/Tctcl/cake-harness/issues/21)) ([9851c84](https://github.com/Tctcl/cake-harness/commit/9851c84a2c2701732e223c226848dac0b1c32045))
* **backend:** fence a second Postgres writer and stop replaying timed-out commits ([#12](https://github.com/Tctcl/cake-harness/issues/12)) ([0135000](https://github.com/Tctcl/cake-harness/commit/01350004d8279e7cadc91826c7b4a565a477dd32))
* **backend:** keep an already-running environment container ([#24](https://github.com/Tctcl/cake-harness/issues/24)) ([cbfc3c7](https://github.com/Tctcl/cake-harness/commit/cbfc3c756e7051e705333b0e79ae8215c84829ac))
* **backend:** log refused requests as one line without a stack ([#34](https://github.com/Tctcl/cake-harness/issues/34)) ([712c921](https://github.com/Tctcl/cake-harness/commit/712c921afc68e638fe05a5b0bfb341782e7bee56))
* **backend:** run chats with the provider key stored in the app ([#26](https://github.com/Tctcl/cake-harness/issues/26)) ([ff6afcf](https://github.com/Tctcl/cake-harness/commit/ff6afcf54175f0fd660110a13167a98105f7cd83))
* **backend:** seal keys saved on the credentials page ([#33](https://github.com/Tctcl/cake-harness/issues/33)) ([9e35c86](https://github.com/Tctcl/cake-harness/commit/9e35c869a4f4780c22fc426fff830d10ce6f1b08))
* **backend:** serve the app and /health to a signed-out browser ([#31](https://github.com/Tctcl/cake-harness/issues/31)) ([b18edd6](https://github.com/Tctcl/cake-harness/commit/b18edd6f39cd7ca2af4bb53e88621497611e6f12))
* **deploy:** let a fresh install run without SSH flags ([#56](https://github.com/Tctcl/cake-harness/issues/56)) ([c83aee9](https://github.com/Tctcl/cake-harness/commit/c83aee9687213dab98cc5fba67f840989c393fbf))
* **frontend:** stop two load races that ate clicks and sessions ([#59](https://github.com/Tctcl/cake-harness/issues/59)) ([96700a9](https://github.com/Tctcl/cake-harness/commit/96700a964ab00562a38397aaba9979757af3e1d6))
* let workspace containers boot, and keep saved agent settings visible ([#57](https://github.com/Tctcl/cake-harness/issues/57)) ([a526080](https://github.com/Tctcl/cake-harness/commit/a526080f9c41a75bcb3b5808495dabd0a0b58981))
* make a staging install boot, route and sign in ([#29](https://github.com/Tctcl/cake-harness/issues/29)) ([1c100d6](https://github.com/Tctcl/cake-harness/commit/1c100d635e4cef4de618e023f2ce6b6a4a97a732))
* staging feedback on chat, usage panel and workspaces ([#40](https://github.com/Tctcl/cake-harness/issues/40)) ([61fe5c3](https://github.com/Tctcl/cake-harness/commit/61fe5c310e0189302d5a858061c00229d47c6c14))
* **website:** keep directory redirects on the public host ([#49](https://github.com/Tctcl/cake-harness/issues/49)) ([6450e1f](https://github.com/Tctcl/cake-harness/commit/6450e1f2a0712743da0f7574afef02ed99f19393))
* workspace containers boot with their token, and stream their log ([#58](https://github.com/Tctcl/cake-harness/issues/58)) ([1206754](https://github.com/Tctcl/cake-harness/commit/12067548a5ef771f32e942e3a46cadb5945a6780))


### Refactors

* **backend:** fail loudly at startup and drop dead exports ([#25](https://github.com/Tctcl/cake-harness/issues/25)) ([8c35c10](https://github.com/Tctcl/cake-harness/commit/8c35c10a40bb763981b2d734fd15c546736d8b58))
* **frontend:** drop unused components and duplicate API clients ([#30](https://github.com/Tctcl/cake-harness/issues/30)) ([8ec1887](https://github.com/Tctcl/cake-harness/commit/8ec1887840a417a02b736780fbcf28dc0d7e153e))


### Documentation

* describe the repository as it stands after the staging work ([#32](https://github.com/Tctcl/cake-harness/issues/32)) ([02c7d28](https://github.com/Tctcl/cake-harness/commit/02c7d283d595631da0270817c359a21404b9dbb6))


### Chores

* rename the product to Cake (cake-harness) ([#46](https://github.com/Tctcl/cake-harness/issues/46)) ([a05a73b](https://github.com/Tctcl/cake-harness/commit/a05a73b10d9b7ca6f2859afd4e6269876cddcef5))

## 0.0.1 (2026-11-22)


### Features

* initial scaffold with CI, release automation and community docs ([0709b86](https://github.com/Tctcl/tlabs-platform/commit/0709b86ba2a9f8aef58e2920fedf627b557af4a1))
