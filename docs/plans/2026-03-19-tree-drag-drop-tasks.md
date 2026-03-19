# Tree-Based Drag-Drop for Tasks — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use skill /subagent-driven-development to execute this plan.

**Goal:** Replace the flat `cdkDropList`-based task list drag-drop with the existing `tree-dnd` component to enable subtask promotion, demotion, and cross-parent moves via drag.

**Architecture:** The `tree-dnd` component already supports before/after/inside drop zones with visual indicators. We bridge it to task state by converting `TaskWithSubTasks[]` → `TreeNode[]` on input, and translating `MoveInstruction` events → NgRx actions on output. A new `convertToSubTask` shared action handles demoting parent tasks. The tree-dnd component gets a small enhancement to support external drop list registration for cross-list connectivity.

**Tech Stack:** Angular 19+, Angular CDK drag-drop, NgRx, existing `tree-dnd` component (`src/app/ui/tree-dnd/`)

**Design doc:** `docs/plans/2026-03-19-tree-drag-drop-tasks-design.md`

---

### Task 1: Add `convertToSubTask` shared action

**depends_on:** none
**phase:** 1
**files:** `src/app/root-store/meta/task-shared.actions.ts`, `src/app/op-log/core/action-types.enum.ts`

**Context:** The inverse of `convertToMainTask`. When a parent task (with no subtasks) is dragged "inside" another parent task, we need to demote it to a subtask. This action must update multiple state slices atomically (task, project, tags) via the meta-reducer pattern.

**Stubs:**

```typescript
// In task-shared.actions.ts, add to the createActionGroup events:
convertToSubTask: (taskProps: {
  task: Task;
  newParentId: string;
  afterTaskId: string | null;
}) => ({
  ...taskProps,
  meta: {
    isPersistent: true,
    entityType: 'TASK',
    entityId: taskProps.task.id,
    opType: OpType.Update,
  } satisfies PersistentActionMeta,
})
```

**Step 1: Add action type enum**

In `src/app/op-log/core/action-types.enum.ts`, add after `TASK_SHARED_CONVERT_TO_MAIN`:

```typescript
TASK_SHARED_CONVERT_TO_SUB = '[Task Shared] convertToSubTask',
```

**Step 2: Add action to `TaskSharedActions`**

In `src/app/root-store/meta/task-shared.actions.ts`, add after the `convertToMainTask` entry (after line 48):

```typescript
convertToSubTask: (taskProps: {
  task: Task;
  newParentId: string;
  afterTaskId: string | null;
}) => ({
  ...taskProps,
  meta: {
    isPersistent: true,
    entityType: 'TASK',
    entityId: taskProps.task.id,
    opType: OpType.Update,
  } satisfies PersistentActionMeta,
}),
```

**Step 3: Run lint check**

```bash
npm run checkFile src/app/root-store/meta/task-shared.actions.ts
npm run checkFile src/app/op-log/core/action-types.enum.ts
```

**Step 4: Commit**

```bash
git add src/app/root-store/meta/task-shared.actions.ts src/app/op-log/core/action-types.enum.ts
git commit -m "feat(tasks): add convertToSubTask shared action"
```

---

### Task 2: Add `convertToSubTask` meta-reducer handler

**depends_on:** Task 1
**phase:** 2
**files:** `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts`

**Context:** This handler is the inverse of `handleConvertToMainTask` (lines 213-282). It must:
1. Remove task from `project.taskIds` (the ordering list for top-level tasks)
2. Remove task from all its tag `taskIds` lists
3. Clear the task's `tagIds` (subtasks inherit via parent's tags)
4. Set `parentId` to the new parent
5. Add task ID to new parent's `subTaskIds` using anchor-based positioning
6. Sync `projectId` to parent's `projectId`
7. Recalculate parent time estimates

**Reference:** Study `handleConvertToMainTask` (line 213) and the `moveSubTask` reducer in `src/app/features/tasks/store/task.reducer.ts` (line 292). Also reference helpers: `removeTaskFromParentSideEffects` in `task.reducer.util.ts` (line 351), `removeTasksFromList` and `updateProject` in `task-shared-helpers.ts`, and `moveItemAfterAnchor` in `work-context-meta.helper.ts` (line 13).

**Step 1: Add the handler function**

Add `handleConvertToSubTask` function before the `handleDeleteTask` function (before line 284). The function should:

