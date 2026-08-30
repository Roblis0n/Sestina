# Third-party notices

Sestina source code and documentation are licensed under Apache License 2.0
unless a file states otherwise. This document records third-party software that
is compiled into or shipped with the Sestina Research Room 0.2.0 public-preview
archives, plus one source-only runtime dependency used by the CLI.

The package names and versions below are fixed by `pnpm-lock.yaml`. A target
archive contains only the native secret-storage packages for that target.

## Component inventory

| Component | Version | License | Distribution role |
| --- | ---: | --- | --- |
| React | 19.2.8 | MIT | Browser client bundle |
| React DOM | 19.2.8 | MIT | Browser client bundle |
| Scheduler | 0.27.0 | MIT | React transitive runtime |
| Zod | 4.2.0, 4.4.3 | MIT | Runtime validation |
| Model Context Protocol Core | 2.0.0 | Apache-2.0 / MIT transition; documentation CC-BY-4.0 | MCP runtime bundle |
| Model Context Protocol Server | 2.0.0 | Apache-2.0 / MIT transition; documentation CC-BY-4.0 | MCP runtime bundle |
| @cfworker/json-schema | 4.1.1 | MIT | Code embedded by the MCP Server package |
| Ajv | 8.18.0 | MIT | Code embedded by the MCP Server package |
| ajv-formats | 3.0.1 | MIT | Code embedded by the MCP Server package |
| content-type | 1.0.5 | MIT | Code embedded by the MCP Server package |
| fast-deep-equal | 3.1.3 | MIT | Code embedded by the MCP Server package |
| fast-uri | 3.1.0 | BSD-3-Clause | Code embedded by the MCP Server package |
| json-schema-traverse | 1.0.0 | MIT | Code embedded by the MCP Server package |
| json-schema-typed | 8.0.2 | BSD-2-Clause | Code embedded by the MCP Server package |
| @primno/dpapi | 2.0.1 | MIT | Windows x64 current-user secret storage |
| node-gyp-build | 4.8.4 | MIT | Windows x64 native-module loader |
| @napi-rs/keyring | 1.3.0 | MIT | macOS/Linux current-user secret storage |
| @napi-rs/keyring-darwin-arm64 | 1.3.0 | MIT | macOS arm64 native binary |
| @napi-rs/keyring-linux-x64-gnu | 1.3.0 | MIT | Ubuntu x64 native binary |
| smol-toml | 1.8.0 | BSD-3-Clause | Source/CLI runtime; not in the Research Room archive |

Build and test tools downloaded during source development are not redistributed
inside the Research Room archive. Their own package license files apply when
they are installed.

## MIT-licensed components

The following copyright notices apply:

- React, React DOM, Scheduler: Copyright (c) Meta Platforms, Inc. and affiliates.
- Zod: Copyright (c) 2025 Colin McDonnell.
- Model Context Protocol MIT-licensed contributions: Copyright (c) 2024-2025
  Model Context Protocol, a Series of LF Projects, LLC.
- @cfworker/json-schema: published package metadata identifies Jeremy Danyow as
  author and declares MIT; its 4.1.1 tarball contains no separate license file.
- Ajv: Copyright (c) 2015-2021 Evgeny Poberezkin.
- ajv-formats: Copyright (c) 2020 Evgeny Poberezkin.
- content-type: Copyright (c) 2015 Douglas Christopher Wilson.
- fast-deep-equal: Copyright (c) 2017 Evgeny Poberezkin.
- json-schema-traverse: Copyright (c) 2017 Evgeny Poberezkin.
- @primno/dpapi: Copyright (c) 2023 Xavier Monin.
- node-gyp-build: Copyright (c) 2017 Mathias Buus.
- @napi-rs/keyring and its target packages: Copyright (c) 2020 N-API for Rust.

### MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Model Context Protocol licensing transition

The 2.0.0 MCP package license states that the project is transitioning from MIT
to Apache License 2.0. New code and specification contributions are
Apache-2.0; contributions with relicensing consent are Apache-2.0; earlier
contributions without that consent remain MIT. Non-specification documentation
is CC-BY-4.0. The Sestina root `LICENSE` contains the complete Apache-2.0 text,
and the MIT terms are reproduced above. CC-BY-4.0 legal terms are available at
<https://creativecommons.org/licenses/by/4.0/legalcode>.

## fast-uri 3.1.0 — BSD-3-Clause

Copyright (c) 2011-2021, Gary Court until
<https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae>

Copyright (c) 2021-present The Fastify team

All rights reserved. The Fastify team members are listed at
<https://github.com/fastify/fastify#team>.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. The names of any contributors may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## smol-toml 1.8.0 — BSD-3-Clause

Copyright (c) Squirrel Chat et al., All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## json-schema-typed 8.0.2 — BSD-2-Clause

Original source code is copyright (c) 2019-2025 Remy Rylan.

All JSON Schema documentation and descriptions are copyright as follows:

- 2009 draft-0: IETF Trust, Kris Zyp, and SitePen (USA).
- 2009 draft-1: IETF Trust, Kris Zyp, and SitePen (USA).
- 2010 draft-2: IETF Trust, Kris Zyp, and SitePen (USA).
- 2010 draft-3: IETF Trust, Kris Zyp, Gary Court, and SitePen (USA).
- 2013 draft-4: IETF Trust, Francis Galiegue, Kris Zyp, Gary Court, and
  SitePen (USA).
- 2018 draft-7: IETF Trust, Austin Wright, Henry Andrews, Geraint Luff, and
  Cloudflare, Inc.
- 2019 draft-2019-09: IETF Trust, Austin Wright, Henry Andrews, Ben Hutton,
  and Greg Dennis.
- 2020 draft-2020-12: IETF Trust, Austin Wright, Henry Andrews, Ben Hutton,
  and Greg Dennis.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
