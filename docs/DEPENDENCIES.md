# Vendored dependencies

The repository contains ordinary source files, not submodules or network-fetched build dependencies. No dependency installation is necessary for verification. The compiler is supplied by Foundry's version manager and is not included in the repository.

| Dependency | Version | Vendored content | License |
| --- | --- | --- | --- |
| OpenZeppelin Contracts | `v5.0.2` | Nine-file import closure for ERC20, SafeERC20 and ReentrancyGuard | MIT, `lib/openzeppelin-contracts/LICENSE` |
| forge-std | `v1.9.7` | Complete `src/` for tests, including interfaces | MIT / Apache-2.0, `lib/forge-std/LICENSE-MIT` and `LICENSE-APACHE` |

Fetched archives and SHA-256 digests:

```text
https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.0.2
18c7b7e949b9a82dcd8cd394426c9c2636dfc263aa2317d4749dbfa0c7b3925a

https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.7
45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94
```

Library sources are unmodified. Remappings resolve exclusively to these files. forge-std declares many cheatcode interfaces; the project's tests do not call environment, filesystem, FFI or fork/RPC cheatcodes. `ffi = false` and `fs_permissions = []` are explicit in `foundry.toml`.