```typescript
const handleConvertToSubTask = (
  state: RootState,
  task: Task,
  newParentId: string,
  afterTaskId: string | null,
): RootState => {
  const newParent = state[TASK_FEATURE_NAME].entities[newParentId] as Task;
  if (!newParent) {
    throw new Error('New parent task not found: ' + newParentId);
  }

  // 1. Update task entity: set parentId, clear tagIds, sync projectId
  const updatedTaskState = taskAdapter.updateOne(
    {
      id: task.id,
      changes: {
        parentId: newParentId,
        tagIds: [],
        projectId: newParent.projectId,
        modified: Date.now(),
      },
    },
    state[TASK_FEATURE_NAME],
  );

  // 2. Add to new parent's subTaskIds using anchor-based positioning
  const newParSubTaskIds = (updatedTaskState.entities[newParentId] as Task).subTaskIds;
  const taskStateWithParent = taskAdapter.updateOne(
    {
      id: newParentId,
      changes: {
        subTaskIds: moveItemAfterAnchor(task.id, afterTaskId, newParSubTaskIds),
      },
    },
    updatedTaskState,
  );

  // 3. Recalculate parent time estimates
  const taskStateFinal = reCalcTimesForParentIfParent(newParentId, taskStateWithParent);

  let updatedState: RootState = {
    ...state,
    [TASK_FEATURE_NAME]: taskStateFinal,
  };

  // 4. Remove task from project.taskIds (top-level ordering)
  if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
    const project = getProject(state, task.projectId);
    updatedState = updateProject(updatedState, task.projectId, {
      taskIds: removeTasksFromList(project.taskIds, [task.id]),
      backlogTaskIds: removeTasksFromList(project.backlogTaskIds, [task.id]),
    });
  }

  // 5. Remove task from all tag taskIds lists
  const tagIdsToUpdate = (task.tagIds || []).filter(
    (tagId) => state[TAG_FEATURE_NAME].entities[tagId],
  );
  const tagUpdates = tagIdsToUpdate.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: getTag(updatedState, tagId).taskIds.filter((id) => id !== task.id),
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
};
```

You'll need to add these imports at the top of the file:
- `moveItemAfterAnchor` from `../../../features/work-context/store/work-context-meta.helper`
- `reCalcTimesForParentIfParent` from `../../../features/tasks/store/task.reducer.util`

**Step 2: Register handler in `createActionHandlers`**

In `createActionHandlers` (line 697), add after the `convertToMainTask` handler entry (after line 709):

```typescript
[TaskSharedActions.convertToSubTask.type]: () => {
  const { task, newParentId, afterTaskId } = action as ReturnType<
    typeof TaskSharedActions.convertToSubTask
  >;
  return handleConvertToSubTask(state, task, newParentId, afterTaskId);
},
```

**Step 3: Run lint check**

```bash
npm run checkFile src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts
```

**Step 4: Commit**

```bash
git add src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts
git commit -m "feat(tasks): add convertToSubTask meta-reducer handler"
```

---

### Task 3: Write tests for `convertToSubTask`

**depends_on:** Task 2
**phase:** 3
**files:** `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts`

**Context:** Follow the same test pattern used by `convertToMainTask` tests (lines 345-408). The test creates mock state with a task and a target parent, dispatches `convertToSubTask`, and asserts the state changes.

**Step 1: Write tests**

Add a `describe('convertToSubTask action', ...)` block near the `convertToMainTask` tests. Tests should cover:

1. Task is removed from `project.taskIds`
2. Task is added to new parent's `subTaskIds`
3. Task's `parentId` is set to new parent
4. Task's `tagIds` are cleared
5. Task's `projectId` is synced to parent's `projectId`
6. Task is removed from tag `taskIds` lists
7. Anchor-based positioning: task placed after `afterTaskId` in parent's `subTaskIds`
8. When `afterTaskId` is `null`, task is prepended to `subTaskIds`

**Step 2: Run tests**

```bash
npm run test:file src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
```

Expected: all new tests PASS.

**Step 3: Commit**

```bash
git add src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
git commit -m "test(tasks): add tests for convertToSubTask meta-reducer"
```

---

### Task 4: Add external drop list registration to `tree-dnd`

**depends_on:** none
**phase:** 1
**files:** `src/app/ui/tree-dnd/tree.component.ts`, `src/app/ui/tree-dnd/tree.component.html`

**Context:** `tree-dnd` currently wraps all its drop lists in an internal `cdkDropListGroup` (line 7 of `tree.component.html`). This isolates its drop zones from external lists. The work-view needs UNDONE, DONE, BACKLOG trees to interconnect via `DropListService`. We add an optional input to disable the internal group and instead register each internal `cdkDropList` with an external service.

**Important:** The existing `tree-dnd` usage (sidebar nav tree) must continue working without changes. All new inputs default to the current behavior.

**Stubs:**

```typescript
// New inputs on TreeDndComponent:
readonly useExternalDropListGroup = input(false);
readonly dropListRegistration = input<{
  register: (dropList: CdkDropList, isSubList: boolean) => void;
  unregister: (dropList: CdkDropList) => void;
  connectedTo: Observable<CdkDropList[]>;
} | null>(null);
```

**Step 1: Add inputs to `tree.component.ts`**

After the `canDrop` input (line 64), add:

```typescript
readonly useExternalDropListGroup = input(false);
readonly dropListRegistration = input<{
  register: (dropList: CdkDropList, isSubList: boolean) => void;
  unregister: (dropList: CdkDropList) => void;
  connectedTo: Observable<CdkDropList[]>;
} | null>(null);
```

Add import for `Observable` from `rxjs`.

**Step 2: Update template to conditionally use `cdkDropListGroup`**

In `tree.component.html`, the root `<div class="tree">` currently always has `cdkDropListGroup`. Change it to be conditional:

