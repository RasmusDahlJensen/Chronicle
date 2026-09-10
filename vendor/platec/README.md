# Platec geography engine

Chronicle vendors the complete C++ core of [Mindwerks/plate-tectonics](https://github.com/Mindwerks/plate-tectonics) at commit `2a27c4fb137c657517bca62122b9de80e6b8c255` (23 November 2025). `src/` retains upstream copyright and license headers. `core-fixes.patch` records Chronicle's changes against that immutable revision. `chronicle_platec_wasm.cpp` supplies five C exports. The TypeScript adapter in `runtime.ts` owns one isolated WebAssembly instance per generation, bounds stepping, validates output and copies heights before freeing the simulation.

`platec.mjs` contains both the JavaScript loader and its WebAssembly bytes. It has no runtime download or compiler dependency. Native WebAssembly exceptions, Emscripten 6.0.5 and the exact flags in `scripts/build-platec.ts` are part of the reproducible generator implementation. The module grows from 16 MiB to at most 128 MiB. Chronicle generates tectonic crust at a fixed 512 × 256 base resolution; the world generation modules own projection and refinement.

## Rebuild and verify

Everyday installation and startup use the committed artifact. A maintainer changing C++ source installs Emscripten **6.0.5** separately, then runs from the repository root:

```sh
CHRONICLE_EMXX=/path/to/emscripten/em++ node scripts/build-platec.ts
node scripts/build-platec.ts --check
node --test tests/tectonics.test.ts
```

If `em++` is already on `PATH`, the environment variable is optional. The script checks the compiler version, sorts the source inputs, builds a single ESM artifact, and records SHA-256 hashes of every C++ source/header, the wrapper, the rebuild script, the output artifact and its declaration. `--check` requires no compiler and rejects source, configuration or artifact drift. It is exercised by the headless regression suite, including deliberate mismatches in isolated copies.

Change `WORLD_GENERATOR_VERSION` whenever source, tuning or runtime changes revise released geography. A successful rebuild does not itself establish geographic acceptance or cross-version compatibility. Complete Chronicle's regression gate and visual review before a handoff.

## Local changes and evidence

- Delete the owned simulation in the public destruction API.
- Use all four bytes of the uint32 PRNG result as four-dimensional noise offsets. This replaces the upstream division/product formulas, removing their zero-divisor and signed-overflow cases and preventing seeds differing by 256 from sharing the initial field.
- Use one vertical noise cycle rather than duplicating the initial continent field.
- Increase initial noise scale from 0.593 to 4.0 so distinct crust cores can evolve into several continents; plate motion, folding and erosion still determine the resulting terrain. The runtime retains upstream's 0.65 initial sea fraction, two cycles and ten plates.

The final starting-field source passed seven native AddressSanitizer/UndefinedBehaviorSanitizer probes: seeds `42`, `298`, `50000`, `2436358115` and `4294967295` at 64 × 32, plus both formerly failing seeds `50000` and `2436358115` at 512 × 256. Every process exited successfully, returned finite heights and produced no sanitizer diagnostics. Initial fields for seeds 42 and 298 differ; the equivalent check failed against the earlier artifact. Two complete Emscripten rebuilds reproduced both the final artifact and its manifest byte for byte. These are bounded probes, not a comprehensive upstream audit.

The nine production tests exercise the committed WASM artifact, high uint32 seeds, A → B → A repeatability, buffer ownership, failure cleanup, memory growth, output validation, bounded work and deliberate integrity mismatches. Real generation also runs with ambient randomness, wall-clock reads and asset downloads forbidden. See the active Worldgen 01 brief for the full Chronicle gate and geographic review results. Platec's internal topology remains toroidal; Chronicle's geographic projection is a separate explicit step.

## Licenses

Upstream source headers grant LGPL 2.1 or any later version; upstream's root `LICENSE` contains LGPL 3. Chronicle distributes this vendored component under LGPL 3 or later, preserving both the original headers and the supplied license. `COPYING.GPL3` contains the GNU GPL version 3 text incorporated by LGPL 3. The complete library source and wrapper are available here so the WASM can be rebuilt and replaced independently.

The generated loader and standard runtime also contain Emscripten and its bundled libraries. Their notices are retained as `LICENSE.emscripten`, `LICENSE.musl`, `LICENSE.libcxx`, `LICENSE.libcxxabi`, and `LICENSE.compiler-rt`. Emscripten's bundled dlmalloc is Doug Lea's version 2.8.6, released to the public domain under CC0; its Emscripten-specific changes use the Emscripten license. These files were copied from the pinned Emscripten 6.0.5 toolchain. LGPL/GPL texts accompany this component; those licenses are not a declaration that unrelated Chronicle files use the same license.
