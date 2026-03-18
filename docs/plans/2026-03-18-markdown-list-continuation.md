# Markdown List Auto-Continuation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use skill /subagent-driven-development to execute this plan.

**Goal:** Add Enter (list continuation), Tab (indent), and Shift+Tab (un-indent) keyboard handling to both markdown editors so users can fluidly create checklists, bullet lists, and numbered lists.

**Architecture:** Pure utility functions in `markdown-toolbar.util.ts` that take text + cursor position and return new text + cursor position (or `null` to skip). A thin dispatcher function routes keyboard events. Both editor components call the dispatcher from their existing keydown handlers.

**Tech Stack:** TypeScript, Angular (signals, standalone components), Jasmine/Karma for tests.

---

### Task 1: handleEnterKey — helpers and implementation with tests

**depends_on:** none
**phase:** 1
**files:** `src/app/ui/inline-markdown/markdown-toolbar.util.ts`, `src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`

**Stubs:**

```typescript
// Regex to parse list lines into: (leading whitespace)(list prefix)(content)
// Order matters: checkbox before bullet so "- [ ] " matches before "- "
const LIST_PREFIX_REGEX = /^(\s*)(- \[[x ]\] |- |\d+\. )(.*)/i;

export const handleEnterKey = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => TextTransformResult | null;
```

**Step 1: Write the failing tests**

Add to `markdown-toolbar.util.spec.ts`:

```typescript
import {
  // ... existing imports ...
  handleEnterKey,
} from './markdown-toolbar.util';

// Add after the existing test suites:

describe('handleEnterKey', () => {
  it('should return null when no list prefix', () => {
    const result = handleEnterKey('hello world', 5, 5);
    expect(result).toBeNull();
  });

  it('should return null when selection spans multiple characters', () => {
    const result = handleEnterKey('- [ ] hello', 0, 5);
    expect(result).toBeNull();
  });

  it('should return null when cursor is before prefix end', () => {
    const result = handleEnterKey('- [ ] hello', 2, 2);
    expect(result).toBeNull();
  });

  it('should continue checkbox with unchecked prefix', () => {
    const text = '- [ ] Buy milk';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] Buy milk\n- [ ] ');
    expect(result!.selectionStart).toBe(21);
    expect(result!.selectionEnd).toBe(21);
  });

  it('should continue checked checkbox with unchecked prefix', () => {
    const text = '- [x] Done';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [x] Done\n- [ ] ');
    expect(result!.selectionStart).toBe(17);
  });

  it('should continue bullet list', () => {
    const text = '- Buy milk';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- Buy milk\n- ');
    expect(result!.selectionStart).toBe(13);
  });

  it('should continue numbered list with auto-increment', () => {
    const text = '3. Buy milk';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('3. Buy milk\n4. ');
    expect(result!.selectionStart).toBe(15);
  });

  it('should handle multi-digit number increment', () => {
    const text = '9. item';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('9. item\n10. ');
    expect(result!.selectionStart).toBe(12);
  });

  it('should degrade empty checkbox to bullet', () => {
    const text = '- [ ] ';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- ');
    expect(result!.selectionStart).toBe(2);
  });

  it('should degrade empty checked checkbox to bullet', () => {
    const text = '- [x] ';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- ');
    expect(result!.selectionStart).toBe(2);
  });

  it('should degrade empty bullet to blank line', () => {
    const text = '- ';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('');
    expect(result!.selectionStart).toBe(0);
  });

  it('should degrade empty numbered list to blank line', () => {
    const text = '1. ';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('');
    expect(result!.selectionStart).toBe(0);
  });

  it('should preserve indentation on continuation', () => {
    const text = '  - [ ] Buy milk';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - [ ] Buy milk\n  - [ ] ');
    expect(result!.selectionStart).toBe(25);
  });

  it('should preserve indentation on degradation', () => {
    const text = '  - [ ] ';
    const result = handleEnterKey(text, text.length, text.length);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - ');
    expect(result!.selectionStart).toBe(4);
  });

  it('should split line when cursor is in the middle', () => {
    const text = '- [ ] Buy milk';
    const result = handleEnterKey(text, 10, 10); // cursor after "Buy "
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] Buy \n- [ ] milk');
    expect(result!.selectionStart).toBe(17);
  });

  it('should handle Enter in middle of multi-line text', () => {
    const text = 'line 1\n- [ ] Buy milk\nline 3';
    const cursor = 7 + 14; // end of "- [ ] Buy milk"
    const result = handleEnterKey(text, cursor, cursor);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('line 1\n- [ ] Buy milk\n- [ ] \nline 3');
  });

  it('should degrade empty bullet in middle of text', () => {
    const text = '- [ ] task\n- \nline 3';
    const cursor = 13; // end of "- " on line 2
    const result = handleEnterKey(text, cursor, cursor);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] task\n\nline 3');
    expect(result!.selectionStart).toBe(11);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: FAIL (handleEnterKey is not exported)

**Step 3: Implement the helpers and handleEnterKey**

Add to `markdown-toolbar.util.ts` (after existing helper section, before inline formatting):

```typescript
// ============================================================================
// List auto-continuation helpers
// ============================================================================