Replace line 7 (`cdkDropListGroup`) with:
```html
[attr.cdkDropListGroup]="useExternalDropListGroup() ? null : ''"
```

Wait — `cdkDropListGroup` is a directive, not an attribute. We need a different approach. Wrap the tree content in two template branches:

Actually the simplest approach: always keep the `cdkDropListGroup` directive but when `useExternalDropListGroup` is true, also connect each internal `cdkDropList` to the external `connectedTo` list. The CDK allows both — `cdkDropListGroup` auto-connects siblings, but explicit `cdkDropListConnectedTo` overrides that behavior.

So:
- When `useExternalDropListGroup()` is false (default): current behavior, internal group connects everything.
- When `useExternalDropListGroup()` is true: each `cdkDropList` gets `[cdkDropListConnectedTo]` from the external registration's `connectedTo` observable, and registers/unregisters with the external service.

Update all three `cdkDropList` instances in `tree.component.html` (root list at line 11, and folder lists at line 100) to conditionally add `[cdkDropListConnectedTo]`:

For the root drop list (line 10-15):
```html
<div
  class="list list--root"
  cdkDropList
  [cdkDropListData]="{ parentId: 'root', items: nodes() }"
  [cdkDropListEnterPredicate]="canEnterList"
  [cdkDropListConnectedTo]="externalConnectedLists()"
  (cdkDropListDropped)="onDrop($event)"
>
```

For folder content drop lists (line 98-104):
```html
<div
  class="folder-content"
  cdkDropList
  [@expandCollapse]
  [cdkDropListData]="{ parentId: node.id, items: node.children ?? [] }"
  [cdkDropListEnterPredicate]="canEnterList"
  [cdkDropListConnectedTo]="externalConnectedLists()"
  (cdkDropListDropped)="onDrop($event)"
>
```

In the component, add a computed signal:

```typescript
readonly externalConnectedLists = computed(() => {
  const reg = this.dropListRegistration();
  if (!reg || !this.useExternalDropListGroup()) return [];
  // Return empty array - actual connection happens via DropListService registration
  return [];
});
```

Wait — `cdkDropListConnectedTo` when set to `[]` would disconnect from the group. The DropListService approach is better: register each cdkDropList with the service, and each list gets `connectedTo` from the service's observable.

Let me simplify. The approach should be:

1. Add `AfterViewInit` and `OnDestroy` lifecycle hooks (tree-dnd already has DestroyRef)
2. Use `viewChildren(CdkDropList)` to get all internal drop lists
3. When `useExternalDropListGroup` is true, register them with `dropListRegistration.register()` and pass `dropListRegistration.connectedTo` to each `[cdkDropListConnectedTo]`

Actually, looking at the existing `task-list.component.ts` pattern more carefully (line 122): it uses `viewChild(CdkDropList)` and registers in `ngAfterViewInit`. But tree-dnd creates drop lists dynamically as folders expand/collapse.

**Revised approach — use the `AsyncPipe` + DropListService directly:**

Add these to tree.component.ts:
```typescript
readonly externalConnectedLists = input<Observable<CdkDropList[]> | null>(null);
readonly dragDisabled = input(false);
```

Then in the template, for each `cdkDropList`:
```html
[cdkDropListConnectedTo]="useExternalDropListGroup() ? (externalConnectedLists() | async) ?? [] : []"
```

And add lifecycle management to register/unregister internal drop lists. Use `viewChildren` with a query for `CdkDropList`.

This is getting complex. Let me think about the cleanest approach...

**Cleanest approach:** Rather than modifying tree-dnd internals extensively, wrap the tree-dnd usage in task-list inside a `cdkDropListGroup`-free zone and let `DropListService` handle connectivity. The work-view's outer `cdkDropListGroup` already connects everything. We just need tree-dnd's internal lists to participate.

The simplest fix: **Remove the `cdkDropListGroup` from tree-dnd when used externally, and have each internal `cdkDropList` use `[cdkDropListConnectedTo]` bound to the external service.**

Implementation:

In `tree.component.html`, change line 7:
```html
[cdkDropListGroup]="useExternalDropListGroup() ? undefined : ''"
```

No — `cdkDropListGroup` is a structural directive. Can't conditionally apply it this way.

**Best approach**: Use `@if` to branch between two root wrappers:

```html
@if (useExternalDropListGroup()) {
  <div class="tree" role="tree" ...classes...>
    <ng-container *ngTemplateOutlet="treeContent"></ng-container>
  </div>
} @else {
  <div class="tree" role="tree" ...classes... cdkDropListGroup>
    <ng-container *ngTemplateOutlet="treeContent"></ng-container>
  </div>
}

<ng-template #treeContent>
  <!-- existing root drop list + indicator content -->
</ng-template>
```

And in this mode, each `cdkDropList` gets `[cdkDropListConnectedTo]` from the injected `DropListService`. The task-list wrapper injects `DropListService` and passes its `dropLists` observable.

**Step 3: Add registration lifecycle for external mode**

In `tree.component.ts`, add a `viewChildren` query for all `CdkDropList` instances and an effect that registers/unregisters them with the external service when they change:

