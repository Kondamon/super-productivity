# Tree-Based Drag-Drop for Tasks

**Date:** 2026-03-19
**Status:** Approved

## Problem

Subtasks can only be reordered within their parent task. Users cannot:
- Drag a subtask to a different parent that has no subtasks yet
- Promote a subtask to a parent task via drag
- Demote a parent task (without subtasks) into another parent task via drag

These operations are common in project workflows and should feel natural.

## Approach

Replace the flat `cdkDropList` in `task-list.component` with the existing `tree-dnd` component. This component already supports before/after/inside drop zones, visual indicators, and ancestor validation.

## Scope

Applies everywhere `task-list` is used: project work view (UNDONE, DONE, BACKLOG, OVERDUE), tag views, and any other context.

## Constraints

- **2-level limit**: Parent tasks and subtasks only. No sub-sub-tasks.
- **DONE/UNDONE stay separate**: Each section is its own `tree-dnd` instance.
- **Cross-list moves stay flat**: Dragging between backlog and today only moves top-level tasks (no compound move + re-parent).

## Data Bridging

### Input: Tasks to TreeNodes

Convert `TaskWithSubTasks[]` to `TreeNode<TaskWithSubTasks>[]`:
- All top-level tasks become nodes with `children: []` (folders), so they can always accept subtask drops.
- Subtasks become leaf nodes with `children: undefined`.
- Task data is stored in `TreeNode.data`.
- `_hideSubTasksMode` filters children before passing to tree-dnd. Dropping into a HideAll task auto-expands it.

### Output: MoveInstruction to NgRx Actions

| MoveInstruction | NgRx Action |
|---|---|
| Subtask before/after sibling (same parent) | `moveSubTask` (same srcTaskId/targetTaskId) |
| Subtask inside another parent | `moveSubTask` (cross-parent) |
| Subtask before/after a top-level task | `convertToMainTask` + `moveTaskInTodayList` |
| Parent (no children) inside another parent | New `convertToSubTask` action |
| Parent before/after another parent | `moveTaskInTodayList` / `moveProjectTaskInBacklogList` |

### Anchor Translation

NgRx actions use `afterTaskId` for positioning. Tree-dnd gives `{ targetId, where }`:
- `where === 'after'` -> `afterTaskId = targetId`
- `where === 'before'` -> `afterTaskId = sibling before targetId`, or `null` for first position
- `where === 'inside'` -> `afterTaskId = null` (prepend to children)

## canDrop Predicate

```
canDrop({ drag, drop, where }):
  if drag has children AND where === 'inside' -> false   // parent with subtasks can't nest
  if drop has no children array AND where === 'inside' -> false  // can't create sub-sub-tasks
  -> true  // everything else allowed (tree-dnd prevents self/ancestor drops)
```

## Template Integration

Tree-dnd uses `#treeFolder` and `#treeItem` content templates:
- `#treeFolder`: Renders `<task>` component for parent tasks with subtasks. Includes the toggle button for subtask visibility.
- `#treeItem`: Renders `<task>` component for leaf tasks (subtasks and childless parents).

The existing `<task>` component is unchanged. The nested `<task-list>` currently rendered inside `task.component.html` (lines 297-326) is removed since tree-dnd handles nesting.

## Cross-List Connectivity

### Problem
Tree-dnd uses its own internal `cdkDropListGroup`. The work-view wraps all lists in an outer `cdkDropListGroup`. These are isolated.

### Solution
Add an optional input to tree-dnd to disable its internal `cdkDropListGroup`. When disabled, tree-dnd's internal drop lists register with `DropListService`, joining the shared pool alongside DONE/UNDONE/BACKLOG lists. This enables cross-list dragging.

## Issue Panel Integration

Issue panel items (`SearchResultItem`) have a different schema than tasks. The `task-list` wrapper intercepts CDK drop events, checks for `issueData`, and routes to `_addFromIssuePanel()` before tree-dnd processes the event.

## Schedule Drag Integration

`ScheduleExternalDragService.setActiveTask()` is called from tree-dnd's template callbacks. The `#treeFolder`/`#treeItem` templates have access to `node.data` (the full task), so they can call the service on `(cdkDragStarted)` / `(cdkDragEnded)`.

## New Action: convertToSubTask

Inverse of `convertToMainTask`. Defined in `task-shared.actions.ts` with meta-reducer in `task-shared-crud.reducer.ts`.

Steps:
1. Remove task from `project.taskIds` ordering
2. Remove task from all its tag `taskIds`
3. Clear the task's `tagIds` (subtasks inherit via parent)
4. Set `parentId` to new parent's ID
5. Add to new parent's `subTaskIds` at specified position
6. Set `projectId` to parent's `projectId`

## Animations

- Task reorder animations use tree-dnd's `justDroppedId` flash mechanism instead of `@taskList` trigger.
- Tree-dnd's `expandCollapseAni` handles folder expand/collapse.
- `DropListService.blockAniTrigger$` is no longer needed for tree-based lists.

## Components Changed

| File | Change |
|---|---|
| `task-list.component.ts/html` | Replace `cdkDropList` with `<tree-dnd>`, add TreeNode conversion, add MoveInstruction handler |
| `task.component.html` | Remove nested `<task-list>` for subtasks (lines 297-326) |
| `tree.component.ts/html` | Add optional input to disable internal `cdkDropListGroup` and use external registration |
| `task-shared.actions.ts` | Add `convertToSubTask` action |
| `task-shared-crud.reducer.ts` | Add `convertToSubTask` reducer logic |

## New Code

| What | Where |
|---|---|
| `tasksToTreeNodes()` | Utility in task-list or helper file |
| `treeInstructionToNgrxAction()` | Handler in task-list component |
| `anchorFromTreeInstruction()` | Small utility for before/after -> afterTaskId |
| `convertToSubTask` action + reducer | task-shared actions/reducer |

## Edge Cases

| Scenario | Behavior |
|---|---|
| Drop inside task with HideAll | Accept drop, auto-expand subtasks |
| Drag last subtask out | Parent becomes childless, keeps `children: []` for future drops |
| Current task dragged | Keeps current-task status regardless of position |
| Task with issue link | Dragged normally, issue links are orthogonal |
| OVERDUE / LATER_TODAY lists | Drag disabled via `cdkDragDisabled` / `isSortingDisabled` |
| Backlog large list (100+ tasks) | Maintain existing delay-based rendering from backlog component |