/**
 * Regex to parse a list line into: (leading whitespace)(list prefix)(content)
 * Order: checkbox before bullet so "- [ ] " matches before "- "
 */
const LIST_PREFIX_REGEX = /^(\s*)(- \[[x ]\] |- |\d+\. )(.*)/i;

/**
 * Build the continuation prefix for the next line.
 * Checkboxes always continue as unchecked. Numbers auto-increment.
 */
const buildContinuationPrefix = (whitespace: string, prefix: string): string => {
  if (/^- \[[x ]\] $/i.test(prefix)) {
    return whitespace + '- [ ] ';
  }
  const numMatch = prefix.match(/^(\d+)\.\s$/);
  if (numMatch) {
    return whitespace + `${parseInt(numMatch[1], 10) + 1}. `;
  }
  return whitespace + prefix;
};

/**
 * Handle degradation of an empty list prefix:
 * checkbox → bullet, bullet/number → remove line content.
 */
const degradeEmptyPrefix = (
  text: string,
  lineStart: number,
  lineEnd: number,
  whitespace: string,
  prefix: string,
): TextTransformResult => {
  const isCheckbox = /^- \[[x ]\] $/i.test(prefix);
  if (isCheckbox) {
    const newLine = whitespace + '- ';
    const newText = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
    const cursorPos = lineStart + newLine.length;
    return { text: newText, selectionStart: cursorPos, selectionEnd: cursorPos };
  }
  const newText = text.substring(0, lineStart) + text.substring(lineEnd);
  return { text: newText, selectionStart: lineStart, selectionEnd: lineStart };
};

// ============================================================================
// Keyboard-driven list functions
// ============================================================================

/**
 * Handle Enter key on a list line.
 * Returns null if cursor is not on a list line (caller should not preventDefault).
 */
export const handleEnterKey = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult | null => {
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const { start: lineStart, end: lineEnd } = getLineRange(text, selectionStart);
  const currentLine = text.substring(lineStart, lineEnd);
  const match = currentLine.match(LIST_PREFIX_REGEX);
  if (!match) {
    return null;
  }
  const [, whitespace, prefix] = match;
  const prefixLen = whitespace.length + prefix.length;
  const cursorInLine = selectionStart - lineStart;
  if (cursorInLine < prefixLen) {
    return null;
  }
  const contentAfterPrefix = currentLine.substring(prefixLen);
  if (contentAfterPrefix.trim().length === 0) {
    return degradeEmptyPrefix(text, lineStart, lineEnd, whitespace, prefix);
  }
  const continuation = buildContinuationPrefix(whitespace, prefix);
  const before = text.substring(0, selectionStart);
  const after = text.substring(selectionStart);
  const newText = before + '\n' + continuation + after;
  const newCursor = selectionStart + 1 + continuation.length;
  return { text: newText, selectionStart: newCursor, selectionEnd: newCursor };
};
```

**Step 4: Run tests to verify they pass**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: PASS

**Step 5: Lint the file**

Run: `npm run checkFile src/app/ui/inline-markdown/markdown-toolbar.util.ts`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/ui/inline-markdown/markdown-toolbar.util.ts src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts
git commit -m "feat(notes): add handleEnterKey for list auto-continuation"
```