```typescript
private readonly _dropLists = viewChildren(CdkDropList);

constructor() {
  // ... existing constructor code ...

  // Register internal drop lists with external service when in external mode
  effect(() => {
    const reg = this.dropListRegistration();
    const lists = this._dropLists();
    const useExternal = this.useExternalDropListGroup();
    if (!useExternal || !reg) return;
    for (const list of lists) {
      reg.register(list, !!list.data?.parentId && list.data.parentId !== 'root');
    }
  });

  this._destroyRef.onDestroy(() => {
    const reg = this.dropListRegistration();
    if (!reg) return;
    for (const list of this._dropLists()) {
      reg.unregister(list);
    }
  });
}
```

**Step 4: Run lint check**

```bash
npm run checkFile src/app/ui/tree-dnd/tree.component.ts
```

**Step 5: Commit**

```bash
git add src/app/ui/tree-dnd/tree.component.ts src/app/ui/tree-dnd/tree.component.html
git commit -m "feat(tree-dnd): add optional external drop list registration"
```

---

### Task 5: Create `tasksToTreeNodes` utility

**depends_on:** none
**phase:** 1
**files:** `src/app/features/tasks/task-list/task-list-tree.util.ts`

**Context:** Converts `TaskWithSubTasks[]` to `TreeNode<TaskWithSubTasks>[]` for the tree-dnd component. All top-level tasks become folders (`children: []` or populated with subtasks). Subtasks become leaf nodes (`children: undefined`). Respects `_hideSubTasksMode` filtering.

**Stubs:**

```typescript
import { TreeNode } from '../../../ui/tree-dnd/tree.types';
import { HideSubTasksMode, TaskWithSubTasks } from '../task.model';

export const tasksToTreeNodes = (
  tasks: TaskWithSubTasks[],
  currentTaskId: string | null,
): TreeNode<TaskWithSubTasks>[] => { ... };
```

**Step 1: Create the utility file**

Create `src/app/features/tasks/task-list/task-list-tree.util.ts`:

```typescript
import { TreeNode } from '../../../ui/tree-dnd/tree.types';
import { HideSubTasksMode, TaskWithSubTasks } from '../task.model';
import { MoveInstruction } from '../../../ui/tree-dnd/tree.types';

export const tasksToTreeNodes = (
  tasks: TaskWithSubTasks[],
  currentTaskId: string | null,
): TreeNode<TaskWithSubTasks>[] => {
  return tasks.map((task) => taskToTreeNode(task, currentTaskId));
};

const taskToTreeNode = (
  task: TaskWithSubTasks,
  currentTaskId: string | null,
): TreeNode<TaskWithSubTasks> => {
  const visibleSubTasks = filterSubTasks(
    task.subTasks || [],
    task._hideSubTasksMode,
    currentTaskId,
  );

  return {
    id: task.id,
    data: task,
    // All top-level tasks are folders (can accept subtask drops).
    // Subtasks are leaf nodes (children: undefined) — enforced by the
    // fact that this function is only called for top-level tasks.
    children: visibleSubTasks.map((subTask) => ({
      id: subTask.id,
      data: subTask as TaskWithSubTasks,
      // No children — enforces 2-level limit
    })),
    expanded: task._hideSubTasksMode !== HideSubTasksMode.HideAll,
  };
};

const filterSubTasks = (
  subTasks: TaskWithSubTasks[],
  hideMode: HideSubTasksMode | undefined,
  currentTaskId: string | null,
): TaskWithSubTasks[] => {
  if (!hideMode) return subTasks;
  if (hideMode === HideSubTasksMode.HideAll) return [];
  if (hideMode === HideSubTasksMode.HideDone) {
    return subTasks.filter(
      (subTask) => !subTask.isDone || subTask.id === currentTaskId,
    );
  }
  return subTasks;
};

/**
 * Translates a tree MoveInstruction's before/after/inside into
 * the anchor-based `afterTaskId` used by NgRx task actions.
 *
 * @param instruction - The MoveInstruction from tree-dnd
 * @param siblingIds - The ordered IDs of siblings at the target level
 * @returns afterTaskId (null = first position)
 */
export const getAfterTaskIdFromInstruction = (
  instruction: MoveInstruction,
  siblingIds: string[],
): string | null => {
  if (instruction.where === 'inside') {
    return null; // prepend to children
  }
  if (instruction.where === 'after') {
    return instruction.targetId as string;
  }
  // 'before': find the sibling immediately before targetId
  const targetIndex = siblingIds.indexOf(instruction.targetId as string);
  if (targetIndex <= 0) {
    return null; // first position
  }
  return siblingIds[targetIndex - 1];
};
```

