# Bundled skill sources

These upstream directories are preserved unchanged, including their supporting files. This kit
hosts them using [workflows/adapter.md](../workflows/adapter.md). Our integration code and adapter
are separate from upstream files, making local changes and later upgrades reviewable.

| Source | Pinned commit | Included skills | Licence |
|---|---|---|---|
| [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills/tree/bf1ff076e25f8da4a339eb1c8cf03361fea5ea4c) | `bf1ff076e25f8da4a339eb1c8cf03361fea5ea4c` | baoyu-infographic, baoyu-cover-image, baoyu-article-illustrator | [MIT, Copyright 2026 Jim Liu](baoyu/LICENSE) |
| [Leonxlnx/imagegen-skills](https://github.com/Leonxlnx/imagegen-skills/tree/beb16b0d0f4dae9a6f5cb04ea41e97b93a54ab8e) | `beb16b0d0f4dae9a6f5cb04ea41e97b93a54ab8e` | brandkit, imagegen-frontend-web, imagegen-frontend-mobile | [MIT, Copyright 2026 Leonxlnx](leon/LICENSE) |

[sources.lock.json](sources.lock.json) records the source commits and SHA-256 of every preserved
file. Generation verifies the selected skill's files and licence before dispatch; the workflow
digest and commit are recorded with the job. `doctor` verifies all six workflows.

```sh
python3 tools/vendor-skills.py
python3 tools/vendor-skills.py --fetch-missing
```

The first command verifies all files offline. The second can restore missing files from the
pinned GitHub commit. It does not overwrite changed files or upgrade to a floating branch.
Review a new upstream revision and its licence/resources before intentionally updating the
bundle and lock. Keep the original directory layout so relative resource links still work.
Re-run the verifier, regression tests and a relevant live job after an upgrade.

The host adapter replaces upstream generation wrappers, setup prompts, batch defaults and
output storage. It preserves the requested asset count, area guidance and built-in image_gen
transport. Applicable art-direction references still need to be read; merely listing a skill
name is not integration. The selected workflow appears in the job receipt for inspection.