---

### Task 2: handleTabKey and handleShiftTabKey with tests

**depends_on:** Task 1
**phase:** 2
**files:** `src/app/ui/inline-markdown/markdown-toolbar.util.ts`, `src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`

**Step 1: Write the failing tests**

Add to `markdown-toolbar.util.spec.ts`:

```typescript
import {
  // ... existing imports ...
  handleTabKey,
  handleShiftTabKey,
} from './markdown-toolbar.util';

describe('handleTabKey', () => {
  it('should return null when no list prefix', () => {
    const result = handleTabKey('hello world', 0, 0);
    expect(result).toBeNull();
  });

  it('should return null when selection spans multiple characters', () => {
    const result = handleTabKey('- hello', 0, 3);
    expect(result).toBeNull();
  });

  it('should indent when cursor at position 0 of list line', () => {
    const text = '- [ ] task';
    const result = handleTabKey(text, 0, 0);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - [ ] task');
    expect(result!.selectionStart).toBe(2);
  });

  it('should indent when cursor at prefix end with no content', () => {
    const text = '- [ ] ';
    const result = handleTabKey(text, 6, 6);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - [ ] ');
    expect(result!.selectionStart).toBe(8);
  });

  it('should return null when cursor is in content text', () => {
    const text = '- [ ] hello';
    const result = handleTabKey(text, 8, 8);
    expect(result).toBeNull();
  });

  it('should return null when cursor at prefix end but content exists', () => {
    const text = '- [ ] hello';
    const result = handleTabKey(text, 6, 6);
    expect(result).toBeNull();
  });

  it('should indent bullet list at position 0', () => {
    const text = '- item';
    const result = handleTabKey(text, 0, 0);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - item');
    expect(result!.selectionStart).toBe(2);
  });

  it('should indent numbered list at prefix end with no content', () => {
    const text = '1. ';
    const result = handleTabKey(text, 3, 3);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  1. ');
    expect(result!.selectionStart).toBe(5);
  });

  it('should stack indentation', () => {
    const text = '  - [ ] ';
    const result = handleTabKey(text, 8, 8);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('    - [ ] ');
    expect(result!.selectionStart).toBe(10);
  });
});

describe('handleShiftTabKey', () => {
  it('should return null when no list prefix', () => {
    const result = handleShiftTabKey('hello world', 0, 0);
    expect(result).toBeNull();
  });

  it('should return null when selection spans multiple characters', () => {
    const result = handleShiftTabKey('  - hello', 0, 3);
    expect(result).toBeNull();
  });

  it('should return null when no leading whitespace', () => {
    const result = handleShiftTabKey('- [ ] task', 6, 6);
    expect(result).toBeNull();
  });

  it('should remove 2 spaces of indentation', () => {
    const text = '  - [ ] task';
    const result = handleShiftTabKey(text, 8, 8);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] task');
    expect(result!.selectionStart).toBe(6);
  });

  it('should remove only 1 space when only 1 exists', () => {
    const text = ' - [ ] task';
    const result = handleShiftTabKey(text, 7, 7);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] task');
    expect(result!.selectionStart).toBe(6);
  });

  it('should not move cursor before line start', () => {
    const text = '  - task';
    const result = handleShiftTabKey(text, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- task');
    expect(result!.selectionStart).toBe(0);
  });

  it('should un-indent in middle of multi-line text', () => {
    const text = 'line 1\n  - task\nline 3';
    const cursor = 7 + 4; // position within "  - task"
    const result = handleShiftTabKey(text, cursor, cursor);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('line 1\n- task\nline 3');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: FAIL (handleTabKey, handleShiftTabKey not exported)

**Step 3: Implement handleTabKey and handleShiftTabKey**

Add to `markdown-toolbar.util.ts` after `handleEnterKey`:

```typescript
/**
 * Handle Tab key to indent a list line by 2 spaces.
 * Only acts when cursor is at line start (position 0) or at prefix end with no content.
 * Returns null if conditions are not met (caller should not preventDefault).
 */