**Step 2: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list-tree.util.ts
```

**Step 3: Commit**

```bash
git add src/app/features/tasks/task-list/task-list-tree.util.ts
git commit -m "feat(tasks): add tasksToTreeNodes and anchor translation utilities"
```

---

### Task 6: Write tests for `tasksToTreeNodes` and `getAfterTaskIdFromInstruction`

**depends_on:** Task 5
**phase:** 2
**files:** `src/app/features/tasks/task-list/task-list-tree.util.spec.ts`

**Context:** Unit tests for the tree conversion utility. Test node structure, subtask filtering by hide mode, and anchor translation.

**Step 1: Write tests**

Create `src/app/features/tasks/task-list/task-list-tree.util.spec.ts`:

Test `tasksToTreeNodes`:
1. Top-level tasks become nodes with `children` array (folder)
2. Subtasks become leaf nodes (no `children` property)
3. `HideSubTasksMode.HideAll` → children is empty, `expanded` is false
4. `HideSubTasksMode.HideDone` → done subtasks filtered except current task
5. No hide mode → all subtasks included, `expanded` is true
6. Task with no subtasks gets `children: []` (still a folder)

Test `getAfterTaskIdFromInstruction`:
1. `where === 'inside'` returns `null`
2. `where === 'after'` returns `targetId`
3. `where === 'before'` first item returns `null`
4. `where === 'before'` middle item returns preceding sibling ID

**Step 2: Run tests**

```bash
npm run test:file src/app/features/tasks/task-list/task-list-tree.util.spec.ts
```

Expected: all PASS.

**Step 3: Commit**

```bash
git add src/app/features/tasks/task-list/task-list-tree.util.spec.ts
git commit -m "test(tasks): add tests for tree conversion and anchor utilities"
```

---

### Task 7: Implement `onTreeMoved` handler in `task-list.component.ts`

**depends_on:** Task 1, Task 5
**phase:** 2
**files:** `src/app/features/tasks/task-list/task-list.component.ts`

**Context:** This is the core bridging logic. When tree-dnd emits a `MoveInstruction`, this handler determines which NgRx action to dispatch based on the drag source and target contexts.

**Reference files:**
- Current `_move()` method: `task-list.component.ts` lines 293-382
- `moveSubTask` action: `task.actions.ts` line 55
- `convertToMainTask`: `task-shared.actions.ts` line 36
- `convertToSubTask`: (created in Task 1)
- `moveTaskInTodayList`: `work-context-meta.actions.ts`
- `getAfterTaskIdFromInstruction`: (created in Task 5)

**Step 1: Add the `onTreeMoved` method**

Add a new method to `TaskListComponent`. The method receives a `MoveInstruction` and the current `TreeNode[]` state, then dispatches the appropriate NgRx action.

The logic branches on 4 scenarios:
1. **Subtask reorder / cross-parent** (both dragged item and target have parentId, or target is a folder): dispatch `moveSubTask`
2. **Subtask promoted to parent** (dragged has parentId, dropped before/after a root node): dispatch `convertToMainTask` + `moveTaskInTodayList`
3. **Parent demoted to subtask** (dragged has no parentId, dropped "inside" a root node): dispatch `convertToSubTask`
4. **Parent reorder** (both are root nodes, before/after): dispatch `moveTaskInTodayList` or `moveProjectTaskInBacklogList`

The method needs access to the full task data (not just IDs) to dispatch actions like `convertToMainTask` which require the `Task` object and parent tag IDs.

```typescript
async onTreeMoved(
  instruction: MoveInstruction,
  nodes: TreeNode<TaskWithSubTasks>[],
): Promise<void> {
  const dragNode = findNodeInTree(nodes, instruction.itemId);
  if (!dragNode?.data) return;
  const dragTask = dragNode.data;
  const isSubtask = !!dragTask.parentId;
  const targetNode = instruction.targetId
    ? findNodeInTree(nodes, instruction.targetId as string)
    : null;

  // ... dispatch logic based on scenarios above
}
```

The `findNodeInTree` helper traverses nodes recursively:
```typescript
const findNodeInTree = <T>(
  nodes: TreeNode<T>[],
  nodeId: string,
): TreeNode<T> | null => {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
};
```

Do NOT remove the existing `drop()`, `_move()`, `enterPredicate` methods yet — they'll be replaced in Task 9 when the template is swapped.

**Step 2: Add necessary imports**

Import `MoveInstruction`, `TreeNode` from tree-dnd types. Import `TaskSharedActions`, `getAfterTaskIdFromInstruction`, `moveSubTask`.

**Step 3: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.ts
```

**Step 4: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.ts
git commit -m "feat(tasks): add onTreeMoved handler for tree-dnd integration"
```

---

### Task 8: Add `canDropTask` predicate to `task-list.component.ts`

**depends_on:** none
**phase:** 1
**files:** `src/app/features/tasks/task-list/task-list.component.ts`

**Context:** The tree-dnd `canDrop` input receives `{ drag, drop, where }` and returns boolean. For tasks we enforce a strict 2-level hierarchy: parent tasks with subtasks cannot be nested, and subtasks cannot have children dropped inside them.

**Step 1: Add the predicate**

Add a `canDropTask` property to `TaskListComponent`:

```typescript
readonly canDropTask: CanDropPredicate<TaskWithSubTasks> = ({ drag, drop, where }) => {
  if (where !== 'inside' && where !== 'root') return true;
  if (where === 'root') return true;

  // drop is the target node
  if (!drop) return true;

  const dragTask = drag.data;
  const dropTask = drop.data;

  // Rule 1: Parent with subtasks cannot be nested inside another task
  if (dragTask && dragTask.subTasks?.length) return false;

  // Rule 2: Cannot drop inside a subtask (would create sub-sub-tasks)
  // Subtasks have children === undefined (leaf nodes)
  if (drop.children === undefined) return false;

  return true;
};
```

Import `CanDropPredicate` from `../../../ui/tree-dnd/tree.types`.

**Step 2: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.ts
```

