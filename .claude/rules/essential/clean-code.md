---
description: Guidelines for writing clean, maintainable, and human-readable code. Apply these rules when writing or reviewing code to ensure consistency and quality.
globs: **/*.ts, **/*.tsx
---
# Clean Code Guidelines

## Constants Over Magic Numbers
- Replace hard-coded values with named constants
- Use descriptive constant names that explain the value's purpose
- Keep constants at the top of the file or in a dedicated constants file

## Meaningful Names
- Variables, functions, and classes should reveal their purpose
- Names should explain why something exists and how it's used
- Avoid abbreviations unless they're universally understood
- Functions follow verb-noun pattern: `fetchMarketData`, `calculateSimilarity`, `isValidEmail`
- Booleans use `is/has/can` prefix: `isLoading`, `hasError`, `canSubmit`

## Smart Comments
- Don't comment on what the code does - make the code self-documenting
- Use comments to explain why something is done a certain way
- Document APIs, complex algorithms, and non-obvious side effects

## Single Responsibility
- Each function should do exactly one thing
- Functions should be small and focused
- If a function needs a comment to explain what it does, it should be split

## DRY (Don't Repeat Yourself)
- Extract repeated code into reusable functions
- Share common logic through proper abstraction
- Maintain single sources of truth

## Clean Structure
- Keep related code together
- Organize code in a logical hierarchy
- Use consistent file and folder naming conventions

## Encapsulation
- Hide implementation details
- Expose clear interfaces
- Move nested conditionals into well-named functions

## Early Returns Over Deep Nesting
- Use guard clauses to return early instead of nesting
- Prefer flat code flow over deeply nested if/else chains
- Target: no more than 3 levels of nesting

## Immutability
- Never mutate objects or arrays directly
- Use spread operator for updates: `{ ...obj, key: value }`, `[...arr, item]`
- Treat function parameters as read-only

## Type Safety
- Never use `any` — use `unknown`, specific types, or generics instead
- Define explicit interfaces for all data structures
- Use return type annotations on all exported functions

## Code Quality Maintenance
- Refactor continuously
- Fix technical debt early
- Leave code cleaner than you found it


## Surgical Changes
- Every diff line must trace back to the user's request; leave unrelated code alone
- Don't "improve" adjacent code, comments, or formatting, even if you'd do it differently
- Match existing style, even if you prefer another approach
- Surface unrelated dead code or issues — mention them, don't silently delete or fix
- Only clean up orphans caused by YOUR changes (unused imports/variables/functions); don't touch pre-existing dead code

## Version Control
- Write clear commit messages
- Make small, focused commits
- Use meaningful branch names 