export const handleTabKey = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult | null => {
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const { start: lineStart, end: lineEnd } = getLineRange(text, selectionStart);
  const currentLine = text.substring(lineStart, lineEnd);
  const match = currentLine.match(LIST_PREFIX_REGEX);
  if (!match) {
    return null;
  }
  const [, whitespace, prefix, content] = match;
  const prefixLen = whitespace.length + prefix.length;
  const cursorInLine = selectionStart - lineStart;
  const atLineStart = cursorInLine === 0;
  const atEmptyPrefixEnd = cursorInLine === prefixLen && content.trim().length === 0;
  if (!atLineStart && !atEmptyPrefixEnd) {
    return null;
  }
  const indent = '  ';
  const newText = text.substring(0, lineStart) + indent + text.substring(lineStart);
  const newCursor = selectionStart + indent.length;
  return { text: newText, selectionStart: newCursor, selectionEnd: newCursor };
};

/**
 * Handle Shift+Tab to un-indent a list line by up to 2 spaces.
 * Returns null if line has no leading whitespace or no list prefix.
 */
export const handleShiftTabKey = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult | null => {
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const { start: lineStart, end: lineEnd } = getLineRange(text, selectionStart);
  const currentLine = text.substring(lineStart, lineEnd);
  if (!currentLine.match(LIST_PREFIX_REGEX)) {
    return null;
  }
  let spacesToRemove = 0;
  while (
    spacesToRemove < 2 &&
    spacesToRemove < currentLine.length &&
    currentLine[spacesToRemove] === ' '
  ) {
    spacesToRemove++;
  }
  if (spacesToRemove === 0) {
    return null;
  }
  const newText =
    text.substring(0, lineStart) +
    currentLine.substring(spacesToRemove) +
    text.substring(lineEnd);
  const newCursor = Math.max(lineStart, selectionStart - spacesToRemove);
  return { text: newText, selectionStart: newCursor, selectionEnd: newCursor };
};
```

**Step 4: Run tests to verify they pass**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: PASS

**Step 5: Lint the file**

Run: `npm run checkFile src/app/ui/inline-markdown/markdown-toolbar.util.ts`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/ui/inline-markdown/markdown-toolbar.util.ts src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts
git commit -m "feat(notes): add handleTabKey and handleShiftTabKey for list indentation"
```

---

### Task 3: handleListKeydown dispatcher with tests

**depends_on:** Task 2
**phase:** 3
**files:** `src/app/ui/inline-markdown/markdown-toolbar.util.ts`, `src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`

**Step 1: Write the failing tests**

Add to `markdown-toolbar.util.spec.ts`:

```typescript
import {
  // ... existing imports ...
  handleListKeydown,
} from './markdown-toolbar.util';

describe('handleListKeydown', () => {
  it('should dispatch Enter to handleEnterKey', () => {
    const text = '- [ ] task';
    const result = handleListKeydown(
      text,
      text.length,
      text.length,
      'Enter',
      false,
      false,
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] task\n- [ ] ');
  });

  it('should dispatch Tab to handleTabKey', () => {
    const text = '- [ ] ';
    const result = handleListKeydown(text, 6, 6, 'Tab', false, false);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('  - [ ] ');
  });

  it('should dispatch Shift+Tab to handleShiftTabKey', () => {
    const text = '  - [ ] task';
    const result = handleListKeydown(text, 8, 8, 'Tab', true, false);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('- [ ] task');
  });

  it('should return null for Ctrl+Enter', () => {
    const text = '- [ ] task';
    const result = handleListKeydown(
      text,
      text.length,
      text.length,
      'Enter',
      false,
      true,
    );
    expect(result).toBeNull();
  });

  it('should return null for unrelated keys', () => {
    const result = handleListKeydown('- [ ] task', 6, 6, 'a', false, false);
    expect(result).toBeNull();
  });

  it('should return null for Shift+Enter', () => {
    const text = '- [ ] task';
    const result = handleListKeydown(
      text,
      text.length,
      text.length,
      'Enter',
      true,
      false,
    );
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: FAIL (handleListKeydown not exported)

**Step 3: Implement handleListKeydown**

Add to `markdown-toolbar.util.ts` after `handleShiftTabKey`:

```typescript
/**
 * Dispatcher for list-related keyboard shortcuts.
 * Returns null if the key is not handled (caller should not preventDefault).
 */