**Step 3: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.ts
git commit -m "feat(tasks): add canDropTask predicate for 2-level hierarchy"
```

---

### Task 9: Replace task-list template with tree-dnd

**depends_on:** Task 4, Task 5, Task 7, Task 8
**phase:** 3
**files:** `src/app/features/tasks/task-list/task-list.component.html`, `src/app/features/tasks/task-list/task-list.component.ts`

**Context:** This is the main UI change. Replace the flat `cdkDropList` with `<tree-dnd>`, using `#treeFolder` and `#treeItem` templates to render `<task>` components. The tree-dnd handles nesting, visual indicators, and drop zone detection.

**Reference:** Current template is in `task-list.component.html`. Study `tree.component.html` (especially lines 73-93) for how templates are projected.

**Step 1: Update the component class**

In `task-list.component.ts`:

1. Add `TreeDndComponent` to imports array
2. Add a computed signal that converts tasks to tree nodes:
```typescript
treeNodes = computed<TreeNode<TaskWithSubTasks>[]>(() => {
  const tasks = this.filteredTasks();
  const currentId = this.currentTaskId() || null;
  return tasksToTreeNodes(tasks, currentId);
});
```
3. Remove old CDK imports no longer needed (`CdkDrag`, `CdkDragDrop`, `CdkDragStart`, `CdkDropList`)
4. Remove `enterPredicate`, `drop()` method, `_move()` method
5. Keep `trackByFn`, `expandDoneTasks`, `_addFromIssuePanel`
6. Keep `DropListService` injection for external list registration
7. Remove `ngAfterViewInit` drop list registration (tree-dnd handles this internally now)

**Step 2: Replace the template**

Replace `task-list.component.html` content. The new template:

```html
@if (isHideDone() || isHideAll()) {
  <div @expandFadeFast class="done-task-box">
    <button (click)="expandDoneTasks()" class="expand-tasks-btn" mat-button>
      <em>+ {{ isHideDone() ? doneTasksLength() + ' done ' : allTasksLength() }} sub tasks</em>
      <mat-icon>expand_more</mat-icon>
    </button>
  </div>
}

<tree-dnd
  [nodes]="treeNodes()"
  [canDrop]="canDropTask"
  [useExternalDropListGroup]="true"
  [dropListRegistration]="dropListRegistrationConfig"
  (moved)="onTreeMoved($event, treeNodes())"
  class="task-list-inner"
  [attr.data-id]="listModelId()"
>
  <ng-template #treeFolder let-node>
    <task
      [task]="node.data"
      [isInSubTaskList]="false"
      [isBacklog]="isBacklog()"
    ></task>
  </ng-template>

  <ng-template #treeItem let-node>
    <task
      [task]="node.data"
      [isInSubTaskList]="!!node.data?.parentId"
      [isBacklog]="isBacklog()"
    ></task>
  </ng-template>
</tree-dnd>

@if (noTasksMsg() && !allTasksLength()) {
  <div class="no-tasks">{{ noTasksMsg() }}</div>
}
```

Add a `dropListRegistrationConfig` property:
```typescript
readonly dropListRegistrationConfig = {
  register: (list: CdkDropList, isSub: boolean) =>
    this.dropListService.registerDropList(list, isSub),
  unregister: (list: CdkDropList) =>
    this.dropListService.unregisterDropList(list),
  connectedTo: this.dropListService.dropLists,
};
```

**Step 3: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.ts
npm run checkFile src/app/features/tasks/task-list/task-list.component.html
```

**Step 4: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.ts src/app/features/tasks/task-list/task-list.component.html
git commit -m "feat(tasks): replace flat cdkDropList with tree-dnd in task-list"
```

---

### Task 10: Remove nested subtask list from task.component

**depends_on:** Task 9
**phase:** 4
**files:** `src/app/features/tasks/task/task.component.html`, `src/app/features/tasks/task/task.component.ts`

**Context:** `task.component.html` (lines 297-326) renders a nested `<task-list>` for subtasks. Since tree-dnd now handles subtask nesting, this nested list must be removed to avoid double-rendering subtasks.

**Important:** Keep the `toggleSubTaskMode()` method and `_hideSubTasksMode` logic in `task.component.ts` — these still control visibility via the `tasksToTreeNodes` conversion. But the toggle button itself can be removed from the task template since the tree handles expand/collapse.

Wait — actually the toggle button should stay because the user needs a way to hide/show done subtasks or collapse all subtasks. The toggle in tree-dnd's folder expand just controls the tree node expansion, but `_hideSubTasksMode` is a persisted task property that filters *which* subtasks appear.

