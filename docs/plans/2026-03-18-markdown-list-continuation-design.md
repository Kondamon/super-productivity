# Markdown List Auto-Continuation & Indentation

## Summary

Add keyboard-driven list continuation (Enter), indentation (Tab), and un-indentation (Shift+Tab) to both the inline and fullscreen markdown note editors. This makes creating checklists, bullet lists, and numbered lists fluid — matching the behavior of dedicated note-taking apps.

## Approach

Pure utility functions in `markdown-toolbar.util.ts` + minimal wiring in both editor components. No new dependencies, no DOM logic in utilities.

## New Utility Functions

Three functions added to `src/app/ui/inline-markdown/markdown-toolbar.util.ts`. All follow the existing signature pattern: `(text, selectionStart, ...) → TextTransformResult | null`. Returning `null` means "not handled — let the browser do the default."

### `handleEnterKey(text, selectionStart)`

Detects the current line's prefix and inserts a continuation line.

| Current line       | Has content? | Result                             |
| ------------------ | ------------ | ---------------------------------- |
| `  - [ ] Buy milk` | yes          | Insert `\n  - [ ] `                |
| `  - [x] Done`     | yes          | Insert `\n  - [ ] ` (unchecked)    |
| ` - [ ]`           | no           | Replace prefix with ` -` (degrade) |
| ` - [x]`           | no           | Replace prefix with ` -` (degrade) |
| ` -`               | no           | Replace with blank line            |
| `  - Buy milk`     | yes          | Insert `\n  - `                    |
| `  3. Buy milk`    | yes          | Insert `\n  4. ` (auto-increment)  |
| ` 3.`              | no           | Replace with blank line            |
| No list prefix     | —            | Return `null`                      |

When cursor is in the middle of text, the line splits at the cursor: text after cursor moves to the new line with the prefix.

### `handleTabKey(text, selectionStart)`

Adds 2 spaces at the start of the current line. Only acts when:

- Cursor is at position 0 of the line, OR
- Cursor is right after the prefix and no content text follows

Returns `null` otherwise (Tab keeps default browser behavior).

### `handleShiftTabKey(text, selectionStart)`

Removes up to 2 leading spaces from the current line. Returns `null` if the line has no leading whitespace.

## Component Integration

### Shared helper

A small function `applyKeyboardShortcut(ev, textarea) → TextTransformResult | null` checks `ev.key` and delegates to the appropriate utility. Both components call this, then apply the result in their own model-update style.

### Inline editor (`InlineMarkdownComponent`)

In `keypressHandler()` (bound to `keydown`):

1. Call shared helper
2. If result: `preventDefault()`, set `textarea.value`, update `modelCopy` signal, call `resizeTextareaToFit()`
3. If null: fall through to existing logic

### Fullscreen editor (`DialogFullscreenMarkdownComponent`)

In `keydownHandler()`:

1. Call shared helper
2. If result: `preventDefault()`, set `data.content`, emit to `_contentChanges$`, restore selection in `setTimeout`
3. If null: fall through to existing logic

## Edge Cases

| Scenario                        | Behavior                                           |
| ------------------------------- | -------------------------------------------------- |
| Multiple lines selected + Enter | Return `null` — browser default                    |
| Tab with no list prefix         | Return `null` — don't capture Tab                  |
| Shift+Tab with 0 indent         | Return `null`                                      |
| `- [x] ` empty + Enter          | Degrades to `- ` (same as unchecked)               |
| Numbered list increment         | Current number + 1; no re-numbering of later lines |

## Files Modified

| File                                                                            | Change                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app/ui/inline-markdown/markdown-toolbar.util.ts`                           | Add `handleEnterKey`, `handleTabKey`, `handleShiftTabKey` + shared helper |
| `src/app/ui/inline-markdown/inline-markdown.component.ts`                       | Wire keydown to shared helper                                             |
| `src/app/ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.ts` | Wire keydown to shared helper                                             |
| `src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`                      | Unit tests for all new functions                                          |

## Testing

All core logic lives in pure functions — unit tests cover every row in the behavior tables above. No component-level or E2E tests needed for the core logic.
