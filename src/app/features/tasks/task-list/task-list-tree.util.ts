import { TreeNode, MoveInstruction } from '../../../ui/tree-dnd/tree.types';
import { HideSubTasksMode, Task, TaskWithSubTasks } from '../task.model';

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
    // Subtasks are leaf nodes (children: undefined) -- enforced by the
    // fact that this function is only called for top-level tasks.
    children: visibleSubTasks.map((subTask) => ({
      id: subTask.id,
      data: subTask as TaskWithSubTasks,
      // No children -- enforces 2-level limit
    })),
    expanded: task._hideSubTasksMode !== HideSubTasksMode.HideAll,
  };
};

const filterSubTasks = (
  subTasks: Task[],
  hideMode: HideSubTasksMode | undefined,
  currentTaskId: string | null,
): Task[] => {
  if (!hideMode) return subTasks;
  if (hideMode === HideSubTasksMode.HideAll) return [];
  if (hideMode === HideSubTasksMode.HideDone) {
    return subTasks.filter((subTask) => !subTask.isDone || subTask.id === currentTaskId);
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
    return instruction.targetId || null;
  }
  // 'before': find the sibling immediately before targetId
  const targetIndex = siblingIds.indexOf(instruction.targetId as string);
  if (targetIndex <= 0) {
    return null; // first position
  }
  return siblingIds[targetIndex - 1];
};