**Revised approach:** Keep the toggle button but move it to the `#treeFolder` template in task-list. Remove only the nested `<task-list>` from task.component.html.

**Step 1: Remove nested task-list from task.component.html**

Remove lines 297-326 (the `@if (t.subTasks?.length)` block containing the nested `<task-list>`). Keep the progress bar and everything else.

**Step 2: Add subtask toggle to the `#treeFolder` template in task-list**

In the `#treeFolder` template (task-list.component.html), add the toggle button next to the task component when the node has children:

```html
<ng-template #treeFolder let-node let-expanded="expanded" let-toggle="toggle">
  <task
    [task]="node.data"
    [isInSubTaskList]="false"
    [isBacklog]="isBacklog()"
  ></task>
</ng-template>
```

The toggle functionality is handled by the tree-dnd's `expanded` state and the task's `_hideSubTasksMode`. When the user clicks the toggle button on the task, it cycles through hide modes which changes the `treeNodes` computed signal (filtering children). The tree's visual expand/collapse follows from `expanded` being set in `tasksToTreeNodes`.

**Step 3: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task/task.component.html
npm run checkFile src/app/features/tasks/task/task.component.ts
npm run checkFile src/app/features/tasks/task-list/task-list.component.html
```

**Step 4: Commit**

```bash
git add src/app/features/tasks/task/task.component.html src/app/features/tasks/task/task.component.ts src/app/features/tasks/task-list/task-list.component.html
git commit -m "refactor(tasks): remove nested subtask list from task component"
```

---

### Task 11: Integrate ScheduleExternalDragService with tree-dnd

**depends_on:** Task 9
**phase:** 4
**files:** `src/app/features/tasks/task-list/task-list.component.ts`, `src/app/features/tasks/task-list/task-list.component.html`

**Context:** The current task-list calls `ScheduleExternalDragService.setActiveTask(task, dragRef)` on drag start and clears it on drag end. The schedule view reads this to enable dragging tasks onto the calendar. Tree-dnd fires `onDragStarted(nodeId)` and `onDragEnded()` but doesn't expose the full task data or `DragRef`.

**Approach:** Since tree-dnd uses `(cdkDragStarted)` and `(cdkDragEnded)` on each node's element, and we're using content projection via `#treeFolder`/`#treeItem` templates, we can't intercept CDK drag events from the template level. Instead, listen for tree-dnd's internal drag state changes via its `draggingId` signal.

Add an effect in `task-list.component.ts` that watches `draggingId`:

```typescript
// In constructor or as a field:
// This requires access to the tree-dnd component instance
readonly treeDnd = viewChild(TreeDndComponent);

constructor() {
  effect(() => {
    const tree = this.treeDnd();
    if (!tree) return;
    const dragId = tree.draggingId();
    if (dragId) {
      const task = this.findTaskById(dragId);
      if (task) {
        this._scheduleExternalDragService.setActiveTask(task);
      }
    } else {
      this._scheduleExternalDragService.setActiveTask(null);
    }
  });
}
```

Add helper:
```typescript
private findTaskById(taskId: string): TaskWithSubTasks | null {
  for (const task of this.tasks()) {
    if (task.id === taskId) return task;
    const subTask = task.subTasks?.find((st) => st.id === taskId);
    if (subTask) return subTask as TaskWithSubTasks;
  }
  return null;
}
```

Note: `setActiveTask` currently also takes a `DragRef` as second arg. Check if schedule view actually uses the DragRef. If it does, we may need to get it from tree-dnd or pass `null`.

**Step 1: Implement the effect and helper**

**Step 2: Handle `isCancelNextDrop`**

In `onTreeMoved`, check `this._scheduleExternalDragService.isCancelNextDrop()` at the start and return early if true (matching current `drop()` behavior at line 204-207).

**Step 3: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.ts
```

**Step 4: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.ts src/app/features/tasks/task-list/task-list.component.html
git commit -m "feat(tasks): integrate ScheduleExternalDragService with tree-dnd"
```

---

### Task 12: Handle auto-expand on drop into collapsed/hidden task

**depends_on:** Task 9
**phase:** 4
**files:** `src/app/features/tasks/task-list/task-list.component.ts`

**Context:** When a task is dropped "inside" a parent that has `_hideSubTasksMode === HideAll`, the subtasks are hidden and the dropped task would be invisible. The design says: accept the drop, then auto-expand subtasks by clearing `_hideSubTasksMode`.

**Step 1: Add auto-expand logic to `onTreeMoved`**

After dispatching the move action for an "inside" drop, check if the target task has `_hideSubTasksMode` set. If so, dispatch `toggleTaskHideSubTasks` to show subtasks:

```typescript
if (instruction.where === 'inside' && targetTask?._hideSubTasksMode) {
  this._taskService.showSubTasks(instruction.targetId as string);
}
```

Check what `showSubTasks` does — it should clear the hide mode.

**Step 2: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.ts
```

**Step 3: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.ts
git commit -m "feat(tasks): auto-expand subtasks when dropping into collapsed parent"
```

---

