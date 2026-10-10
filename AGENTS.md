# Project instructions

## Code style

- Follow a function-first approach: use functions, plain objects, and closures.
- Do not write application classes or custom Error subclasses. Use explicit
  return values for expected validation failures.
- Constructors from dependencies, such as discord.js builders and Client, are
  allowed when required by their APIs.
- Use English for code, comments, logs, errors, and documentation.

## Architecture

- Use a lightweight Feature-Sliced Design structure suited to this Discord bot.
- Keep `src/index.ts` as the entry point only. Put startup and application wiring
  in `src/app/`.
- Put user-facing capabilities in `src/features/<feature>/`, domain models and
  persistence in `src/entities/<entity>/`, and reusable utilities in `src/shared/`.
- Dependencies flow downward: `app` → `features` → `entities` → `shared`.
  A layer may skip intermediate layers; lower layers must not import higher ones.
- Expose feature and entity slices through their `index.ts` public APIs. Keep
  internal imports inside each slice.
- Add layers and segments only when there is actual code for them.

## Documentation

- Do not create or update `README.md` unless the user explicitly requests it.

## Verification

- Do not write, generate, or modify tests in this project.
- Use linting, type checking, formatting checks, builds, and manual verification.
- Preserve existing settings and verify resource paths when moving files.