export const handleListKeydown = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
  shiftKey: boolean,
  ctrlKey: boolean,
): TextTransformResult | null => {
  if (ctrlKey) {
    return null;
  }
  if (key === 'Enter' && !shiftKey) {
    return handleEnterKey(text, selectionStart, selectionEnd);
  }
  if (key === 'Tab' && !shiftKey) {
    return handleTabKey(text, selectionStart, selectionEnd);
  }
  if (key === 'Tab' && shiftKey) {
    return handleShiftTabKey(text, selectionStart, selectionEnd);
  }
  return null;
};
```

**Step 4: Run tests to verify they pass**

Run: `npm run test:file src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts`
Expected: PASS

**Step 5: Lint the file**

Run: `npm run checkFile src/app/ui/inline-markdown/markdown-toolbar.util.ts`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/ui/inline-markdown/markdown-toolbar.util.ts src/app/ui/inline-markdown/markdown-toolbar.util.spec.ts
git commit -m "feat(notes): add handleListKeydown dispatcher"
```

---

### Task 4: Wire InlineMarkdownComponent

**depends_on:** Task 3
**phase:** 4
**files:** `src/app/ui/inline-markdown/inline-markdown.component.ts`

**Step 1: Add import and update keypressHandler**

In `inline-markdown.component.ts`, add the import:

```typescript
import { handleListKeydown } from './markdown-toolbar.util';
```

Replace the existing `keypressHandler` method with:

```typescript
keypressHandler(ev: KeyboardEvent): void {
  this.resizeTextareaToFit();

  if ((ev.key === 'Enter' && ev.ctrlKey) || ev.code === 'Escape') {
    this.untoggleShowEdit();
    this.keyboardUnToggle.emit(ev);
    return;
  }

  const textarea = this.textareaEl()?.nativeElement;
  if (!textarea) {
    return;
  }
  const result = handleListKeydown(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    ev.key,
    ev.shiftKey,
    ev.ctrlKey,
  );
  if (result) {
    ev.preventDefault();
    textarea.value = result.text;
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    this.modelCopy.set(result.text);
    this.resizeTextareaToFit();
  }
}
```

**Step 2: Lint the file**

Run: `npm run checkFile src/app/ui/inline-markdown/inline-markdown.component.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/ui/inline-markdown/inline-markdown.component.ts
git commit -m "feat(notes): wire list keyboard handling to inline editor"
```

---

### Task 5: Wire DialogFullscreenMarkdownComponent

**depends_on:** Task 3
**phase:** 4
**files:** `src/app/ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.ts`

**Step 1: Update keydownHandler**

The fullscreen component already imports `* as MarkdownToolbar`. Update the `keydownHandler` method:

```typescript
keydownHandler(ev: KeyboardEvent): void {
  if (ev.key === 'Enter' && ev.ctrlKey) {
    this.close();
    return;
  }

  const textarea = this.textareaEl()?.nativeElement;
  if (!textarea) {
    return;
  }
  const result = MarkdownToolbar.handleListKeydown(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    ev.key,
    ev.shiftKey,
    ev.ctrlKey,
  );
  if (result) {
    ev.preventDefault();
    this.data.content = result.text;
    this._contentChanges$.next(result.text);
    setTimeout(() => {
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }
}
```

**Step 2: Lint the file**

Run: `npm run checkFile src/app/ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.ts
git commit -m "feat(notes): wire list keyboard handling to fullscreen editor"
```

---

## Phase Summary

| Phase | Tasks          | Parallel-safe                   |
| ----- | -------------- | ------------------------------- |
| 1     | Task 1         | Single task                     |
| 2     | Task 2         | Single task                     |
| 3     | Task 3         | Single task                     |
| 4     | Task 4, Task 5 | Yes — different component files |