### Task 13: Update task-list SCSS for tree-dnd styling

**depends_on:** Task 9
**phase:** 4
**files:** `src/app/features/tasks/task-list/task-list.component.scss`

**Context:** The tree-dnd component adds its own structural CSS, but task-specific styling (backgrounds, spacing, drag handle appearance) needs to be adapted. The tree-dnd indicator line and "inside" highlight need to match the task list aesthetic.

**Reference:** `src/app/ui/tree-dnd/tree.component.scss` for tree-dnd's built-in styles. `src/app/features/tasks/task-list/task-list.component.scss` for current task list styles.

**Step 1: Read both SCSS files**

Read and understand current styling. Then adjust task-list.component.scss to:
- Remove CDK drop-list-specific styles (`.cdk-drag-preview`, `.cdk-drag-placeholder`)
- Add tree-dnd overrides: indicator line color matching theme, folder indent for subtasks, "inside" highlight using task theme colors
- Preserve task spacing, hover states, and background colors

**Step 2: Run lint check**

```bash
npm run checkFile src/app/features/tasks/task-list/task-list.component.scss
```

**Step 3: Commit**

```bash
git add src/app/features/tasks/task-list/task-list.component.scss
git commit -m "style(tasks): adapt task-list SCSS for tree-dnd integration"
```

---

### Task 14: Manual testing and edge case fixes

**depends_on:** Task 10, Task 11, Task 12, Task 13
**phase:** 5
**files:** (varies based on findings)

**Context:** Run the app and test all drag-drop scenarios manually. This is critical because drag-drop interactions are visual and depend on DOM timing.

**Step 1: Start the dev server**

```bash
ng serve
```

**Step 2: Test checklist**

Test each scenario in a project view with at least 3 parent tasks, some with subtasks:

- [ ] Drag subtask within same parent → reorders correctly
- [ ] Drag subtask to different parent (that already has subtasks) → moves correctly
- [ ] Drag subtask to parent with NO subtasks → creates subtask correctly
- [ ] Drag subtask before/after a top-level task → promotes to parent task
- [ ] Drag parent task (no subtasks) "inside" another parent → demotes to subtask
- [ ] Drag parent task (has subtasks) "inside" another → blocked (shows invalid cursor)
- [ ] Drag parent task before/after another parent → reorders correctly
- [ ] Toggle subtask visibility (hide all / hide done) → tree updates correctly
- [ ] Drop into collapsed parent → auto-expands and shows subtask
- [ ] Drag between UNDONE and DONE sections → moves correctly
- [ ] Drag between today and backlog → moves correctly (flat only)
- [ ] OVERDUE / LATER_TODAY lists → drag is disabled
- [ ] Schedule panel drag → still works
- [ ] Current (active) task dragged → keeps current-task status
- [ ] Tag view drag-drop → works same as project view

**Step 3: Fix any issues found**

**Step 4: Commit fixes**

```bash
git commit -m "fix(tasks): address edge cases in tree-dnd drag-drop"
```

---

### Task 15: Run full test suite

**depends_on:** Task 14
**phase:** 6
**files:** none (test run only)

**Step 1: Run unit tests**

```bash
npm test
```

Fix any failing tests. The `task-list.component.spec.ts` tests will likely need updates for the new template structure.

**Step 2: Run E2E tests**

```bash
npm run e2e -- --retries=0
```

Fix any failing E2E tests related to task drag-drop.

**Step 3: Run lint**

```bash
npm run lint
npm run prettier
```

**Step 4: Commit any fixes**

```bash
git commit -m "test(tasks): fix tests after tree-dnd migration"
```

---

## Phase Summary

| Phase | Tasks | Parallel-safe |
|-------|-------|---------------|
| 1 | Task 1 (action), Task 4 (tree-dnd enhancement), Task 5 (utility), Task 8 (predicate) | Yes — Task 1 touches `task-shared.actions.ts` + `action-types.enum.ts`, Task 4 touches `tree-dnd/`, Task 5 creates new file, Task 8 touches `task-list.component.ts` only adding a new property |
| 2 | Task 2 (reducer), Task 6 (utility tests), Task 7 (onTreeMoved handler) | Yes — Task 2 touches `task-shared-crud.reducer.ts`, Task 6 creates new spec file, Task 7 touches `task-list.component.ts` (different section than Task 8) |
| 3 | Task 3 (reducer tests), Task 9 (template swap) | No — Task 9 touches `task-list.component.ts` (same as Task 7/8, but they're done by now). Task 3 touches reducer spec (independent). Parallel-safe. |
| 4 | Task 10 (remove nested list), Task 11 (schedule drag), Task 12 (auto-expand), Task 13 (SCSS) | Yes — Task 10 touches `task.component.*`, Task 11 touches `task-list.component.ts` (adding effect), Task 12 touches `task-list.component.ts` (adding logic to onTreeMoved), Task 13 touches SCSS. Note: Tasks 11 and 12 both touch task-list.component.ts but different methods — serialized within the pair but parallel with 10/13. |
| 5 | Task 14 (manual testing) | Single task |
| 6 | Task 15 (full test suite) | Single task |
